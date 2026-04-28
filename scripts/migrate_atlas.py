"""One-shot Atlas → Atlas migration.

Reads OLD_URI/OLD_DB from backend/.env (current cluster), writes everything
to NEW_URI/NEW_DB. Safe to re-run: it drops the destination collection
before copying so the result is always a clean mirror.

Usage:
    NEW_URI='mongodb+srv://flashmapping:...@cluster0.iihl6kf.mongodb.net' \
    NEW_DB=flashmapping \
    python scripts/migrate_atlas.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import dotenv
dotenv.load_dotenv(ROOT / "backend" / ".env")

from pymongo import MongoClient

OLD_URI = os.environ["MONGO_URI"]
OLD_DB = os.environ.get("MONGO_DB", "pharma_mapping")
NEW_URI = os.environ.get("NEW_URI") or sys.exit("NEW_URI env var required")
NEW_DB = os.environ.get("NEW_DB", "flashmapping")

# Collections we don't migrate — generated/cached data, will rebuild on first
# use in the new cluster.
SKIP_COLLECTIONS = {
    "pipedrive_cache",        # rebuilt on next account open (~30s for 23k persons)
    "pipedrive_cache_meta",
}

BATCH = 500


def main() -> None:
    print(f"OLD: {OLD_URI[:60]}…  db={OLD_DB}")
    print(f"NEW: {NEW_URI[:60]}…  db={NEW_DB}")
    print()

    src = MongoClient(OLD_URI, serverSelectionTimeoutMS=8000)
    src.admin.command("ping")
    src_db = src[OLD_DB]

    dst = MongoClient(NEW_URI, serverSelectionTimeoutMS=8000)
    dst.admin.command("ping")
    dst_db = dst[NEW_DB]

    cols = sorted(src_db.list_collection_names())
    if not cols:
        print("OLD database is empty — nothing to migrate.")
        return

    total = 0
    for col in cols:
        if col in SKIP_COLLECTIONS:
            print(f"  · {col:<28s} (skipped: regenerated on demand)")
            continue
        n = src_db[col].count_documents({})
        if n == 0:
            print(f"  · {col:<28s} (empty)")
            continue
        # Drop the destination collection so each run produces a clean mirror.
        dst_db[col].drop()
        copied = 0
        cur = src_db[col].find({})
        batch: list = []
        for doc in cur:
            batch.append(doc)
            if len(batch) >= BATCH:
                dst_db[col].insert_many(batch, ordered=False)
                copied += len(batch)
                batch = []
        if batch:
            dst_db[col].insert_many(batch, ordered=False)
            copied += len(batch)
        print(f"  ✓ {col:<28s} {copied:>6d} docs")
        total += copied

    print()
    print(f"Total: {total} documents migrated to {NEW_DB}.")
    print()
    print("Next steps:")
    print("  1. Update backend/.env:")
    print(f"     MONGO_URI={NEW_URI}")
    print(f"     MONGO_DB={NEW_DB}")
    print("  2. Restart the backend; ensure_indexes() will rebuild indexes.")
    print("  3. Update EDJ Labs stack env vars (same MONGO_URI / MONGO_DB).")
    print("  4. Verify the app — open one account, sync Pipedrive once.")


if __name__ == "__main__":
    main()
