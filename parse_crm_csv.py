"""Parse the CRM x TechToMed CSV: extract P2 accounts + known contacts in Commentaires."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path


@dataclass
class KnownContact:
    raw: str
    full_name: str
    role_hint: str = ""   # whatever was in parentheses or after a dash


@dataclass
class Account:
    crm_id: str
    name: str
    priority: str
    status: str
    pic: str              # internal owner at muchbetter
    step: str             # next action
    work_status: str      # Pas / A moitié / Travaillé
    comments_raw: str
    known_contacts: list[KnownContact] = field(default_factory=list)


# Heuristic: split the Commentaires cell on commas + newlines, but keep parentheticals intact.
_NAME_RE = re.compile(
    r"^\s*([A-ZÉÈÀÂÊÎÔÛÇ][\wÀ-ÿ'\-]+(?:\s+[A-Za-zÀ-ÿ][\wÀ-ÿ'\-]+){1,4})(\s*[\-–(:].*)?$"
)


def extract_known_contacts(comments: str) -> list[KnownContact]:
    """Best-effort extract of full names from the Commentaires cell.

    The Commentaires field mixes free text and contact names. We split on
    newlines + commas, then regex-match anything that looks like a
    'Firstname Lastname' sequence (2-5 Capitalized tokens).
    """
    if not comments:
        return []

    contacts: list[KnownContact] = []
    seen = set()

    # First split on newlines, then commas
    segments: list[str] = []
    for line in comments.splitlines():
        segments.extend(s.strip() for s in line.split(","))

    for seg in segments:
        if not seg or len(seg) < 4:
            continue

        # Strip leading artifacts like "Anciennement :" or "DG France -"
        seg_clean = re.sub(r"^(anciennement|puis|ancien|ex)\s*:?\s*", "", seg, flags=re.IGNORECASE)
        seg_clean = re.sub(r"^(DG|CDO|CIO|CEO|VP)\s+[\w\s]+-\s*", "", seg_clean)
        # Drop emojis + checkmarks
        seg_clean = re.sub(r"[✅❌☎️🎯]", "", seg_clean).strip()

        m = _NAME_RE.match(seg_clean)
        if not m:
            continue

        full_name = m.group(1).strip()
        role_hint = (m.group(2) or "").strip(" -–(:)")

        # Reject obvious false positives (words that start Capitalized but aren't names)
        tokens = full_name.split()
        first = tokens[0].lower()
        if first in {
            "franck", "charles", "julien", "max", "théo", "theo", "nicolas",
            "proposition", "plan", "rencontre", "mail", "europe", "france",
            "mentionner", "attendre", "discussions", "grosse", "recontacter",
            "referencement", "contacter", "ancien", "anciennement",
            "points", "propositions", "gros", "pas", "voir", "tendance",
            "good", "d'accord",
        }:
            # Still could be a real first name — keep if at least 2 tokens AND not a known non-person word
            if first in {"proposition", "plan", "rencontre", "mail", "mentionner",
                         "attendre", "discussions", "grosse", "recontacter",
                         "referencement", "contacter", "points", "tendance",
                         "good", "d'accord", "europe", "france", "ancien",
                         "anciennement"}:
                continue

        key = full_name.lower()
        if key in seen:
            continue
        seen.add(key)
        contacts.append(KnownContact(raw=seg, full_name=full_name, role_hint=role_hint))

    return contacts


def load_csv(path: Path) -> list[Account]:
    accounts: list[Account] = []
    with open(path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            acc = Account(
                crm_id=(row.get("ID") or "").strip(),
                name=(row.get("Nom") or "").strip(),
                priority=(row.get("Priorité") or "").strip(),
                status=(row.get("Statut") or "").strip(),
                pic=(row.get("PIC") or "").strip(),
                step=(row.get("Step") or "").strip(),
                work_status=(list(row.values())[7] or "").strip() if len(row) > 7 else "",
                comments_raw=(row.get("Commentaires") or "").strip(),
            )
            if acc.name:
                acc.known_contacts = extract_known_contacts(acc.comments_raw)
                accounts.append(acc)
    return accounts


def filter_priority(accounts: list[Account], *keep: str) -> list[Account]:
    keep_set = {p.lower() for p in keep}
    return [a for a in accounts if a.priority.lower() in keep_set]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", type=Path)
    ap.add_argument("--priority", nargs="*", default=["P2"])
    ap.add_argument("--json", action="store_true", help="emit JSON to stdout")
    args = ap.parse_args()

    accounts = load_csv(args.csv)
    accounts = filter_priority(accounts, *args.priority)

    if args.json:
        payload = [
            {
                **{k: v for k, v in asdict(a).items() if k != "known_contacts"},
                "known_contacts": [asdict(c) for c in a.known_contacts],
            }
            for a in accounts
        ]
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    else:
        for a in accounts:
            print(f"\n[{a.priority}] {a.name}  (CRM {a.crm_id or '—'}, PIC={a.pic})")
            print(f"  status: {a.status} | step: {a.step} | work: {a.work_status}")
            if a.known_contacts:
                for c in a.known_contacts:
                    print(f"  · {c.full_name}" + (f" — {c.role_hint}" if c.role_hint else ""))
            else:
                print("  (aucun contact connu extrait)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
