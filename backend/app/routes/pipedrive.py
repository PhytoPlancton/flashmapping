"""Pipedrive push-only integration routes.

All endpoints are team-scoped and require membership. Mutating endpoints
(connect/disconnect + company sync) require admin+; per-contact sync is
allowed for any team member.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import get_current_user
from ..db import get_db
from ..models import (
    ContactOut,
    PipedriveConnectRequest,
    PipedriveConnectResponse,
    PipedriveFieldOut,
    PipedriveFieldsResponse,
    PipedriveMappingUpdateRequest,
    PipedriveStatusResponse,
    PipedriveSyncError,
    PipedriveSyncResponse,
    PipedriveUserInfo,
)
from ..pipedrive import (
    PipedriveClient,
    PipedriveError,
    get_client_for_team,
)
from ..pipedrive_cache import (
    ensure_fresh_cache as _ensure_fresh_pd_cache,
    match_contacts_to_pipedrive as _match_company_contacts_to_pd,
)
from ..teams import require_team_member, require_team_role

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["pipedrive"])

# Be polite: Pipedrive's limit is ~80 requests / 2 seconds on the personal
# plan. We throttle between calls to stay well under and avoid 429s.
_RATE_LIMIT_SLEEP_SECS = 0.15

# TTL for the cached /personFields schema. Fresh enough that newly-created
# Pipedrive fields show up the same day; long enough that we don't hammer
# the Pipedrive API on every page load. Refresh is also explicit via the
# `POST /pipedrive/fields/refresh` endpoint.
_FIELD_SCHEMA_TTL = timedelta(hours=24)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_CATEGORY_LABELS = {
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
    "other": "Other",
}


# ---------------------------------------------------------------------------
# Custom-field mapping — declarative
# ---------------------------------------------------------------------------
#
# `AVAILABLE_OUR_FIELDS` is the authoritative whitelist of internal contact
# attributes we can push into a Pipedrive custom field. Keys are stable
# strings (used as dict keys in `team.settings.pipedrive_person_field_mapping`).
# The order also drives the rendering order of the Settings UI.
#
# `AUTO_MATCH_KEYWORDS` is the case-insensitive substring heuristic used at
# connect-time (or on demand) to guess which Pipedrive field maps to which
# of our attributes. Matching is done on the Pipedrive field's human `name`,
# lowercased and stripped of accents — see `_match_field`.
#
# `FIELD_LABELS_FR` is the UI label (French). Kept server-side so backend
# and frontend agree on casing/wording.


AVAILABLE_OUR_FIELDS: list[str] = [
    "linkedin_url",
    "headline",
    "category",
    "seniority",
    "source",
    "qualification",
    "title",
    "school",
    "persona",
    "comments",
    "relation",
    "sales_navigator_url",
    "initiatives",
    "language",
    "gender",
    "newsletter",
]


FIELD_LABELS_FR: dict[str, str] = {
    "linkedin_url": "LinkedIn URL",
    "headline": "Headline LinkedIn",
    "category": "Catégorie",
    "seniority": "Séniorité / Hiérarchie",
    "source": "Source / Provenance",
    "qualification": "Statut du lead",
    "title": "Intitulé du poste",
    "school": "École",
    "persona": "Persona",
    "comments": "Commentaires",
    "relation": "Relation",
    "sales_navigator_url": "Sales Navigator URL",
    "initiatives": "Initiatives",
    "language": "Langue",
    "gender": "Genre",
    "newsletter": "Newsletter",
}


# Ordered list of substrings to match against a Pipedrive field name (lower,
# no accents). First match wins. We deliberately put the more specific
# tokens first (e.g. "linkedin url" before "linkedin") so noisy fields like
# "LinkedIn Headline" don't get grabbed by `linkedin_url`.
AUTO_MATCH_KEYWORDS: dict[str, list[str]] = {
    "linkedin_url": ["linkedin url", "linkedinurl", "linkedin"],
    "headline": ["linkedin headline", "headline"],
    "category": ["categorie", "category"],
    "seniority": ["hierarchy", "hierarchie", "seniority", "seniorite"],
    "source": ["provenance", "source"],
    "qualification": ["statut du lead", "lead status", "qualification"],
    # `title` matches both the Pipedrive standard `job_title` key *and* any
    # "Intitulé du poste" custom field — route logic prefers the standard
    # one by checking for key == "job_title" before falling into the mapping.
    "title": ["intitule du poste", "job title", "poste"],
    "school": ["school name", "ecole", "school"],
    "persona": ["persona"],
    "comments": ["commentaires", "comments"],
    "relation": ["relation"],
    "sales_navigator_url": ["sales navigator", "sn url"],
    "initiatives": ["initiatives"],
    "language": ["language", "langue"],
    "gender": ["gender", "genre"],
    "newsletter": ["newsletter"],
}


def _normalise_label(label: str) -> str:
    """Lower-case + strip French accents from a field name for matching.

    Matches the frontend's common normalisation (NFKD + filter combining).
    Pipedrive labels are typed by the user ("Catégorie - MB", "Hiérarchie"…)
    so we need accent-insensitive matching to hit consistently.
    """
    import unicodedata

    s = unicodedata.normalize("NFKD", label or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.strip().lower()


def _match_field(
    our_key: str, fields: list[dict[str, Any]]
) -> Optional[str]:
    """Find a Pipedrive field whose label contains one of our keywords.

    Returns the Pipedrive field `key` (hash for custom fields, snake_case
    for standard fields) of the first non-system match, or None. A field
    with `edit_flag == False` is treated as read-only and skipped (we can't
    write to it via the API, so mapping it would just silently fail).
    """
    keywords = AUTO_MATCH_KEYWORDS.get(our_key) or []
    if not keywords:
        return None
    # Each field gets its normalised name computed once — cheap but tidy.
    indexed = [
        (f, _normalise_label(str(f.get("name") or "")))
        for f in fields
        if isinstance(f, dict) and f.get("key")
    ]
    for kw in keywords:
        kw_norm = _normalise_label(kw)
        for field, name_norm in indexed:
            if kw_norm and kw_norm in name_norm:
                # Skip fields Pipedrive tells us are not writable (system-
                # managed like "added_by" / "update_time"). Some standard
                # fields legitimately have `edit_flag=False`, in which case
                # Pipedrive will simply ignore the value in the PUT payload
                # — we'd rather skip and let the user pick a sibling field.
                if field.get("edit_flag") is False:
                    continue
                return str(field.get("key") or "") or None
    return None


def _auto_map_fields(
    schema: list[dict[str, Any]],
    existing_mapping: Optional[dict[str, str]] = None,
) -> tuple[dict[str, str], list[str]]:
    """Build a `{our_key: pd_key}` mapping from a Pipedrive schema.

    Only fills in entries that are *missing* from `existing_mapping` — we
    never overwrite a manually-curated mapping. Returns (full_mapping,
    list_of_auto_detected_keys).
    """
    mapping: dict[str, str] = dict(existing_mapping or {})
    auto: list[str] = []
    for our_key in AVAILABLE_OUR_FIELDS:
        if mapping.get(our_key):
            continue
        pd_key = _match_field(our_key, schema)
        if pd_key:
            mapping[our_key] = pd_key
            auto.append(our_key)
    return mapping, auto


def _schema_is_fresh(cached_at: Any) -> bool:
    """True if `cached_at` is a datetime within the TTL window."""
    if not isinstance(cached_at, datetime):
        return False
    # Normalise naive → aware so subtraction works on either variant.
    if cached_at.tzinfo is None:
        cached_at = cached_at.replace(tzinfo=timezone.utc)
    return (datetime.now(tz=timezone.utc) - cached_at) < _FIELD_SCHEMA_TTL


async def _ensure_schema(
    db: Any,
    team: dict[str, Any],
    client: PipedriveClient,
    *,
    force: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, str], list[str]]:
    """Load the Pipedrive Person field schema (cached unless stale/forced),
    auto-complete any missing mapping entries, and persist both to the
    team's settings. Returns (schema, mapping, auto_detected_keys).
    """
    settings_dict = (team or {}).get("settings") or {}
    schema: list[dict[str, Any]] = (
        settings_dict.get("pipedrive_field_schema") or []
    )
    cached_at = settings_dict.get("pipedrive_field_schema_cached_at")
    existing_mapping: dict[str, str] = (
        settings_dict.get("pipedrive_person_field_mapping") or {}
    )

    must_fetch = force or not schema or not _schema_is_fresh(cached_at)

    if must_fetch:
        try:
            schema = await client.list_person_fields()
        except PipedriveError as e:
            # If we had a cached schema, fall back to it — better than 5xx.
            log.warning(
                "Pipedrive list_person_fields failed for team %s: %s",
                team.get("slug"), e,
            )
            if not schema:
                raise

    mapping, auto = _auto_map_fields(schema, existing_mapping)

    # Persist whatever we learned. We always update `cached_at` after a
    # successful fetch, and we always persist the (possibly auto-extended)
    # mapping — storing an empty update is harmless.
    now = datetime.now(tz=timezone.utc)
    updates: dict[str, Any] = {
        "settings.pipedrive_person_field_mapping": mapping,
        "updated_at": now,
    }
    if must_fetch:
        updates["settings.pipedrive_field_schema"] = schema
        updates["settings.pipedrive_field_schema_cached_at"] = now
    await db.teams.update_one({"_id": team["_id"]}, {"$set": updates})
    return schema, mapping, auto


def _resolve_contact_value(
    contact: dict[str, Any], our_key: str
) -> Any:
    """Return the value to push for `our_key` given one of our contact docs.

    Returns `None` (or "") when the contact has nothing meaningful — the
    caller skips these so we never blank out a Pipedrive cell.
    """
    if our_key == "linkedin_url":
        return (contact.get("linkedin_url") or "").strip() or None
    if our_key == "headline":
        # We don't store a separate LinkedIn headline today — fall back to
        # the job title which, on LinkedIn, IS the headline for most people.
        return (contact.get("title") or "").strip() or None
    if our_key == "category":
        cat = contact.get("category") or ""
        if cat and cat != "other":
            return _CATEGORY_LABELS.get(cat, cat)
        return None
    if our_key == "seniority":
        s = (contact.get("seniority") or "").strip()
        return s if s and s != "Unknown" else None
    if our_key == "source":
        # "Réseau interne" prefix keeps the Pipedrive Source field sortable
        # for contacts the user explicitly marked as already-known.
        if contact.get("is_techtomed"):
            src = (contact.get("source") or "").strip()
            return f"Réseau interne — {src}" if src else "Réseau interne"
        return (contact.get("source") or "").strip() or None
    if our_key == "qualification":
        return (contact.get("qualification") or "").strip() or None
    if our_key == "title":
        return (contact.get("title") or "").strip() or None
    if our_key == "school":
        # Not modelled yet in our Contact — placeholder so the mapping exists
        # and the field stays compatible with future enrichment.
        return (contact.get("school") or "").strip() or None
    if our_key == "persona":
        return (contact.get("persona") or "").strip() or None
    if our_key == "comments":
        return (contact.get("notes") or "").strip() or None
    if our_key == "relation":
        return (contact.get("relation") or "").strip() or None
    if our_key == "sales_navigator_url":
        return (contact.get("sales_navigator_url") or "").strip() or None
    if our_key == "initiatives":
        val = contact.get("initiatives")
        if isinstance(val, list):
            return ", ".join(str(x) for x in val if x) or None
        if isinstance(val, str):
            return val.strip() or None
        return None
    if our_key == "language":
        return (contact.get("language") or "").strip() or None
    if our_key == "gender":
        return (contact.get("gender") or "").strip() or None
    if our_key == "newsletter":
        # Booleans → Pipedrive accepts the literal string for varchar fields;
        # enum fields would need option ids (TODO below).
        val = contact.get("newsletter")
        if val in (True, "yes", "Yes", "oui", "Oui"):
            return "Oui"
        if val in (False, "no", "No", "non", "Non"):
            return "Non"
        if isinstance(val, str) and val.strip():
            return val.strip()
        return None
    return None


def _coerce_org_id(raw: Any) -> Optional[int]:
    """Coerce `company.crm_id` (stored as string) to a Pipedrive org_id int.

    Returns None if raw is empty, non-numeric, or zero.
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        val = int(s)
    except (TypeError, ValueError):
        return None
    return val if val > 0 else None


