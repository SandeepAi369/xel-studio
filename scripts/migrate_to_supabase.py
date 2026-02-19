#!/usr/bin/env python3
"""
migrate_to_supabase.py — One-time migration script
Reads existing data/data.json and inserts all records into Supabase tables.

Usage:
    export SUPABASE_URL=https://your-project.supabase.co
    export SUPABASE_KEY=your-service-role-key
    python3 scripts/migrate_to_supabase.py

Requirements:
    pip install supabase
"""

import json
import os
import sys

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: Install supabase-py first:")
    print("  pip install supabase")
    sys.exit(1)

# Config
DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'data.json')
SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Set SUPABASE_URL and SUPABASE_KEY (or NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)")
    sys.exit(1)

# Connect
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
print(f"Connected to Supabase: {SUPABASE_URL}")

# Load data
with open(DATA_FILE, 'r') as f:
    db = json.load(f)

print(f"\nData loaded from {DATA_FILE}")
print(f"  Articles: {len(db.get('articles', []))}")
print(f"  Apps:     {len(db.get('apks', []))}")
print(f"  AI Labs:  {len(db.get('aiLabs', []))}")
print(f"  Sec Tools:{len(db.get('securityTools', []))}")

# ─── Migrate Articles ─────────────────────────────────────────
articles = db.get('articles', [])
if articles:
    print(f"\nMigrating {len(articles)} articles...")
    for art in articles:
        row = {
            'id': art['id'],
            'title': art.get('title', ''),
            'image': art.get('image', ''),
            'content': art.get('content', ''),
            'date': art.get('date', ''),
            'category': art.get('category', 'general'),
        }
        result = supabase.table('articles').upsert(row).execute()
        print(f"  ✓ {art['title'][:60]}")
    print(f"  Done: {len(articles)} articles migrated")
else:
    print("\nNo articles to migrate")

# ─── Migrate Apps (APKs) ──────────────────────────────────────
apks = db.get('apks', [])
if apks:
    print(f"\nMigrating {len(apks)} apps...")
    for apk in apks:
        row = {
            'id': apk['id'],
            'name': apk.get('name', ''),
            'version': apk.get('version', '1.0'),
            'download_url': apk.get('downloadUrl', ''),
            'size': apk.get('size', ''),
            'icon': apk.get('icon', ''),
            'description': apk.get('description', ''),
            'category': apk.get('category', 'general'),
        }
        result = supabase.table('apps').upsert(row).execute()
        print(f"  ✓ {apk['name'][:60]}")
    print(f"  Done: {len(apks)} apps migrated")
else:
    print("\nNo apps to migrate")

# ─── Migrate AI Labs ──────────────────────────────────────────
ai_labs = db.get('aiLabs', [])
if ai_labs:
    print(f"\nMigrating {len(ai_labs)} AI labs...")
    for lab in ai_labs:
        row = {
            'id': lab['id'],
            'name': lab.get('name', ''),
            'description': lab.get('description', ''),
            'status': lab.get('status', 'active'),
            'demo_url': lab.get('demoUrl', ''),
            'image': lab.get('image', ''),
        }
        result = supabase.table('ai_labs').upsert(row).execute()
        print(f"  ✓ {lab['name'][:60]}")
    print(f"  Done: {len(ai_labs)} AI labs migrated")
else:
    print("\nNo AI labs to migrate")

# ─── Migrate Security Tools ───────────────────────────────────
sec_tools = db.get('securityTools', [])
if sec_tools:
    print(f"\nMigrating {len(sec_tools)} security tools...")
    for tool in sec_tools:
        row = {
            'id': tool['id'],
            'name': tool.get('name', ''),
            'description': tool.get('description', ''),
            'category': tool.get('category', ''),
            'link': tool.get('link', ''),
        }
        result = supabase.table('security_tools').upsert(row).execute()
        print(f"  ✓ {tool['name'][:60]}")
    print(f"  Done: {len(sec_tools)} security tools migrated")
else:
    print("\nNo security tools to migrate")

print("\n" + "=" * 50)
print("Migration complete!")
print("=" * 50)
