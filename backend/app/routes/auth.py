"""Authentication routes."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError

from ..auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from ..config import get_settings
from ..db import get_db
from ..rate_limit import rate_limit
from ..models import (
    BootstrapResponse,
    ChangePasswordRequest,
    LoginRequest,
    OnboardingStateResponse,
    RegisterRequest,
    TokenResponse,
    UpdateMeRequest,
    UserPublic,
)
from ..teams import ensure_personal_team

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger(__name__)


def _public(user: dict[str, Any]) -> UserPublic:
    return UserPublic.model_validate(user)


@router.get("/bootstrap", response_model=BootstrapResponse)
async def bootstrap() -> BootstrapResponse:
    db = get_db()
    count = await db.users.count_documents({}, limit=1)
    return BootstrapResponse(bootstrap_needed=count == 0)


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("register", max_calls=3, window_secs=3600))],
)
async def register(payload: RegisterRequest) -> TokenResponse:
    """Create a user.

    Open registration is only allowed when the server is configured with
    `ALLOW_OPEN_REGISTRATION=true` (default dev: true). In prod we lock it
    down — new users must come in via a team invite (`/api/teams/accept-
    invite`), never through this public endpoint.

    The very first user always bypasses the lock so a fresh install can
    bootstrap; they land with `role=admin`. Subsequent users get
    `role=user`.
    """
    db = get_db()
    settings = get_settings()
    existing_count = await db.users.count_documents({}, limit=1)

    # Bootstrap (no user yet) is always allowed so a fresh install works.
    if existing_count > 0 and not settings.allow_open_registration:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "L'inscription libre est désactivée. Demande un lien d'invitation.",
        )

    role = "admin" if existing_count == 0 else "user"

    email = payload.email.lower().strip()
    now = datetime.now(tz=timezone.utc)
    doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name.strip(),
        "role": role,
        "created_at": now,
        "last_login": now,
    }
    try:
        res = await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    doc["_id"] = res.inserted_id
    # Every user gets a personal space at register time. Guarantees the user
    # is never stranded without a team (onboarding dead-end fix).
    try:
        await ensure_personal_team(db, doc)
    except Exception:  # pragma: no cover - defensive
        log.exception(
            "Failed to create personal team for %s; user row kept", email
        )
    token = create_access_token(str(res.inserted_id), role)
    log.info("User registered: %s (role=%s)", email, role)
    return TokenResponse(access_token=token, user=_public(doc))


@router.post(
    "/login",
    response_model=TokenResponse,
    dependencies=[Depends(rate_limit("login", max_calls=8, window_secs=60))],
)
async def login(payload: LoginRequest) -> TokenResponse:
    db = get_db()
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"last_login": datetime.now(tz=timezone.utc)}},
    )
    token = create_access_token(str(user["_id"]), user["role"])
    log.info("Login %s", email)
    return TokenResponse(access_token=token, user=_public(user))


@router.get("/me", response_model=UserPublic)
async def me(user: dict[str, Any] = Depends(get_current_user)) -> UserPublic:
    return _public(user)


@router.patch("/me", response_model=UserPublic)
async def update_me(
    payload: UpdateMeRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> UserPublic:
    db = get_db()
    updates: dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.email is not None:
        new_email = payload.email.lower().strip()
        if new_email != user.get("email"):
            # Conflict check
            existing = await db.users.find_one(
                {"email": new_email, "_id": {"$ne": user["_id"]}}
            )
            if existing:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "Email already in use"
                )
            updates["email"] = new_email
    if not updates:
        return _public(user)
    try:
        updated = await db.users.find_one_and_update(
            {"_id": user["_id"]}, {"$set": updates}, return_document=True
        )
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already in use")
    log.info("User %s updated profile (%s)", user.get("email"), list(updates))
    return _public(updated)


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, bool]:
    db = get_db()
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Current password is incorrect"
        )
    new_hash = hash_password(payload.new_password)
    await db.users.update_one(
        {"_id": user["_id"]}, {"$set": {"password_hash": new_hash}}
    )
    log.info("User %s changed password", user.get("email"))
    return {"ok": True}


@router.get("/onboarding-state", response_model=OnboardingStateResponse)
async def onboarding_state(
    user: dict[str, Any] = Depends(get_current_user),
) -> OnboardingStateResponse:
    db = get_db()
    teams_count = await db.team_members.count_documents({"user_id": user["_id"]})
    return OnboardingStateResponse(
        has_teams=teams_count > 0, teams_count=teams_count
    )


@router.post("/logout")
async def logout(
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, bool]:
    """Stateless JWT: the client simply drops the token."""
    return {"ok": True}