def _safe_oid(raw: str, label: str = "Resource") -> ObjectId:
    try:
        return ObjectId(raw)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label} not found")


def _build_notes(
    contact: dict[str, Any],
    company: dict[str, Any],
    mapping: Optional[dict[str, str]] = None,
) -> str:
    """Compose a multi-line notes block for attributes that are NOT covered
    by a Pipedrive custom-field mapping.

    If `mapping` is provided, any info that already flows into a Pipedrive
    custom field (linkedin_url, category, seniority, source, qualification,
    comments…) is omitted here to avoid duplication. If a field is *not*
    mapped (the team hasn't wired it up, or the Pipedrive field was deleted)
    we fall back to embedding the value in the notes so nothing is lost.
    """
    mapping = mapping or {}
    lines: list[str] = []

    def _is_mapped(key: str) -> bool:
        return bool(mapping.get(key))

    if contact.get("linkedin_url") and not _is_mapped("linkedin_url"):
        lines.append(f"LinkedIn: {contact['linkedin_url']}")
    # `location` is free-text (city/country), we don't have a clean mapping
    # for it yet — always keep it in notes.
    if contact.get("location"):
        lines.append(f"Location: {contact['location']}")

    cat = contact.get("category") or ""
    if cat and cat != "other" and not _is_mapped("category"):
        lines.append(f"Category: {_CATEGORY_LABELS.get(cat, cat)}")

    seniority = contact.get("seniority") or ""
    if seniority and seniority != "Unknown" and not _is_mapped("seniority"):
        lines.append(f"Seniority: {seniority}")

    # Priority score has no obvious Pipedrive counterpart — keep in notes.
    score = contact.get("priority_score") or 0
    if score:
        lines.append(f"Priority score: {score}")

    flags: list[str] = []
    if contact.get("flag_c_level"):
        flags.append("C-Level")
    if contact.get("flag_bu_head"):
        flags.append("BU Head")
    if contact.get("flag_manager_of_managers"):
        flags.append("Manager-of-Managers")
    if flags:
        lines.append("Flags: " + ", ".join(flags))

    tas = contact.get("therapeutic_areas") or []
    if tas:
        lines.append("Aires thérapeutiques: " + ", ".join(tas))

    if not _is_mapped("source"):
        if contact.get("is_techtomed"):
            lines.append("Source: réseau interne")
        elif contact.get("source"):
            lines.append(f"Source: {contact['source']}")

    decision = contact.get("decision_vs_influencer") or ""
    if decision:
        lines.append(f"Rôle décisionnel: {decision}")

    # Free-form notes go last and only if they're not already mapped to a
    # custom "Comments - MB" field.
    if contact.get("notes") and not _is_mapped("comments"):
        lines.append("")
        lines.append("Notes:")
        lines.append(str(contact["notes"]))

    if company.get("name"):
        lines.append("")
        lines.append(
            f"— Poussé depuis FlashMapping ({company.get('name', '')})"
        )

    return "\n".join(lines).strip()


