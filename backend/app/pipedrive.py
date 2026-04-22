"""Pipedrive API v1 client — push-only integration.

Documentation: https://developers.pipedrive.com/docs/api/v1

Authentication: `?api_token=<key>` (legacy personal API token, still supported).

This module deliberately exposes a minimal surface — just what we need to push
contacts as Pipedrive Persons and link them to an existing organisation.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from .config import get_settings

log = logging.getLogger(__name__)


class PipedriveError(Exception):
    """Raised when the Pipedrive API returns a non-success response.

    Attributes:
        status_code: HTTP status code (0 if no response)
        body: parsed response body (if any)
    """

    def __init__(
        self,
        message: str,
        status_code: int = 0,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class PipedriveClient:
    """Thin async Pipedrive v1 client scoped to a single API token.

    All methods raise `PipedriveError` on non-2xx responses or on Pipedrive's
    own `{"success": false}` envelope.
    """

    def __init__(self, api_key: str, base_url: Optional[str] = None) -> None:
        if not api_key:
            raise PipedriveError("Pipedrive API key is missing")
        settings = get_settings()
        self.key = api_key
        self.base = (base_url or settings.pipedrive_api_base).rstrip("/")
        # Use a shared AsyncClient — one TCP pool, reused across calls.
        self.client = httpx.AsyncClient(timeout=20.0)

    async def close(self) -> None:
        await self.client.aclose()

    async def __aenter__(self) -> "PipedriveClient":
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.close()

    # ------------------------------------------------------------------
    # low-level
    # ------------------------------------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        url = f"{self.base}{path}"
        p = dict(params or {})
        p["api_token"] = self.key
        try:
            resp = await self.client.request(
                method, url, params=p, json=json
            )
        except httpx.HTTPError as e:
            raise PipedriveError(f"Network error calling Pipedrive: {e}") from e

        # Pipedrive always returns JSON, even on error.
        try:
            data = resp.json()
        except ValueError:
            data = None

        if resp.status_code >= 400:
            msg = "HTTP error"
            if isinstance(data, dict):
                msg = (
                    data.get("error")
                    or data.get("error_info")
                    or data.get("message")
                    or f"HTTP {resp.status_code}"
                )
            raise PipedriveError(
                f"Pipedrive {method} {path} failed: {msg}",
                status_code=resp.status_code,
                body=data,
            )

        if not isinstance(data, dict):
            raise PipedriveError(
                "Unexpected Pipedrive response (not a JSON object)",
                status_code=resp.status_code,
                body=data,
            )

        if data.get("success") is False:
            msg = (
                data.get("error")
                or data.get("error_info")
                or "Pipedrive returned success=false"
            )
            raise PipedriveError(
                f"Pipedrive {method} {path}: {msg}",
                status_code=resp.status_code,
                body=data,
            )
        return data

    # ------------------------------------------------------------------
    # users
    # ------------------------------------------------------------------

    async def me(self) -> dict[str, Any]:
        """GET /users/me — returns the authenticated user info."""
        data = await self._request("GET", "/users/me")
        return data.get("data") or {}

    # ------------------------------------------------------------------
    # schema discovery — person / organization custom fields
    # ------------------------------------------------------------------

    async def list_person_fields(self) -> list[dict[str, Any]]:
        """GET /personFields — full schema (standard + custom) for Persons.

        Each field has at least:
          - `key`    : hashed column name (e.g. "abc123…") for custom fields,
                      or a stable snake_case name ("name", "email", …) for
                      standard ones. This is the key you pass in POST/PUT
                      payloads to set the value.
          - `name`   : human-readable label as shown in the Pipedrive UI.
          - `field_type` : "varchar", "text", "enum", "set", "date", "monetary"…
          - `edit_flag`  : False for system-managed fields we can't write.
          - `options` (for enum/set) : list of `{ id, label }`.
        We return the raw list verbatim — callers normalise.
        """
        # Pipedrive paginates at 500; we iterate just in case (Nicolas has ~40
        # fields so one page is enough today, but this is defensive).
        items: list[dict[str, Any]] = []
        start = 0
        limit = 500
        while True:
            data = await self._request(
                "GET",
                "/personFields",
                params={"start": start, "limit": limit},
            )
            chunk = data.get("data") or []
            if isinstance(chunk, list):
                items.extend(x for x in chunk if isinstance(x, dict))
            pagination = (
                (data.get("additional_data") or {}).get("pagination") or {}
            )
            if not pagination.get("more_items_in_collection"):
                break
            start = int(pagination.get("next_start") or (start + limit))
        return items

    async def list_organization_fields(self) -> list[dict[str, Any]]:
        """GET /organizationFields — Organization schema (for future use).

        Same shape as `list_person_fields`. Currently exposed so the UI /
        backend can later map company-level attributes (headcount, HQ…) onto
        Nicolas' custom Organization fields.
        """
        items: list[dict[str, Any]] = []
        start = 0
        limit = 500
        while True:
            data = await self._request(
                "GET",
                "/organizationFields",
                params={"start": start, "limit": limit},
            )
            chunk = data.get("data") or []
            if isinstance(chunk, list):
                items.extend(x for x in chunk if isinstance(x, dict))
            pagination = (
                (data.get("additional_data") or {}).get("pagination") or {}
            )
            if not pagination.get("more_items_in_collection"):
                break
            start = int(pagination.get("next_start") or (start + limit))
        return items

    # ------------------------------------------------------------------
    # persons
    # ------------------------------------------------------------------

    async def find_person_by_email(self, email: str) -> Optional[dict[str, Any]]:
        """Search Pipedrive persons by email.

        Returns the best-scoring match (first item) or None.
        Uses /persons/search?term=...&fields=email&exact_match=true.
        """
        email = (email or "").strip()
        if not email:
            return None
        data = await self._request(
            "GET",
            "/persons/search",
            params={
                "term": email,
                "fields": "email",
                "exact_match": "true",
                "limit": 1,
            },
        )
        payload = data.get("data") or {}
        items = payload.get("items") or []
        if not items:
            return None
        # Each item is { "result_score": float, "item": { id, name, emails, ... } }
        first = items[0]
        return first.get("item") or None

    async def get_person(self, person_id: int) -> Optional[dict[str, Any]]:
        """GET /persons/{id} — returns None if 404."""
        try:
            data = await self._request("GET", f"/persons/{int(person_id)}")
        except PipedriveError as e:
            if e.status_code == 404:
                return None
            raise
        return data.get("data") or None

    async def create_person(self, payload: dict[str, Any]) -> dict[str, Any]:
        """POST /persons — returns the created person."""
        data = await self._request("POST", "/persons", json=payload)
        created = data.get("data")
        if not isinstance(created, dict):
            raise PipedriveError(
                "Pipedrive create_person: missing `data` in response",
                body=data,
            )
        return created

    async def update_person(
        self, person_id: int, payload: dict[str, Any]
    ) -> dict[str, Any]:
        """PUT /persons/{id} — returns the updated person."""
        data = await self._request(
            "PUT", f"/persons/{int(person_id)}", json=payload
        )
        updated = data.get("data")
        if not isinstance(updated, dict):
            raise PipedriveError(
                "Pipedrive update_person: missing `data` in response",
                body=data,
            )
        return updated

    # ------------------------------------------------------------------
    # notes  (separate entity in Pipedrive — NOT a Person attribute)
    # ------------------------------------------------------------------

    async def list_person_notes(
        self, person_id: int, limit: int = 50
    ) -> list[dict[str, Any]]:
        """GET /notes?person_id=… — returns the person's notes (newest first)."""
        data = await self._request(
            "GET", "/notes",
            params={"person_id": int(person_id), "limit": limit, "sort": "add_time DESC"},
        )
        items = data.get("data") or []
        return items if isinstance(items, list) else []

    async def create_note(
        self,
        content: str,
        *,
        person_id: Optional[int] = None,
        org_id: Optional[int] = None,
    ) -> dict[str, Any]:
        """POST /notes — create a note linked to a Person and/or Organization."""
        payload: dict[str, Any] = {"content": content}
        if person_id is not None:
            payload["person_id"] = int(person_id)
        if org_id is not None:
            payload["org_id"] = int(org_id)
        data = await self._request("POST", "/notes", json=payload)
        created = data.get("data")
        if not isinstance(created, dict):
            raise PipedriveError(
                "Pipedrive create_note: missing `data` in response",
                body=data,
            )
        return created

    async def update_note(
        self, note_id: int, content: str
    ) -> dict[str, Any]:
        """PUT /notes/{id} — update a note's content."""
        data = await self._request(
            "PUT", f"/notes/{int(note_id)}", json={"content": content}
        )
        updated = data.get("data")
        if not isinstance(updated, dict):
            raise PipedriveError(
                "Pipedrive update_note: missing `data` in response",
                body=data,
            )
        return updated


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def get_client() -> PipedriveClient:
    """Instantiate a Pipedrive client from env settings. Raises if unconfigured.

    DEPRECATED for team-scoped flows — prefer `get_client_for_team(db, team_id)`
    which looks up the per-team API key first and falls back to `.env` only
    for legacy single-tenant compatibility.
    """
    settings = get_settings()
    key = (settings.pipedrive_api_key or "").strip()
    if not key:
        raise PipedriveError("Pipedrive is not configured (PIPEDRIVE_API_KEY missing)")
    return PipedriveClient(key)


