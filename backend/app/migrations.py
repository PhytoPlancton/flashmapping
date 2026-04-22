"""Database migrations run at application startup.

Currently only V2 migration: attach any legacy (team-less) companies and
contacts to a default team owned by the first admin user.

All migrations are idempotent so they can safely be re-run on every startup.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

log = logging.getLogger(__name__)


DEFAULT_TEAM_NAME = "muchbetter.ai"
DEFAULT_TEAM_SLUG = "muchbetter-ai"


def _kebab(s: str) -> str:
    """Turn a string into a url-safe kebab-case slug."""
    nf = unicodedata.normalize("NFKD", s or "")
    nf = "".join(c for c in nf if not unicodedata.combining(c))
    nf = nf.lower()
    nf = re.sub(r"[^a-z0-9]+", "-", nf).strip("-")
    return nf or "team"


async def _pick_anchor_user(db: AsyncIOMotorDatabase) -> dict | None:
    """Return the admin user if any, else the first created user, else None."""
    user = await db.users.find_one({"role": "admin"}, sort=[("created_at", 1)])
    if user:
        return user
    return await db.users.find_one({}, sort=[("created_at", 1)])


async def migrate_legacy_team_scope(db: AsyncIOMotorDatabase) -> None:
    """Attach team-less companies + contacts to a default team.

    Idempotent:
      - If no legacy docs exist, returns quickly.
      - If team/membership already exist, reuses them.
    """
    # Any legacy company? (no team_id OR team_id is null)
    legacy_count = await db.companies.count_documents(
        {"$or": [{"team_id": {"$exists": False}}, {"team_id": None}]},
        limit=1,
    )
    if legacy_count == 0:
        log.debug("migrate_legacy_team_scope: nothing to do")
        return

    user = await _pick_anchor_user(db)
    if not user:
        log.warning(
            "migrate_legacy_team_scope: legacy data exists but no user — skipping"
        )
        return

    now = datetime.now(tz=timezone.utc)

    # --- Team ---
    team = await db.teams.find_one({"slug": DEFAULT_TEAM_SLUG})
    if not team:
        team_doc = {
            "name": DEFAULT_TEAM_NAME,
            "slug": DEFAULT_TEAM_SLUG,
            "owner_id": user["_id"],
            "created_at": now,
            "updated_at": now,
            "settings": {"default_currency": ""},
        }
        res = await db.teams.insert_one(team_doc)
        team_doc["_id"] = res.inserted_id
        team = team_doc
        log.info(
            "migrate_legacy_team_scope: created default team '%s' owned by %s",
            DEFAULT_TEAM_SLUG,
            user.get("email"),
        )

    team_id = team["_id"]

    # --- Membership (owner) ---
    existing_membership = await db.team_members.find_one(
        {"team_id": team_id, "user_id": user["_id"]}
    )
    if not existing_membership:
        await db.team_members.insert_one(
            {
                "team_id": team_id,
                "user_id": user["_id"],
                "role": "owner",
                "joined_at": now,
                "invited_by": None,
            }
        )
        log.info(
            "migrate_legacy_team_scope: added %s as owner of %s",
            user.get("email"),
            DEFAULT_TEAM_SLUG,
        )

    # --- Backfill companies ---
    comp_res = await db.companies.update_many(
        {"$or": [{"team_id": {"$exists": False}}, {"team_id": None}]},
        {"$set": {"team_id": team_id, "updated_at": now}},
    )
    # --- Backfill contacts ---
    contact_res = await db.contacts.update_many(
        {"$or": [{"team_id": {"$exists": False}}, {"team_id": None}]},
        {"$set": {"team_id": team_id, "updated_at": now}},
    )

    log.info(
        "migrate_legacy_team_scope: updated %d companies and %d contacts → team %s",
        comp_res.modified_count,
        contact_res.modified_count,
        DEFAULT_TEAM_SLUG,
    )


async def ensure_personal_teams_for_all_users(
    db: AsyncIOMotorDatabase,
) -> None:
    """Backfill a personal team for every existing user who lacks one.

    Runs before the legacy team-scope migration so Nicolas (the first admin)
    already has his personal space in place — the legacy migration then
    still creates the shared `muchbetter.ai` team separately, unrelated.

    Idempotent: `ensure_personal_team` is itself a no-op when the team
    already exists.
    """
    # Local import to avoid a circular import at module load time
    # (app.teams imports nothing from migrations, but better safe than sorry).
    from .teams import ensure_personal_team

    created = 0
    async for user in db.users.find({}):
        try:
            team = await ensure_personal_team(db, user)
            # Rough heuristic to log only brand-new creations. Cheap enough.
            if team.get("created_at") and (
                datetime.now(tz=timezone.utc) - team["created_at"]
            ).total_seconds() < 5:
                created += 1
        except Exception:  # pragma: no cover - defensive
            log.exception(
                "ensure_personal_team failed for user %s", user.get("email")
            )
    if created:
        log.info(
            "ensure_personal_teams_for_all_users: backfilled %d personal team(s)",
            created,
        )


async def run_all_migrations(db: AsyncIOMotorDatabase) -> None:
    """Entry point: run all known migrations in order."""
    # 1. Personal spaces first, so every user has at least one team.
    await ensure_personal_teams_for_all_users(db)
    # 2. Legacy team-scope backfill (muchbetter.ai default team).
    await migrate_legacy_team_scope(db)