def _resolve_option_id(
    field_def: dict[str, Any], value: Any
) -> Optional[int | list[int]]:
    """Map our string value to the right option id(s) for an enum/set field.

    Pipedrive silently drops writes if you post a plain string to an
    enum/set field — it expects the option's numeric id (or a comma-joined
    list of ids for `set`). We match case-insensitively against each
    option's label; on no match we return None so the caller can skip.

    For `set` fields, `value` may be a comma-separated string or list —
    every matching label becomes an id in the returned list.
    """
    options = field_def.get("options") or []
    if not options:
        return None

    import re as _re

    def _norm(s: Any) -> str:
        return str(s or "").strip().casefold()

    def _token_set(s: Any) -> frozenset[str]:
        # Lowercase, collapse anything non-alphanumeric, keep only tokens
        # of ≥ 2 chars. Lets "Head / Director" match "Director/Head" and
        # tolerates separators / accents drift.
        import unicodedata as _ud
        raw = _ud.normalize("NFKD", str(s or ""))
        raw = "".join(c for c in raw if not _ud.combining(c)).lower()
        return frozenset(t for t in _re.split(r"[^a-z0-9]+", raw) if len(t) >= 2)

    def _lookup(single: Any) -> Optional[int]:
        key = _norm(single)
        if not key:
            return None
        for opt in options:
            if _norm(opt.get("label")) == key:
                try:
                    return int(opt.get("id"))
                except (TypeError, ValueError):
                    return None
            # Also accept the id itself passed as string ("485") — lets
            # pre-translated values round-trip cleanly.
            if str(opt.get("id")) == str(single).strip():
                try:
                    return int(opt.get("id"))
                except (TypeError, ValueError):
                    return None
        # Fallback: token-set equality, tolerant to word order + separators.
        ts = _token_set(single)
        if ts:
            for opt in options:
                if _token_set(opt.get("label")) == ts:
                    try:
                        return int(opt.get("id"))
                    except (TypeError, ValueError):
                        return None
        return None

    ftype = (field_def.get("field_type") or "").lower()
    if ftype == "set":
        if isinstance(value, list):
            candidates = value
        elif isinstance(value, str):
            candidates = [p.strip() for p in value.split(",") if p.strip()]
        else:
            candidates = [value]
        ids: list[int] = []
        for v in candidates:
            rid = _lookup(v)
            if rid is not None and rid not in ids:
                ids.append(rid)
        return ids or None
    # enum or any single-value field
    return _lookup(value)


