---
description: Dual-Database Architecture Rule — Supabase vs Firebase responsibilities
---

# Dual-Database Architecture Rule

**This is a PERMANENT rule. Never violate this separation.**

## 1. SUPABASE — Static/Structured Content ONLY

Supabase handles these 4 tables and NOTHING else:

| Table | Description |
|-------|-------------|
| `articles` | Blog/article content |
| `apps` | APK/app listings |
| `ai_labs` | AI lab projects |
| `security_tools` | Security tool listings |

**Code paths:**
- `lib/supabase.ts` — Supabase client
- `lib/supabase-db.ts` — All CRUD operations for the 4 tables
- `app/api/content/route.ts` — Public GET endpoint (fetches from Supabase)
- `app/api/admin/route.ts` — Admin CRUD (writes to Supabase)

## 2. FIREBASE — News + Authentication ONLY

Firebase (Firestore) handles:
- **News articles** (`news` collection in Firestore)
- **Authentication** (Firebase Auth)

**Code paths:**
- `lib/firebase.ts` — Firebase client (Auth + Firestore)
- `app/ai-news/page.tsx` — Fetches news from Firestore directly
- `scripts/generate_news.py` — Writes news to Firestore via firebase-admin
- `.github/workflows/daily-news.yml` — Runs generate_news.py hourly

## ❌ NEVER DO

- Never fetch News from Supabase
- Never fetch Articles/Apps/AI Labs/Security Tools from Firebase
- Never create a `news` table in Supabase
- Never store articles in Firebase Firestore
- Never mix `lib/supabase-db.ts` imports in news-related components
- Never mix `lib/firebase.ts` Firestore imports in article/app/lab/tool components
