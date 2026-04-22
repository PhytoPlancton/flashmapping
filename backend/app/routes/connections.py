"""Connections — edges between contacts on the Freeform canvas.

Scoped to a team + a company. For the MVP there's a single `type`
(`"default"`) but the field is stored so Phase 2 can introduce
reporting/ally/influence types without a migration.

Soft-delete semantics: when a company is soft-deleted, its connections are
hidden (GET returns 404, POST/PATCH/DELETE reject). When the background
purger hard-deletes a soft-deleted company, `app.background` cascades to
`db.connections`. When a contact is hard-deleted, its route cascades
connections where it's source or target.
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
    ConnectionCreate,
    ConnectionOut,
    ConnectionUpdate,
)
from ..teams import require_team_member

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["connections"])


def _safe_oid(raw: str, label: str = "Resource") -> ObjectId:
    try:
        return ObjectId(raw)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label} not found")


async def _get_live_company(db, team_id: ObjectId, company_slug: str) -> dict:
    """Return the company doc for (team, slug) or 404 if missing/soft-deleted."""
    doc = await db.companies.find_one(
        {"team_id": team_id, "slug": company_slug.lower()}
    )
    if not doc or doc.get("deleted_at"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")
    return doc


@router.get(
    "/teams/{team_slug}/companies/{company_slug}/connections",
    response_model=list[ConnectionOut],
)
async def list_connections(
    team_slug: str,
    company_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> list[ConnectionOut]:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    company = await _get_live_company(db, team["_id"], company_slug)
    cursor = db.connections.find(
        {"team_id": team["_id"], "company_id": company["_id"]}
    ).sort("created_at", 1)
    return [ConnectionOut.model_validate(doc) async for doc in cursor]


@router.post(
    "/teams/{team_slug}/companies/{company_slug}/connections",
    response_model=ConnectionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_connection(
    team_slug: str,
    company_slug: str,
    payload: ConnectionCreate,
    user: dict[str, Any] = Depends(get_current_user),
) -> ConnectionOut:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    company = await _get_live_company(db, team["_id"], company_slug)

    source_oid = _safe_oid(payload.source_contact_id, "Contact")
    target_oid = _safe_oid(payload.target_contact_id, "Contact")

    # Self-loop: nothing to visualise, and in practice a UX footgun.
    if source_oid == target_oid:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "A connection cannot link a contact to itself (self-loop)",
        )

    # Validate both contacts belong to this company *in this team*. One round
    # trip (count_documents with $in) is enough: if count != 2, at least one
    # is missing or cross-company.
    matching = await db.contacts.count_documents(
        {
            "_id": {"$in": [source_oid, target_oid]},
            "team_id": team["_id"],
            "company_id": company["_id"],
        }
    )
    if matching != 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Both contacts must belong to this company",
        )

    now = datetime.now(tz=timezone.utc)
    doc = {
        "team_id": team["_id"],
        "company_id": company["_id"],
        "source_contact_id": source_oid,
        "target_contact_id": target_oid,
        "type": payload.type or "default",
        "label": payload.label or "",
        "created_at": now,
        "updated_at": now,
        "created_by": user["_id"],
    }
    try:
        res = await db.connections.insert_one(doc)
    except DuplicateKeyError:
        # Unique index on (company_id, source, target, type) — same edge in
        # the same direction + type already exists.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This connection already exists",
        )
    doc["_id"] = res.inserted_id
    return ConnectionOut.model_validate(doc)


@router.patch(
    "/teams/{team_slug}/companies/{company_slug}/connections/{connection_id}",
    response_model=ConnectionOut,
)
async def update_connection(
    team_slug: str,
    company_slug: str,
    connection_id: str,
    payload: ConnectionUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> ConnectionOut:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    company = await _get_live_company(db, team["_id"], company_slug)
    oid = _safe_oid(connection_id, "Connection")

    updates: dict[str, Any] = {}
    raw = payload.model_dump(exclude_unset=True)
    if "type" in raw and raw["type"] is not None:
        updates["type"] = raw["type"]
    if "label" in raw and raw["label"] is not None:
        updates["label"] = raw["label"]

    if not updates:
        doc = await db.connections.find_one(
            {
                "_id": oid,
                "team_id": team["_id"],
                "company_id": company["_id"],
            }
        )
        if not doc:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Connection not found"
            )
        return ConnectionOut.model_validate(doc)

    updates["updated_at"] = datetime.now(tz=timezone.utc)
    try:
        doc = await db.connections.find_one_and_update(
            {
                "_id": oid,
                "team_id": team["_id"],
                "company_id": company["_id"],
            },
            {"$set": updates},
            return_document=True,
        )
    except DuplicateKeyError:
        # Changing `type` can collide with another edge (same source/target,
        # other type) — surface as 409 so the UI can fall back cleanly.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Another connection with this type already exists",
        )
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")
    return ConnectionOut.model_validate(doc)


@router.delete(
    "/teams/{team_slug}/companies/{company_slug}/connections/{connection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_connection(
    team_slug: str,
    company_slug: str,
    connection_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    company = await _get_live_company(db, team["_id"], company_slug)
    oid = _safe_oid(connection_id, "Connection")
    res = await db.connections.delete_one(
        {
            "_id": oid,
            "team_id": team["_id"],
            "company_id": company["_id"],
        }
    )
    if res.deleted_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
