#!/usr/bin/env python3
"""
News Pipeline Worker — GitHub Actions Background Runner
========================================================
Pipeline: Dynamic Query → Tavily Search → URL Dedup →
          Cerebras (GPT-OSS 120B / llama3.1-8b) → FLUX.1-dev Image Gen →
          Cloudinary Upload → Firestore Save → History Update

Ported from: app/api/cron/generate-news/route.ts (v17)
"""

import json
import os
import random
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse

import cloudinary
import cloudinary.uploader
import firebase_admin
from firebase_admin import credentials, firestore
import requests
from cerebras.cloud.sdk import Cerebras

# ─── Config ──────────────────────────────────────────────────

COLLECTION = "news"
HISTORY_COLLECTION = "news_history"
HEALTH_DOC_PATH = "system/cron_health"
HISTORY_TTL_DAYS = 10
TAVILY_RESULT_COUNT = 10

IMAGE_WIDTH = 1024
IMAGE_HEIGHT = 576  # 16:9 cinematic ratio

# ─── Search Queries (Balanced: ~50% AI/Tech, ~50% Diverse) ───
#
# Distribution:
#   ~50% → AI, Tech, Hardware, Robotics (primary focus)
#   ~50% → Disability/Accessibility, Climate/Environment, World Affairs,
#           CEO/Business Leaders, Science, Health, Culture
#
# Each pipeline run picks ONE random query, so over time the mix balances out.

SEARCH_QUERIES = [
    # ═══════════════════════════════════════════════════════════
    # 50% — AI & TECH (primary focus)
    # ═══════════════════════════════════════════════════════════
    "artificial intelligence latest breakthroughs announcements",
    "OpenAI GPT new model release announcements",
    "Google DeepMind Gemini AI research news",
    "Anthropic Claude AI safety research news",
    "Anthropic AI company announcements updates news",
    "Meta AI Llama open source model news",
    "open source AI models community development news",
    "Hugging Face open source AI tools models news",
    "Mistral AI open source language model news",
    "generative AI tools products launches today",
    "AI startup funding acquisition deals news",
    "AI regulation policy government updates",
    "Nvidia AMD AI chip semiconductor hardware news",
    "Apple Google Microsoft major tech announcements",
    "quantum computing breakthrough research news",
    "robotics automation humanoid robot news",
    "AI coding programming developer tools news",
    "AI image video generation model news",
    "cloud computing AI infrastructure updates",

    # ═══════════════════════════════════════════════════════════
    # 50% — DIVERSE TOPICS
    # ═══════════════════════════════════════════════════════════

    # ── Disability & Accessibility ──
    "disability technology assistive tech accessibility news",
    "AI assistive technology disability inclusion news",
    "accessible technology innovations disabled people news",
    "visually impaired blind students assistive technology news",
    "screen reader accessibility blind people technology news",
    "deaf hearing impaired technology accessibility news",
    "wheelchair disability mobility technology innovation news",
    "autism neurodiversity technology support news",

    # ── Health ──
    "healthcare technology innovation AI medical news",
    "mental health digital wellness technology news",
    "AI healthcare diagnosis treatment breakthrough news",
    "medical technology health research discovery news",

    # ── Climate & Environment ──
    "climate change environmental research news",
    "climate technology clean energy innovation news",
    "climate policy energy transition sustainability news",

    # ── World Affairs & Geopolitics ──
    "geopolitical technology competition world news",
    "international trade technology policy news",
    "digital privacy surveillance regulation world news",

    # ── General / Business / Culture ──
    "tech CEO statements leadership announcements news",
    "tech company earnings big tech stock news",
    "tech startup unicorn IPO funding news",
    "cryptocurrency blockchain Web3 news",
    "social media platform changes updates news",
    "gaming esports streaming industry news",
    "science discovery research breakthrough news",
    "space technology SpaceX NASA launch news",
]

FALLBACK_QUERIES = [
    "artificial intelligence news today",
    "latest technology breakthrough news",
    "Anthropic open source AI news today",
    "disability assistive technology news today",
    "health technology AI news today",
]

# ─── Helpers ─────────────────────────────────────────────────


