"""Background maintenance tasks.

Launched at app startup via `asyncio.create_task()`. Each coroutine here is
an infinite loop; the task is cancelled cleanly on shutdown.

Currently just one job: purge soft-deleted companies older than 24h along
with their contacts (cascade hard-delete). The interval is long and the
query is cheap — no need for a proper scheduler yet.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

log = logging.getLogger(__name__)

# Grace period before a soft-deleted company is hard-deleted. 24h matches
# the product spec ("5s undo in UI + 24h safety net in case tab is closed").
SOFT_DELETE_TTL = timedelta(hours=24)

# Sweep interval. 1h is generous: the UI commits to "undo within 5s", so by
# the time the purger runs, the window is long gone. Low DB pressure.
PURGE_SWEEP_INTERVAL_SECS = 3600


async def _purge_once(db: AsyncIOMotorDatabase) -> tuple[int, int, int]:
    """Run one purge pass.

    Returns (companies_purged, contacts_purged, connections_purged).
    """
    cutoff = datetime.now(tz=timezone.utc) - SOFT_DELETE_TTL
    # Step 1: collect ids of companies past their grace period. We do it in
    # two steps (find, then delete) so we can cascade contacts with the
    # exact same list — avoids a race where a restore sneaks in between
    # the cascade delete and the company delete.
    stale_ids: list = []
    async for doc in db.companies.find(
        {"deleted_at": {"$ne": None, "$lt": cutoff}},
        {"_id": 1, "team_id": 1},
    ):
        stale_ids.append(doc["_id"])
    if not stale_ids:
        return 0, 0, 0

    # Step 2: cascade-delete contacts + connections first, then the company
    # doc. If the process dies between the two, the next sweep will catch
    # the orphan company (children are already gone — no user-visible issue).
    contacts_res = await db.contacts.delete_many(
        {"company_id": {"$in": stale_ids}}
    )
    # Freeform connections are scoped per company — purge by company_id.
    connections_res = await db.connections.delete_many(
        {"company_id": {"$in": stale_ids}}
    )
    # The final company delete still re-checks deleted_at < cutoff so that
    # if someone called `restore` on one of these in the last few ms, we
    # don't wipe it. The cascade above may have deleted a handful of its
    # contacts in that window — acceptable edge case: the user can re-sync
    # Pipedrive or re-create the contacts manually. Realistically the
    # restore toast window is 5s and runs inside the same backend process,
    # so the actual race is vanishingly small.
    companies_res = await db.companies.delete_many(
        {
            "_id": {"$in": stale_ids},
            "deleted_at": {"$ne": None, "$lt": cutoff},
        }
    )
    return (
        companies_res.deleted_count,
        contacts_res.deleted_count,
        connections_res.deleted_count,
    )


async def purge_soft_deleted_companies(db: AsyncIOMotorDatabase) -> None:
    """Infinite loop: every hour, hard-delete companies soft-deleted > 24h ago.

    Cancellation-safe: on shutdown the event loop cancels this task and the
    `asyncio.sleep()` raises CancelledError, which propagates cleanly.
    """
    log.info(
        "background: purge_soft_deleted_companies started (ttl=%s, interval=%ss)",
        SOFT_DELETE_TTL,
        PURGE_SWEEP_INTERVAL_SECS,
    )
    while True:
        try:
            (
                purged_companies,
                purged_contacts,
                purged_connections,
            ) = await _purge_once(db)
            if purged_companies or purged_contacts or purged_connections:
                log.info(
                    "background: purged %d companies + %d contacts + %d connections (>24h soft-deleted)",
                    purged_companies,
                    purged_contacts,
                    purged_connections,
                )
        except asyncio.CancelledError:
            log.info("background: purge task cancelled, exiting")
            raise
        except Exception:  # pragma: no cover - defensive
            # Never let the loop die: log and keep going.
            log.exception("background: purge pass failed")
        try:
            await asyncio.sleep(PURGE_SWEEP_INTERVAL_SECS)
        except asyncio.CancelledError:
            log.info("background: purge task cancelled during sleep, exiting")
            raise
