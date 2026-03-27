#!/usr/bin/env python3
"""
News Pipeline Worker — GitHub Actions Background Runner
========================================================
Pipeline: Dynamic Query → Tavily Search → URL Dedup →
          Cerebras (Qwen 235B / llama3.1-8b) → FLUX.1-dev Image Gen →
          Cloudinary Upload → Firestore Save → History Update

Ported from: app/api/cron/generate-news/route.ts (v17)
"""

import json
import os
import random
from duckduckgo_search import DDGS
import re
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
# HISTORY_COLLECTION removed — history now stored in scripts/news_history.json
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

QUERY_BUCKETS = {
    # ── AI & Tech (core) ──
    "ai-tech": [
        "artificial intelligence latest breakthroughs announcements",
        "OpenAI GPT new model release announcements",
        "Google DeepMind Gemini AI research news",
        "Anthropic Claude AI safety research news",
        "Meta AI Llama open source model news",
        "generative AI tools products launches today",
        "AI startup funding acquisition deals news",
        "AI regulation policy government updates",
        "Nvidia AMD AI chip semiconductor hardware news",
        "quantum computing breakthrough research news",
        "robotics automation humanoid robot news",
        "AI coding programming developer tools news",
        "AI image video generation model news",
        "cloud computing AI infrastructure updates",
    ],

    # ── Open Source AI ──
    "open-source": [
        "open source AI models community development news",
        "Hugging Face open source AI tools models news",
        "Mistral AI open source language model news",
        "open source large language model release news",
        "Linux open source software community news",
        "open source AI framework PyTorch TensorFlow news",
    ],

    # ── Disability & Accessibility ──
    "disability": [
        "disability technology assistive tech accessibility news",
        "AI assistive technology disability inclusion news",
        "accessible technology innovations disabled people news",
        "visually impaired blind students assistive technology news",
        "screen reader accessibility blind people technology news",
        "deaf hearing impaired technology accessibility news",
        "wheelchair disability mobility technology innovation news",
        "autism neurodiversity technology support news",
    ],

    # ── Health ──
    "health": [
        "healthcare technology innovation AI medical news",
        "mental health digital wellness technology news",
        "AI healthcare diagnosis treatment breakthrough news",
        "medical technology health research discovery news",
        "telemedicine digital health innovation news",
        "drug discovery AI pharmaceutical research news",
    ],

    # ── Climate & Natural Disasters ──
    "climate": [
        "climate change global warming research news today",
        "climate technology clean energy innovation news",
        "earthquake volcano natural disaster news today",
        "extreme weather flooding hurricane disaster news",
        "renewable energy solar wind power news",
        "climate policy carbon emissions sustainability news",
        "wildlife conservation biodiversity environmental news",
    ],

    # ── World Affairs ──
    "world": [
        "geopolitical technology competition world news",
        "international trade technology policy news",
        "digital privacy surveillance regulation world news",
        "global economy recession inflation news today",
        "war conflict peace diplomatic negotiations news",
        "election democracy political news today",
        "refugee migration humanitarian crisis news",
    ],

    # ── General / Business / Science ──
    "general": [
        "tech CEO statements leadership announcements news",
        "tech company earnings big tech stock news",
        "Apple Google Microsoft major tech announcements",
        "cryptocurrency blockchain Web3 news",
        "social media platform changes updates news",
        "science discovery research breakthrough news",
        "space technology SpaceX NASA launch news",
        "gaming esports streaming industry news",
    ],

    # ── Sports & Achievements ──
    "sports": [
        "sports achievement world record breaking news today",
        "incredible sports moments historic victory news",
        "Olympic athlete achievement gold medal news",
        "football soccer basketball cricket incredible play news",
        "tennis golf boxing MMA UFC championship news",
        "sports technology innovation performance analytics news",
        "marathon running athletics track field record news",
        "esports competitive gaming tournament championship news",
    ],
}

# Rotation order — ensures each category gets coverage across the day
# 48 runs/day (every 30 min) spread across 8 categories
ROTATION_ORDER = [
    "ai-tech", "sports", "disability", "climate",
    "open-source", "health", "world", "general",
    "ai-tech", "sports", "open-source", "disability",
    "ai-tech", "climate", "world", "health",
    "general", "sports", "ai-tech", "disability",
    "open-source", "climate", "health", "ai-tech",
    "world", "sports", "general", "disability",
    "climate", "open-source", "health", "ai-tech",
    "world", "sports", "general", "disability",
    "climate", "open-source", "health", "ai-tech",
    "world", "general", "sports", "disability",
    "ai-tech", "climate", "open-source", "health",
]


