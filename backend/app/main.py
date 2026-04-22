"""FastAPI application entry point.

Mounts the API routes under /api/ and serves the Vue frontend from /.
"""
from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .background import purge_soft_deleted_companies
from .config import PROJECT_ROOT
from .db import connect, disconnect, ensure_indexes, get_db
from .migrations import run_all_migrations
from .routes import auth as auth_routes
from .routes import connections as connections_routes
from .routes import folders as folders_routes
from .routes import pipedrive as pipedrive_routes
from .routes import taxonomy as taxonomy_routes
from .routes import teams as teams_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("app")

from .config import get_settings
_settings = get_settings()

# In prod, hide the auto-generated Swagger UI, Redoc, and the openapi.json
# dump — they hand an attacker a full map of every endpoint + schema.
# The SPA still works fine without them.
_docs_kwargs: dict[str, Any] = {}
if _settings.is_prod:
    _docs_kwargs = {"docs_url": None, "redoc_url": None, "openapi_url": None}

app = FastAPI(title="FlashMapping", version="2.0.0", **_docs_kwargs)

# CORS: allow any localhost / 127.0.0.1 port (dev-friendly).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Security headers — applied to every response. HSTS only in prod (on dev
# you want plain HTTP to keep working). CSP is intentionally permissive
# for `unsafe-inline` because the Vue template compiler relies on inline
# attribute bindings; can be tightened with nonces later.
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if _settings.is_prod:
        # 6 months HSTS; includeSubDomains because flashmapping.nmt.ovh
        # doesn't have sub-domains, safe default.
        response.headers["Strict-Transport-Security"] = (
            "max-age=15552000; includeSubDomains"
        )
    return response


# Dev-mode: force browsers to re-fetch frontend files on every page load.
# ESM modules are otherwise aggressively cached, blocking hot-reload of .js/.css.
@app.middleware("http")
async def no_cache_for_frontend(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if (
        path == "/"
        or path.endswith(".js")
        or path.endswith(".css")
        or path.endswith(".html")
    ):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


_background_tasks: list[asyncio.Task] = []


@app.on_event("startup")
async def on_startup() -> None:
    await connect()
    await ensure_indexes()
    # V2 teams migration: attach legacy docs to the default team + backfill
    # personal spaces for every user.
    await run_all_migrations(get_db())
    # Background task: purge soft-deleted companies > 24h old (cascades to
    # their contacts). Kept as a simple asyncio.Task — the workload is tiny
    # and a proper scheduler would be overkill.
    _background_tasks.append(
        asyncio.create_task(
            purge_soft_deleted_companies(get_db()),
            name="purge_soft_deleted_companies",
        )
    )
    log.info("Application startup complete")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    for task in _background_tasks:
        task.cancel()
    for task in _background_tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:  # pragma: no cover
            log.exception("Background task raised during shutdown")
    _background_tasks.clear()
    await disconnect()
    log.info("Application shutdown complete")


# -------------------- API routers --------------------
app.include_router(auth_routes.router)
app.include_router(taxonomy_routes.router)
# Teams + all team-scoped sub-resources (companies, contacts, admin, invites).
app.include_router(teams_routes.router)
# Pipedrive push-only integration (status + per-company sync).
app.include_router(pipedrive_routes.router)
# Freeform view: contact-to-contact connections (per team + company).
app.include_router(connections_routes.router)
# Folders: organise companies within a team (flat V1, team-shared).
app.include_router(folders_routes.router)

# FastAPI defaults to by_alias=False during response serialisation. Override it
# on every APIRoute so documents leave the API with `_id` instead of `id`.
from fastapi.routing import APIRoute  # noqa: E402
for _route in app.routes:
    if isinstance(_route, APIRoute):
        _route.response_model_by_alias = True


# -------------------- Static frontend --------------------
FRONTEND_DIR = PROJECT_ROOT / "frontend"
INDEX_FILE = FRONTEND_DIR / "index.html"


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


if FRONTEND_DIR.exists():
    # Mount /js, /css, /assets so relative asset URLs resolve.
    for sub in ("js", "css", "assets"):
        subdir = FRONTEND_DIR / sub
        if subdir.exists():
            app.mount(f"/{sub}", StaticFiles(directory=str(subdir)), name=sub)

    @app.get("/", include_in_schema=False)
    async def root_index() -> FileResponse:
        if INDEX_FILE.exists():
            return FileResponse(str(INDEX_FILE))
        raise HTTPException(404, "Frontend not built yet")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str, request: Request) -> FileResponse:
        """Serve static files if they exist, else fall back to index.html."""
        # Any /api/* that reached here is unknown — 404.
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(404, "Not found")
        # Prevent path traversal.
        if re.search(r"(^|/)\.\.(/|$)", full_path):
            raise HTTPException(400, "Invalid path")
        candidate = (FRONTEND_DIR / full_path).resolve()
        try:
            candidate.relative_to(FRONTEND_DIR.resolve())
        except ValueError:
            raise HTTPException(400, "Invalid path")
        if candidate.is_file():
            return FileResponse(str(candidate))
        if INDEX_FILE.exists():
            return FileResponse(str(INDEX_FILE))
        raise HTTPException(404, "Not found")