def detect_category(query: str, title: str = "", content: str = "") -> str:
    """Detect category from search query, title, and article content.
    Checks ALL text for keyword matches, with priority weighting."""
    # Combine all text for analysis (title gets extra weight by appearing twice)
    q = f"{query} {title} {title} {content[:500]}".lower()

    # Category rules: ordered from most specific to least
    CATEGORY_RULES = [
        ("disability", [
            "disability", "disabled", "assistive", "accessible", "accessibility",
            "inclusion", "wheelchair", "blind", "deaf", "autism", "neurodiversity",
            "ada ", "special needs", "impairment", "prosthetic", "screen reader",
        ]),
        ("health", [
            "healthcare", "health", "mental health", "wellness", "medical",
            "disease", "vaccine", "hospital", "patient", "therapy", "drug ",
            "pharmaceutical", "clinical trial", "who ", "cdc ",
        ]),
        ("climate", [
            "climate", "environment", "clean energy", "sustainability",
            "energy transition", "carbon", "emissions", "renewable", "solar",
            "wind energy", "ev ", "electric vehicle", "green",
        ]),
        ("science", [
            "space", "spacex", "nasa", "physics", "astronomy", "mars",
            "biotechnology", "genetics", "science discovery", "research breakthrough",
            "quantum", "crispr", "genome", "telescope", "satellite",
        ]),
        ("world", [
            "geopolitical", "international", "trade war", "privacy", "surveillance",
            "world", "regulation", "government", "policy", "law ", "legislation",
            "congress", "parliament", "sanctions", "diplomacy", "united nations",
            "eu ", "european union", "china", "india", "nist", "ftc",
        ]),
        ("business", [
            "earnings", "stock", "ipo", "funding", "startup", "unicorn",
            "crypto", "blockchain", "web3", "ceo", "revenue", "acquisition",
            "merger", "market cap", "investor", "venture capital", "valuation",
        ]),
        ("entertainment", [
            "social media", "streaming", "gaming", "esports", "entertainment",
            "movie", "music", "tiktok", "youtube", "netflix", "spotify",
        ]),
    ]

    # Score each category by keyword matches
    scores: dict[str, int] = {}
    for cat, keywords in CATEGORY_RULES:
        score = sum(1 for kw in keywords if kw in q)
        if score > 0:
            scores[cat] = score

    if scores:
        best_cat = max(scores, key=scores.get)
        if scores[best_cat] >= 1:
            return best_cat

    # AI & Tech (default for anything AI/tech related)
    return "ai-tech"


def extract_topic(query: str) -> str:
    """Remove time modifiers to get the core topic."""
    import re
    time_pattern = r"\s*(latest breaking news|updates today|news \w+ \d+|fresh developments|this week|breaking today|\d+ breakthrough|exclusive update)$"
    topic = re.sub(time_pattern, "", query, flags=re.IGNORECASE).strip()
    topic = re.sub(r"\s+(AND|OR)\s+", " & ", topic)
    return topic


def normalize_url(url: str) -> str:
    """Normalize URL for consistent comparison."""
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname.lower() if parsed.hostname else ""
        pathname = parsed.path.rstrip("/")
        # Remove tracking params
        params = parse_qs(parsed.query)
        for key in ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "source"]:
            params.pop(key, None)
        clean_query = urlencode(params, doseq=True) if params else ""
        return urlunparse(("https", hostname, pathname, "", clean_query, ""))
    except Exception:
        return url.lower().rstrip("/")


# ─── Firebase Init ───────────────────────────────────────────


def init_firebase() -> firestore.Client:
    """Initialize Firebase Admin SDK from environment variables."""
    if firebase_admin._apps:
        return firestore.client()

    # Check both env var names (GitHub Actions uses FIREBASE_CREDENTIALS,
    # local .env.local uses FIREBASE_SERVICE_ACCOUNT)
    creds_json = os.environ.get("FIREBASE_CREDENTIALS") or os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if creds_json:
        try:
            creds_dict = json.loads(creds_json)
            cred = credentials.Certificate(creds_dict)
            firebase_admin.initialize_app(cred)
            print("🔥 Firebase initialized from FIREBASE_CREDENTIALS")
            return firestore.client()
        except Exception as e:
            print(f"⚠️ Failed to parse FIREBASE_CREDENTIALS: {e}")

    # Fallback: individual env vars
    project_id = os.environ.get("FIREBASE_PROJECT_ID", "xelbackend")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")

    if client_email and private_key:
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": project_id,
            "client_email": client_email,
            "private_key": private_key,
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        firebase_admin.initialize_app(cred)
        print("🔥 Firebase initialized from individual env vars")
        return firestore.client()

    firebase_admin.initialize_app(options={"projectId": project_id})
    print("🔥 Firebase initialized with default credentials")
    return firestore.client()


# ─── Cloudinary Init ─────────────────────────────────────────