def pick_search_query() -> tuple[str, str]:
    """Pick a search query based on time-of-day rotation.
    Returns (query, category_key)."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    # Slot index: each 30-min slot gets a category
    slot = (now.hour * 2 + (1 if now.minute >= 30 else 0)) % len(ROTATION_ORDER)
    category_key = ROTATION_ORDER[slot]
    queries = QUERY_BUCKETS[category_key]
    query = random.choice(queries)
    return query, category_key


def pick_fallback_queries(exclude_category: str) -> list[tuple[str, str]]:
    """Pick queries from OTHER categories for fallback."""
    fallbacks = []
    other_keys = [k for k in QUERY_BUCKETS if k != exclude_category]
    random.shuffle(other_keys)
    for key in other_keys[:3]:  # Try 3 different categories
        q = random.choice(QUERY_BUCKETS[key])
        fallbacks.append((q, key))
    return fallbacks

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
            "social media", "streaming", "movie",
            "music", "tiktok", "youtube", "netflix", "spotify",
        ]),
        ("sports", [
            "sport", "athlete", "championship", "olympic", "medal", "tournament",
            "football", "soccer", "basketball", "cricket", "tennis", "golf",
            "boxing", "mma", "ufc", "marathon", "athletics", "track and field",
            "world record", "league", "playoff", "super bowl", "world cup",
            "esport", "gaming tournament", "victory", "trophy", "championship",
            "grand slam", "premier league", "nba", "nfl", "mlb", "fifa",
            "ipl", "f1", "formula 1", "race", "wrestling", "gymnast",
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
                    "search_depth": "basic",
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
            error_details = ""
            if hasattr(e, "response") and hasattr(e.response, "text"):
                error_details = f" Details: {e.response.text}"
            print(f"⚠️ Tavily ({label}) failed: {e}{error_details}")
            if i < len(keys) - 1:
                print("🔄 Switching to fallback Tavily API key...")

    print("⚠️ All Tavily keys exhausted — falling back to DuckDuckGo Search...")
    try:
        ddgs = DDGS()
        results = [r for r in ddgs.text(query + " news", max_results=TAVILY_RESULT_COUNT)]
        if results:
            mapped = [
                {"title": r.get("title", ""), "description": r.get("body", r.get("abstract", "")), "url": r.get("href", "")}
                for r in results
            ]
            context = "\n\n".join(
                f"[{j+1}] {r['title']}\n{r['description']}" for j, r in enumerate(mapped)
            )
            print(f'🔍 DuckDuckGo: {len(mapped)} results for "{query}"')
            return {"context": context, "results": mapped}
        else:
            print("⚠️ DuckDuckGo returned no results.")
    except Exception as e:
        print(f"⚠️ DuckDuckGo failed: {e}")

    print("❌ All search methods failed.")
    return {"context": "", "results": []}


# ─── JSON-Based History & Dedup (ZERO Firestore reads) ───────
# History stored in scripts/news_history.json (Git-tracked)
# Format: {"entries": [{"title": ..., "urls": [...], "date": ...}, ...], "lastUpdated": ...}

HISTORY_JSON_PATH = os.path.join(os.path.dirname(__file__), "news_history.json")


def _load_history_json() -> dict:
    """Load the JSON history file. Returns {entries: [], lastUpdated: ''}."""
    try:
        if os.path.exists(HISTORY_JSON_PATH):
            with open(HISTORY_JSON_PATH, "r") as f:
                data = json.load(f)
            if isinstance(data, dict) and "entries" in data:
                return data
    except Exception as e:
        print(f"⚠️ History JSON read error: {e}")
    return {"entries": [], "lastUpdated": ""}


def _save_history_json(data: dict):
    """Save the JSON history file."""
    try:
        data["lastUpdated"] = datetime.now(timezone.utc).isoformat()
        with open(HISTORY_JSON_PATH, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"⚠️ History JSON write error: {e}")


def _purge_old_entries(data: dict, max_days: int = 10) -> dict:
    """Remove entries older than max_days from history."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_days)).isoformat()
    before = len(data["entries"])
    data["entries"] = [e for e in data["entries"] if e.get("date", "") >= cutoff]
    purged = before - len(data["entries"])
    if purged > 0:
        print(f"🧹 Purged {purged} history entries older than {max_days} days")
    return data


def _git_push_history():
    """Commit and push the history JSON file."""
    try:
        import subprocess
        repo_dir = os.path.dirname(os.path.dirname(__file__))
        subprocess.run(
            ["git", "add", HISTORY_JSON_PATH],
            cwd=repo_dir, capture_output=True, timeout=15
        )
        subprocess.run(
            ["git", "commit", "-m", "auto: update news history JSON", "--no-verify"],
            cwd=repo_dir, capture_output=True, timeout=15
        )
        result = subprocess.run(
            ["git", "push", "origin", "main"],
            cwd=repo_dir, capture_output=True, timeout=30
        )
        if result.returncode == 0:
            print("📤 History JSON pushed to GitHub")
        else:
            print(f"⚠️ Git push: {result.stderr.decode()[:100]}")
    except Exception as e:
        print(f"⚠️ Git push failed (non-critical): {str(e)[:100]}")