def _build_person_payload(
    contact: dict[str, Any],
    company: dict[str, Any],
    org_id: Optional[int],
    mapping: Optional[dict[str, str]] = None,
    schema: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Shape a Pipedrive Person payload from one of our Contact docs.

    `mapping` is `{our_key: pipedrive_key}` — when provided, we emit each
    mapped attribute under its Pipedrive key (hashed column for custom
    fields, snake_case for standard ones). `schema` drives two things:
    (1) skipping fields deleted in Pipedrive since our cache, (2) resolving
    our string values to option ids for enum/set fields.
    """
    payload: dict[str, Any] = {
        "name": (contact.get("name") or "").strip() or "(Sans nom)",
    }

    email = (contact.get("email") or "").strip()
    if email:
        payload["email"] = [
            {"value": email, "primary": True, "label": "work"}
        ]

    phone = (contact.get("phone") or "").strip()
    if phone:
        payload["phone"] = [
            {"value": phone, "primary": True, "label": "work"}
        ]

    if org_id is not None:
        payload["org_id"] = org_id

    # Index schema by key once — used both for the enum option lookup and
    # the existence guard below.
    field_by_key: dict[str, dict[str, Any]] = {}
    if schema:
        for f in schema:
            if isinstance(f, dict) and f.get("key"):
                field_by_key[str(f["key"])] = f

    # `job_title` is a native Pipedrive Person attribute. Some accounts
    # have it disabled / removed — if it's missing from the schema we skip
    # it (Pipedrive silently swallowed it before, leaving the field blank).
    # The user's custom "Intitulé du poste" mapping still carries the value.
    title = (contact.get("title") or "").strip()
    if title and (not field_by_key or "job_title" in field_by_key):
        payload["job_title"] = title

    # ---- Custom-field fan-out via mapping ----
    mapping = mapping or {}

    for our_key, pd_key in mapping.items():
        pd_key = (pd_key or "").strip()
        if not pd_key:
            continue
        # Guard: if the field was deleted in Pipedrive since our last
        # schema refresh, don't try to write to it (400 otherwise).
        if field_by_key and pd_key not in field_by_key:
            log.warning(
                "Pipedrive field key %r (our_key=%s) no longer in schema — "
                "skipping. Consider re-running auto-detect.",
                pd_key, our_key,
            )
            continue
        # Don't clobber `job_title` by also writing the custom title slot —
        # Pipedrive would throw on the second key anyway but be tidy.
        if pd_key == "job_title" and payload.get("job_title"):
            continue
        value = _resolve_contact_value(contact, our_key)
        if value in (None, "", [], 0):
            continue
        # enum / set fields need option ids — map our string to the right
        # id(s) via the schema's `options` list. If nothing matches, we
        # skip (sending the raw string makes Pipedrive silently drop it).
        fdef = field_by_key.get(pd_key) or {}
        ftype = (fdef.get("field_type") or "").lower()
        if ftype in ("enum", "set"):
            resolved = _resolve_option_id(fdef, value)
            if resolved in (None, [], ""):
                log.warning(
                    "Pipedrive enum/set field %r (our_key=%s) has no option "
                    "matching %r — skipping (add the option in Pipedrive or "
                    "remap this field).",
                    fdef.get("name") or pd_key, our_key, value,
                )
                continue
            # `set` returns a list of ids; Pipedrive accepts comma-joined.
            if isinstance(resolved, list):
                payload[pd_key] = ",".join(str(i) for i in resolved)
            else:
                payload[pd_key] = resolved
        else:
            payload[pd_key] = value

    # NB: Pipedrive Persons DO NOT store free-form notes on the person doc
    # itself — notes are a separate entity (POST /notes). We used to stuff
    # content into payload["notes"] and Pipedrive silently discarded it,
    # which meant user-written notes never showed up in the CRM. The real
    # note upsert happens in `_upsert_contact_note` after the person sync.

    return payload


async def _upsert_contact_note(
    pipedrive: PipedriveClient,
    db: Any,
    contact: dict[str, Any],
    company: dict[str, Any],
    person_id: int,
    org_id: Optional[int],
    mapping: Optional[dict[str, str]] = None,
) -> None:
    """Create or update the Pipedrive note attached to this contact's person.

    We store `pipedrive_note_id` on our contact doc so subsequent syncs
    update the same note rather than creating a new one each push.
    If no note has ever been created and there's no content, we skip.

    `mapping` is forwarded to `_build_notes` so we don't duplicate content
    already pushed into a native/custom Pipedrive field.
    """
    content = _build_notes(contact, company, mapping=mapping)
    if not content:
        return

    note_id = contact.get("pipedrive_note_id")
    now = datetime.now(tz=timezone.utc)

    # 1) Existing link — try to update the note.
    if note_id:
        try:
            await pipedrive.update_note(int(note_id), content)
            return
        except PipedriveError as e:
            if e.status_code == 404:
                # Note was deleted in Pipedrive — recreate.
                note_id = None
            else:
                log.warning(
                    "Failed to update Pipedrive note %s for contact %s: %s",
                    note_id, contact.get("name"), e,
                )
                return

    # 2) No link — check if a note already exists for this person (avoid
    # dupes when an older sync pushed notes as an ignored person attribute).
    try:
        existing = await pipedrive.list_person_notes(person_id, limit=5)
    except PipedriveError as e:
        log.warning("Pipedrive list_person_notes failed: %s", e)
        existing = []

    if existing:
        # Reuse the most recent note (first item due to `sort=add_time DESC`).
        first = existing[0]
        fid = int(first.get("id") or 0)
        if fid:
            try:
                await pipedrive.update_note(fid, content)
                await db.contacts.update_one(
                    {"_id": contact["_id"]},
                    {"$set": {"pipedrive_note_id": fid, "updated_at": now}},
                )
                return
            except PipedriveError as e:
                log.warning("Fallback update_note failed: %s", e)

    # 3) Create fresh.
    try:
        created = await pipedrive.create_note(
            content, person_id=person_id, org_id=org_id
        )
        new_id = int(created.get("id") or 0)
        if new_id:
            await db.contacts.update_one(
                {"_id": contact["_id"]},
                {"$set": {"pipedrive_note_id": new_id, "updated_at": now}},
            )
    except PipedriveError as e:
        log.warning(
            "Pipedrive create_note failed for contact %s: %s",
            contact.get("name"), e,
        )


async def _ensure_sync_field(db: Any, contact_id: Any, person_id: int) -> None:
    """Persist the Pipedrive person id + sync timestamp on our contact doc."""
    now = datetime.now(tz=timezone.utc)
    await db.contacts.update_one(
        {"_id": contact_id},
        {
            "$set": {
                "pipedrive_person_id": int(person_id),
                "pipedrive_synced_at": now,
                "updated_at": now,
            }
        },
    )


async def _sync_one_contact(
    pipedrive: PipedriveClient,
    db: Any,
    contact: dict[str, Any],
    company: dict[str, Any],
    org_id: Optional[int],
    mapping: Optional[dict[str, str]] = None,
    schema: Optional[list[dict[str, Any]]] = None,
) -> tuple[str, int]:
    """Sync a single contact. Returns (action, person_id).

    action ∈ {"created", "updated"}. Raises PipedriveError on failure.
    `mapping` + `schema` come from `_ensure_schema` and drive the custom-
    field fan-out in `_build_person_payload`.
    """
    payload = _build_person_payload(
        contact, company, org_id, mapping=mapping, schema=schema
    )
    person_id = contact.get("pipedrive_person_id")

    # 1) Already linked → try to update.
    if person_id:
        try:
            await pipedrive.update_person(int(person_id), payload)
            await _ensure_sync_field(db, contact["_id"], int(person_id))
            await _upsert_contact_note(
                pipedrive, db, contact, company, int(person_id), org_id,
                mapping=mapping,
            )
            return "updated", int(person_id)
        except PipedriveError as e:
            if e.status_code == 404:
                # Stale link — the person was deleted in Pipedrive.
                # Fall through and re-create (or search by email).
                log.info(
                    "Stale pipedrive_person_id=%s for contact %s; re-creating",
                    person_id,
                    contact.get("name"),
                )
                person_id = None
            else:
                raise

    # 2) No link → try to find an existing person by email, to avoid doubles.
    email = (contact.get("email") or "").strip()
    if email:
        try:
            existing = await pipedrive.find_person_by_email(email)
        except PipedriveError as e:
            # Search is best-effort; if it fails, fall through to create.
            log.warning("Pipedrive search by email failed (%s): %s", email, e)
            existing = None
        if existing and existing.get("id"):
            found_id = int(existing["id"])
            await pipedrive.update_person(found_id, payload)
            await _ensure_sync_field(db, contact["_id"], found_id)
            await _upsert_contact_note(
                pipedrive, db, contact, company, found_id, org_id,
                mapping=mapping,
            )
            return "updated", found_id

    # 3) Create fresh.
    created = await pipedrive.create_person(payload)
    new_id = int(created.get("id") or 0)
    if not new_id:
        raise PipedriveError(
            "Pipedrive create_person returned no id", body=created
        )
    await _ensure_sync_field(db, contact["_id"], new_id)
    await _upsert_contact_note(
        pipedrive, db, contact, company, new_id, org_id, mapping=mapping,
    )
    return "created", new_id


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/teams/{team_slug}/pipedrive/status",
    response_model=PipedriveStatusResponse,
)
async def pipedrive_status(
    team_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> PipedriveStatusResponse:
    """Report whether the Pipedrive integration is wired up for this team,
    and who it authenticates as. The UI uses this to switch between the
    "connect form" and the "connected" green panel.
    """
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)

    client, source = await get_client_for_team(db, team)
    if client is None:
        return PipedriveStatusResponse(
            configured=False,
            error="Aucune clé Pipedrive n'est configurée pour cette équipe.",
            source=None,
        )

    settings_dict = (team or {}).get("settings") or {}

    try:
        me = await client.me()
    except PipedriveError as e:
        # Key is present but invalid / expired. Surface clearly so the UI
        # prompts the admin to reconnect.
        return PipedriveStatusResponse(
            configured=False,
            error=str(e),
            source=source,
            # Expose what we stored so the UI can say "stored key expired".
            company_domain=settings_dict.get("pipedrive_company_domain"),
            connected_at=settings_dict.get("pipedrive_connected_at"),
        )
    finally:
        await client.close()

    info = PipedriveUserInfo(
        id=me.get("id"),
        name=me.get("name"),
        email=me.get("email"),
        company_domain=me.get("company_domain"),
        company_name=me.get("company_name"),
    )
    return PipedriveStatusResponse(
        configured=True,
        user=info,
        company_domain=me.get("company_domain")
        or settings_dict.get("pipedrive_company_domain"),
        connected_at=settings_dict.get("pipedrive_connected_at"),
        source=source,
    )


@router.post(
    "/teams/{team_slug}/pipedrive/connect",
    response_model=PipedriveConnectResponse,
)
async def pipedrive_connect(
    team_slug: str,
    payload: PipedriveConnectRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> PipedriveConnectResponse:
    """Validate a Pipedrive API key by calling /users/me, then persist it
    into `team.settings.pipedrive_api_key`. Admin+ only.
    """
    db = get_db()
    team, _ = await require_team_role(db, team_slug, user, "admin")

    key = (payload.api_key or "").strip()
    if not key:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Clé API manquante"
        )

    client = PipedriveClient(key)
    try:
        me = await client.me()
    except PipedriveError as e:
        # Most common case: invalid/expired token → Pipedrive returns 401.
        msg = "Clé API invalide ou expirée"
        if e.status_code and e.status_code != 401:
            msg = f"{msg} ({e})"
        raise HTTPException(status.HTTP_400_BAD_REQUEST, msg)
    finally:
        await client.close()

    user_name = (me.get("name") or "").strip() or None
    company_domain = (me.get("company_domain") or "").strip() or None
    now = datetime.now(tz=timezone.utc)

    from ..crypto import encrypt as _encrypt
    await db.teams.update_one(
        {"_id": team["_id"]},
        {
            "$set": {
                "settings.pipedrive_api_key": _encrypt(key),
                "settings.pipedrive_user_name": user_name,
                "settings.pipedrive_company_domain": company_domain,
                "settings.pipedrive_connected_at": now,
                "updated_at": now,
            }
        },
    )
    log.info(
        "Pipedrive connected for team %s as %s (%s)",
        team_slug,
        user_name,
        company_domain,
    )

    # Kick off an immediate schema fetch + auto-map so the Settings UI
    # lands on a pre-populated mapping table rather than an empty one.
    # Best-effort: if this fails (e.g. Pipedrive down), we just log and
    # the first /fields GET will retry.
    fresh_team = await db.teams.find_one({"_id": team["_id"]}) or team
    bootstrap_client = PipedriveClient(key)
    try:
        await _ensure_schema(db, fresh_team, bootstrap_client, force=True)
    except PipedriveError as e:
        log.warning(
            "Pipedrive connect: schema bootstrap failed for team %s: %s",
            team_slug, e,
        )
    finally:
        await bootstrap_client.close()

    return PipedriveConnectResponse(
        connected=True,
        user_name=user_name,
        company_domain=company_domain,
        connected_at=now,
    )


@router.delete(
    "/teams/{team_slug}/pipedrive/connect",
    response_model=PipedriveConnectResponse,
)
async def pipedrive_disconnect(
    team_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> PipedriveConnectResponse:
    """Clear the Pipedrive connection from this team's settings. Admin+ only.

    Note: this does NOT touch the legacy `.env` fallback — if a global
    PIPEDRIVE_API_KEY is set, the team may still fall back to it. The UI
    reflects that by disabling the "Disconnect" button when source == "env".
    """
    db = get_db()
    team, _ = await require_team_role(db, team_slug, user, "admin")

    await db.teams.update_one(
        {"_id": team["_id"]},
        {
            "$unset": {
                "settings.pipedrive_api_key": "",
                "settings.pipedrive_user_name": "",
                "settings.pipedrive_company_domain": "",
                "settings.pipedrive_connected_at": "",
                # Clear the mapping cache too — a new account will have a
                # completely different field catalog; reusing would push
                # values into stranger's CRM cells.
                "settings.pipedrive_person_field_mapping": "",
                "settings.pipedrive_field_schema": "",
                "settings.pipedrive_field_schema_cached_at": "",
            },
            "$set": {"updated_at": datetime.now(tz=timezone.utc)},
        },
    )
    log.info("Pipedrive disconnected for team %s", team_slug)
    return PipedriveConnectResponse(connected=False)


@router.post(
    "/teams/{team_slug}/companies/{company_slug}/pipedrive/sync",
    response_model=PipedriveSyncResponse,
)
async def pipedrive_sync_company(
    team_slug: str,
    company_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> PipedriveSyncResponse:
    """Push every contact of the given company to Pipedrive.

    Requires admin+ in the team (write to an external CRM).
    """
    db = get_db()
    team, _ = await require_team_role(db, team_slug, user, "admin")

    company = await db.companies.find_one(
        {"team_id": team["_id"], "slug": company_slug.lower()}
    )
    if not company or company.get("deleted_at"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")

    org_id = _coerce_org_id(company.get("crm_id"))

    client, _src = await get_client_for_team(db, team)
    if client is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Connecte Pipedrive avant de synchroniser",
        )

    contacts: list[dict[str, Any]] = []
    async for c in db.contacts.find(
        {"team_id": team["_id"], "company_id": company["_id"]}
    ).sort([("level", 1), ("position_in_level", 1)]):
        contacts.append(c)

    # Load (and if needed refresh + auto-map) the Pipedrive field schema
    # once for the whole batch. If this fails we still attempt the sync
    # with the native fields only — the custom-field fan-out degrades
    # gracefully to an empty mapping.
    schema: list[dict[str, Any]] = []
    mapping: dict[str, str] = {}
    try:
        schema, mapping, _auto = await _ensure_schema(db, team, client)
    except PipedriveError as e:
        log.warning(
            "Pipedrive schema unavailable for team %s (continuing w/o "
            "custom-field mapping): %s", team_slug, e,
        )

    resp = PipedriveSyncResponse(org_id=org_id)
    try:
        for idx, contact in enumerate(contacts):
            if idx > 0:
                # Simple rate-limit guard between calls.
                await asyncio.sleep(_RATE_LIMIT_SLEEP_SECS)
            try:
                action, _pid = await _sync_one_contact(
                    client, db, contact, company, org_id,
                    mapping=mapping, schema=schema,
                )
                resp.synced += 1
                if action == "created":
                    resp.created += 1
                elif action == "updated":
                    resp.updated += 1
            except PipedriveError as e:
                log.warning(
                    "Pipedrive sync failed for contact %s (%s): %s",
                    contact.get("_id"),
                    contact.get("name"),
                    e,
                )
                resp.errors.append(
                    PipedriveSyncError(
                        contact_id=str(contact.get("_id")),
                        contact_name=contact.get("name", ""),
                        error=str(e),
                    )
                )
            except Exception as e:  # pragma: no cover - defensive
                log.exception(
                    "Unexpected error syncing contact %s", contact.get("_id")
                )
                resp.errors.append(
                    PipedriveSyncError(
                        contact_id=str(contact.get("_id")),
                        contact_name=contact.get("name", ""),
                        error=f"Unexpected: {e}",
                    )
                )
    finally:
        await client.close()

    resp.last_synced_at = datetime.now(tz=timezone.utc)
    log.info(
        "Pipedrive sync team=%s company=%s org_id=%s synced=%d created=%d "
        "updated=%d errors=%d",
        team_slug,
        company_slug,
        org_id,
        resp.synced,
        resp.created,
        resp.updated,
        len(resp.errors),
    )
    return resp


@router.post(
    "/teams/{team_slug}/companies/{company_slug}/pipedrive/auto-match",
)
async def pipedrive_auto_match_company(
    team_slug: str,
    company_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Silently link FM contacts of a company to their existing Pipedrive
    person (if any) by name + org match.

    Populates `contact.pipedrive_person_id` on any contact where we find a
    confident match, so the UI's green Pipedrive badge appears without the
    user having to click "Sync" on each contact.

    Throttled to ~1h per company to avoid hammering Pipedrive on every
    page load.
    """
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)

    company = await db.companies.find_one(
        {"team_id": team["_id"], "slug": company_slug.lower()}
    )
    if not company or company.get("deleted_at"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")

    # Per-company throttle: skip if we already ran in the last hour.
    now = datetime.now(tz=timezone.utc)
    last = company.get("pipedrive_auto_match_at")
    if last:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if (now - last) < timedelta(hours=1):
            return {"matched": 0, "skipped": "throttled", "last_run": last.isoformat()}

    client, _src = await get_client_for_team(db, team)
    if client is None:
        # No Pipedrive configured for this team — nothing to do, and that's
        # fine (non-fatal: we just return 0).
        return {"matched": 0, "skipped": "no_pipedrive"}

    try:
        refreshed = await _ensure_fresh_pd_cache(db, team["_id"], client)
        updates = await _match_company_contacts_to_pd(
            db, team["_id"], company["_id"], company.get("name") or ""
        )
    finally:
        await client.close()

    await db.companies.update_one(
        {"_id": company["_id"]},
        {"$set": {"pipedrive_auto_match_at": now}},
    )
    return {
        "matched": len(updates),
        "updates": updates,
        "cache_refreshed": refreshed,
    }


@router.post(
    "/teams/{team_slug}/contacts/{contact_id}/pipedrive/sync",
    response_model=ContactOut,
)
async def pipedrive_sync_contact(
    team_slug: str,
    contact_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> ContactOut:
    """Push a SINGLE contact to Pipedrive. Any team member can do this.

    Returns the freshly-updated ContactOut so the frontend can patch its
    store without a full company re-fetch.
    """
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)
    oid = _safe_oid(contact_id, "Contact")

    contact = await db.contacts.find_one(
        {"_id": oid, "team_id": team["_id"]}
    )
    if not contact:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")

    company = await db.companies.find_one(
        {"_id": contact["company_id"], "team_id": team["_id"]}
    )
    if not company or company.get("deleted_at"):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Company for this contact not found"
        )

    client, _src = await get_client_for_team(db, team)
    if client is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Connecte Pipedrive avant de synchroniser",
        )

    org_id = _coerce_org_id(company.get("crm_id"))
    try:
        # Ensure the field schema + mapping are loaded. If Pipedrive's
        # field endpoint is momentarily down, fall back to native-only.
        schema: list[dict[str, Any]] = []
        mapping: dict[str, str] = {}
        try:
            schema, mapping, _auto = await _ensure_schema(db, team, client)
        except PipedriveError as e:
            log.warning(
                "Pipedrive schema unavailable for team %s: %s",
                team_slug, e,
            )
        try:
            action, _pid = await _sync_one_contact(
                client, db, contact, company, org_id,
                mapping=mapping, schema=schema,
            )
        except PipedriveError as e:
            log.warning(
                "Single-contact Pipedrive sync failed for %s (%s): %s",
                contact.get("_id"),
                contact.get("name"),
                e,
            )
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"Pipedrive: {e}",
            )
    finally:
        await client.close()

    refreshed = await db.contacts.find_one({"_id": oid, "team_id": team["_id"]})
    if not refreshed:
        # Should never happen (we just updated it), but stay defensive.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    log.info(
        "Pipedrive sync team=%s contact=%s action=%s",
        team_slug,
        contact.get("name"),
        action,
    )
    return ContactOut.model_validate(refreshed)


