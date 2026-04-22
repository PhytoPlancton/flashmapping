"""End-to-end orchestrator.

Pipeline
--------
1. `python3 account_mapper.py prepare <crm_csv>`
   Reads the CRM CSV, filters to the priorities you want (default P2),
   and writes `data/accounts.json` — one row per account with its known
   TechToMed contacts already extracted.

2. (External step) Claude calls the MCP enrichment tools for each
   company and drops the raw responses into `data/enrichment/<slug>.json`.
   The expected shape is documented in `docs/enrichment-schema.md` but
   boils down to:
     {
       "company": {"name": ..., "domain": ..., "linkedin_url": ...,
                   "headcount": ..., "therapeutic_areas": [...]},
       "contacts": [
         {"name": ..., "title": ..., "linkedin_url": ..., "email": ...,
          "location": ..., "seniority_hint": ...},
         ...
       ]
     }

3. `python3 account_mapper.py process`
   Merges accounts.json + enrichment/*.json, classifies every contact,
   dedupes against TechToMed-known names, produces the final XLSX.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from dataclasses import asdict
from pathlib import Path

from rapidfuzz import fuzz, process

from parse_crm_csv import Account, KnownContact, filter_priority, load_csv
from roles_taxonomy import classify, RoleAnalysis
from build_xlsx import write_workbook


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
ENRICHMENT_DIR = DATA_DIR / "enrichment"
OUT_DIR = ROOT / "out"

MAX_CONTACTS_PER_COMPANY = 30


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


# ---------------------------------------------------------------------------
# PREPARE
# ---------------------------------------------------------------------------

def cmd_prepare(args: argparse.Namespace) -> int:
    accounts = load_csv(args.csv)
    accounts = filter_priority(accounts, *args.priority)

    DATA_DIR.mkdir(exist_ok=True)
    ENRICHMENT_DIR.mkdir(exist_ok=True)

    # Also load the companies.yaml domain hints (optional).
    domains: dict[str, dict] = {}
    companies_yaml = ROOT / "companies.yaml"
    if companies_yaml.exists():
        try:
            import yaml  # type: ignore
        except ImportError:
            yaml = None
        if yaml:
            cfg = yaml.safe_load(companies_yaml.read_text())
            for row in cfg.get("p2_accounts", []):
                domains[row["name"].lower()] = row

    payload = []
    for a in accounts:
        hint = domains.get(a.name.lower(), {})
        payload.append({
            "crm_id": a.crm_id,
            "name": a.name,
            "priority": a.priority,
            "status": a.status,
            "pic": a.pic,
            "step": a.step,
            "work_status": a.work_status,
            "comments_raw": a.comments_raw,
            "domain_hint": hint.get("domain", ""),
            "aliases": hint.get("aliases", []),
            "note": hint.get("note", ""),
            "known_contacts": [asdict(c) for c in a.known_contacts],
            "enrichment_file": f"enrichment/{_slugify(a.name)}.json",
        })

    out = DATA_DIR / "accounts.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"wrote {out} ({len(payload)} accounts)")
    print(f"→ next: for each account, call MCP enrichment and save raw JSON to {ENRICHMENT_DIR}/<slug>.json")
    print(f"  slugs: {', '.join(_slugify(a.name) for a in accounts)}")
    return 0


# ---------------------------------------------------------------------------
# PROCESS
# ---------------------------------------------------------------------------

def _load_enrichment(slug: str) -> dict | None:
    p = ENRICHMENT_DIR / f"{slug}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError as e:
        print(f"  ⚠️  {p.name}: invalid JSON ({e})", file=sys.stderr)
        return None


def _match_known(contact_name: str, known: list[dict]) -> dict | None:
    if not known:
        return None
    names = [k["full_name"] for k in known]
    match = process.extractOne(contact_name, names, scorer=fuzz.token_sort_ratio)
    if match and match[1] >= 85:
        return known[match[2]]
    return None


def _dedupe_contacts(contacts: list[dict]) -> list[dict]:
    """Dedupe contacts within a company on fuzzy name match (threshold 92)."""
    out: list[dict] = []
    for c in contacts:
        name = (c.get("name") or "").strip()
        if not name:
            continue
        dup = False
        for existing in out:
            if fuzz.token_sort_ratio(name, existing["name"]) >= 92:
                # Merge: prefer non-empty fields from `c` into `existing`.
                for k, v in c.items():
                    if v and not existing.get(k):
                        existing[k] = v
                dup = True
                break
        if not dup:
            out.append(dict(c))
    return out


def cmd_process(args: argparse.Namespace) -> int:
    accounts_json = DATA_DIR / "accounts.json"
    if not accounts_json.exists():
        print(f"error: {accounts_json} not found — run `prepare` first.", file=sys.stderr)
        return 1

    accounts = json.loads(accounts_json.read_text())

    org_rows: list[dict] = []
    people_rows: list[dict] = []

    today = dt.date.today().isoformat()

    for acc in accounts:
        slug = _slugify(acc["name"])
        enr = _load_enrichment(slug)
        company = (enr or {}).get("company", {})
        enriched_contacts = (enr or {}).get("contacts", [])
        known = acc.get("known_contacts", [])

        # Start the contact list from enrichment, then add any TechToMed-known
        # names that didn't come back from enrichment.
        enriched_names = [c.get("name", "") for c in enriched_contacts]
        enriched_contacts = list(enriched_contacts)

        for kc in known:
            kname = kc["full_name"]
            if not kname:
                continue
            dup = False
            for en in enriched_contacts:
                if fuzz.token_sort_ratio(kname, en.get("name", "")) >= 85:
                    en["_known_source"] = "techtomed"
                    dup = True
                    break
            if not dup:
                enriched_contacts.append({
                    "name": kname,
                    "title": kc.get("role_hint", "") or "",
                    "linkedin_url": "",
                    "email": "",
                    "_known_source": "techtomed",
                    "_from_crm_only": True,
                })

        # Dedupe + cap
        enriched_contacts = _dedupe_contacts(enriched_contacts)
        # Sort by priority score (computed after classification), so cap keeps the best
        classified: list[tuple[dict, RoleAnalysis]] = []
        for c in enriched_contacts:
            title = c.get("title", "")
            analysis = classify(title)
            classified.append((c, analysis))

        classified.sort(key=lambda ca: (
            -int(bool(ca[0].get("_known_source") == "techtomed")),  # keep TechToMed first
            -ca[1].priority_score,
            -int(ca[1].is_c_level),
        ))

        capped = classified[:MAX_CONTACTS_PER_COMPANY]

        # Org row
        all_areas = set()
        for c, a in capped:
            for ta in a.therapeutic_areas:
                all_areas.add(ta)
        for ta in company.get("therapeutic_areas", []) or []:
            all_areas.add(ta)

        org_rows.append({
            "Name": acc["name"],
            "Website": company.get("domain", acc.get("domain_hint", "")),
            "Label": acc["priority"] or "Unprioritized",
            "Address": company.get("hq", ""),
            "Phone": company.get("phone", ""),
            "Priorité (P1/P2/P3)": acc["priority"],
            "Statut CRM": acc["status"],
            "Work Status": acc.get("work_status", ""),
            "PIC muchbetter": acc["pic"],
            "Next Step": acc["step"],
            "CRM_ID": acc["crm_id"],
            "LinkedIn URL": company.get("linkedin_url", ""),
            "Effectif": company.get("headcount", ""),
            "Aires thérapeutiques (enrichies)": ", ".join(sorted(all_areas)),
            "Nb contacts mappés": len(capped),
            "Date enrichissement": today if enr else "",
            "Commentaires CRM": acc["comments_raw"],
            "Notes": acc.get("note", ""),
        })

        # People rows
        for c, a in capped:
            is_known = c.get("_known_source") == "techtomed"
            labels = []
            if a.is_c_level:
                labels.append("C-Level")
            for cat in a.categories:
                labels.append(cat.split(" / ")[0])
            if a.is_bu_head:
                labels.append("BU Head")
            if is_known:
                labels.append("TechToMed")
            labels = list(dict.fromkeys(labels))  # dedupe, keep order

            people_rows.append({
                "Name": c.get("name", ""),
                "Organization": acc["name"],
                "Job Title": c.get("title", ""),
                "Email": c.get("email", ""),
                "Phone": c.get("phone", ""),
                "Label": ", ".join(labels),
                "LinkedIn URL": c.get("linkedin_url", ""),
                "Location": c.get("location", ""),
                "Priorité compte": acc["priority"],
                "CRM_ID compte": acc["crm_id"],
                "Séniorité": a.seniority,
                "Catégorie rôle": ", ".join(a.categories),
                "Aire thérapeutique": ", ".join(a.therapeutic_areas),
                "Flag C-Level": "Oui" if a.is_c_level else "Non",
                "Flag Manager-de-managers": "Oui" if a.manager_of_managers_flag else "Non",
                "Flag BU Head": "Oui" if a.is_bu_head else "Non",
                "Priority Score": a.priority_score,
                "Source": "techtomed" if is_known else ("mcp_enrich" if not c.get("_from_crm_only") else "crm"),
                "Déjà connu Nicolas (O/N)": "O" if is_known else "N",
                "Décideur ou Influenceur (à remplir terrain)": "",
                "Notes": a.notes,
            })

    OUT_DIR.mkdir(exist_ok=True)
    out_path = OUT_DIR / f"mapping_P2_{today}.xlsx"
    write_workbook(out_path, org_rows, people_rows)

    total_contacts = sum(int(r["Nb contacts mappés"]) for r in org_rows)
    missing = [a["name"] for a in accounts if not (ENRICHMENT_DIR / f"{_slugify(a['name'])}.json").exists()]
    print(f"✓ wrote {out_path}")
    print(f"  {len(org_rows)} organizations, {total_contacts} contacts")
    if missing:
        print(f"  ⚠️  no enrichment yet for: {', '.join(missing)}")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_prep = sub.add_parser("prepare", help="read CRM CSV, emit data/accounts.json")
    p_prep.add_argument("csv", type=Path)
    p_prep.add_argument("--priority", nargs="*", default=["P2"])
    p_prep.set_defaults(func=cmd_prepare)

    p_proc = sub.add_parser("process", help="merge enrichment + CSV → XLSX")
    p_proc.set_defaults(func=cmd_process)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