def load_history_urls(db=None) -> set[str]:
    """Load all known URLs from the JSON history file.
    ZERO Firestore reads — completely local."""
    history = _load_history_json()
    urls = set()
    for entry in history.get("entries", []):
        for u in entry.get("urls", []):
            urls.add(normalize_url(u))
    print(f"📚 History loaded: {len(urls)} known URLs from {len(history['entries'])} entries (JSON file)")
    return urls


def load_existing_titles(db=None) -> list[str]:
    """Load all known titles for dedup.
    Strategy: Read from Firestore DB, also sync titles into JSON for backup.
    Firestore has all published articles. JSON is a local cache/backup."""
    titles = []

    # Primary: Read from Firestore (the actual database with all articles)
    if db:
        try:
            docs = list(db.collection(COLLECTION).limit(50).stream())
            for doc in docs:
                data = doc.to_dict()
                t = data.get("title", "")
                if t:
                    titles.append(t)
            if titles:
                print(f"📋 Dedup: loaded {len(titles)} titles from Firestore DB")
                # Sync to JSON so the file isn't empty anymore
                try:
                    history = _load_history_json()
                    existing_json_titles = {e.get("title", "") for e in history.get("entries", [])}
                    new_count = 0
                    for t in titles:
                        if t and t not in existing_json_titles:
                            history["entries"].append({
                                "title": t,
                                "urls": [],
                                "date": datetime.now(timezone.utc).isoformat(),
                            })
                            new_count += 1
                    if new_count > 0:
                        history = _purge_old_entries(history)
                        _save_history_json(history)
                        print(f"📥 Synced {new_count} titles from Firestore → JSON cache")
                except Exception as sync_err:
                    print(f"⚠️ JSON sync failed (non-critical): {sync_err}")
                return titles
        except Exception as e:
            print(f"⚠️ Firestore title read failed: {e}")

    # Fallback: Read from JSON file
    history = _load_history_json()
    titles = [e.get("title", "") for e in history.get("entries", []) if e.get("title")]
    print(f"📋 Dedup: loaded {len(titles)} existing titles (JSON fallback)")
    return titles


def filter_by_url_history(results: list[dict], known_urls: set[str]) -> tuple[list[dict], int]:
    """Filter Tavily results — remove any whose URL matches history."""
    fresh = [r for r in results if normalize_url(r.get("url", "")) not in known_urls]
    filtered = len(results) - len(fresh)
    if filtered > 0:
        print(f"🔗 URL filter: {filtered} already-used URLs removed, {len(fresh)} fresh results remain")
    return fresh, filtered


