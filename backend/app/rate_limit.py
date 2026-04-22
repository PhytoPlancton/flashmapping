"""Lightweight in-memory rate limiter for abuse-prone auth endpoints.

No Redis, no external dep — a process-local sliding window per (bucket,
key) pair. Good enough for a single-container deployment; swap for
Redis if we ever horizontally scale auth.

Usage (as a FastAPI dependency)::

    @router.post("/login", dependencies=[Depends(rate_limit("login", 5, 60))])

→ max 5 calls per 60 s per client IP on that bucket.
"""
from __future__ import annotations

import time
from collections import deque
from typing import Deque, Dict, Tuple

from fastapi import HTTPException, Request, status


_buckets: Dict[Tuple[str, str], Deque[float]] = {}


def _client_key(request: Request) -> str:
    # Honour X-Forwarded-For when behind Traefik (single value, the edge IP).
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if xff:
        return xff
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, max_calls: int, window_secs: float):
    """Return a FastAPI dependency that enforces the limit."""

    async def _dep(request: Request) -> None:
        key = (bucket, _client_key(request))
        now = time.monotonic()
        dq = _buckets.setdefault(key, deque())
        cutoff = now - window_secs
        # Evict old entries.
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= max_calls:
            retry_after = max(1, int(dq[0] + window_secs - now + 0.5))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Trop de tentatives, réessaie dans {retry_after}s",
                headers={"Retry-After": str(retry_after)},
            )
        dq.append(now)

    return _dep
