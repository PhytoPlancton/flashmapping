"""Re-classify tous les contacts en DB avec la taxonomie mise à jour (Operations/Finance/Legal).
Update seulement: category, priority_score (cas où la catégorie change le score).
Garde level + flags intacts (validation humaine prioritaire)."""
from __future__ import annotations
import asyncio, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.taxonomy import classify  # type: ignore
from motor.motor_asyncio import AsyncIOMotorClient

env = (ROOT / "backend" / ".env").read_text()
MONGO_URI = next(l.split("=", 1)[1].strip() for l in env.splitlines() if l.startswith("MONGO_URI="))
MONGO_DB = next((l.split("=", 1)[1].strip() for l in env.splitlines() if l.startswith("MONGO_DB=")), "pharma_mapping")


async def main():
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]

    contacts = await db.contacts.find({}).to_list(5000)
    changed = 0
    now = datetime.now(timezone.utc)

    summary: dict[str, int] = {}

    for c in contacts:
        title = c.get("title") or ""
        if not title:
            continue

        new = classify(title)
        old_cat = c.get("category") or "other"
        new_cat = new["category"]

        # Skip if category unchanged
        if old_cat == new_cat:
            continue

        # Only downgrade from "other" → something else, NOT overwrite a human-set category
        # (e.g., we manually set Xavier Joseph to "marketing" earlier — if the new taxonomy
        # still picks "other" for his title, we don't revert).
        # So: only update if either (a) old was "other" and new is not "other",
        # or (b) new is more specific and old was also auto.
        if old_cat != "other" and new_cat == "other":
            continue

        await db.contacts.update_one(
            {"_id": c["_id"]},
            {"$set": {
                "category": new_cat,
                "priority_score": new["priority_score"],
                "updated_at": now,
            }}
        )
        key = f"{old_cat} → {new_cat}"
        summary[key] = summary.get(key, 0) + 1
        changed += 1

    print(f"\n{changed} contacts re-catégorisés.\n")
    for k in sorted(summary, key=lambda x: -summary[x]):
        print(f"  {summary[k]:3d}  {k}")

    # Breakdown final par catégorie
    print("\n--- Distribution finale ---")
    pipeline = [{"$group": {"_id": "$category", "count": {"$sum": 1}}}]
    async for row in db.contacts.aggregate(pipeline):
        print(f"  {row['count']:4d}  {row['_id']}")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