# ---------------------------------------------------------------------------
# Custom-field mapping endpoints
# ---------------------------------------------------------------------------
#
# These are the "Intégrations > Pipedrive > Mapping des champs" backend.
# - GET  /fields          → current schema + mapping + whitelist (any member)
# - POST /fields/refresh  → force re-fetch + re-auto-map (admin+)
# - PATCH /fields/mapping → manual override (admin+)


def _field_to_out(f: dict[str, Any]) -> PipedriveFieldOut:
    """Project a raw Pipedrive field dict to our trimmed response shape."""
    return PipedriveFieldOut(
        key=str(f.get("key") or ""),
        name=str(f.get("name") or ""),
        field_type=f.get("field_type"),
        # Pipedrive's `edit_flag` is sometimes missing (→ default to True,
        # standard writable fields). We preserve the False only when the
        # API explicitly marks the field as read-only.
        editable=bool(f.get("edit_flag", True)),
        options=f.get("options") if isinstance(f.get("options"), list) else None,
    )


@router.get(
    "/teams/{team_slug}/pipedrive/fields",
    response_model=PipedriveFieldsResponse,
)
async def pipedrive_list_fields(
    team_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> PipedriveFieldsResponse:
    """Return the Pipedrive Person field catalog + current mapping.

    On first call after a connect (or 24h after the last fetch), the schema
    is refreshed from /personFields and any unmapped `AVAILABLE_OUR_FIELDS`
    entry is auto-populated via the substring heuristic. Subsequent calls
    return the cached copy so the Settings UI stays snappy.
    """
    db = get_db()
    team, _ = await require_team_member(db, team_slug, user)

    client, _src = await get_client_for_team(db, team)
    if client is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Connecte Pipedrive avant de configurer le mapping",
        )

    try:
        schema, mapping, auto = await _ensure_schema(db, team, client)
    except PipedriveError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Pipedrive: {e}"
        )
    finally:
        await client.close()

    # Re-fetch the team so we return the persisted `cached_at` rather than
    # a stale in-memory value (also captures the auto-map write we just did).
    refreshed = await db.teams.find_one({"_id": team["_id"]}) or team
    cached_at = (
        (refreshed.get("settings") or {}).get("pipedrive_field_schema_cached_at")
    )

    return PipedriveFieldsResponse(
        fields=[_field_to_out(f) for f in schema if isinstance(f, dict)],
        mapping=mapping,
        available_our_fields=list(AVAILABLE_OUR_FIELDS),
        auto_detected=auto,
        cached_at=cached_at,
    )


