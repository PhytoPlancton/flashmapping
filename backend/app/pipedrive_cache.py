"""Lightweight cache of Pipedrive persons, scoped per team.

Rationale: per-company auto-match needs to look up each FM contact against the
team's full Pipedrive book (tens of thousands of persons). Calling `/v1/persons`
on every page load would be wasteful and slow; instead we cache the full list
locally with a 24h TTL and rebuild on demand.

Collection shape (`pipedrive_cache`):
    {
        _id: ObjectId,
        team_id: ObjectId,
        pd_id: int,                  # Pipedrive person id
        name: str,
        name_norm: str,              # normalised for matching
        org_name: str,
        org_name_norm: str,
        emails: [str],               # normalised lowercase
        updated_at: datetime,
    }

Plus one meta doc per team:
    {
        _id: {"team_id": ObjectId, "kind": "persons"},
        refreshed_at: datetime,
    }
"""
from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from bson import ObjectId

from .pipedrive import PipedriveClient

log = logging.getLogger(__name__)

CACHE_COL = "pipedrive_cache"
META_COL = "pipedrive_cache_meta"
TTL_HOURS = 24


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(sorted(s.split()))


def _norm_keep_order(s: str) -> str:
    """Same as _norm but preserves token order (for substring-style matches)."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


async def ensure_indexes(db: Any) -> None:
    await db[CACHE_COL].create_index([("team_id", 1), ("name_norm", 1)])
    await db[CACHE_COL].create_index([("team_id", 1), ("pd_id", 1)], unique=True)


async def _refresh_cache(
    db: Any, team_id: ObjectId, client: PipedriveClient
) -> int:
    """Pull all Pipedrive persons and upsert them into the cache. Returns count."""
    log.info("Pipedrive cache refresh for team %s", team_id)
    start = 0
    count = 0
    # Mark the pre-refresh timestamp so we can delete stale entries after.
    cutoff = datetime.now(tz=timezone.utc)
    while True:
        data = await client._request(
            "GET", "/persons", params={"start": start, "limit": 500}
        )
        items = data.get("data") or []
        for p in items:
            pd_id = p.get("id")
            if not pd_id:
                continue
            name = (p.get("name") or "").strip()
            org_name = (p.get("org_name") or "").strip()
            emails_raw = p.get("email") or []
            emails: list[str] = []
            for e in emails_raw:
                v = (e.get("value") if isinstance(e, dict) else e or "") or ""
                v = v.strip().lower()
                if v:
                    emails.append(v)
            await db[CACHE_COL].update_one(
                {"team_id": team_id, "pd_id": int(pd_id)},
                {
                    "$set": {
                        "name": name,
                        "name_norm": _norm(name),
                        "org_name": org_name,
                        "org_name_norm": _norm_keep_order(org_name),
                        "emails": emails,
                        "updated_at": datetime.now(tz=timezone.utc),
                    }
                },
                upsert=True,
            )
            count += 1
        pg = (data.get("additional_data") or {}).get("pagination") or {}
        if not pg.get("more_items_in_collection"):
            break
        start = int(pg.get("next_start") or (start + 500))

    # Drop cache entries not touched by this refresh (person deleted in PD).
    await db[CACHE_COL].delete_many({
        "team_id": team_id,
        "updated_at": {"$lt": cutoff},
    })

    await db[META_COL].update_one(
        {"_id": {"team_id": team_id, "kind": "persons"}},
        {"$set": {"refreshed_at": datetime.now(tz=timezone.utc)}},
        upsert=True,
    )
    log.info("Pipedrive cache: %d persons for team %s", count, team_id)
    return count


async def ensure_fresh_cache(
    db: Any,
    team_id: ObjectId,
    client: PipedriveClient,
    *,
    ttl_hours: int = TTL_HOURS,
) -> bool:
    """Refresh cache if stale. Returns True if a refresh happened."""
    meta = await db[META_COL].find_one({"_id": {"team_id": team_id, "kind": "persons"}})
    refreshed = meta.get("refreshed_at") if meta else None
    now = datetime.now(tz=timezone.utc)
    # refreshed may be naive from older Mongo docs; normalize to aware.
    if refreshed and refreshed.tzinfo is None:
        refreshed = refreshed.replace(tzinfo=timezone.utc)
    if refreshed and (now - refreshed) < timedelta(hours=ttl_hours):
        return False
    await _refresh_cache(db, team_id, client)
    return True


async def match_contacts_to_pipedrive(
    db: Any,
    team_id: ObjectId,
    company_id: ObjectId,
    fm_company_name: str,
) -> list[dict[str, Any]]:
    """Match FM contacts (company-scoped, without pipedrive_person_id) against
    the team's Pipedrive cache **by name only**. If the exact normalised name
    exists in the CRM → link it (so the green Pipedrive badge appears). On
    homonyms (multiple PD persons share the same name) we pick the first hit.

    Returns a list of {contact_id, pipedrive_person_id, pd_name, pd_org}.
    """
    fm_contacts = await db.contacts.find(
        {
            "team_id": team_id,
            "company_id": company_id,
            "$or": [
                {"pipedrive_person_id": None},
                {"pipedrive_person_id": {"$exists": False}},
            ],
        },
        projection={"_id": 1, "name": 1},
    ).to_list(length=None)

    if not fm_contacts:
        return []

    updated: list[dict[str, Any]] = []
    for c in fm_contacts:
        key = _norm(c.get("name") or "")
        if not key:
            continue
        pick = await db[CACHE_COL].find_one(
            {"team_id": team_id, "name_norm": key},
            projection={"pd_id": 1, "name": 1, "org_name": 1},
        )
        if not pick:
            continue
        pd_id = int(pick["pd_id"])
        await db.contacts.update_one(
            {"_id": c["_id"]},
            {"$set": {"pipedrive_person_id": pd_id}},
        )
        updated.append({
            "contact_id": str(c["_id"]),
            "pipedrive_person_id": pd_id,
            "pd_name": pick.get("name"),
            "pd_org": pick.get("org_name"),
        })

    return updated
