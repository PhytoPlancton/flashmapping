"""MongoDB Motor client singleton + index setup."""
from __future__ import annotations

import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING

from .config import get_settings

log = logging.getLogger(__name__)

_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None


async def connect() -> AsyncIOMotorDatabase:
    """Initialise the Motor client. Called once at app startup."""
    global _client, _db
    if _db is not None:
        return _db
    settings = get_settings()
    _client = AsyncIOMotorClient(settings.mongo_uri, tz_aware=True)
    _db = _client[settings.mongo_db]
    # Trigger a server ping so we fail fast if the URI is invalid.
    await _client.admin.command("ping")
    log.info("Connected to MongoDB database '%s'", settings.mongo_db)
    return _db


async def disconnect() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
    _client = None
    _db = None


def get_db() -> AsyncIOMotorDatabase:
    """Return the active database handle. Raises if not yet connected."""
    if _db is None:
        raise RuntimeError("Database is not initialised. Call connect() first.")
    return _db


async def _drop_index_safe(collection, name: str) -> None:
    """Drop an index by name, ignoring if it doesn't exist."""
    try:
        await collection.drop_index(name)
        log.info("Dropped legacy index %s on %s", name, collection.name)
    except Exception:
        pass


async def ensure_indexes() -> None:
    db = get_db()

    # --- users ---
    await db.users.create_index("email", unique=True)

    # --- teams ---
    await db.teams.create_index("slug", unique=True)

    # --- team_members: unique (team_id, user_id) ---
    await db.team_members.create_index(
        [("team_id", ASCENDING), ("user_id", ASCENDING)], unique=True
    )
    await db.team_members.create_index("user_id")

    # --- team_invites ---
    await db.team_invites.create_index("code", unique=True)
    await db.team_invites.create_index("team_id")

    # --- companies ---
    # Drop the old global-unique slug index if present so we can recreate it
    # scoped to team. Name convention from pymongo is "<field>_1".
    await _drop_index_safe(db.companies, "slug_1")
    await db.companies.create_index(
        [("team_id", ASCENDING), ("slug", ASCENDING)], unique=True
    )
    await db.companies.create_index("team_id")
    # Fast "list companies in a folder" query — the sidebar hits it on every
    # render when folders are expanded.
    await db.companies.create_index(
        [("team_id", ASCENDING), ("folder_id", ASCENDING)]
    )

    # --- folders ---
    # Name uniqueness is scoped to the team so two teams can each have a
    # "Pharma" folder without collision.
    await db.folders.create_index(
        [("team_id", ASCENDING), ("name", ASCENDING)], unique=True
    )
    # Sort the sidebar by (position, name) — position is the manual drag order
    # and name breaks ties deterministically.
    await db.folders.create_index(
        [("team_id", ASCENDING), ("position", ASCENDING)]
    )

    # --- contacts ---
    # Replace old (company_id, level, position_in_level) with team-scoped one.
    await _drop_index_safe(
        db.contacts, "company_id_1_level_1_position_in_level_1"
    )
    await db.contacts.create_index(
        [
            ("team_id", ASCENDING),
            ("company_id", ASCENDING),
            ("level", ASCENDING),
            ("position_in_level", ASCENDING),
        ]
    )
    await db.contacts.create_index("team_id")
    await db.contacts.create_index("company_id")

    # --- connections (Freeform view) ---
    # Fast "list all edges for a company" query. (team_id, company_id) is
    # the hot path: every load of the Freeform view hits it.
    await db.connections.create_index(
        [("team_id", ASCENDING), ("company_id", ASCENDING)]
    )
    # Uniqueness: at most one edge per (company, source, target, type). The
    # `type` axis leaves room for Phase 2's 3-type palette without a migration.
    # Drop any legacy name first (rename-safe: pattern "drop legacy + create").
    await _drop_index_safe(
        db.connections,
        "company_id_1_source_contact_id_1_target_contact_id_1_type_1",
    )
    await db.connections.create_index(
        [
            ("company_id", ASCENDING),
            ("source_contact_id", ASCENDING),
            ("target_contact_id", ASCENDING),
            ("type", ASCENDING),
        ],
        unique=True,
    )

    # --- pipedrive_cache (persons book, scoped per team) ---
    await db.pipedrive_cache.create_index(
        [("team_id", ASCENDING), ("pd_id", ASCENDING)], unique=True
    )
    await db.pipedrive_cache.create_index(
        [("team_id", ASCENDING), ("name_norm", ASCENDING)]
    )

    log.info("MongoDB indexes ensured")
