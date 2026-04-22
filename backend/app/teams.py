"""Team helper functions: membership lookup, permission checks, slug helpers."""
from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Literal, Optional, Tuple

from bson import ObjectId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

log = logging.getLogger(__name__)

# Slug prefix for every user's auto-created personal team. Predictable so we
# can enforce idempotency at the unique-index level (a user gets at most one
# personal space, keyed by user_id).
PERSONAL_TEAM_SLUG_PREFIX = "personal-"
PERSONAL_TEAM_NAME = "Espace personnel"

TeamRoleStr = Literal["owner", "admin", "member"]

_ROLE_WEIGHT: dict[str, int] = {"owner": 3, "admin": 2, "member": 1}


def role_weight(role: str) -> int:
    """Return numeric weight for a team role. Unknown → 0."""
    return _ROLE_WEIGHT.get(role or "", 0)


def kebab_slug(s: str) -> str:
    """Turn a human-readable name into a url-safe kebab-case slug."""
    nf = unicodedata.normalize("NFKD", s or "")
    nf = "".join(c for c in nf if not unicodedata.combining(c))
    nf = nf.lower()
    nf = re.sub(r"[^a-z0-9]+", "-", nf).strip("-")
    return nf or "team"


async def generate_unique_team_slug(db: AsyncIOMotorDatabase, name: str) -> str:
    """Generate a unique slug for a new team.

    Starts with kebab(name); if taken, appends numeric suffixes -2, -3, ...
    """
    base = kebab_slug(name)
    candidate = base
    suffix = 2
    while await db.teams.find_one({"slug": candidate}, {"_id": 1}):
        candidate = f"{base}-{suffix}"
        suffix += 1
        if suffix > 9999:  # pathological safety net
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "Could not generate unique team slug",
            )
    return candidate


async def get_team_by_slug(
    db: AsyncIOMotorDatabase, slug: str
) -> Optional[dict]:
    """Return the team document matching `slug`, or None."""
    if not slug:
        return None
    return await db.teams.find_one({"slug": slug.lower()})


async def get_membership(
    db: AsyncIOMotorDatabase, team_id: ObjectId, user_id: Any
) -> Optional[dict]:
    """Return the team_members doc for (team_id, user_id), or None."""
    if not team_id or not user_id:
        return None
    return await db.team_members.find_one(
        {"team_id": team_id, "user_id": user_id}
    )


async def require_team_member(
    db: AsyncIOMotorDatabase, team_slug: str, user: dict
) -> Tuple[dict, dict]:
    """Ensure the current user is a member of `team_slug`.

    Raises:
      404 if the team does not exist
      403 if the user is not a member

    Returns (team, membership).
    """
    team = await get_team_by_slug(db, team_slug)
    if not team:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")
    membership = await get_membership(db, team["_id"], user["_id"])
    if not membership:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You are not a member of this team"
        )
    return team, membership


async def require_team_role(
    db: AsyncIOMotorDatabase,
    team_slug: str,
    user: dict,
    min_role: TeamRoleStr,
) -> Tuple[dict, dict]:
    """Like `require_team_member` but also enforces a minimum role.

    `min_role` is one of "member", "admin", "owner".
    """
    team, membership = await require_team_member(db, team_slug, user)
    needed = role_weight(min_role)
    have = role_weight(membership.get("role", ""))
    if have < needed:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Insufficient permission: requires {min_role}+",
        )
    return team, membership


async def ensure_personal_team(
    db: AsyncIOMotorDatabase, user: dict
) -> dict:
    """Idempotently create + membership-attach the user's personal team.

    Called at register time and from the migration. Uses a predictable slug
    (`personal-<user_id>`) so two concurrent calls race safely on the unique
    slug index rather than producing duplicates.

    Returns the team doc (fresh or existing).
    """
    user_id = user["_id"]
    slug = f"{PERSONAL_TEAM_SLUG_PREFIX}{str(user_id)}"

    existing = await db.teams.find_one({"slug": slug})
    if existing:
        # Ensure membership is in place (covers: imported / hand-patched users).
        await db.team_members.update_one(
            {"team_id": existing["_id"], "user_id": user_id},
            {
                "$setOnInsert": {
                    "team_id": existing["_id"],
                    "user_id": user_id,
                    "role": "owner",
                    "joined_at": datetime.now(tz=timezone.utc),
                    "invited_by": None,
                }
            },
            upsert=True,
        )
        # Backfill is_personal if older doc pre-dates the feature.
        if not existing.get("is_personal"):
            await db.teams.update_one(
                {"_id": existing["_id"]},
                {"$set": {"is_personal": True}},
            )
            existing["is_personal"] = True
        return existing

    now = datetime.now(tz=timezone.utc)
    team_doc = {
        "name": PERSONAL_TEAM_NAME,
        "slug": slug,
        "owner_id": user_id,
        "is_personal": True,
        "created_at": now,
        "updated_at": now,
        "settings": {"default_currency": ""},
    }
    try:
        res = await db.teams.insert_one(team_doc)
        team_doc["_id"] = res.inserted_id
    except Exception:
        # Concurrent insert won the race: re-fetch and fall through.
        existing = await db.teams.find_one({"slug": slug})
        if not existing:
            raise
        team_doc = existing

    await db.team_members.update_one(
        {"team_id": team_doc["_id"], "user_id": user_id},
        {
            "$setOnInsert": {
                "team_id": team_doc["_id"],
                "user_id": user_id,
                "role": "owner",
                "joined_at": now,
                "invited_by": None,
            }
        },
        upsert=True,
    )
    log.info(
        "Personal team created for user %s (slug=%s)",
        user.get("email"),
        slug,
    )
    return team_doc