async def get_client_for_team(
    db: Any, team: dict[str, Any]
) -> tuple[Optional[PipedriveClient], str]:
    """Return a `(client, source)` tuple for the given team.

    source ∈ {"db", "env", ""}:
      - "db" if the team has its own `pipedrive_api_key` stored in settings
      - "env" if we fell back to the global `.env` key (legacy compat)
      - ""  if no key is available anywhere → client is None

    The caller is responsible for calling `await client.close()`.
    """
    from .crypto import decrypt as _decrypt
    settings_dict = (team or {}).get("settings") or {}
    stored_key = (settings_dict.get("pipedrive_api_key") or "").strip()
    team_key = _decrypt(stored_key)
    if team_key:
        return PipedriveClient(team_key), "db"

    env_key = (get_settings().pipedrive_api_key or "").strip()
    if env_key:
        log.info(
            "Pipedrive: using .env fallback for team %s (no key in settings)",
            (team or {}).get("slug"),
        )
        return PipedriveClient(env_key), "env"

    return None, ""


def extract_primary_email(person: dict[str, Any]) -> str:
    """Pull the first email string out of a Pipedrive person payload."""
    emails = person.get("email") or person.get("emails") or []
    if isinstance(emails, list):
        for e in emails:
            if isinstance(e, dict):
                val = e.get("value") or ""
            else:
                val = str(e or "")
            val = val.strip()
            if val:
                return val
    if isinstance(emails, str):
        return emails.strip()
    return ""