def init_cloudinary():
    """Initialize Cloudinary from CLOUDINARY_URL env var."""
    url = os.environ.get("CLOUDINARY_URL")
    if url:
        cloudinary.config(cloudinary_url=url)
        print("☁️ Cloudinary initialized")
    else:
        cloud_name = os.environ.get("CLOUDINARY_CLOUD_NAME")
        api_key = os.environ.get("CLOUDINARY_API_KEY")
        api_secret = os.environ.get("CLOUDINARY_API_SECRET")
        if cloud_name and api_key and api_secret:
            cloudinary.config(
                cloud_name=cloud_name,
                api_key=api_key,
                api_secret=api_secret,
            )
            print("☁️ Cloudinary initialized from individual env vars")
        else:
            print("⚠️ No Cloudinary credentials — images will use placeholder")





# ─── Tavily Search ───────────────────────────────────────────


def search_tavily(query: str, days_back: int = 3) -> dict:
    """Search Tavily with dual-key fallback. Returns {context, results}."""
    keys = [
        os.environ.get("TAVILY_API_KEY"),
        os.environ.get("TAVILY_API_KEY_2"),
    ]
    keys = [k for k in keys if k]

    if not keys:
        print("⚠️ No TAVILY_API_KEY set — skipping search")
        return {"context": "", "results": []}

    for i, key in enumerate(keys):
        label = "primary" if i == 0 else "fallback"
        try:
            print(f'🔍 Tavily ({label}): searching "{query}" (last {days_back} days)...')
            resp = requests.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": key,
                    "query": query,
                    "search_depth": "advanced",
                    "topic": "news",
                    "days": days_back,
                    "max_results": TAVILY_RESULT_COUNT,
                    "include_answer": False,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()

            results = data.get("results", [])
            if not results:
                print(f'⚠️ Tavily ({label}) returned no results for "{query}"')
                continue

            mapped = [
                {"title": r.get("title", ""), "description": r.get("content", ""), "url": r.get("url", "")}
                for r in results
            ]
            context = "\n\n".join(
                f"[{j+1}] {r['title']}\n{r['description']}" for j, r in enumerate(mapped)
            )
            print(f'🔍 Tavily ({label}): {len(mapped)} results for "{query}"')
            return {"context": context, "results": mapped}

        except Exception as e:
            print(f"⚠️ Tavily ({label}) failed: {e}")
            if i < len(keys) - 1:
                print("🔄 Switching to fallback Tavily API key...")

    print("⚠️ All Tavily keys exhausted — no results")
    return {"context": "", "results": []}


# ─── URL History & LLM Dedup ─────────────────────────────────


def load_history_urls(db: firestore.Client) -> set[str]:
    """Load all source URLs from news_history into a Set for O(1) lookup."""
    docs = db.collection(HISTORY_COLLECTION).select(["sourceUrls"]).stream()
    urls = set()
    doc_count = 0
    for doc in docs:
        doc_count += 1
        data = doc.to_dict()
        source_urls = data.get("sourceUrls", [])
        if isinstance(source_urls, list):
            for u in source_urls:
                urls.add(normalize_url(u))
    print(f"📚 History loaded: {len(urls)} known URLs from {doc_count} articles")
    return urls


def load_existing_titles(db: firestore.Client) -> list[str]:
    """Load ALL existing titles from both 'news' and 'news_history'.
    The LLM uses this list to avoid generating repeated/similar topics."""
    titles = []
    # From live news collection
    try:
        for doc in db.collection(COLLECTION).select(["title"]).stream():
            t = doc.to_dict().get("title", "")
            if t:
                titles.append(t)
    except Exception:
        pass
    # From history (deleted articles — still need dedup)
    try:
        for doc in db.collection(HISTORY_COLLECTION).select(["title"]).stream():
            t = doc.to_dict().get("title", "")
            if t:
                titles.append(t)
    except Exception:
        pass
    print(f"📋 Dedup: loaded {len(titles)} existing titles (news + history)")
    return titles


def filter_by_url_history(results: list[dict], known_urls: set[str]) -> tuple[list[dict], int]:
    """Filter Tavily results — remove any whose URL matches history."""
    fresh = [r for r in results if normalize_url(r.get("url", "")) not in known_urls]
    filtered = len(results) - len(fresh)
    if filtered > 0:
        print(f"🔗 URL filter: {filtered} already-used URLs removed, {len(fresh)} fresh results remain")
    return fresh, filtered


