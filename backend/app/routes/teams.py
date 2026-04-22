"""Teams, members, invites, and team-scoped sub-resources.

All team-scoped resources (companies, contacts, seed, export) now live under
`/api/teams/{team_slug}/...`. The global `/api/companies` and `/api/contacts`
prefixes from V1 no longer exist.
"""
from __future__ import annotations

import io
import json
import logging
import secrets
import tempfile
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError
from rapidfuzz import fuzz

from ..auth import get_current_user
from ..config import PROJECT_ROOT
from ..db import get_db
from ..models import (
    AcceptInviteRequest,
    AcceptInviteResponse,
    CompanyCreate,
    CompanyDetailOut,
    CompanyOut,
    CompanyReorderRequest,
    CompanyUpdate,
    ContactCreate,
    ContactMove,
    ContactOut,
    ContactUpdate,
    SeedResponse,
    TeamCreateRequest,
    TeamDetailOut,
    TeamInviteCreateRequest,
    TeamInviteOut,
    TeamMemberOut,
    TeamMemberRoleUpdate,
    TeamOut,
    TeamSummaryOut,
    TeamUpdateRequest,
    TeamICPsUpdateRequest,
    CompanyICPsUpdateRequest,
    ICP,
)
from ..icp import match_keyword as icp_match_keyword, llm_match_titles
from ..taxonomy import classify
from ..teams import (
    generate_unique_team_slug,
    require_team_member,
    require_team_role,
    role_weight,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["teams"])


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

PRIORITY_ORDER = {"P1+": 0, "P1": 1, "P2": 2, "P3": 3, "": 9}

CATEGORY_LABELS = {
    "c_level": "C-Level",
    "digital": "Digital",
    "data_ai": "Data/AI",
    "it_is": "IT/IS",
    "medical": "Medical Affairs",
    "market_access": "Market Access",
    "commercial": "Commercial Excellence",
    "rd_clinical": "R&D/Clinical",
    "hr": "HR/People",
    "marketing": "Marketing/Brand",
    "quality": "Regulatory/Quality",
    "other": "",
}


def _safe_oid(raw: str, label: str = "Resource") -> ObjectId:
    try:
        return ObjectId(raw)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label} not found")


def _company_slugify(name: str) -> str:
    import re
    nf = unicodedata.normalize("NFKD", name)
    nf = "".join(c for c in nf if not unicodedata.combining(c))
    nf = re.sub(r"[^a-zA-Z0-9]+", "_", nf).strip("_").lower()
    return nf or "company"


def _normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip()


def _is_techtomed(contact_name: str, known_names_norm: list[str]) -> bool:
    if not contact_name:
        return False
    candidate = _normalize(contact_name)
    for known in known_names_norm:
        if not known:
            continue
        score = fuzz.token_sort_ratio(candidate, known)
        if score >= 85:
            return True
    return False


async def _next_position(
    db, team_id: ObjectId, company_id: ObjectId, level: int
) -> int:
    cursor = db.contacts.find(
        {"team_id": team_id, "company_id": company_id, "level": level},
        {"position_in_level": 1},
    ).sort("position_in_level", -1).limit(1)
    async for doc in cursor:
        return int(doc.get("position_in_level", 0)) + 1
    return 0


def _invite_code() -> str:
    """Generate a 10-char url-safe code."""
    # token_urlsafe yields ~1.3 chars per byte; 8 bytes → ~11 chars; slice to 10.
    return secrets.token_urlsafe(8)[:10]


# ===========================================================================
# Teams
# ===========================================================================


@router.get("/teams", response_model=list[TeamSummaryOut])
async def list_my_teams(
    user: dict[str, Any] = Depends(get_current_user),
) -> list[TeamSummaryOut]:
    db = get_db()
    out: list[TeamSummaryOut] = []
    async for m in db.team_members.find({"user_id": user["_id"]}):
        team = await db.teams.find_one({"_id": m["team_id"]})
        if not team:
            continue
        members_count = await db.team_members.count_documents({"team_id": team["_id"]})
        # Exclude soft-deleted companies from the visible count.
        companies_count = await db.companies.count_documents(
            {
                "team_id": team["_id"],
                "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
            }
        )
        out.append(
            TeamSummaryOut.model_validate(
                {
                    **team,
                    "role": m["role"],
                    "members_count": members_count,
                    "companies_count": companies_count,
                }
            )
        )
    # Sort: personal space first, then by created_at ASC (stable tie-break on name).
    def _sort_key(t: TeamSummaryOut) -> tuple:
        return (
            0 if getattr(t, "is_personal", False) else 1,
            t.created_at or datetime.min.replace(tzinfo=timezone.utc),
            t.name.lower(),
        )
    out.sort(key=_sort_key)
    return out


