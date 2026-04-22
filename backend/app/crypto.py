"""Symmetric-at-rest encryption for sensitive per-team secrets.

Currently used for:
- `team.settings.pipedrive_api_key` (otherwise stored plaintext in Mongo)

Design
------
- Fernet (AES-128-CBC + HMAC-SHA256) from the `cryptography` package.
- Key is loaded once from `SECRETS_ENCRYPTION_KEY` env var.
- Stored format: `fernet:<token>` — the `fernet:` prefix lets us detect
  legacy plaintext values during the transition window (encrypt on next
  write, decrypt-or-passthrough on read).
- If the key is unset, `encrypt`/`decrypt` become no-ops and log a
  warning once at startup. Production deployments SHOULD set the key.

Rotation
--------
To rotate: generate a new key, prepend it to `SECRETS_ENCRYPTION_KEYS`
(future env var — not implemented yet). For now we support a single
key and a one-shot re-encrypt script is all that's needed.
"""
from __future__ import annotations

import logging
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

log = logging.getLogger(__name__)

_PREFIX = "fernet:"

_fernet: Optional[Fernet] = None
_warned = False


def _get() -> Optional[Fernet]:
    """Lazily build the Fernet instance from settings. Returns None if no
    encryption key is configured — the caller degrades to passthrough."""
    global _fernet, _warned
    if _fernet is not None:
        return _fernet
    key = (get_settings().secrets_encryption_key or "").strip()
    if not key:
        if not _warned:
            s = get_settings()
            if s.is_prod:
                log.warning(
                    "SECRETS_ENCRYPTION_KEY not set in prod — Pipedrive API "
                    "keys are stored UNENCRYPTED in Mongo. Generate with: "
                    "python -c 'from cryptography.fernet import Fernet; "
                    "print(Fernet.generate_key().decode())'"
                )
            _warned = True
        return None
    try:
        _fernet = Fernet(key.encode("utf-8"))
    except Exception as e:
        log.error(
            "SECRETS_ENCRYPTION_KEY is not a valid Fernet key (%s). "
            "Falling back to plaintext storage.", e,
        )
        _fernet = None
    return _fernet


def encrypt(value: str) -> str:
    """Encrypt `value` → 'fernet:<token>'. Returns input unchanged if no
    encryption key is configured. Empty string stays empty."""
    if not value:
        return value
    if value.startswith(_PREFIX):
        return value  # already encrypted
    f = _get()
    if f is None:
        return value
    token = f.encrypt(value.encode("utf-8")).decode("utf-8")
    return f"{_PREFIX}{token}"


def decrypt(stored: str) -> str:
    """Inverse of `encrypt`. Plaintext (non-prefixed) values pass through
    untouched — this keeps existing docs readable during migration."""
    if not stored:
        return stored
    if not stored.startswith(_PREFIX):
        return stored  # legacy plaintext
    f = _get()
    if f is None:
        # Key was removed; can't decrypt. Return empty so callers fail
        # closed rather than leak ciphertext.
        log.error("decrypt(): no key available, cannot read encrypted value")
        return ""
    token = stored[len(_PREFIX):]
    try:
        return f.decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        log.error("decrypt(): Fernet rejected token (key mismatch?)")
        return ""