def save_to_history(db: firestore.Client, title: str, content: str, source_urls: list[str]):
    """Save generated article metadata + source URLs to history."""
    try:
        normalized = [normalize_url(u) for u in source_urls]
        db.collection(HISTORY_COLLECTION).add({
            "title": title,
            "content": content,
            "sourceUrls": normalized,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        })
        print(f'📚 History saved: "{title[:50]}" with {len(normalized)} URLs')
    except Exception as e:
        print(f"⚠️ History save failed (non-critical): {e}")


# ─── Health Tracking ─────────────────────────────────────────


def log_health(db: firestore.Client, status: str, details: dict):
    """Update system/cron_health document."""
    try:
        now = datetime.now(timezone.utc)
        db.document(HEALTH_DOC_PATH).set({
            "status": status,
            "timestamp": now.isoformat(),
            "last_run": now.strftime("%d/%m/%Y, %I:%M:%S %p"),
            "runner": "github-actions",
            **details,
        })
    except Exception as e:
        print(f"Health log write failed: {e}")


# ─── Image Generation (g4f multi-provider) & Cloudinary Upload ───

# Priority 1: g4f (Flux, DALL-E 3, SDXL, SD3 — no API keys needed)
# Priority 2: Placeholder image

PLACEHOLDER_IMAGE_URL = (
    "https://placehold.co/1024x576/1a1a2e/e2e8f0?text=XeL+AI+News&font=roboto"
)


def _upload_placeholder_to_cloudinary(article_id: str) -> str:
    """Upload a placeholder image to Cloudinary, or return static URL as ultimate fallback."""
    print(f"  🔄 Uploading placeholder to Cloudinary...")
    try:
        placeholder_bytes = requests.get(PLACEHOLDER_IMAGE_URL, timeout=15).content
        if placeholder_bytes and len(placeholder_bytes) > 500:
            result = cloudinary.uploader.upload(
                placeholder_bytes,
                public_id=article_id,
                folder="xel-news",
                resource_type="image",
                overwrite=True,
            )
            placeholder_url = result.get("secure_url", "")
            if placeholder_url:
                print(f"  ✅ Placeholder uploaded: {placeholder_url[:80]}...")
                return placeholder_url
    except Exception as e:
        print(f"  ⚠️ Placeholder upload failed: {e}")

    print(f"  ⚠️ Using static placeholder URL")
    return PLACEHOLDER_IMAGE_URL





def _upload_bytes_to_cloudinary(image_bytes: bytes, article_id: str) -> str | None:
    """Upload raw image bytes to Cloudinary, return secure URL or None."""
    try:
        print(f"  ☁️ Uploading to Cloudinary (public_id=xel-news/{article_id})...")
        result = cloudinary.uploader.upload(
            image_bytes,
            public_id=article_id,
            folder="xel-news",
            resource_type="image",
            overwrite=True,
        )
        url = result.get("secure_url", "")
        if url:
            print(f"  ☁️ Cloudinary URL: {url[:80]}...")
            print(f"  ☁️ Format: {result.get('format')}, "
                  f"Size: {result.get('bytes')} bytes, "
                  f"Dims: {result.get('width')}x{result.get('height')}")
            return url
    except Exception as e:
        print(f"  ❌ Cloudinary upload failed: {e}")
    return None


def _call_g4f_image(prompt: str) -> bytes | None:
    """Attempt image generation via g4f multi-provider system."""
    try:
        from gemini_image_gen import generate_image_gemini
        return generate_image_gemini(prompt)
    except ImportError:
        print("  ⚠️ g4f image gen not available (g4f not installed?)")
        return None
    except Exception as e:
        print(f"  ❌ g4f image error: {e}")
        return None


def generate_and_upload_image(prompt: str, article_id: str) -> str:
    """
    Image pipeline:
      1. g4f (Flux, DALL-E 3, SDXL, SD3) → Cloudinary
      2. Placeholder → Cloudinary
    """
    import re as _re

    print(f"\n{'─'*50}")
    print("🖼️ IMAGE PIPELINE (g4f → Placeholder)")
    print(f"   Article ID: {article_id}")
    print(f"{'─'*50}")

    # Sanitize prompt
    clean_prompt = _re.sub(r"[^\w\s,.\-!?']", "", prompt)
    clean_prompt = _re.sub(r"\s+", " ", clean_prompt).strip()
    if len(clean_prompt) > 300:
        clean_prompt = clean_prompt[:300].rsplit(" ", 1)[0]

    enhanced_prompt = (
        f"{clean_prompt}, photorealistic, highly detailed, "
        "sharp focus, professional lighting, cinematic, 8k"
    )
    print(f"   Prompt: \"{clean_prompt[:80]}...\"")

    # ── Attempt 1: g4f (multi-provider) ──────────────────────
    g4f_bytes = _call_g4f_image(enhanced_prompt)
    if g4f_bytes:
        result = _upload_bytes_to_cloudinary(g4f_bytes, article_id)
        if result:
            print(f"  ✅ IMAGE SUCCESS (g4f → Cloudinary)")
            return result

    # ── Attempt 2: Placeholder ───────────────────────────────
    print(f"  ⚠️ g4f failed, using placeholder")
    return _upload_placeholder_to_cloudinary(article_id)


