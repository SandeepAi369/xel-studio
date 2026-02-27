#!/usr/bin/env python3
"""
News Cleanup — Standalone script
Keeps the newest 50 articles, deletes oldest excess.
Archives deleted URLs to news_history for dedup.
Runs daily at 12:45 AM via GitHub Actions.
"""

import sys
import os

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from run_news_cycle import init_firebase, cleanup_old_news


def main():
    print("🧹 DAILY CLEANUP — Starting...")
    try:
        db = init_firebase()
        cleanup_old_news(db)
        print("✅ Daily cleanup complete!")
    except Exception as e:
        print(f"❌ Cleanup failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
