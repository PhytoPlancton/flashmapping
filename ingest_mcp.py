"""Transform raw MCP enrichment responses into the schema `account_mapper` expects.

Usage (interactive, from Python/REPL or called from Claude):
    from ingest_mcp import ingest
    ingest(slug="novo_nordisk",
           raw_responses=[response1, response2, ...],
           therapeutic_area_hints=["Diabetes / Obesity / Metabolic"])

Writes `data/enrichment/<slug>.json`.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENRICHMENT_DIR = ROOT / "data" / "enrichment"


def _pick_primary_location(locations: list[dict]) -> str:
    for loc in locations:
        if loc.get("is_primary"):
            inf = loc.get("inferred_location") or {}
            return inf.get("formatted_address") or loc.get("address", "")
    return ""


def _norm_contact(c: dict, expected_domain: str) -> dict | None:
    """Keep only contacts whose latest employer domain matches (or is empty)."""
    domain = (c.get("domain") or "").lower()
    if domain and expected_domain and domain != expected_domain.lower():
        return None
    title = c.get("latest_experience_title") or c.get("title") or ""
    return {
        "name": c.get("name", "").strip(),
        "title": title.strip(),
        "linkedin_url": c.get("url") or c.get("linkedin_url", ""),
        "email": c.get("email", ""),
        "location": c.get("location_name") or c.get("location", ""),
        "domain": domain,
        "profile_id": c.get("profile_id", ""),
        "start_date": c.get("latest_experience_start_date", ""),
    }


def ingest(
    slug: str,
    raw_responses: list[dict],
    therapeutic_area_hints: list[str] | None = None,
    expected_domain: str = "",
) -> Path:
    """Merge one or many MCP responses for a single company into one enrichment file."""

    ENRICHMENT_DIR.mkdir(parents=True, exist_ok=True)

    # Company metadata — take from the first response that has it.
    company: dict = {}
    by_profile: dict[str, dict] = {}

    for resp in raw_responses:
        if not resp:
            continue
        companies = resp.get("companies") or {}
        for dom, meta in companies.items():
            if expected_domain and dom.lower() != expected_domain.lower():
                continue
            if not company:
                company = {
                    "name": meta.get("name"),
                    "domain": meta.get("domain") or dom,
                    "linkedin_url": meta.get("url"),
                    "industry": meta.get("industry"),
                    "size": meta.get("size"),
                    "headcount": meta.get("employee_count"),
                    "country": meta.get("country"),
                    "hq": _pick_primary_location(meta.get("locations") or []),
                    "annual_revenue": meta.get("annual_revenue"),
                    "therapeutic_areas": list(therapeutic_area_hints or []),
                }
                break

        for c in resp.get("contacts") or []:
            norm = _norm_contact(c, expected_domain=expected_domain or company.get("domain", ""))
            if not norm or not norm["name"]:
                continue
            pid = norm["profile_id"] or norm["linkedin_url"] or norm["name"]
            existing = by_profile.get(pid)
            if existing:
                for k, v in norm.items():
                    if v and not existing.get(k):
                        existing[k] = v
            else:
                by_profile[pid] = norm

    payload = {
        "company": company,
        "contacts": list(by_profile.values()),
    }

    out = ENRICHMENT_DIR / f"{slug}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    return out
