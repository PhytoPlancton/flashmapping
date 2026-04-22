"""Folders — organise companies within a team workspace.

V1 is **flat** (single level) and **team-shared** (any member can CRUD).
`parent_folder_id` is reserved in the schema for nested V2 but never filled
today. Deleting a folder **never** cascades to its companies: they bubble
back up to the root (`folder_id=null`) so the user never loses data by a
misclick.

Permissions: every endpoint is gated by `require_team_member` — folders are
organisational, not security boundaries, so we don't require admin.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pymongo.errors import DuplicateKeyError

from ..auth import get_current_user
from ..db import get_db
from ..models import (
    FolderCreate,
    FolderOut,
    FolderReorderRequest,
    FolderUpdate,
)
from ..teams import require_team_member

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["folders"])


def _safe_oid(raw: str, label: str = "Folder") -> ObjectId:
    try:
        return ObjectId(raw)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label} not found")


async def _companies_counts_by_folder(
    db, team_id: ObjectId
) -> dict[ObjectId, int]:
    """Aggregate live-company counts keyed by `folder_id` for one team.

    Only counts live (non-soft-deleted) companies so the sidebar badge
    matches what the user sees in the list. Returns an empty dict when the
    team has no folders yet.
    """
    pipeline = [
        {
            "$match": {
                "team_id": team_id,
                "folder_id": {"$ne": None},
                "$or": [
                    {"deleted_at": None},
                    {"deleted_at": {"$exists": False}},
                ],
            }
        },
        {"$group": {"_id": "$folder_id", "n": {"$sum": 1}}},
    ]
    counts: dict[ObjectId, int] = {}
    async for row in db.companies.aggregate(pipeline):
        counts[row["_id"]] = int(row.get("n", 0))
    return counts


@router.get(
    "/teams/{slug}/folders", response_model=list[FolderOut]
)
async def list_folders(
    slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> list[FolderOut]:
    """List folders in a team, sorted by (position ASC, name ASC).

    Each folder carries `companies_count` — the number of live companies
    currently assigned to it. Companies with `folder_id=null` are rendered
    by the UI as the implicit "Sans dossier" section and are not counted
    here.
    """
    db = get_db()
    team, _ = await require_team_member(db, slug, user)
    counts = await _companies_counts_by_folder(db, team["_id"])
    out: list[FolderOut] = []
    async for doc in db.folders.find({"team_id": team["_id"]}):
        doc["companies_count"] = counts.get(doc["_id"], 0)
        out.append(FolderOut.model_validate(doc))
    # Stable secondary sort on name handles ties when the user hasn't
    # manually reordered yet (all positions still 0 / equal).
    out.sort(key=lambda f: (f.position, f.name.lower()))
    return out


@router.post(
    "/teams/{slug}/folders",
    response_model=FolderOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_folder(
    slug: str,
    payload: FolderCreate,
    user: dict[str, Any] = Depends(get_current_user),
) -> FolderOut:
    """Create a folder.

    Position is auto-assigned as `max(existing)+1` so new folders land at
    the bottom of the list. The unique `(team_id, name)` index surfaces
    duplicates as 409.
    """
    db = get_db()
    team, _ = await require_team_member(db, slug, user)
    now = datetime.now(tz=timezone.utc)

    # Compute next position. `sort+limit(1)` is the cheap way to get MAX(pos).
    next_pos = 0
    cursor = db.folders.find(
        {"team_id": team["_id"]}, {"position": 1}
    ).sort("position", -1).limit(1)
    async for d in cursor:
        next_pos = int(d.get("position", 0)) + 1

    doc = {
        "team_id": team["_id"],
        "name": payload.name.strip(),
        "icon": payload.icon,
        "color": payload.color,
        # Reserved for V2; always `None` at creation time in V1.
        "parent_folder_id": None,
        "position": next_pos,
        "created_at": now,
        "updated_at": now,
        "created_by": user["_id"],
    }
    try:
        res = await db.folders.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A folder with this name already exists in this team",
        )
    doc["_id"] = res.inserted_id
    doc["companies_count"] = 0
    log.info(
        "Folder %s created in team %s by %s",
        doc["name"],
        slug,
        user.get("email"),
    )
    return FolderOut.model_validate(doc)


@router.patch(
    "/teams/{slug}/folders/{folder_id}",
    response_model=FolderOut,
)
async def update_folder(
    slug: str,
    folder_id: str,
    payload: FolderUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> FolderOut:
    """Rename / recolour / re-icon / reposition a single folder.

    Pass only the fields you want to change; omitted ones stay untouched
    (`exclude_unset=True`). Renaming into an existing name → 409.
    """
    db = get_db()
    team, _ = await require_team_member(db, slug, user)
    oid = _safe_oid(folder_id)
    raw = payload.model_dump(exclude_unset=True)
    updates: dict[str, Any] = {}
    for k, v in raw.items():
        # `icon` and `color` accept explicit `null` to clear — keep None.
        if k in ("icon", "color"):
            updates[k] = v
        elif v is not None:
            updates[k] = v
    if "name" in updates:
        updates["name"] = updates["name"].strip()
    if not updates:
        doc = await db.folders.find_one(
            {"_id": oid, "team_id": team["_id"]}
        )
        if not doc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
        counts = await _companies_counts_by_folder(db, team["_id"])
        doc["companies_count"] = counts.get(doc["_id"], 0)
        return FolderOut.model_validate(doc)
    updates["updated_at"] = datetime.now(tz=timezone.utc)
    try:
        doc = await db.folders.find_one_and_update(
            {"_id": oid, "team_id": team["_id"]},
            {"$set": updates},
            return_document=True,
        )
    except DuplicateKeyError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A folder with this name already exists in this team",
        )
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    counts = await _companies_counts_by_folder(db, team["_id"])
    doc["companies_count"] = counts.get(doc["_id"], 0)
    return FolderOut.model_validate(doc)


@router.delete(
    "/teams/{slug}/folders/{folder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_folder(
    slug: str,
    folder_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    """Delete a folder and bubble its companies back to the root.

    Never cascades to companies — a misclick on a dossier with 8 accounts
    should not vaporise the accounts. The UI confirms with an explicit
    count in the modal (see UX doc §4).
    """
    db = get_db()
    team, _ = await require_team_member(db, slug, user)
    oid = _safe_oid(folder_id)
    folder = await db.folders.find_one(
        {"_id": oid, "team_id": team["_id"]}
    )
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    # Detach companies first so a crash mid-operation never leaves orphans
    # pointing to a deleted folder id.
    await db.companies.update_many(
        {"team_id": team["_id"], "folder_id": oid},
        {
            "$set": {
                "folder_id": None,
                "updated_at": datetime.now(tz=timezone.utc),
            }
        },
    )
    await db.folders.delete_one({"_id": oid, "team_id": team["_id"]})
    log.info(
        "Folder %s deleted from team %s by %s (companies bubbled to root)",
        folder_id,
        slug,
        user.get("email"),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/teams/{slug}/folders/reorder",
    response_model=list[FolderOut],
)
async def reorder_folders(
    slug: str,
    payload: FolderReorderRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> list[FolderOut]:
    """Rewrite `position` for every folder based on the order of `ids`.

    The new position is simply the index in the list (0, 1, 2, ...). Ids
    that don't belong to this team are silently ignored; unknown / invalid
    ids are skipped rather than 400'd so a stale client can't brick the
    reorder with one dangling id.
    """
    db = get_db()
    team, _ = await require_team_member(db, slug, user)
    now = datetime.now(tz=timezone.utc)
    for idx, raw_id in enumerate(payload.ids):
        try:
            oid = ObjectId(raw_id)
        except (InvalidId, TypeError):
            continue
        await db.folders.update_one(
            {"_id": oid, "team_id": team["_id"]},
            {"$set": {"position": idx, "updated_at": now}},
        )
    # Return the fresh ordering so the client doesn't need a second GET.
    counts = await _companies_counts_by_folder(db, team["_id"])
    out: list[FolderOut] = []
    async for doc in db.folders.find({"team_id": team["_id"]}):
        doc["companies_count"] = counts.get(doc["_id"], 0)
        out.append(FolderOut.model_validate(doc))
    out.sort(key=lambda f: (f.position, f.name.lower()))
    return out