# ─── Parse JSON Response ─────────────────────────────────────


def parse_article_response(text: str) -> tuple[str, str]:
    """Extract articleText and category from JSON response.
    Returns (article_text, category)."""
    clean = text.strip()
    if clean.startswith("```"):
        import re
        clean = re.sub(r"^```(?:json)?\s*\n?", "", clean)
        clean = re.sub(r"\n?```\s*$", "", clean)
    try:
        parsed = json.loads(clean)
        article = parsed.get("articleText", "").strip() if "articleText" in parsed else clean
        category = parsed.get("category", "").strip().lower() if "category" in parsed else ""
        # Validate category is one of the allowed values
        valid_categories = {"ai-tech", "disability", "health", "world", "general"}
        if category not in valid_categories:
            category = ""
        return (article, category)
    except json.JSONDecodeError:
        pass
    return (clean, "")


# ─── Cerebras LLM ────────────────────────────────────────────


def call_cerebras(client: Cerebras, model: str, system_prompt: str, user_prompt: str) -> tuple[str, str]:
    """Call Cerebras API and return (article_text, category)."""
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
        max_tokens=4096,
        response_format={"type": "json_object"},
    )
    raw = (completion.choices[0].message.content or "").strip()
    if not raw:
        raise ValueError("Empty response from Cerebras")
    return parse_article_response(raw)


# ─── Cleanup Old News ────────────────────────────────────────


def cleanup_old_news(db: firestore.Client):
    """
    Cleanup: keep the newest 30 articles, delete any excess.
      - Only deletes articles beyond the 30-article threshold
      - Archives deleted article URLs to 'news_history' for dedup
      - Purges 'news_history' entries older than 10 days
    """
    print("\n🧹 CLEANUP — Checking news collection...")

    MIN_ARTICLES_TO_KEEP = 30  # Always keep at least this many articles

    # ── 1. Delete excess articles beyond MIN_ARTICLES_TO_KEEP ──
    try:
        # Get all news ordered by date ASCENDING (oldest first)
        all_news = list(
            db.collection(COLLECTION)
            .order_by("date", direction=firestore.Query.ASCENDING)
            .stream()
        )
        total = len(all_news)

        if total <= MIN_ARTICLES_TO_KEEP:
            print(f"  ✅ {total} articles (under {MIN_ARTICLES_TO_KEEP} limit) — no cleanup needed")
        else:
            # Only delete the EXCESS beyond the threshold
            excess = total - MIN_ARTICLES_TO_KEEP
            to_delete = all_news[:excess]
            batch = db.batch()
            count = 0

            for doc_snap in to_delete:
                data = doc_snap.to_dict()

                # ── Archive to news_history BEFORE deleting ──
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
                        print(f"  ⚠️ History archive failed for '{title[:40]}': {he}")

                batch.delete(doc_snap.reference)
                count += 1
                # Firestore batch limit is 500
                if count % 400 == 0:
                    batch.commit()
                    batch = db.batch()
            if count % 400 != 0:
                batch.commit()
            print(f"  🗑️ Deleted {count} excess articles (had {total}, keeping {MIN_ARTICLES_TO_KEEP})")


    except Exception as e:
        print(f"  ⚠️ News cleanup failed: {e}")

    # ── 2. Purge history older than 10 days ──────────────────
    # After 10 days, dedup entries are no longer needed
    try:
        cutoff = datetime.now(timezone.utc).isoformat()
        # Calculate cutoff: 10 days ago
        from datetime import timedelta
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
            print(f"  🗑️ Purged {count} history entries older than {HISTORY_TTL_DAYS} days")
        else:
            print(f"  ✅ No history entries older than {HISTORY_TTL_DAYS} days")
    except Exception as e:
        print(f"  ⚠️ History cleanup failed: {e}")

    print("🧹 Cleanup complete\n")


# ─── Main Pipeline ───────────────────────────────────────────