def save_to_history(db=None, title: str = "", content: str = "", source_urls: list[str] = None):
    """Save article metadata + source URLs to the JSON history file."""
    if source_urls is None:
        source_urls = []
    try:
        history = _load_history_json()
        normalized = [normalize_url(u) for u in source_urls]
        history["entries"].append({
            "title": title,
            "urls": normalized,
            "date": datetime.now(timezone.utc).isoformat(),
        })
        # Purge old entries (>10 days)
        history = _purge_old_entries(history)
        _save_history_json(history)
        print(f'📚 History saved: "{title[:50]}" with {len(normalized)} URLs (JSON file)')
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

    print(f"\n{'─'*50}")
    print("🖼️ IMAGE PIPELINE (g4f → Placeholder)")
    print(f"   Article ID: {article_id}")
    print(f"{'─'*50}")

    # Sanitize prompt
    clean_prompt = re.sub(r"[^\w\s,.\-!?']", "", prompt)
    clean_prompt = re.sub(r"\s+", " ", clean_prompt).strip()
    if len(clean_prompt) > 300:
        clean_prompt = clean_prompt[:300].rsplit(" ", 1)[0]

    enhanced_prompt = clean_prompt
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
        clean = re.sub(r"^```(?:json)?\s*\n?", "", clean)
        clean = re.sub(r"\n?```\s*$", "", clean)
    try:
        parsed = json.loads(clean)
        article = parsed.get("articleText", "").strip() if "articleText" in parsed else clean
        category = parsed.get("category", "").strip().lower() if "category" in parsed else ""
        # Validate category is one of the allowed values
        valid_categories = {"ai-tech", "disability", "health", "world", "general", "sports"}
        if category not in valid_categories:
            category = ""
        # Strip any remaining JSON artifacts from article text
        article = re.sub(r'^\s*\{\s*"articleText"\s*:\s*"', '', article)
        article = re.sub(r'"\s*,\s*"category"\s*:\s*"[^"]*"\s*\}\s*$', '', article)
        article = article.replace('\\n', '\n').replace('\\"', '"')
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
    Cleanup: keep the newest 50 articles in Firestore, delete excess.
    Archives deleted article URLs to JSON history file (not Firestore).
    No Firestore reads for history — all dedup via JSON file.
    """
    print("\n🧹 CLEANUP — Checking news collection...")

    MIN_ARTICLES_TO_KEEP = 50

    # ── 1. Delete excess articles from Firestore ──
    try:
        all_news = list(
            db.collection(COLLECTION)
            .order_by("date", direction=firestore.Query.ASCENDING)
            .stream()
        )
        total = len(all_news)

        if total <= MIN_ARTICLES_TO_KEEP:
            print(f"  ✅ {total} articles (under {MIN_ARTICLES_TO_KEEP} limit) — no cleanup needed")
        else:
            excess = total - MIN_ARTICLES_TO_KEEP
            to_delete = all_news[:excess]
            batch = db.batch()
            count = 0

            # Load JSON history to archive deleted articles
            history = _load_history_json()

            for doc_snap in to_delete:
                data = doc_snap.to_dict()

                # Archive to JSON history (not Firestore)
                source_urls = data.get("sourceUrls", [])
                title = data.get("title", "")
                if source_urls or title:
                    history["entries"].append({
                        "title": title,
                        "urls": [normalize_url(u) for u in source_urls] if source_urls else [],
                        "date": datetime.now(timezone.utc).isoformat(),
                    })

                batch.delete(doc_snap.reference)
                count += 1
                if count % 400 == 0:
                    batch.commit()
                    batch = db.batch()
            if count % 400 != 0:
                batch.commit()

            # Save updated JSON history
            history = _purge_old_entries(history)
            _save_history_json(history)
            print(f"  🗑️ Deleted {count} excess articles (had {total}, keeping {MIN_ARTICLES_TO_KEEP})")

    except Exception as e:
        print(f"  ⚠️ News cleanup failed: {e}")

    # ── 2. Purge old JSON history entries ──
    try:
        history = _load_history_json()
        before_count = len(history["entries"])
        history = _purge_old_entries(history, max_days=HISTORY_TTL_DAYS)
        after_count = len(history["entries"])
        _save_history_json(history)
        purged = before_count - after_count
        if purged > 0:
            print(f"  🗑️ Purged {purged} history entries older than {HISTORY_TTL_DAYS} days")
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

    # 1. Pick search query via time-based rotation
    search_query, query_category = pick_search_query()
    print(f"📰 Query [{query_category}]: {search_query}")

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
        # Fallback: try queries from OTHER categories (up to 3)
        fallback_queries = pick_fallback_queries(query_category)
        found_fallback = False
        for fb_query, fb_cat in fallback_queries:
            print(f"⚠️ Primary search weak. Trying [{fb_cat}]: \"{fb_query}\"")
            fb_result = search_tavily(fb_query, 7)
            fb_fresh, fb_filtered = filter_by_url_history(fb_result["results"], known_urls)
            if fb_fresh and sum(len(f"{r.get('title','')} {r.get('description','')}") for r in fb_fresh) >= 50:
                scraped_data = fb_fresh
                total_filtered += fb_filtered
                used_query = fb_query
                category = detect_category(fb_query)
                print(f"✅ Fallback [{fb_cat}] succeeded: {len(scraped_data)} fresh results")
                found_fallback = True
                break
            else:
                print(f"  ⚠️ [{fb_cat}] also empty, trying next...")

        if not found_fallback:
            # Last resort: very broad search
            print("⚠️ All category fallbacks empty. Trying ultra-broad search...")
            broad_result = search_tavily("latest breaking news today", 7)
            broad_fresh, br_filtered = filter_by_url_history(broad_result["results"], known_urls)
            if broad_fresh:
                scraped_data = broad_fresh
                total_filtered += br_filtered
                used_query = "latest breaking news today"
                print(f"✅ Broad search succeeded: {len(scraped_data)} fresh results")
            else:
                raise RuntimeError("No fresh search results found after all fallbacks")
    else:
        print(f"✅ Primary search OK: {len(scraped_data)} fresh results, {total_text} chars ({filtered_count} filtered)")

    source_urls = [r.get("url", "") for r in scraped_data if r.get("url")]

    # 5. Cerebras article generation (with LLM dedup)
    system_prompt = (
        'You are a focused factual journalist. Output valid JSON: {"articleText": "...", "category": "..."}. '
        'Valid categories: ai-tech, disability, health, world, general, sports. '
        'Pick the BEST matching category for the article topic. '
        'Write about ONE SINGLE story in depth. NEVER mix multiple unrelated topics. '
        'No other keys, no markdown, no explanation.'
    )

    cerebras_data = [{"title": r["title"], "description": r["description"]} for r in scraped_data]

    # Build dedup context — show LLM what already exists so it doesn't repeat
    dedup_section = ""
    if existing_titles:
        # Show last 30 titles max to save tokens
        recent_titles = existing_titles[-50:]
        titles_list = "\n".join(f"- {t}" for t in recent_titles)
        dedup_section = f"""\n\nALREADY PUBLISHED (DO NOT REPEAT these topics):\n{titles_list}\n\nYou MUST pick a COMPLETELY DIFFERENT story. Even slight rewording of the same topic is NOT allowed. If the search results are all about the same topic as published articles, find a totally different angle or sub-topic."""

    # ===== ENHANCED 3-LAYER DEDUPLICATION =====
    # Layer 1: Normalized title matching (catches exact rewording)
    # Layer 2: N-gram similarity (catches phrase-level overlap like "OpenAI GPT-5.3")
    # Layer 3: Entity extraction (catches same companies/products/people)

    def _normalize_title(t: str) -> str:
        """Normalize a title for comparison: lowercase, strip punctuation, collapse whitespace."""
        t = re.sub(r'[^a-zA-Z0-9\s]', ' ', t.lower())
        t = re.sub(r'\s+', ' ', t).strip()
        return t

    def _get_ngrams(text: str, n: int = 2) -> set:
        """Extract character n-grams and word n-grams from text."""
        words = text.split()
        word_ngrams = set()
        for i in range(len(words) - n + 1):
            word_ngrams.add(' '.join(words[i:i+n]))
        return word_ngrams

    def _extract_entities(text: str) -> set:
        """Extract key entities (company names, product names, proper nouns) without NLP libs."""
        # Known tech/company entities
        known_entities = [
            'openai', 'google', 'microsoft', 'apple', 'meta', 'nvidia', 'tesla', 'amazon',
            'anthropic', 'deepmind', 'cerebras', 'mistral', 'hugging face', 'ibm', 'intel',
            'amd', 'qualcomm', 'samsung', 'spacex', 'nasa', 'who', 'un', 'eu', 'fda',
            'gpt', 'gemini', 'claude', 'llama', 'copilot', 'chatgpt', 'sora', 'dall-e',
            'bitcoin', 'ethereum', 'iphone', 'android', 'linux', 'windows', 'chrome',
        ]
        text_lower = text.lower()
        found = set()
        for entity in known_entities:
            if entity in text_lower:
                found.add(entity)
        # Also extract capitalized multi-word phrases (likely proper nouns)
        for match in re.finditer(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b', text):
            found.add(match.group().lower())
        # Extract version numbers with product (e.g., "GPT-5.3", "iOS 18")
        for match in re.finditer(r'\b([A-Za-z]+[-\s]?\d+(?:\.\d+)?)\b', text):
            found.add(match.group().lower())
        return found

    def _title_words(t: str) -> set:
        """Extract significant words from a title (ignore common words)."""
        stop = {'the','a','an','in','on','at','to','for','of','with','and','or','is','are','was','were',
                'by','from','as','its','that','this','has','have','had','be','been','will','would',
                'it','not','but','their','new','into','than','also','how','what','when','where','who',
                'can','could','may','should','about','up','out','over','after','before','between',
                'says','said','report','reports','news','update','updates','announces','announced',
                'launches','launched','reveals','revealed','unveils','unveiled','releases','released'}
        return {w.lower() for w in re.sub(r'[^a-zA-Z0-9\s]', '', t).split() if len(w) > 2 and w.lower() not in stop}

    def _calculate_similarity(title_a: str, title_b: str) -> float:
        """Calculate multi-layer similarity score between two titles. Returns 0.0 - 1.0."""
        norm_a = _normalize_title(title_a)
        norm_b = _normalize_title(title_b)

        # Layer 1: Exact normalized match
        if norm_a == norm_b:
            return 1.0

        # Layer 2: Word overlap (improved with action-verb stopwords)
        words_a = _title_words(title_a)
        words_b = _title_words(title_b)
        if words_a and words_b:
            word_overlap = len(words_a & words_b) / min(len(words_a), len(words_b))
        else:
            word_overlap = 0.0

        # Layer 3: Bigram overlap (catches phrase-level similarity)
        bigrams_a = _get_ngrams(norm_a, 2)
        bigrams_b = _get_ngrams(norm_b, 2)
        if bigrams_a and bigrams_b:
            bigram_overlap = len(bigrams_a & bigrams_b) / min(len(bigrams_a), len(bigrams_b))
        else:
            bigram_overlap = 0.0

        # Layer 4: Entity overlap (catches same company/product)
        entities_a = _extract_entities(title_a)
        entities_b = _extract_entities(title_b)
        if entities_a and entities_b:
            entity_overlap = len(entities_a & entities_b) / min(len(entities_a), len(entities_b))
        else:
            entity_overlap = 0.0

        # Combined score: weighted average (entities matter most)
        score = (word_overlap * 0.3) + (bigram_overlap * 0.3) + (entity_overlap * 0.4)
        return score

    if existing_titles and scraped_data:
        filtered_scraped = []
        for r in scraped_data:
            r_title = r.get('title', '')
            if not r_title:
                filtered_scraped.append(r)
                continue
            is_dup = False
            best_score = 0.0
            matched_title = ''
            for existing_t in existing_titles:
                sim = _calculate_similarity(r_title, existing_t)
                if sim > best_score:
                    best_score = sim
                    matched_title = existing_t
                if sim >= 0.4:  # 40% combined score = duplicate topic
                    is_dup = True
                    break
            if not is_dup:
                filtered_scraped.append(r)
            else:
                print(f"🔁 Dedup filtered (score={best_score:.2f}): \"{r_title[:60]}\"")
                print(f"   Matched: \"{matched_title[:60]}\"")
        if filtered_scraped:
            scraped_data = filtered_scraped
            cerebras_data = [{"title": r["title"], "description": r["description"]} for r in scraped_data]
            print(f"📋 After enhanced dedup: {len(scraped_data)} unique results remain")
        else:
            print("⚠️ All results matched existing titles — keeping originals for LLM to handle")

    user_prompt = f"""Write a news summary from the search results below.{dedup_section}