@router.post(
    "/teams/{team_slug}/pipedrive/fields/refresh",
    response_model=PipedriveFieldsResponse,
)
async def pipedrive_refresh_fields(
    team_slug: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> PipedriveFieldsResponse:
    """Force a re-fetch of the Pipedrive field schema + re-auto-map.

    Admin+ only. This is the "Re-détecter automatiquement" button in the
    Settings UI. It does NOT wipe manually-overridden entries — only the
    ones currently empty get filled by the heuristic.
    """
    db = get_db()
    team, _ = await require_team_role(db, team_slug, user, "admin")

    client, _src = await get_client_for_team(db, team)
    if client is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Connecte Pipedrive avant de configurer le mapping",
        )

    try:
        schema, mapping, auto = await _ensure_schema(
            db, team, client, force=True
        )
    except PipedriveError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Pipedrive: {e}"
        )
    finally:
        await client.close()

    refreshed = await db.teams.find_one({"_id": team["_id"]}) or team
    cached_at = (
        (refreshed.get("settings") or {}).get("pipedrive_field_schema_cached_at")
    )
    return PipedriveFieldsResponse(
        fields=[_field_to_out(f) for f in schema if isinstance(f, dict)],
        mapping=mapping,
        available_our_fields=list(AVAILABLE_OUR_FIELDS),
        auto_detected=auto,
        cached_at=cached_at,
    )