@router.post("/teams", response_model=TeamDetailOut, status_code=status.HTTP_201_CREATED)
async def create_team(
    payload: TeamCreateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> TeamDetailOut:
    db = get_db()
    now = datetime.now(tz=timezone.utc)
    slug = await generate_unique_team_slug(db, payload.name)
    team_doc = {
        "name": payload.name.strip(),
        "slug": slug,
        "owner_id": user["_id"],
        "is_personal": False,
        "created_at": now,
        "updated_at": now,
        "settings": {"default_currency": ""},
    }
    try:
        res = await db.teams.insert_one(team_doc)
    except DuplicateKeyError:
        # Race on slug: retry once with a forced suffix.
        slug = await generate_unique_team_slug(db, payload.name)
        team_doc["slug"] = slug
        res = await db.teams.insert_one(team_doc)
    team_doc["_id"] = res.inserted_id
    # Membership = owner
    await db.team_members.insert_one(
        {
            "team_id": res.inserted_id,
            "user_id": user["_id"],
            "role": "owner",
            "joined_at": now,
            "invited_by": None,
        }
    )
    log.info("Team %s created by %s", slug, user.get("email"))
    return TeamDetailOut.model_validate(
        {
            **team_doc,
            "role": "owner",
            "members": [],
            "members_count": 1,
            "companies_count": 0,
        }
    )


@router.get("/teams/{slug}", response_model=TeamDetailOut)
async def get_team(
    slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> TeamDetailOut:
    db = get_db()
    team, membership = await require_team_member(db, slug, user)
    members = await _list_team_members(db, team["_id"])
    companies_count = await db.companies.count_documents(
        {
            "team_id": team["_id"],
            "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
        }
    )
    return TeamDetailOut.model_validate(
        {
            **team,
            "role": membership["role"],
            "members": [m.model_dump(by_alias=True) for m in members],
            "members_count": len(members),
            "companies_count": companies_count,
        }
    )


@router.patch("/teams/{slug}", response_model=TeamDetailOut)
async def update_team(
    slug: str,
    payload: TeamUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> TeamDetailOut:
    db = get_db()
    team, membership = await require_team_role(db, slug, user, "admin")
    updates: dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if updates:
        updates["updated_at"] = datetime.now(tz=timezone.utc)
        updated = await db.teams.find_one_and_update(
            {"_id": team["_id"]}, {"$set": updates}, return_document=True
        )
    else:
        # Nothing to update; return current state unchanged.
        updated = team
    members = await _list_team_members(db, team["_id"])
    companies_count = await db.companies.count_documents(
        {
            "team_id": team["_id"],
            "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
        }
    )
    return TeamDetailOut.model_validate(
        {
            **updated,
            "role": membership["role"],
            "members": [m.model_dump(by_alias=True) for m in members],
            "members_count": len(members),
            "companies_count": companies_count,
        }
    )


@router.patch("/teams/{slug}/icps", response_model=TeamDetailOut)
async def update_team_icps(
    slug: str,
    payload: TeamICPsUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> TeamDetailOut:
    """Replace the team's ICP list and/or toggle the LLM fallback.

    On ICP change, this also recomputes `icp_match_ids` on every contact in
    the team via the *keyword* matcher (LLM fallback is explicit via the
    /recompute-llm endpoint, to avoid surprise API spend).
    """
    db = get_db()
    team, membership = await require_team_role(db, slug, user, "admin")
    updates: dict[str, Any] = {}
    icps_changed = False
    if payload.icps is not None:
        icps_normalized: list[dict] = []
        seen_ids: set[str] = set()
        for icp in payload.icps:
            icp_id = (icp.id or "").strip()
            name = (icp.name or "").strip()
            if not icp_id or not name or icp_id in seen_ids:
                continue
            seen_ids.add(icp_id)
            syns = [s.strip() for s in (icp.synonyms or []) if s and s.strip()]
            icps_normalized.append({
                "id": icp_id,
                "name": name,
                "emoji": (icp.emoji or "👤").strip() or "👤",
                "synonyms": syns,
            })
        updates["settings.icps"] = icps_normalized
        icps_changed = True
    if payload.icp_llm_enabled is not None:
        updates["settings.icp_llm_enabled"] = bool(payload.icp_llm_enabled)

    if updates:
        updates["updated_at"] = datetime.now(tz=timezone.utc)
        updated = await db.teams.find_one_and_update(
            {"_id": team["_id"]}, {"$set": updates}, return_document=True
        )
    else:
        updated = team

    if icps_changed:
        await _recompute_keyword_icp_matches(db, team["_id"], updates["settings.icps"])

    members = await _list_team_members(db, team["_id"])
    companies_count = await db.companies.count_documents(
        {
            "team_id": team["_id"],
            "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
        }
    )
    return TeamDetailOut.model_validate(
        {
            **updated,
            "role": membership["role"],
            "members": [m.model_dump(by_alias=True) for m in members],
            "members_count": len(members),
            "companies_count": companies_count,
        }
    )


@router.post("/teams/{slug}/icps/llm-recompute")
async def recompute_icps_with_llm(
    slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """LLM fallback pass: only contacts whose keyword pass found no match.

    Batched to reduce latency + token spend. Returns a small summary so the
    UI can display "X nouveaux matchs trouvés par IA".
    """
    import os
    if not (os.environ.get("ANTHROPIC_API_KEY") or "").strip():
        raise HTTPException(
            status_code=400,
            detail="ANTHROPIC_API_KEY manquant côté serveur",
        )
    db = get_db()
    team, _membership = await require_team_role(db, slug, user, "admin")
    icps = (team.get("settings") or {}).get("icps") or []
    if not icps:
        return {"updated": 0, "matched_new": 0}

    # Gather unmatched titles (distinct) so we batch-call the LLM.
    cur = db.contacts.find(
        {"team_id": team["_id"], "icp_match_ids": {"$in": [None, []]}},
        projection={"_id": 1, "title": 1, "icp_match_ids": 1},
    )
    contacts = [c async for c in cur]
    titles_set: dict[str, list[ObjectId]] = {}
    for c in contacts:
        t = (c.get("title") or "").strip()
        if not t:
            continue
        titles_set.setdefault(t, []).append(c["_id"])

    if not titles_set:
        return {"updated": 0, "matched_new": 0}

    # Batch in chunks of 40 titles / call
    matched_new = 0
    updated = 0
    titles = list(titles_set.keys())
    chunk_size = 40
    for i in range(0, len(titles), chunk_size):
        chunk = titles[i : i + chunk_size]
        mapping = await llm_match_titles(chunk, icps)
        for title, icp_ids in mapping.items():
            if not icp_ids:
                continue
            ids_for_title = titles_set.get(title) or []
            if not ids_for_title:
                continue
            res = await db.contacts.update_many(
                {"_id": {"$in": ids_for_title}},
                {"$set": {"icp_match_ids": icp_ids}},
            )
            updated += res.modified_count
            matched_new += 1
    return {"updated": updated, "matched_new": matched_new}


async def _recompute_keyword_icp_matches(
    db: Any, team_id: ObjectId, team_icps: list[dict]
) -> int:
    """Rebuild `icp_match_ids` on every contact in a team (keyword pass).

    Merges the team's permanent ICPs with each contact's company's account-
    scoped ICPs so both contribute to the final match list. Safe to call
    frequently — one pass, no external API calls. Returns the number of
    contacts updated.
    """
    # Preload per-company ICPs so we don't re-query on every contact.
    cur_co = db.companies.find(
        {"team_id": team_id}, projection={"_id": 1, "icps": 1}
    )
    company_icps: dict[ObjectId, list[dict]] = {}
    async for co in cur_co:
        company_icps[co["_id"]] = co.get("icps") or []

    cur = db.contacts.find(
        {"team_id": team_id},
        projection={"_id": 1, "title": 1, "company_id": 1, "icp_match_ids": 1},
    )
    updated = 0
    async for c in cur:
        icps_for_contact = list(team_icps) + list(
            company_icps.get(c.get("company_id"), [])
        )
        new = icp_match_keyword(c.get("title") or "", icps_for_contact)
        if sorted(new) != sorted(c.get("icp_match_ids") or []):
            await db.contacts.update_one(
                {"_id": c["_id"]}, {"$set": {"icp_match_ids": new}}
            )
            updated += 1
    return updated


async def _recompute_keyword_icp_matches_for_company(
    db: Any,
    team_id: ObjectId,
    company_id: ObjectId,
    team_icps: list[dict],
    company_icps: list[dict],
) -> int:
    """Same as above but scoped to ONE company (used when the company's own
    ICPs are edited — no need to touch other companies' contacts).
    """
    merged = list(team_icps) + list(company_icps)
    cur = db.contacts.find(
        {"team_id": team_id, "company_id": company_id},
        projection={"_id": 1, "title": 1, "icp_match_ids": 1},
    )
    updated = 0
    async for c in cur:
        new = icp_match_keyword(c.get("title") or "", merged)
        if sorted(new) != sorted(c.get("icp_match_ids") or []):
            await db.contacts.update_one(
                {"_id": c["_id"]}, {"$set": {"icp_match_ids": new}}
            )
            updated += 1
    return updated


@router.delete("/teams/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(
    slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    db = get_db()
    team, membership = await require_team_role(db, slug, user, "owner")
    if team.get("is_personal"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Impossible de supprimer l'espace personnel",
        )
    team_id = team["_id"]
    # Cascade — order doesn't matter (we're wiping the whole team) but we
    # purge children first for consistency with the soft-delete purger.
    await db.connections.delete_many({"team_id": team_id})
    await db.contacts.delete_many({"team_id": team_id})
    await db.companies.delete_many({"team_id": team_id})
    await db.folders.delete_many({"team_id": team_id})
    await db.team_invites.delete_many({"team_id": team_id})
    await db.team_members.delete_many({"team_id": team_id})
    await db.teams.delete_one({"_id": team_id})
    log.info("Team %s deleted (cascade) by %s", slug, user.get("email"))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ===========================================================================
# Members
# ===========================================================================


async def _list_team_members(db, team_id: ObjectId) -> list[TeamMemberOut]:
    members: list[TeamMemberOut] = []
    async for m in db.team_members.find({"team_id": team_id}):
        u = await db.users.find_one(
            {"_id": m["user_id"]}, {"email": 1, "name": 1}
        )
        members.append(
            TeamMemberOut.model_validate(
                {
                    **m,
                    "email": (u or {}).get("email"),
                    "name": (u or {}).get("name"),
                }
            )
        )
    return members


@router.get("/teams/{slug}/members", response_model=list[TeamMemberOut])
async def list_members(
    slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> list[TeamMemberOut]:
    db = get_db()
    team, _ = await require_team_member(db, slug, user)
    return await _list_team_members(db, team["_id"])


@router.patch("/teams/{slug}/members/{user_id}", response_model=TeamMemberOut)
async def update_member_role(
    slug: str,
    user_id: str,
    payload: TeamMemberRoleUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> TeamMemberOut:
    db = get_db()
    team, caller_membership = await require_team_role(db, slug, user, "admin")
    target_oid = _safe_oid(user_id, "Member")
    target = await db.team_members.find_one(
        {"team_id": team["_id"], "user_id": target_oid}
    )
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if target.get("role") == "owner":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Cannot modify the owner role via this endpoint",
        )
    # Admin cannot demote themselves in a way that breaks things: allow it.
    updated = await db.team_members.find_one_and_update(
        {"_id": target["_id"]},
        {"$set": {"role": payload.role}},
        return_document=True,
    )
    u = await db.users.find_one({"_id": target_oid}, {"email": 1, "name": 1})
    return TeamMemberOut.model_validate(
        {**updated, "email": (u or {}).get("email"), "name": (u or {}).get("name")}
    )


@router.delete(
    "/teams/{slug}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_member(
    slug: str,
    user_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    db = get_db()
    team, caller_membership = await require_team_member(db, slug, user)
    target_oid = _safe_oid(user_id, "Member")
    target = await db.team_members.find_one(
        {"team_id": team["_id"], "user_id": target_oid}
    )
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")

    is_self = target_oid == user["_id"]
    target_role = target.get("role", "member")

    # Personal space: the owning user can never leave nor be removed.
    # Other users cannot be members of a personal space anyway (there is no
    # invite flow for it), but guard defensively.
    if team.get("is_personal") and is_self:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Impossible de quitter l'espace personnel",
        )

    if target_role == "owner":
        # Owner cannot be removed (including by self — V2: no leave for owner).
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Owner cannot leave or be removed. Delete the team instead.",
        )

    if is_self:
        # A regular member/admin can leave.
        pass
    else:
        # Someone else: caller must be admin+.
        if role_weight(caller_membership.get("role", "")) < role_weight("admin"):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Insufficient permission: requires admin+",
            )

    await db.team_members.delete_one({"_id": target["_id"]})
    log.info(
        "Member %s removed from team %s (by %s)",
        target_oid,
        slug,
        user.get("email"),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ===========================================================================
# Invites
# ===========================================================================


@router.get("/teams/{slug}/invites", response_model=list[TeamInviteOut])
async def list_invites(
    slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> list[TeamInviteOut]:
    db = get_db()
    team, _ = await require_team_role(db, slug, user, "admin")
    now = datetime.now(tz=timezone.utc)
    cursor = db.team_invites.find(
        {
            "team_id": team["_id"],
            "expires_at": {"$gt": now},
            "$expr": {"$lt": ["$uses", "$max_uses"]},
        }
    ).sort("created_at", -1)
    return [TeamInviteOut.model_validate(i) async for i in cursor]


@router.post(
    "/teams/{slug}/invites",
    response_model=TeamInviteOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_invite(
    slug: str,
    payload: TeamInviteCreateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> TeamInviteOut:
    db = get_db()
    team, _ = await require_team_role(db, slug, user, "admin")
    now = datetime.now(tz=timezone.utc)
    expires_at = now + timedelta(days=payload.expires_in_days)
    # Retry until we get a unique code (extremely unlikely collision).
    for _ in range(5):
        code = _invite_code()
        doc = {
            "team_id": team["_id"],
            "code": code,
            "role": payload.role,
            "created_by": user["_id"],
            "created_at": now,
            "expires_at": expires_at,
            "used_by": None,
            "used_at": None,
            "max_uses": payload.max_uses,
            "uses": 0,
        }
        try:
            res = await db.team_invites.insert_one(doc)
            doc["_id"] = res.inserted_id
            log.info(
                "Invite %s created for team %s (role=%s, max_uses=%d)",
                code,
                slug,
                payload.role,
                payload.max_uses,
            )
            return TeamInviteOut.model_validate(doc)
        except DuplicateKeyError:
            continue
    raise HTTPException(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "Failed to generate a unique invite code",
    )


@router.delete(
    "/teams/{slug}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def revoke_invite(
    slug: str,
    invite_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    db = get_db()
    team, _ = await require_team_role(db, slug, user, "admin")
    oid = _safe_oid(invite_id, "Invite")
    res = await db.team_invites.delete_one(
        {"_id": oid, "team_id": team["_id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/teams/accept-invite", response_model=AcceptInviteResponse)
async def accept_invite(
    payload: AcceptInviteRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> AcceptInviteResponse:
    db = get_db()
    invite = await db.team_invites.find_one({"code": payload.code.strip()})
    if not invite:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    now = datetime.now(tz=timezone.utc)
    expires_at = invite.get("expires_at")
    if expires_at and expires_at <= now:
        raise HTTPException(status.HTTP_410_GONE, "Invite expired")
    if int(invite.get("uses", 0)) >= int(invite.get("max_uses", 1)):
        raise HTTPException(status.HTTP_410_GONE, "Invite is fully used")

    team = await db.teams.find_one({"_id": invite["team_id"]})
    if not team:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team no longer exists")

    # Already a member?
    existing = await db.team_members.find_one(
        {"team_id": team["_id"], "user_id": user["_id"]}
    )
    if existing:
        # Idempotent: return team info without consuming a use.
        return AcceptInviteResponse(team=TeamOut.model_validate(team))

    await db.team_members.insert_one(
        {
            "team_id": team["_id"],
            "user_id": user["_id"],
            "role": invite.get("role", "member"),
            "joined_at": now,
            "invited_by": invite.get("created_by"),
        }
    )
    # Bump uses (and set used_by / used_at when single-use).
    update: dict[str, Any] = {"$inc": {"uses": 1}}
    if int(invite.get("max_uses", 1)) == 1:
        update["$set"] = {"used_by": user["_id"], "used_at": now}
    await db.team_invites.update_one({"_id": invite["_id"]}, update)
    log.info(
        "User %s joined team %s via invite %s",
        user.get("email"),
        team.get("slug"),
        payload.code,
    )
    return AcceptInviteResponse(team=TeamOut.model_validate(team))


# ===========================================================================
# Companies (team-scoped)
# ===========================================================================


@router.get("/teams/{team_slug}/companies", response_model=list[CompanyOut])
async def list_companies(
    team_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> list[CompanyOut]:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    pipeline = [
        {
            "$match": {
                "team_id": team["_id"],
                # Exclude soft-deleted companies. Match both missing field
                # (legacy docs) and explicit null.
                "$or": [
                    {"deleted_at": None},
                    {"deleted_at": {"$exists": False}},
                ],
            }
        },
        {
            "$lookup": {
                "from": "contacts",
                "let": {"cid": "$_id"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$company_id", "$$cid"]},
                                    {"$eq": ["$team_id", team["_id"]]},
                                ]
                            }
                        }
                    }
                ],
                "as": "_contacts",
            }
        },
        {
            "$addFields": {
                "contact_count": {"$size": "$_contacts"},
                "techtomed_count": {
                    "$size": {
                        "$filter": {
                            "input": "$_contacts",
                            "as": "c",
                            "cond": {"$eq": ["$$c.is_techtomed", True]},
                        }
                    }
                },
            }
        },
        {"$project": {"_contacts": 0}},
    ]
    out: list[CompanyOut] = []
    async for doc in db.companies.aggregate(pipeline):
        out.append(CompanyOut.model_validate(doc))
    # Sort: priority (P1+ first) → manual position (ascending) → name.
    # `position` is 0 by default (unassigned), so untouched companies fall
    # back to alphabetical within a priority group. The frontend applies the
    # same tie-breakers so the two views stay in lock-step.
    out.sort(
        key=lambda c: (
            PRIORITY_ORDER.get(c.priority, 9),
            c.position,
            c.name.lower(),
        )
    )
    return out


@router.get(
    "/teams/{team_slug}/companies/{company_slug}",
    response_model=CompanyDetailOut,
)
async def get_company(
    team_slug: str,
    company_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> CompanyDetailOut:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    doc = await db.companies.find_one(
        {"team_id": team["_id"], "slug": company_slug.lower()}
    )
    # Hide soft-deleted companies behind a 404 so the UI falls back the same
    # way it would for a truly missing doc. The restore endpoint works by id,
    # not slug, so admins can still recover it within the 24h window.
    if not doc or doc.get("deleted_at"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")
    contacts_cursor = db.contacts.find(
        {"team_id": team["_id"], "company_id": doc["_id"]}
    ).sort([("level", 1), ("position_in_level", 1)])
    contacts = [ContactOut.model_validate(c) async for c in contacts_cursor]
    doc["contact_count"] = len(contacts)
    doc["techtomed_count"] = sum(1 for c in contacts if c.is_techtomed)
    detail = CompanyDetailOut.model_validate({**doc, "contacts": []})
    detail.contacts = contacts
    return detail


@router.patch(
    "/teams/{team_slug}/companies/{company_slug}/icps",
)
async def update_company_icps(
    team_slug: str,
    company_slug: str,
    payload: CompanyICPsUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Replace a company's account-specific ICPs + recompute the match list
    for every contact of that company (merged with team ICPs).
    """
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    company = await db.companies.find_one(
        {"team_id": team["_id"], "slug": company_slug.lower()}
    )
    if not company or company.get("deleted_at"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")

    # Normalise incoming ICP payload (same shape as team ICPs).
    seen_ids: set[str] = set()
    icps_norm: list[dict] = []
    for icp in payload.icps:
        icp_id = (icp.id or "").strip()
        name = (icp.name or "").strip()
        if not icp_id or not name or icp_id in seen_ids:
            continue
        seen_ids.add(icp_id)
        syns = [s.strip() for s in (icp.synonyms or []) if s and s.strip()]
        icps_norm.append({
            "id": icp_id,
            "name": name,
            "emoji": (icp.emoji or "👤").strip() or "👤",
            "synonyms": syns,
        })

    now = datetime.now(tz=timezone.utc)
    await db.companies.update_one(
        {"_id": company["_id"]},
        {"$set": {"icps": icps_norm, "updated_at": now}},
    )

    team_icps = ((team.get("settings") or {}).get("icps")) or []
    updated = await _recompute_keyword_icp_matches_for_company(
        db, team["_id"], company["_id"], team_icps, icps_norm
    )

    # Return the fresh company + contacts so the frontend can refresh its view.
    company["icps"] = icps_norm
    contacts_cursor = db.contacts.find(
        {"team_id": team["_id"], "company_id": company["_id"]}
    ).sort([("level", 1), ("position_in_level", 1)])
    contacts = [ContactOut.model_validate(c) async for c in contacts_cursor]
    company["contact_count"] = len(contacts)
    company["techtomed_count"] = sum(1 for c in contacts if c.is_techtomed)
    detail = CompanyDetailOut.model_validate({**company, "contacts": []})
    detail.contacts = contacts
    return {"recomputed": updated, "company": detail.model_dump(by_alias=True)}


@router.post(
    "/teams/{team_slug}/companies",
    response_model=CompanyOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_company(
    team_slug: str,
    payload: CompanyCreate,
    user: dict[str, Any] = Depends(get_current_user),
) -> CompanyOut:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    now = datetime.now(tz=timezone.utc)
    doc = payload.model_dump()
    doc["slug"] = (doc.get("slug") or _company_slugify(doc["name"])).lower()
    doc["team_id"] = team["_id"]
    doc["created_at"] = now
    doc["updated_at"] = now
    doc["created_by"] = user["_id"]
    try:
        res = await db.companies.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A company with this slug already exists in this team",
        )
    doc["_id"] = res.inserted_id
    doc["contact_count"] = 0
    doc["techtomed_count"] = 0
    log.info(
        "Company %s created in team %s by %s",
        doc["slug"],
        team_slug,
        user.get("email"),
    )
    return CompanyOut.model_validate(doc)


@router.post(
    "/teams/{team_slug}/companies/reorder",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def reorder_companies(
    team_slug: str,
    payload: CompanyReorderRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    """Rewrite manual `position` for companies inside one container.

    The container is a folder (`folder_id = <ObjectId string>`) or the root
    (`folder_id = null`). Every id in `ordered_ids` gets:
      - `position = <its index in ordered_ids>`
      - `folder_id = <payload.folder_id>`  (covers drop-at-precise-position
        during a cross-folder drag)

    Other companies in the same target container (not listed) are shifted
    down by `len(ordered_ids)` so the reordered block sits cleanly at the
    top of the container — preserving their relative order.

    This is deliberately **not** a full-container rewrite. The client only
    needs to send the ids it actually dragged (1 for single-drag, N for a
    multi-drag selection) — which keeps the payload small and the surface
    area for races narrow.
    """
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)

    # Validate + resolve target folder (if any).
    target_folder_oid: Optional[ObjectId] = None
    if payload.folder_id is not None:
        try:
            target_folder_oid = ObjectId(payload.folder_id)
        except (InvalidId, TypeError):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Invalid folder_id"
            )
        folder = await db.folders.find_one(
            {"_id": target_folder_oid, "team_id": team["_id"]}, {"_id": 1}
        )
        if not folder:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Folder does not belong to this team",
            )

    # Coerce ids to ObjectIds, dropping obvious garbage early.
    ordered_oids: list[ObjectId] = []
    for raw_id in payload.ordered_ids:
        try:
            ordered_oids.append(ObjectId(raw_id))
        except (InvalidId, TypeError):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Invalid company id: {raw_id}",
            )

    if not ordered_oids:
        # Nothing to reorder — noop. Still 204 so the caller isn't surprised.
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # Verify every id exists in this team (and isn't soft-deleted).
    found_count = await db.companies.count_documents(
        {
            "_id": {"$in": ordered_oids},
            "team_id": team["_id"],
            "$or": [
                {"deleted_at": None},
                {"deleted_at": {"$exists": False}},
            ],
        }
    )
    if found_count != len(ordered_oids):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "One or more company ids do not belong to this team",
        )

    now = datetime.now(tz=timezone.utc)
    n = len(ordered_oids)

    # Shift every OTHER company in the target container down by N so the
    # reordered block lands at positions [0..N-1] without clashes. Exclude
    # soft-deleted docs defensively.
    shift_filter: dict[str, Any] = {
        "team_id": team["_id"],
        "_id": {"$nin": ordered_oids},
        "$or": [
            {"deleted_at": None},
            {"deleted_at": {"$exists": False}},
        ],
    }
    if target_folder_oid is None:
        # Root container: either folder_id is null, missing, or falsy.
        shift_filter["$and"] = [
            {
                "$or": [
                    {"folder_id": None},
                    {"folder_id": {"$exists": False}},
                ]
            }
        ]
    else:
        shift_filter["folder_id"] = target_folder_oid

    await db.companies.update_many(
        shift_filter,
        {"$inc": {"position": n}, "$set": {"updated_at": now}},
    )

    # Write the new positions + (re)assign folder_id in bulk.
    # We loop rather than using $position tricks because the per-id `position`
    # is the index in the user-provided list — trivial & cheap (N is small).
    for idx, oid in enumerate(ordered_oids):
        await db.companies.update_one(
            {"_id": oid, "team_id": team["_id"]},
            {
                "$set": {
                    "position": idx,
                    "folder_id": target_folder_oid,
                    "updated_at": now,
                }
            },
        )

    log.info(
        "Reordered %d companies in team %s folder=%s (by %s)",
        n,
        team_slug,
        payload.folder_id or "root",
        user.get("email"),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/teams/{team_slug}/companies/{company_id}",
    response_model=CompanyOut,
)
async def update_company(
    team_slug: str,
    company_id: str,
    payload: CompanyUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> CompanyOut:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    oid = _safe_oid(company_id, "Company")
    raw = payload.model_dump(exclude_unset=True)
    # `folder_id` is tri-state (not-set / null / ObjectId). `exclude_unset`
    # already strips "not-set" for us, so any key still present is meaningful
    # — including explicit `None` (reset to root). Handle it before the
    # generic None-drop below so it survives.
    folder_update_present = "folder_id" in raw
    folder_id_raw = raw.pop("folder_id", None) if folder_update_present else None

    updates = {k: v for k, v in raw.items() if v is not None}

    if folder_update_present:
        if folder_id_raw is None:
            # Explicit null → bubble the company back up to the root.
            updates["folder_id"] = None
        else:
            # Non-null: must be a valid ObjectId AND the folder must belong
            # to the same team (no cross-team smuggling).
            try:
                target_oid = ObjectId(folder_id_raw)
            except (InvalidId, TypeError):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, "Invalid folder_id"
                )
            folder = await db.folders.find_one(
                {"_id": target_oid, "team_id": team["_id"]}, {"_id": 1}
            )
            if not folder:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Folder does not belong to this team",
                )
            updates["folder_id"] = target_oid

    if "slug" in updates:
        updates["slug"] = updates["slug"].lower()
    updates["updated_at"] = datetime.now(tz=timezone.utc)
    try:
        result = await db.companies.find_one_and_update(
            {
                "_id": oid,
                "team_id": team["_id"],
                # Reject edits on soft-deleted companies (behave like 404).
                "$or": [
                    {"deleted_at": None},
                    {"deleted_at": {"$exists": False}},
                ],
            },
            {"$set": updates},
            return_document=True,
        )
    except DuplicateKeyError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A company with this slug already exists in this team",
        )
    if not result:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")
    contact_count = await db.contacts.count_documents(
        {"team_id": team["_id"], "company_id": oid}
    )
    techtomed_count = await db.contacts.count_documents(
        {"team_id": team["_id"], "company_id": oid, "is_techtomed": True}
    )
    result["contact_count"] = contact_count
    result["techtomed_count"] = techtomed_count
    return CompanyOut.model_validate(result)


@router.delete(
    "/teams/{team_slug}/companies/{company_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_company(
    team_slug: str,
    company_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    """Soft-delete a company.

    The doc is flagged with `deleted_at=now()` rather than removed outright,
    giving the frontend a 5s "undo" window (and a 24h grace period in case
    the user closes the tab). The background purger (`app.background`)
    hard-deletes the doc + cascades to contacts after 24h.

    Idempotent on already-deleted docs: returns 404 (nothing visible to
    delete) so the UI knows the row is gone.
    """
    db = get_db()
    team, _ = await require_team_role(db, team_slug, user, "admin")
    oid = _safe_oid(company_id, "Company")
    now = datetime.now(tz=timezone.utc)
    res = await db.companies.update_one(
        {
            "_id": oid,
            "team_id": team["_id"],
            # Don't re-stamp an already-deleted doc; treat as 404.
            "$or": [
                {"deleted_at": None},
                {"deleted_at": {"$exists": False}},
            ],
        },
        {"$set": {"deleted_at": now, "updated_at": now}},
    )
    if res.matched_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")
    log.info(
        "Company %s soft-deleted from team %s by %s",
        company_id,
        team_slug,
        user.get("email"),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/teams/{team_slug}/companies/{company_id}/restore",
    response_model=CompanyOut,
)
async def restore_company(
    team_slug: str,
    company_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> CompanyOut:
    """Restore a soft-deleted company.

    Admin+ only (same level as delete). Unsets `deleted_at`. Contacts are
    untouched by soft-delete so they come back as-is. Returns 404 if the
    company was already hard-purged by the background job (>24h old).
    """
    db = get_db()
    team, _ = await require_team_role(db, team_slug, user, "admin")
    oid = _safe_oid(company_id, "Company")
    now = datetime.now(tz=timezone.utc)
    restored = await db.companies.find_one_and_update(
        {
            "_id": oid,
            "team_id": team["_id"],
            "deleted_at": {"$ne": None, "$exists": True},
        },
        {"$unset": {"deleted_at": ""}, "$set": {"updated_at": now}},
        return_document=True,
    )
    if not restored:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Company not found or not in a deleted state",
        )
    contact_count = await db.contacts.count_documents(
        {"team_id": team["_id"], "company_id": oid}
    )
    techtomed_count = await db.contacts.count_documents(
        {"team_id": team["_id"], "company_id": oid, "is_techtomed": True}
    )
    restored["contact_count"] = contact_count
    restored["techtomed_count"] = techtomed_count
    log.info(
        "Company %s restored in team %s by %s",
        company_id,
        team_slug,
        user.get("email"),
    )
    return CompanyOut.model_validate(restored)


# ===========================================================================
# Contacts (team-scoped)
# ===========================================================================


@router.post(
    "/teams/{team_slug}/companies/{company_slug}/contacts",
    response_model=ContactOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_contact(
    team_slug: str,
    company_slug: str,
    payload: ContactCreate,
    user: dict[str, Any] = Depends(get_current_user),
) -> ContactOut:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    company = await db.companies.find_one(
        {"team_id": team["_id"], "slug": company_slug.lower()}
    )
    if not company or company.get("deleted_at"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")

    data = payload.model_dump(exclude_unset=False)

    needs_classify = (
        data.get("level") is None
        or data.get("category") is None
        or data.get("seniority") is None
    )
    if needs_classify:
        cls = classify(data.get("title") or "")
        if data.get("level") is None:
            data["level"] = cls["level"]
        if data.get("category") is None:
            data["category"] = cls["category"]
        if data.get("seniority") is None:
            data["seniority"] = cls["seniority"]
        if data.get("flag_c_level") is None:
            data["flag_c_level"] = cls["flag_c_level"]
        if data.get("flag_bu_head") is None:
            data["flag_bu_head"] = cls["flag_bu_head"]
        if data.get("flag_manager_of_managers") is None:
            data["flag_manager_of_managers"] = cls["flag_manager_of_managers"]
        if data.get("therapeutic_areas") is None:
            data["therapeutic_areas"] = cls["therapeutic_areas"]
        if data.get("priority_score") is None:
            data["priority_score"] = cls["priority_score"]

    for k, default in (
        ("flag_c_level", False),
        ("flag_bu_head", False),
        ("flag_manager_of_managers", False),
        ("therapeutic_areas", []),
        ("priority_score", 0),
        ("seniority", "Unknown"),
        ("category", "other"),
        ("level", 6),
    ):
        if data.get(k) is None:
            data[k] = default

    if data.get("position_in_level") is None:
        data["position_in_level"] = await _next_position(
            db, team["_id"], company["_id"], data["level"]
        )

    now = datetime.now(tz=timezone.utc)
    data["team_id"] = team["_id"]
    data["company_id"] = company["_id"]
    data["created_at"] = now
    data["updated_at"] = now
    data["created_by"] = user["_id"]
    # Keyword-only ICP match at create time; LLM recompute is on-demand.
    # Merge team permanent ICPs + this company's account-scoped ICPs.
    team_icps = (team.get("settings") or {}).get("icps") or []
    co_icps = company.get("icps") or []
    data["icp_match_ids"] = icp_match_keyword(
        data.get("title") or "", list(team_icps) + list(co_icps)
    )

    res = await db.contacts.insert_one(data)
    data["_id"] = res.inserted_id
    return ContactOut.model_validate(data)


@router.patch(
    "/teams/{team_slug}/contacts/{contact_id}",
    response_model=ContactOut,
)
async def update_contact(
    team_slug: str,
    contact_id: str,
    payload: ContactUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> ContactOut:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    oid = _safe_oid(contact_id, "Contact")
    raw = payload.model_dump(exclude_unset=True)
    # `freeform_position` is the only field where explicit `null` is meaningful
    # (reset the freeform layout). For every other optional field, a `None`
    # value is treated as "not provided" and dropped.
    updates: dict[str, Any] = {}
    for k, v in raw.items():
        if k == "freeform_position":
            updates[k] = v  # may be None → MongoDB stores null → UI auto-layout
        elif v is not None:
            updates[k] = v
    if not updates:
        doc = await db.contacts.find_one({"_id": oid, "team_id": team["_id"]})
        if not doc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
        return ContactOut.model_validate(doc)
    # Recompute icp_match_ids if title changed (keyword pass only).
    if "title" in updates:
        # Look up the contact's company to merge team + account ICPs.
        existing = await db.contacts.find_one(
            {"_id": oid, "team_id": team["_id"]}, {"company_id": 1}
        )
        team_icps = (team.get("settings") or {}).get("icps") or []
        co_icps: list[dict] = []
        if existing and existing.get("company_id"):
            co = await db.companies.find_one(
                {"_id": existing["company_id"]}, {"icps": 1}
            )
            co_icps = (co or {}).get("icps") or []
        updates["icp_match_ids"] = icp_match_keyword(
            updates["title"] or "", list(team_icps) + list(co_icps)
        )
    updates["updated_at"] = datetime.now(tz=timezone.utc)
    doc = await db.contacts.find_one_and_update(
        {"_id": oid, "team_id": team["_id"]},
        {"$set": updates},
        return_document=True,
    )
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    return ContactOut.model_validate(doc)


@router.post(
    "/teams/{team_slug}/contacts/{contact_id}/move",
    response_model=ContactOut,
)
async def move_contact(
    team_slug: str,
    contact_id: str,
    move: ContactMove,
    user: dict[str, Any] = Depends(get_current_user),
) -> ContactOut:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    oid = _safe_oid(contact_id, "Contact")
    contact = await db.contacts.find_one({"_id": oid, "team_id": team["_id"]})
    if not contact:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")

    team_id = team["_id"]
    company_id = contact["company_id"]
    old_level = int(contact.get("level", 6))
    old_pos = int(contact.get("position_in_level", 0))
    new_level = move.level
    new_pos = move.position_in_level

    if old_level == new_level and old_pos == new_pos:
        return ContactOut.model_validate(contact)

    if old_level == new_level:
        if new_pos < old_pos:
            await db.contacts.update_many(
                {
                    "team_id": team_id,
                    "company_id": company_id,
                    "level": old_level,
                    "_id": {"$ne": oid},
                    "position_in_level": {"$gte": new_pos, "$lt": old_pos},
                },
                {"$inc": {"position_in_level": 1}},
            )
        else:
            await db.contacts.update_many(
                {
                    "team_id": team_id,
                    "company_id": company_id,
                    "level": old_level,
                    "_id": {"$ne": oid},
                    "position_in_level": {"$gt": old_pos, "$lte": new_pos},
                },
                {"$inc": {"position_in_level": -1}},
            )
    else:
        await db.contacts.update_many(
            {
                "team_id": team_id,
                "company_id": company_id,
                "level": old_level,
                "_id": {"$ne": oid},
                "position_in_level": {"$gt": old_pos},
            },
            {"$inc": {"position_in_level": -1}},
        )
        await db.contacts.update_many(
            {
                "team_id": team_id,
                "company_id": company_id,
                "level": new_level,
                "_id": {"$ne": oid},
                "position_in_level": {"$gte": new_pos},
            },
            {"$inc": {"position_in_level": 1}},
        )

    updated = await db.contacts.find_one_and_update(
        {"_id": oid, "team_id": team_id},
        {
            "$set": {
                "level": new_level,
                "position_in_level": new_pos,
                "updated_at": datetime.now(tz=timezone.utc),
            }
        },
        return_document=True,
    )
    return ContactOut.model_validate(updated)


@router.delete(
    "/teams/{team_slug}/contacts/{contact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_contact(
    team_slug: str,
    contact_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    oid = _safe_oid(contact_id, "Contact")
    contact = await db.contacts.find_one({"_id": oid, "team_id": team["_id"]})
    if not contact:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    await db.contacts.delete_one({"_id": oid})
    # Cascade: drop any freeform connection that references this contact
    # (either side). Connections are always bidirectional in the UI, so we
    # purge on both source and target.
    await db.connections.delete_many(
        {
            "$or": [
                {"source_contact_id": oid},
                {"target_contact_id": oid},
            ]
        }
    )
    await db.contacts.update_many(
        {
            "team_id": team["_id"],
            "company_id": contact["company_id"],
            "level": contact.get("level", 6),
            "position_in_level": {"$gt": contact.get("position_in_level", 0)},
        },
        {"$inc": {"position_in_level": -1}},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ===========================================================================
# Admin: seed + export (team-scoped)
# ===========================================================================


@router.post(
    "/teams/{team_slug}/admin/seed",
    response_model=SeedResponse,
)
async def seed_team(
    team_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> SeedResponse:
    db = get_db()
    team, _ = await require_team_role(db, team_slug, user, "admin")
    team_id = team["_id"]

    data_dir = PROJECT_ROOT / "data"
    accounts_path = data_dir / "accounts.json"
    if not accounts_path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"accounts.json not found at {accounts_path}"
        )

    with accounts_path.open("r", encoding="utf-8") as f:
        accounts = json.load(f)

    companies_created = 0
    companies_skipped = 0
    contacts_created = 0
    techtomed_matched = 0
    now = datetime.now(tz=timezone.utc)

    for acc in accounts:
        slug = _company_slugify(acc["name"])
        enrichment_file = acc.get("enrichment_file")
        enrichment: dict[str, Any] = {}
        if enrichment_file:
            enr_path = data_dir / Path(enrichment_file).name
            candidate = data_dir / enrichment_file
            if candidate.exists():
                with candidate.open("r", encoding="utf-8") as f:
                    enrichment = json.load(f)
            elif enr_path.exists():
                with enr_path.open("r", encoding="utf-8") as f:
                    enrichment = json.load(f)

        company_enr = enrichment.get("company", {}) or {}

        # Scoped to team: same slug may exist in another team.
        existing = await db.companies.find_one(
            {"team_id": team_id, "slug": slug}
        )
        if existing:
            companies_skipped += 1
            continue

        doc = {
            "name": company_enr.get("name") or acc["name"],
            "slug": slug,
            "team_id": team_id,
            "domain": company_enr.get("domain") or acc.get("domain_hint", ""),
            "linkedin_url": company_enr.get("linkedin_url", ""),
            "priority": acc.get("priority", ""),
            "crm_id": acc.get("crm_id", ""),
            "pic": acc.get("pic", ""),
            "crm_status": acc.get("status", ""),
            "work_status": acc.get("work_status", ""),
            "next_step": acc.get("step", ""),
            "industry": company_enr.get("industry", ""),
            "headcount": int(company_enr.get("headcount") or 0),
            "hq": company_enr.get("hq", ""),
            "country": company_enr.get("country", ""),
            "annual_revenue": company_enr.get("annual_revenue", ""),
            "therapeutic_areas": company_enr.get("therapeutic_areas") or [],
            "comments_crm": acc.get("comments_raw", ""),
            "created_at": now,
            "updated_at": now,
            "created_by": user["_id"],
        }
        res = await db.companies.insert_one(doc)
        company_id = res.inserted_id
        companies_created += 1

        known_contacts = acc.get("known_contacts") or []
        known_norm = [_normalize(kc.get("full_name", "")) for kc in known_contacts]

        level_positions: dict[int, int] = {}

        for contact in enrichment.get("contacts", []) or []:
            cls = classify(contact.get("title", ""))
            level = cls["level"]
            pos = level_positions.get(level, 0)
            level_positions[level] = pos + 1

            is_techtomed = _is_techtomed(contact.get("name", ""), known_norm)
            if is_techtomed:
                techtomed_matched += 1

            contact_doc = {
                "team_id": team_id,
                "company_id": company_id,
                "name": contact.get("name", ""),
                "title": contact.get("title", ""),
                "email": contact.get("email", ""),
                "phone": contact.get("phone", ""),
                "linkedin_url": contact.get("linkedin_url", ""),
                "location": contact.get("location", ""),
                "level": level,
                "category": cls["category"],
                "seniority": cls["seniority"],
                "flag_c_level": cls["flag_c_level"],
                "flag_bu_head": cls["flag_bu_head"],
                "flag_manager_of_managers": cls["flag_manager_of_managers"],
                "therapeutic_areas": cls["therapeutic_areas"],
                "priority_score": cls["priority_score"],
                "source": "techtomed" if is_techtomed else "mcp_enrich",
                "is_techtomed": is_techtomed,
                "position_in_level": pos,
                "notes": "",
                "decision_vs_influencer": "",
                "created_at": now,
                "updated_at": now,
                "created_by": user["_id"],
            }
            await db.contacts.insert_one(contact_doc)
            contacts_created += 1

        existing_names_norm = {
            _normalize(c.get("name", ""))
            async for c in db.contacts.find(
                {"team_id": team_id, "company_id": company_id}, {"name": 1}
            )
        }
        for kc in known_contacts:
            full_name = (kc.get("full_name") or "").strip()
            if not full_name:
                continue
            norm = _normalize(full_name)
            if any(
                fuzz.token_sort_ratio(norm, existing) >= 85
                for existing in existing_names_norm
            ):
                continue
            role_hint = kc.get("role_hint") or ""
            cls = classify(role_hint)
            pos = level_positions.get(cls["level"], 0)
            level_positions[cls["level"]] = pos + 1
            contact_doc = {
                "team_id": team_id,
                "company_id": company_id,
                "name": full_name,
                "title": role_hint,
                "email": "",
                "phone": "",
                "linkedin_url": "",
                "location": "",
                "level": cls["level"],
                "category": cls["category"],
                "seniority": cls["seniority"],
                "flag_c_level": cls["flag_c_level"],
                "flag_bu_head": cls["flag_bu_head"],
                "flag_manager_of_managers": cls["flag_manager_of_managers"],
                "therapeutic_areas": cls["therapeutic_areas"],
                "priority_score": cls["priority_score"],
                "source": "techtomed",
                "is_techtomed": True,
                "position_in_level": pos,
                "notes": "",
                "decision_vs_influencer": "",
                "created_at": now,
                "updated_at": now,
                "created_by": user["_id"],
            }
            await db.contacts.insert_one(contact_doc)
            contacts_created += 1
            techtomed_matched += 1

    return SeedResponse(
        companies_created=companies_created,
        companies_skipped=companies_skipped,
        contacts_created=contacts_created,
        techtomed_matched=techtomed_matched,
    )


@router.get("/teams/{team_slug}/admin/export/xlsx")
async def export_team_xlsx(
    team_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> StreamingResponse:
    db = get_db()
    team, _ = await require_team_role(db, team_slug, user, "admin")
    team_id = team["_id"]

    import sys
    sys.path.insert(0, str(PROJECT_ROOT))
    try:
        from build_xlsx import write_workbook  # type: ignore
    except Exception as e:
        log.exception("Failed to import build_xlsx")
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"build_xlsx import failed: {e}",
        )

    companies_list: list[dict[str, Any]] = []
    contacts_list: list[dict[str, Any]] = []

    company_by_id: dict[Any, dict[str, Any]] = {}
    async for comp in db.companies.find(
        {
            "team_id": team_id,
            "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
        }
    ):
        company_by_id[comp["_id"]] = comp

    contact_counts: dict[Any, int] = {}
    async for c in db.contacts.find({"team_id": team_id}):
        contact_counts[c["company_id"]] = contact_counts.get(c["company_id"], 0) + 1

    today = datetime.now(tz=timezone.utc).date().isoformat()

    for comp in company_by_id.values():
        companies_list.append(
            {
                "Name": comp.get("name", ""),
                "Website": comp.get("domain", ""),
                "Label": comp.get("priority", ""),
                "Address": comp.get("hq", ""),
                "Phone": "",
                "Priorité (P1/P2/P3)": comp.get("priority", ""),
                "Statut CRM": comp.get("crm_status", ""),
                "Work Status": comp.get("work_status", ""),
                "PIC muchbetter": comp.get("pic", ""),
                "Next Step": comp.get("next_step", ""),
                "CRM_ID": comp.get("crm_id", ""),
                "LinkedIn URL": comp.get("linkedin_url", ""),
                "Effectif": comp.get("headcount", ""),
                "Aires thérapeutiques (enrichies)": ", ".join(
                    comp.get("therapeutic_areas", []) or []
                ),
                "Nb contacts mappés": contact_counts.get(comp["_id"], 0),
                "Date enrichissement": today,
                "Commentaires CRM": comp.get("comments_crm", ""),
                "Notes": "",
            }
        )

    async for c in db.contacts.find({"team_id": team_id}).sort(
        [("company_id", 1), ("level", 1), ("position_in_level", 1)]
    ):
        comp = company_by_id.get(c["company_id"], {})
        cat_label = CATEGORY_LABELS.get(c.get("category", "other"), "")
        contacts_list.append(
            {
                "Name": c.get("name", ""),
                "Organization": comp.get("name", ""),
                "Job Title": c.get("title", ""),
                "Email": c.get("email", ""),
                "Phone": c.get("phone", ""),
                "Label": cat_label,
                "LinkedIn URL": c.get("linkedin_url", ""),
                "Location": c.get("location", ""),
                "Priorité compte": comp.get("priority", ""),
                "CRM_ID compte": comp.get("crm_id", ""),
                "Séniorité": c.get("seniority", ""),
                "Catégorie rôle": cat_label,
                "Aire thérapeutique": ", ".join(c.get("therapeutic_areas", []) or []),
                "Flag C-Level": "Oui" if c.get("flag_c_level") else "Non",
                "Flag Manager-de-managers": "Oui"
                if c.get("flag_manager_of_managers")
                else "Non",
                "Flag BU Head": "Oui" if c.get("flag_bu_head") else "Non",
                "Priority Score": c.get("priority_score", 0),
                "Source": c.get("source", ""),
                "Déjà connu Nicolas (O/N)": "O" if c.get("is_techtomed") else "N",
                "Décideur ou Influenceur (à remplir terrain)": c.get(
                    "decision_vs_influencer", ""
                ),
                "Notes": c.get("notes", ""),
            }
        )

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        write_workbook(tmp_path, companies_list, contacts_list)
        data = tmp_path.read_bytes()
    finally:
        tmp_path.unlink(missing_ok=True)

    filename = f"pharma_mapping_{team_slug}_{today}.xlsx"
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