Search results:
{json.dumps(cerebras_data, indent=2)}

STRICT FORMATTING RULES:
1. Word Count: strictly between 130 to 170 words. This is CRITICAL.
2. Structure: Do NOT write paragraphs. Use exactly 3 to 4 bullet points. You MUST separate each bullet point with a real newline (`\n`).
3. Bold Starting Keywords (CRITICAL): Each bullet point MUST start with a **Bolded Subject, Entity, or Keyword** (e.g., **Gold**, **Microsoft**, **The global market**), followed immediately by the rest of the sentence in regular text.
4. Tone: Factual, objective, punchy. No fluff, no adjectives, no dramatic words.
5. No Title: Do NOT generate any title or heading. Output ONLY the bullet points.
6. SINGLE TOPIC ONLY: Pick ONE story from the results and go DEEP into it with detail. Do NOT combine, merge, or reference multiple unrelated stories. Every bullet point must be about the SAME story. If you mention a different company or topic in any bullet, you are FAILING.
7. No dates, no "breaking news" labels, no system details.
8. Use SIMPLE, CLEAR language anyone can understand.
9. DEPTH: Give specific numbers, quotes, names, context, and implications. Each bullet should add NEW information, not repeat what was already said.
10. YOU MUST decide the category. Pick ONE from: ai-tech, disability, health, world, general, sports
   - ai-tech: AI, technology, open source AI, startups, chips, coding, Anthropic, OpenAI, etc.
   - disability: assistive tech, blind, deaf, wheelchair, accessibility, visually impaired, inclusion
   - health: healthcare, medical, mental health, wellness, disease, treatment
   - world: geopolitics, regulation, policy, climate, environment, international trade
   - general: business, earnings, crypto, entertainment, social media, anything else
   - sports: sports achievements, athletic records, championships, Olympic, tournaments, incredible sports moments