def generate_news():
    t0 = time.time()
    print("⚡ NEWS PIPELINE (GitHub Actions) — Cerebras + Tavily + g4f + Cloudinary")

    # Init services
    db = init_firebase()
    init_cloudinary()

    # NOTE: Cleanup is now a separate daily cron job (news_cleanup.yml)
    # Runs once at 12:15 AM IST — keeps 50 articles, deletes excess

    cerebras_key = os.environ.get("CEREBRAS_API_KEY")
    if not cerebras_key:
        raise RuntimeError("CEREBRAS_API_KEY not set")
    cerebras_client = Cerebras(api_key=cerebras_key)

    # 1. Generate dynamic search query
    search_query = random.choice(SEARCH_QUERIES)
    print(f"📰 Generated dynamic query: {search_query}")

    # 2. Detect category from query
    category = detect_category(search_query)
    topic = extract_topic(search_query)
    print(f"📌 Category: {category.upper()}, Topic: \"{topic}\"")

    # 3. Load URL history + existing titles for LLM dedup + Run Tavily search
    known_urls = load_history_urls(db)
    existing_titles = load_existing_titles(db)
    initial_result = search_tavily(search_query, 7)

    # 4. Filter by URL history
    scraped_data = initial_result["results"]
    used_query = search_query
    total_filtered = 0

    fresh_results, filtered_count = filter_by_url_history(scraped_data, known_urls)
    scraped_data = fresh_results
    total_filtered = filtered_count

    total_text = sum(len(f"{r.get('title','')} {r.get('description','')}") for r in scraped_data)

    if not scraped_data or total_text < 50:
        # Fallback 1: broader query, 3 days
        fallback_query = random.choice(FALLBACK_QUERIES)
        print(f"⚠️ Primary search weak. Trying fallback: \"{fallback_query}\"")
        fallback_result = search_tavily(fallback_query, 7)
        fallback_fresh, fb_filtered = filter_by_url_history(fallback_result["results"], known_urls)
        if fallback_fresh:
            scraped_data = fallback_fresh
            total_filtered += fb_filtered
            used_query = fallback_query
            print(f"✅ Fallback search succeeded: {len(scraped_data)} fresh results")
        else:
            # Fallback 2: even broader, 7 days
            print("⚠️ 3-day fallback empty. Trying 7-day window...")
            wider_result = search_tavily("latest technology AI news", 7)
            wider_fresh, w_filtered = filter_by_url_history(wider_result["results"], known_urls)
            if wider_fresh:
                scraped_data = wider_fresh
                total_filtered += w_filtered
                used_query = "latest technology AI news (7d)"
                print(f"✅ 7-day search succeeded: {len(scraped_data)} fresh results")
            else:
                raise RuntimeError("No fresh search results found after all fallbacks")
    else:
        print(f"✅ Primary search OK: {len(scraped_data)} fresh results, {total_text} chars ({filtered_count} filtered)")

    source_urls = [r.get("url", "") for r in scraped_data if r.get("url")]

    # 5. Cerebras article generation (with LLM dedup)
    system_prompt = (
        'You are a factual tech journalist. Output valid JSON: {"articleText": "...", "category": "..."}. '
        'No other keys, no markdown, no explanation.'
    )

    cerebras_data = [{"title": r["title"], "description": r["description"]} for r in scraped_data]

    # Build dedup context — show LLM what already exists so it doesn't repeat
    dedup_section = ""
    if existing_titles:
        # Show last 30 titles max to save tokens
        recent_titles = existing_titles[-30:]
        titles_list = "\n".join(f"- {t}" for t in recent_titles)
        dedup_section = f"""\n\nALREADY PUBLISHED (DO NOT REPEAT these topics):\n{titles_list}\n\nYou MUST pick a DIFFERENT story from the search results. If all results overlap with published titles, find a unique angle."""

    user_prompt = f"""Write a news summary from the search results below.{dedup_section}

Search results:
{json.dumps(cerebras_data, indent=2)}

STRICT FORMATTING RULES:
1. Word Count: strictly between 100 to 150 words.
2. Structure: Do NOT write paragraphs. Use exactly 3 to 4 bullet points.
3. Bold Starting Keywords (CRITICAL): Each bullet point MUST start with a **Bolded Subject, Entity, or Keyword** (e.g., **Gold**, **Microsoft**, **The global market**), followed immediately by the rest of the sentence in regular text.
4. Tone: Factual, objective, punchy. No fluff, no adjectives, no dramatic words.
5. No Title: Do NOT generate any title or heading. Output ONLY the bullet points.
6. Pick ONE story from the results. Do NOT mix topics.
7. No dates, no "breaking news" labels, no system details.
8. Use SIMPLE, CLEAR language anyone can understand.
9. YOU MUST decide the category. Pick ONE from: ai-tech, disability, health, world, general
   - ai-tech: AI, technology, open source AI, startups, chips, coding, Anthropic, OpenAI, etc.
   - disability: assistive tech, blind, deaf, wheelchair, accessibility, visually impaired, inclusion
   - health: healthcare, medical, mental health, wellness, disease, treatment
   - world: geopolitics, regulation, policy, climate, environment, international trade
   - general: business, earnings, crypto, entertainment, gaming, social media, anything else

Return JSON: {{ "articleText": "your bullet points", "category": "one-of-the-five" }}"""

    MODELS = ["gpt-oss-120b", "llama3.1-8b"]
    article_text = ""
    used_model = ""

    for model_name in MODELS:
        try:
            print(f"🔄 Trying Cerebras model: {model_name}")
            article_text, ai_category = call_cerebras(cerebras_client, model_name, system_prompt, user_prompt)
            used_model = model_name

            if ai_category:
                print(f"🤖 AI picked category: {ai_category}")

            word_count = len(article_text.split())
            print(f"📝 First attempt: {word_count} words")

            # Auto-retry if too short
            if word_count < 80:
                print(f"⚠️ Too short ({word_count} words), retrying...")
                retry_prompt = f"""{user_prompt}

CRITICAL CORRECTION: Your previous attempt was ONLY {word_count} words. UNACCEPTABLE.
You MUST write between 100 to 150 words using 3-4 bullet points.
Each bullet MUST start with **Bold Keyword**. ADD more factual details."""

                try:
                    retry_text, retry_cat = call_cerebras(cerebras_client, model_name, system_prompt, retry_prompt)
                    retry_wc = len(retry_text.split())
                    print(f"📝 Retry: {retry_wc} words")
                    if retry_wc > word_count:
                        article_text = retry_text
                        if retry_cat:
                            ai_category = retry_cat
                        print(f"✅ Retry accepted: {retry_wc} words")
                except Exception:
                    print("⚠️ Retry failed, keeping first attempt")

            print(f"✅ Success with: {model_name}")
            break
        except Exception as e:
            print(f"⚠️ {model_name} failed: {str(e)[:200]}")
            article_text = ""

    if not article_text:
        raise RuntimeError("All Cerebras models failed for article generation")

    word_count = len(article_text.split())
    print(f"📝 Article ({used_model}): {word_count} words")

    # 6. Generate image prompt (concise, photorealistic editorial style)
    image_prompt = ""
    try:
        img_completion = cerebras_client.chat.completions.create(
            model="llama3.1-8b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert editorial photo director. Write highly detailed, photorealistic image descriptions for news articles. "
                        "Your descriptions MUST match the article topic exactly. "
                        "Include: specific scene/setting, key objects, background elements, lighting conditions, color palette, mood/atmosphere, camera angle. "
                        "Output ONLY the description. Never include text, words, logos, watermarks, or UI elements in the image."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Write an 80-120 word photorealistic editorial photo description that matches this news article.\n\n"
                        f"Title: {title or 'Technology news'}\n"
                        f"Article: {article_text[:500]}\n\n"
                        f"Requirements:\n"
                        f"- Shot on Canon EOS R5, 35mm lens, natural lighting\n"
                        f"- Cinematic 16:9 composition, shallow depth-of-field\n"
                        f"- Describe specific real-world objects, people, or places relevant to the story\n"
                        f"- Specify exact background color tones (warm amber, cool blue, neutral gray, etc.)\n"
                        f"- Include mood: urgent, hopeful, professional, dramatic, calm, etc.\n"
                        f"- NO neon glow, NO futuristic effects, NO text overlays, NO abstract shapes\n"
                        f"- Make it look like a real Reuters/AP news photograph"
                    ),
                },
            ],
            temperature=0.7,
            max_tokens=200,
        )
        image_prompt = (img_completion.choices[0].message.content or "").strip()
        if image_prompt.startswith('"') and image_prompt.endswith('"'):
            image_prompt = image_prompt[1:-1]
        print(f'🎨 Image prompt ({len(image_prompt.split())} words): "{image_prompt[:120]}..."')
    except Exception as e:
        print(f"⚠️ Image prompt generation failed: {e}")
        image_prompt = (
            "Editorial photograph of modern technology workspace, golden-hour light, "
            "minimalist desk with monitors, shallow depth-of-field, Canon EOS R5, "
            "natural color palette, cinematic 16:9"
        )

    # 7. Generate professional headline via LLM
    title = ""
    try:
        title_completion = cerebras_client.chat.completions.create(
            model="llama3.1-8b",
            messages=[
                {
                    "role": "system",
                    "content": "Write one professional news headline. Output ONLY the headline. No quotes, no labels, no colons.",
                },
                {
                    "role": "user",
                    "content": (
                        f"Write ONE headline for this article. 8-14 words, Title Case. "
                        f"Start with WHO/WHAT. Use active verb. "
                        f"NO prefixes like 'Breaking:', 'AI News:', 'Tech:'. NO colons. "
                        f"Be specific — mention names/products/numbers.\n\n"
                        f"Article: {article_text[:400]}"
                    ),
                },
            ],
            temperature=0.4,
            max_tokens=40,
        )
        raw_title = (title_completion.choices[0].message.content or "").strip()
        # Clean up: remove quotes, prefix patterns, colons
        import re as _re
        raw_title = raw_title.strip('"\'')
        # Strip ALL common prefix labels the LLM might add
        raw_title = _re.sub(
            r'^(Breaking\s*News|Breaking|BREAKING|Update|Report|News|Spotlight|Alert|'
            r'Headline|Tech|AI|Analysis|Exclusive|Latest|Just\s*In|Flash|Urgent|'
            r'Development|Watch)[:\s—–-]+',
            '', raw_title, flags=_re.IGNORECASE
        )
        raw_title = _re.sub(r'^[:\s—–-]+', '', raw_title).strip()
        if raw_title and len(raw_title.split()) >= 4:
            title = raw_title
            print(f"📰 LLM Title: \"{title}\"")
    except Exception as e:
        print(f"⚠️ LLM title generation failed: {e}")

    # Fallback: extract meaningful title from article's first sentence
    if not title:
        import re as _re
        first_sentence = _re.split(r'[.!?]', article_text)[0].strip()
        if len(first_sentence) > 15 and len(first_sentence) < 120:
            title = first_sentence
        else:
            title = "New Developments in AI and Technology"
        print(f"📰 Fallback title: \"{title}\"")

    # 8. Use AI-picked category (primary), fallback to keyword detection
    if ai_category:
        if ai_category != category:
            print(f"📌 AI category: {ai_category} (keyword was: {category})")
        category = ai_category
    else:
        # Fallback: re-validate with keyword detection
        refined_category = detect_category(search_query, title, article_text)
        if refined_category != category:
            print(f"📌 Category refined: {category} → {refined_category} (keyword fallback)")
            category = refined_category

    # 9. Generate image via g4f + upload to Cloudinary
    article_id = str(uuid.uuid4())
    image_url = generate_and_upload_image(image_prompt, article_id)

    # 10. Save to Firestore

    news_item = {
        "id": article_id,
        "title": title,
        "summary": article_text,
        "image_url": image_url,
        "source_link": None,
        "source_name": "XeL AI News",
        "category": category,
        "date": datetime.now(timezone.utc).isoformat(),
    }

    db.collection(COLLECTION).document(article_id).set(news_item)
    save_to_history(db, title, article_text, source_urls)

    duration = int((time.time() - t0) * 1000)
    print(f'✅ Saved: "{title}" in {duration}ms')

    # 10. Log health
    log_health(db, "✅ Success", {
        "last_news_title": title,
        "category": category,
        "word_count": str(word_count),
        "image_prompt": image_prompt[:100],
        "has_image": "yes" if image_url else "no",
        "image_source": "cloudinary" if "cloudinary" in image_url else "placeholder",
        "search_query": used_query,
        "search_results": str(len(scraped_data)),
        "duration_ms": str(duration),
    })

    print(f"\n{'='*60}")
    print(f"✅ Pipeline complete!")
    print(f"   Title:    {title}")
    print(f"   Category: {category}")
    print(f"   Words:    {word_count}")
    print(f"   Image:    {'Cloudinary' if 'cloudinary' in image_url else 'Placeholder'}")
    print(f"   Duration: {duration}ms")
    print(f"{'='*60}")

    return news_item


# ─── Entry Point ─────────────────────────────────────────────

if __name__ == "__main__":
    try:
        result = generate_news()
        print(f"\n📄 Result: {json.dumps({'title': result['title'], 'category': result['category']}, indent=2)}")
    except Exception as e:
        print(f"\n❌ Pipeline failed: {e}")
        # Try to log failure to Firestore
        try:
            db = init_firebase()
            log_health(db, "❌ Failed", {"error_message": str(e), "runner": "github-actions"})
        except Exception:
            pass
        sys.exit(1)