@router.patch(
    "/teams/{team_slug}/pipedrive/fields/mapping",
    response_model=PipedriveFieldsResponse,
)
async def pipedrive_update_mapping(
    team_slug: str,
    payload: PipedriveMappingUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> PipedriveFieldsResponse:
    """Full replace of the Pipedrive person-field mapping. Admin+ only.

    The body is `{ "mapping": { "linkedin_url": "hash_abc…", ... } }`. We:
      - reject unknown `our_key`s (not in `AVAILABLE_OUR_FIELDS`) — prevents
        typos from silently writing garbage into the team doc.
      - drop empty/whitespace values (user picked "— Non mappé —").
      - validate each `pd_key` against the cached schema — any unknown key
        is rejected to keep the mapping self-consistent.
    """
    db = get_db()
    team, _ = await require_team_role(db, team_slug, user, "admin")

    incoming = payload.mapping or {}
    allowed = set(AVAILABLE_OUR_FIELDS)
    unknown = [k for k in incoming.keys() if k not in allowed]
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Champs inconnus: {', '.join(sorted(unknown))}",
        )

    settings_dict = (team or {}).get("settings") or {}
    schema: list[dict[str, Any]] = (
        settings_dict.get("pipedrive_field_schema") or []
    )
    valid_keys = {
        str(f.get("key")) for f in schema
        if isinstance(f, dict) and f.get("key")
    }

    sanitised: dict[str, str] = {}
    for our_key, pd_key in incoming.items():
        pk = (pd_key or "").strip()
        if not pk:
            continue  # explicit unmap
        if valid_keys and pk not in valid_keys:
            # Mapping points at a field that doesn't exist in the cached
            # schema. Reject rather than silently accepting — otherwise a
            # stale UI would happily save into a dead key.
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Clé Pipedrive inconnue pour {our_key!r}: {pk!r}. "
                "Relance la détection automatique.",
            )
        sanitised[our_key] = pk

    now = datetime.now(tz=timezone.utc)
    await db.teams.update_one(
        {"_id": team["_id"]},
        {
            "$set": {
                "settings.pipedrive_person_field_mapping": sanitised,
                "updated_at": now,
            }
        },
    )
    log.info(
        "Pipedrive mapping updated for team %s (%d fields)",
        team_slug, len(sanitised),
    )

    return PipedriveFieldsResponse(
        fields=[_field_to_out(f) for f in schema if isinstance(f, dict)],
        mapping=sanitised,
        available_our_fields=list(AVAILABLE_OUR_FIELDS),
        # After a manual save, nothing is "auto-detected" — the user owns
        # the mapping and will click "Re-détecter" explicitly if needed.
        auto_detected=[],
        cached_at=settings_dict.get("pipedrive_field_schema_cached_at"),
    )