Return JSON: {{ "articleText": "your bullet points", "category": "one-of-the-six" }}"""

    MODELS = ["qwen-3-235b-a22b-instruct-2507"]
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
            if word_count < 120:
                print(f"⚠️ Too short ({word_count} words), retrying...")
                retry_prompt = f"""{user_prompt}

CRITICAL CORRECTION: Your previous attempt was ONLY {word_count} words. UNACCEPTABLE.
You MUST write between 130 to 170 words using 3-4 bullet points. Each bullet MUST be separated by a newline (`\n`).
Each bullet MUST start with **Bold Keyword**. ADD more factual details, specific numbers, names, and context.
STAY on the SAME SINGLE topic — do NOT add unrelated stories to fill space."""

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

    # 6. Generate professional headline via LLM (MUST come before image prompt)
    title = ""
    try:
        title_completion = cerebras_client.chat.completions.create(
            model="qwen-3-235b-a22b-instruct-2507",
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
        raw_title = raw_title.strip('"\'')
        raw_title = re.sub(
            r'^(Breaking\s*News|Breaking|BREAKING|Update|Report|News|Spotlight|Alert|'
            r'Headline|Tech|AI|Analysis|Exclusive|Latest|Just\s*In|Flash|Urgent|'
            r'Development|Watch)[:\s—–-]+',
            '', raw_title, flags=re.IGNORECASE
        )
        raw_title = re.sub(r'^[:\s—–-]+', '', raw_title).strip()
        if raw_title and len(raw_title.split()) >= 4:
            title = raw_title
            print(f"📰 LLM Title: \"{title}\"")
    except Exception as e:
        print(f"⚠️ LLM title generation failed: {e}")

    # Use article first sentence as fallback title
    if not title:
        fallback = article_text.replace("**", "").replace("- ", "").strip()
        sentences = fallback.split(".")
        title = (sentences[0].strip() + ".") if sentences else "AI Technology News Update"
        title = title[:100]
        print(f"📰 Fallback title: \"{title}\"")

    # POST-GENERATION DEDUP: Final safety net — check if generated title is too similar to existing
    if title and existing_titles:
        best_sim = 0.0
        best_match = ""
        for existing_t in existing_titles:
            sim = _calculate_similarity(title, existing_t)
            if sim > best_sim:
                best_sim = sim
                best_match = existing_t
        if best_sim >= 0.5:
            print(f"⚠️ POST-DEDUP WARNING: Generated title is {best_sim:.0%} similar to existing!")
            print(f"   Generated: \"{title[:60]}\"")
            print(f"   Existing:  \"{best_match[:60]}\"")
            print(f"   ⚠️ This article may be a duplicate — but publishing since it passed other checks")

    # 7. Intelligent adaptive image prompt — LLM auto-detects topic, adapts style
    image_prompt = ""

    detected_cat = (ai_category or category or "general").lower().strip()
    print(f"🎨 Category: {detected_cat}")

    # Quality suffix — universal, no style bias
    QUALITY_BOOST = (
        "cinematic composition, high resolution, sharp focus, "
        "professional color grading, no text no words no letters no watermarks"
    )

    try:
        img_completion = cerebras_client.chat.completions.create(
            model="qwen-3-235b-a22b-instruct-2507",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an elite creative director at a premium news publication. "
                        "Your job: read a news article and craft a unique image prompt that an AI image generator will use.\n\n"
                        "YOUR CREATIVE PROCESS (follow this exactly):\n"
                        "Step 1 — ANALYZE THE TOPIC: What is this article specifically about? "
                        "Identify the core subject (a person? a company? a policy? a product? a scientific discovery? a crisis?).\n"
                        "Step 2 — CHOOSE THE RIGHT VISUAL APPROACH for THIS topic:\n"
                        "  • Company/product news → show the actual product, logo context, or corporate setting\n"
                        "  • Policy/regulation → show lawmakers, courtrooms, documents, government buildings\n"
                        "  • Scientific breakthrough → show the actual research: labs, microscopes, experiments, nature\n"
                        "  • Cybersecurity/hacking → show real-world consequences: worried people, screens with alerts, offices\n"
                        "  • AI/ML research → show researchers at whiteboards, code on screens, university settings\n"
                        "  • Hardware/chips → show actual hardware: close-up chips, manufacturing, clean rooms\n"
                        "  • Public health → show real patients, doctors, hospitals, communities\n"
                        "  • Climate/environment → show landscapes, weather events, wildlife, ecosystems\n"
                        "  • Business/finance → show boardrooms, trading floors, cityscapes, handshakes\n"
                        "  • If the topic doesn't fit any above, imagine you're sending a photographer — where would you send them?\n"
                        "Step 3 — CHOOSE A UNIQUE COLOR PALETTE that matches the article's emotional tone:\n"
                        "  • Hopeful/positive → warm golds, soft greens, morning light\n"
                        "  • Urgent/crisis → stark contrasts, reds, dramatic shadows\n"
                        "  • Corporate/formal → clean whites, steel blues, neutral tones\n"
                        "  • Innovation/discovery → bright whites, clean teals, lab lighting\n"
                        "  • Human interest → warm skin tones, natural daylight, intimate bokeh\n"
                        "  • Each article gets a DIFFERENT palette — never repeat the same colors\n"
                        "Step 4 — CHOOSE PHOTOGRAPHY STYLE based on subject matter:\n"
                        "  • Editorial portrait, photojournalism, macro product shot, aerial landscape, "
                        "documentary candid, scientific visualization, architectural photography, street photography\n\n"
                        "ABSOLUTE BANS (NEVER use these — they make all images look the same):\n"
                        "❌ People sitting at computers or desks (this is the #1 problem — NEVER default to this)\n"
                        "❌ Rows of people working at computer screens in an office\n"
                        "❌ Generic glowing server rooms with blue/purple neon lights\n"
                        "❌ Humanoid robots standing in corridors\n"
                        "❌ Abstract floating holographic interfaces\n"
                        "❌ Dark cyberpunk backgrounds with neon circuits\n"
                        "❌ People in lab coats looking at screens\n"
                        "❌ Generic 'futuristic' 3D renders\n\n"
                        "PREFER INSTEAD: Show the OBJECT of the news (the product, the building, the chip, the landscape, "
                        "the handshake, the document, the chart) rather than generic people at desks.\n\n"
                        "OUTPUT: 25-40 words. One vivid paragraph describing the scene. No labels, no explanations."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Create a unique image prompt for this article:\n\n"
                        f"HEADLINE: {title}\n"
                        f"CATEGORY: {detected_cat}\n"
                        f"ARTICLE: {article_text[:500]}"
                    ),
                },
            ],
            temperature=0.95,
            max_tokens=80,
        )
        raw_prompt = (img_completion.choices[0].message.content or "").strip()
        if raw_prompt.startswith('"') and raw_prompt.endswith('"'):
            raw_prompt = raw_prompt[1:-1]
        # Strip any labels the LLM might add
        raw_prompt = re.sub(r'^(Optimized\s+)?Cinematic\s+Prompt:\s*', '', raw_prompt, flags=re.IGNORECASE).strip()
        raw_prompt = re.sub(r'^\*\*.*?\*\*\s*', '', raw_prompt).strip()
        raw_prompt = re.sub(r'^(Image\s+)?Prompt:\s*', '', raw_prompt, flags=re.IGNORECASE).strip()
        # Append quality boosters
        image_prompt = f"{raw_prompt}, {QUALITY_BOOST}"
        print(f'🎨 Prompt ({len(image_prompt.split())} words): "{image_prompt[:150]}..."')
    except Exception as e:
        print(f"⚠️ Image prompt generation failed: {e}")
        # Fallback: simple title-based prompt
        image_prompt = f"{title}, editorial news photography, natural lighting, {QUALITY_BOOST}"
        print(f'🎨 Fallback prompt: "{image_prompt[:120]}..."')


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
    #    BULLETPROOF: image failure must NEVER crash the pipeline
    article_id = str(uuid.uuid4())
    try:
        import signal
        IMAGE_TIMEOUT = 180  # 3 minutes max for entire image step

        def _image_timeout_handler(signum, frame):
            raise TimeoutError("Image generation timed out after 3 minutes")

        # Set alarm (Unix only — works on GitHub Actions Ubuntu)
        old_handler = signal.signal(signal.SIGALRM, _image_timeout_handler)
        signal.alarm(IMAGE_TIMEOUT)
        try:
            image_url = generate_and_upload_image(image_prompt, article_id)
        finally:
            signal.alarm(0)  # Cancel alarm
            signal.signal(signal.SIGALRM, old_handler)
    except TimeoutError as te:
        print(f"⏰ {te} — using placeholder")
        image_url = PLACEHOLDER_IMAGE_URL
    except Exception as img_err:
        print(f"⚠️ Image generation crashed: {str(img_err)[:200]} — using placeholder")
        image_url = PLACEHOLDER_IMAGE_URL

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
    _git_push_history()  # Push updated JSON to GitHub

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
    MAX_RETRY_SECONDS = 600  # 10 minutes total budget
    RETRY_WAIT = 60          # wait 60 seconds between retries
    start_time = time.time()
    attempt = 0

    while True:
        attempt += 1
        elapsed = time.time() - start_time
        remaining = MAX_RETRY_SECONDS - elapsed

        if remaining <= 0:
            print(f"\n❌ Pipeline exhausted all retries after {int(elapsed)}s ({attempt-1} attempts)")
            try:
                db = init_firebase()
                log_health(db, "❌ Failed", {"error_message": f"All {attempt-1} attempts failed in {int(elapsed)}s", "runner": "github-actions"})
            except Exception:
                pass
            sys.exit(1)

        print(f"\n{'='*60}")
        print(f"🔄 Attempt {attempt} | Elapsed: {int(elapsed)}s | Budget remaining: {int(remaining)}s")
        print(f"{'='*60}")

        try:
            result = generate_news()
            print(f"\n📄 Result: {json.dumps({'title': result['title'], 'category': result['category']}, indent=2)}")
            break  # SUCCESS — exit the retry loop
        except Exception as e:
            print(f"\n⚠️ Attempt {attempt} failed: {e}")
            elapsed_now = time.time() - start_time
            if elapsed_now + RETRY_WAIT >= MAX_RETRY_SECONDS:
                print(f"❌ Not enough time for another retry. Total: {int(elapsed_now)}s")
                try:
                    db = init_firebase()
                    log_health(db, "❌ Failed", {"error_message": str(e), "runner": "github-actions"})
                except Exception:
                    pass
                sys.exit(1)
            print(f"⏳ Waiting {RETRY_WAIT}s before retry... (budget: {int(MAX_RETRY_SECONDS - elapsed_now)}s left)")
            time.sleep(RETRY_WAIT)
