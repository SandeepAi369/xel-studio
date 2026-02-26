#!/usr/bin/env python3
"""
News Cleanup — Daily Midnight Job
===================================
Runs once at 12:15 AM IST via GitHub Actions.
Keeps minimum 50 articles. Deletes ONLY the excess (oldest first).
If 50 or fewer articles exist → does nothing.
"""

import os
import sys
import json
from datetime import datetime, timezone, timedelta

import firebase_admin
from firebase_admin import credentials, firestore

COLLECTION = "news"
HISTORY_COLLECTION = "news_history"
MIN_ARTICLES = 50
HISTORY_TTL_DAYS = 10


def init_firebase() -> firestore.Client:
    """Initialize Firebase and return Firestore client."""
    cred_json = os.environ.get("FIREBASE_CREDENTIALS") or os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not cred_json:
        print("❌ No Firebase credentials found")
        sys.exit(1)

    cred_data = json.loads(cred_json)
    cred = credentials.Certificate(cred_data)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def cleanup(db: firestore.Client):
    """Keep newest 50 articles. Delete excess oldest articles."""
    print(f"\n🧹 NEWS CLEANUP — Keeping minimum {MIN_ARTICLES} articles")
    print(f"   Time: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")

    # ── 1. Delete excess articles ──────────────────────────────
    try:
        all_news = list(
            db.collection(COLLECTION)
            .order_by("date", direction=firestore.Query.ASCENDING)
            .stream()
        )
        total = len(all_news)
        print(f"   📊 Total articles: {total}")

        if total <= MIN_ARTICLES:
            print(f"   ✅ {total} articles ≤ {MIN_ARTICLES} — nothing to delete")
        else:
            excess = total - MIN_ARTICLES
            to_delete = all_news[:excess]
            batch = db.batch()
            count = 0

            for doc_snap in to_delete:
                data = doc_snap.to_dict()

                # Archive to history for dedup before deleting
                source_urls = data.get("sourceUrls", [])
                title = data.get("title", "")
                if source_urls or title:
                    try:
                        db.collection(HISTORY_COLLECTION).add({
                            "title": title,
                            "sourceUrls": source_urls,
                            "createdAt": datetime.now(timezone.utc).isoformat(),
                            "archivedFrom": "cleanup",
                        })
                    except Exception as he:
                        print(f"   ⚠️ History archive failed: {he}")

                batch.delete(doc_snap.reference)
                count += 1
                if count % 400 == 0:
                    batch.commit()
                    batch = db.batch()

            if count % 400 != 0:
                batch.commit()

            print(f"   🗑️ Deleted {count} excess articles (had {total}, keeping {MIN_ARTICLES})")

    except Exception as e:
        print(f"   ❌ Cleanup failed: {e}")

    # ── 2. Purge old history entries (>10 days) ────────────────
    try:
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=HISTORY_TTL_DAYS)
        cutoff_iso = cutoff_dt.isoformat()

        old_history = list(
            db.collection(HISTORY_COLLECTION)
            .where("createdAt", "<", cutoff_iso)
            .stream()
        )
        if old_history:
            batch = db.batch()
            count = 0
            for doc_snap in old_history:
                batch.delete(doc_snap.reference)
                count += 1
                if count % 400 == 0:
                    batch.commit()
                    batch = db.batch()
            if count % 400 != 0:
                batch.commit()
            print(f"   🗑️ Purged {count} history entries older than {HISTORY_TTL_DAYS} days")
        else:
            print(f"   ✅ No old history entries to purge")
    except Exception as e:
        print(f"   ⚠️ History cleanup failed: {e}")

    print("🧹 Cleanup complete\n")


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))
    except ImportError:
        pass

    db = init_firebase()
    cleanup(db)
