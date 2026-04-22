"""ICP (Ideal Customer Profile) matcher.

Given a contact's `title` and a team's list of ICP definitions, return the
set of ICP ids the contact matches. Keyword mode normalises (lowercase +
strip diacritics) and does a *contains* check against each synonym. The
LLM fallback is called by a separate route — this module exposes a pure
function for it as well (`llm_match_titles`) so both are colocated.
"""
from __future__ import annotations

import logging
import os
import re
import unicodedata
from typing import Any, Iterable

log = logging.getLogger(__name__)


def normalise(s: str) -> str:
    """Lowercase + strip diacritics + collapse whitespace.

    "Responsable Formation & L&D" → "responsable formation & l&d"
    "Directeur Régional" → "directeur regional"
    """
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    # Keep alphanumerics and a few separators useful for word boundaries;
    # replace everything else with a space.
    s = re.sub(r"[^a-z0-9&+/]+", " ", s)
    return " ".join(s.split())


def match_keyword(title: str, icps: list[dict | Any]) -> list[str]:
    """Return the list of ICP ids whose synonyms match `title`.

    Matching = normalised-contains. Empty title or empty synonyms → no match.
    Order of returned ids follows the order of `icps`.
    """
    t = normalise(title)
    if not t:
        return []
    out: list[str] = []
    for icp in icps or []:
        if isinstance(icp, dict):
            icp_id = icp.get("id") or ""
            syns = icp.get("synonyms") or []
        else:
            icp_id = getattr(icp, "id", "") or ""
            syns = getattr(icp, "synonyms", None) or []
        if not icp_id:
            continue
        for syn in syns:
            n = normalise(str(syn))
            if n and n in t:
                out.append(icp_id)
                break
    return out


# ---------------------------------------------------------------------------
# LLM fallback (Anthropic Claude) — optional
# ---------------------------------------------------------------------------

LLM_MODEL = "claude-haiku-4-5-20251001"
LLM_SYSTEM = (
    "You classify job titles against a list of ICP (Ideal Customer Profile) "
    "roles. Output ONLY JSON, one object per input title: "
    '{"title": "<exact>", "icp_ids": ["<id>", ...]}. '
    "Match a role only if the title plausibly denotes the same function "
    "(synonyms, translations, abbreviations, seniority variants). If unsure, "
    "return an empty list. Never invent icp ids."
)


def _build_user_prompt(titles: list[str], icps: list[dict]) -> str:
    lines = ["ICPs:"]
    for icp in icps:
        syns = ", ".join(icp.get("synonyms") or [])
        lines.append(
            f'- id="{icp["id"]}" name="{icp["name"]}" hints: {syns}'
        )
    lines.append("")
    lines.append("Titles to classify (one per line):")
    for t in titles:
        lines.append(f"- {t}")
    lines.append("")
    lines.append(
        'Respond with a JSON array: '
        '[{"title": "...", "icp_ids": ["..."]}, ...]. '
        "Keep the same order as input."
    )
    return "\n".join(lines)


async def llm_match_titles(
    titles: list[str], icps: list[dict]
) -> dict[str, list[str]]:
    """Batch-classify titles via Claude. Returns {title: [icp_id, ...]}.

    Silently returns {} if ANTHROPIC_API_KEY is missing or the call fails.
    Callers should treat the result as best-effort.
    """
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not key or not titles or not icps:
        return {}

    try:
        import anthropic  # type: ignore
    except ImportError:
        log.warning("anthropic package not installed; LLM fallback disabled")
        return {}

    client = anthropic.AsyncAnthropic(api_key=key)
    user_prompt = _build_user_prompt(titles, icps)

    try:
        resp = await client.messages.create(
            model=LLM_MODEL,
            max_tokens=2048,
            system=LLM_SYSTEM,
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception as e:
        log.warning("ICP LLM call failed: %s", e)
        return {}
    finally:
        try:
            await client.close()
        except Exception:
            pass

    text = ""
    for block in getattr(resp, "content", []) or []:
        if getattr(block, "type", None) == "text":
            text += getattr(block, "text", "") or ""
    text = text.strip()
    if not text:
        return {}

    # The model sometimes wraps JSON in ```json fences; strip them.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S).strip()

    import json
    try:
        arr = json.loads(text)
    except ValueError:
        log.warning("ICP LLM returned non-JSON: %r", text[:200])
        return {}
    if not isinstance(arr, list):
        return {}

    valid_ids = {icp["id"] for icp in icps}
    result: dict[str, list[str]] = {}
    for item in arr:
        if not isinstance(item, dict):
            continue
        t = item.get("title")
        ids = item.get("icp_ids") or []
        if not isinstance(t, str) or not isinstance(ids, list):
            continue
        clean = [i for i in ids if isinstance(i, str) and i in valid_ids]
        result[t] = clean
    return result
