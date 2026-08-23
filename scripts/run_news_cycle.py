#!/usr/bin/env python3
"""
News Pipeline Worker — GitHub Actions Background Runner
========================================================
Pipeline: Dynamic Query → Tavily Search → URL Dedup →
          Cerebras (Qwen 235B / llama3.1-8b) → FLUX.1-dev Image Gen →
          Cloudinary Upload → Firestore Save → History Update

Ported from: app/api/cron/generate-news/route.ts (v17)
"""

import html
import json
import os
import random
import re
import sys
import time
import threading
import requests
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse

import cloudinary
import cloudinary.uploader
import firebase_admin
from firebase_admin import credentials, firestore
import requests
try:
    from cerebras.cloud.sdk import Cerebras as CerebrasSDK
    HAS_CEREBRAS_SDK = True
except ImportError:
    HAS_CEREBRAS_SDK = False
try:
    from rapidfuzz import fuzz as rfuzz
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False


# ─── Heartbeat Keep-Alive ────────────────────────────────────────

class Heartbeat:
    """Background heartbeat to keep GitHub Actions alive."""
    def __init__(self):
        self._stop = threading.Event()
        self._thread = None
        self._task = "idle"
    
    def start(self, task: str):
        self._task = task
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
    
    def update(self, task: str):
        self._task = task
    
    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
    
    def _run(self):
        tick = 0
        while not self._stop.wait(5):
            tick += 1
            print(f"  💓 [{tick*5}s] {self._task}")

heartbeat = Heartbeat()

def _cool_down(seconds: int, next_task: str):
    """Cool down between tasks — prints activity to keep Actions alive."""
    for i in range(seconds):
        time.sleep(1)
        print(f"  ⏳ Cool-down {i+1}/{seconds}s — preparing {next_task}...")

# ─── Config ──────────────────────────────────────────────────

COLLECTION = "news"
# HISTORY_COLLECTION removed — history now stored in scripts/news_history.json
HEALTH_DOC_PATH = "system/cron_health"
HISTORY_TTL_DAYS = 10
TAVILY_RESULT_COUNT = 10

IMAGE_WIDTH = 1024
IMAGE_HEIGHT = 576  # 16:9 cinematic ratio

# ─── Pipeline timing budget (keeps the whole run under the 15-min job wall) ───
# Measured from process start. Image GENERATION must stop early enough to leave
# IMAGE_FALLBACK_RESERVE seconds for the verified stock fallback + Cloudinary
# upload + Firestore write + git push — otherwise the GitHub Actions job hits
# its 15-min timeout mid-generation and the fallback never runs (the root cause
# of "silently exits before hitting the stock photo fallback").
PIPELINE_START = time.time()
PIPELINE_SOFT_BUDGET = 760        # ~12.7 min of script runtime (headroom under the 15-min wall after setup)
IMAGE_FALLBACK_RESERVE = 110      # secs reserved AFTER generation for fallback + upload + DB + push
IMAGE_MIN_GEN_WINDOW = 45         # below this many secs left → skip g4f, go straight to verified fallback


def _image_generation_deadline() -> float:
    """Absolute time.time() by which g4f generation must stop so the verified
    fallback + upload still complete before the 15-min job wall."""
    return PIPELINE_START + PIPELINE_SOFT_BUDGET - IMAGE_FALLBACK_RESERVE

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
        # India Tech
        "Indian startup ecosystem funding unicorn news",
        "UPI digital India fintech payments technology news",
        "ISRO space missions India satellite launch news",
        "MeitY government technology policy India digital",
        "India semiconductor chip manufacturing plant news",
        "Infosys TCS Wipro Indian IT industry news",
        "India AI research IIT technology innovation news",
    ],

    # ── Open Source AI ──
    "open-source": [
        "open source AI models community development news",
        "Hugging Face open source AI tools models news",
        "Mistral AI open source language model news",
        "open source large language model release news",
        "Linux open source software community news",
        "open source AI framework PyTorch TensorFlow news",
        # India Open Source
        "India open source software community BharatGPT news",
        "Indian developers open source AI contributions news",
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
        # India Disability
        "India disability rights accessibility government policy news",
        "India assistive technology Divyang empowerment news",
    ],

    # ── Health ──
    "health": [
        "healthcare technology innovation AI medical news",
        "mental health digital wellness technology news",
        "AI healthcare diagnosis treatment breakthrough news",
        "medical technology health research discovery news",
        "telemedicine digital health innovation news",
        "drug discovery AI pharmaceutical research news",
        # India Health
        "India healthcare Ayushman Bharat digital health mission news",
        "AIIMS Indian medical research breakthrough news",
        "India pharmaceutical generic drugs export news",
        "India public health WHO disease prevention news",
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
        # India Climate
        "India renewable energy solar power transition news",
        "Indian monsoon climate impact weather forecast news",
        "India electric vehicle EV adoption policy news",
        "India air pollution Delhi smog environment news",
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
        # India World
        "Indian government policy budget announcements news",
        "Supreme Court India latest rulings judgments news",
        "RBI Reserve Bank India economy monetary policy news",
        "India infrastructure development smart city project news",
        "India foreign affairs diplomatic relations G20 news",
        "India defence military DRDO technology news",
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
        # India Sports
        "India cricket BCCI team selection match news",
        "Indian Premier League IPL cricket updates news",
        "Indian Olympic athletes preparation training news",
        "ISL Indian Super League football results news",
        "India hockey badminton wrestling athletes news",
        "Indian women sports achievements recognition news",
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


DYNAMIC_SUFFIXES = [
    "latest updates", "breaking developments", "news today",
    "fresh announcements", "this week", "recent highlights",
    "new developments", "key updates", "top stories",
]


def _add_dynamic_suffix(query: str) -> str:
    """Append a dynamic suffix with month/year to make query unique and fresh."""
    now = datetime.now(timezone.utc)
    month_year = now.strftime("%B %Y")  # e.g. "August 2026"
    suffix = random.choice(DYNAMIC_SUFFIXES)
    return f"{query} {suffix} {month_year}"


def pick_search_query() -> tuple[str, str]:
    """Pick a search query based on time-of-day rotation.
    Returns (query_with_dynamic_suffix, category_key)."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    # Slot index: each 30-min slot gets a category
    slot = (now.hour * 2 + (1 if now.minute >= 30 else 0)) % len(ROTATION_ORDER)
    category_key = ROTATION_ORDER[slot]
    queries = QUERY_BUCKETS[category_key]
    base_query = random.choice(queries)
    query = _add_dynamic_suffix(base_query)
    return query, category_key


def pick_fallback_queries(exclude_category: str) -> list[tuple[str, str]]:
    """Pick queries from OTHER categories for fallback, with dynamic suffixes."""
    fallbacks = []
    other_keys = [k for k in QUERY_BUCKETS if k != exclude_category]
    random.shuffle(other_keys)
    for key in other_keys[:3]:  # Try 3 different categories
        q = _add_dynamic_suffix(random.choice(QUERY_BUCKETS[key]))
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


def search_searchwala(query: str, days_back: int = 3) -> dict:
    """Search using local SearchWala instance."""
    try:
        print(f'🔍 SearchWala: searching "{query}"...')
        heartbeat.start(f'SearchWala searching "{query}"...')
        resp = requests.post(
            "http://localhost:8000/search",
            json={
                "query": query,
                "max_results": TAVILY_RESULT_COUNT,
                "focus_mode": "lite"
            },
            timeout=120,
        )
        resp.raise_for_status()
        heartbeat.stop()
        data = resp.json()

        results = data.get("search_results", [])
        if not results:
            print(f'⚠️ SearchWala returned no results for "{query}"')
            return {"context": "", "results": []}

        mapped = [
            {"title": r.get("title", ""), "description": r.get("extracted_text", ""), "url": r.get("url", "")}
            for r in results
        ]
        context = "\n\n".join(
            f"[{j+1}] {r['title']}\n{r['description']}" for j, r in enumerate(mapped)
        )
        print(f'🔍 SearchWala: {len(mapped)} results for "{query}"')
        return {"context": context, "results": mapped}

    except Exception as e:
        heartbeat.stop()
        print(f"⚠️ SearchWala failed: {e}")
        return {"context": "", "results": []}

def perform_search(query: str, days_back: int = 3) -> dict:
    res = search_searchwala(query, days_back)
    if res["results"]:
        return res
    print("🔄 Falling back to Tavily...")
    return search_tavily(query, days_back)

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


def _openverse_search(query: str) -> list[str]:
    """Return candidate image URLs from Openverse for a query.

    Restricted to CC0 + Public Domain Mark — open-licence images that carry
    NO attribution requirement, so the fallback needs no on-page credit and no
    frontend change. (Switch to license=cc0,pdm,by if you later add a caption.)
    """
    params = {"q": query, "page_size": 8, "mature": "false", "license": "cc0,pdm"}
    try:
        resp = requests.get(
            "https://api.openverse.org/v1/images/",
            params=params, timeout=15,
            headers={"User-Agent": "XeL-Studio-News/1.0"},
        )
        if resp.status_code != 200:
            return []
        out = []
        for item in resp.json().get("results", []) or []:
            url = item.get("url") or item.get("thumbnail")
            if url:
                out.append(url)
        return out
    except Exception:
        return []


def _fetch_relevant_stock_image(query: str, category: str = "") -> bytes | None:
    """
    Last-resort BEFORE the gray placeholder: fetch a real, on-topic photo from
    Openverse (keyless) and run it through the SAME content verifier the
    generator uses. A news site should never show a gray box when a real,
    relevant image is one HTTP call away.

    Openverse matches poorly on long headlines, so we degrade the query:
    full-ish title → first 2 keywords → category → "technology". Only CC0 /
    Public Domain images are used, so no attribution is ever required.
    """
    try:
        from gemini_image_gen import _validate_image  # reuse the robust verifier
    except Exception:
        _validate_image = None

    clean = re.sub(r"[^\w\s]", " ", query or "")
    clean = re.sub(r"\s+", " ", clean).strip()
    words = clean.split()

    # Query-degradation ladder (most → least specific)
    candidates = []
    if len(words) >= 3:
        candidates.append(" ".join(words[:4]))
    if len(words) >= 2:
        candidates.append(" ".join(words[:2]))
    if category:
        candidates.append(category.strip())
    candidates.append("technology")
    # de-dup while preserving order
    seen = set()
    candidates = [c for c in candidates if c and not (c.lower() in seen or seen.add(c.lower()))]

    for q in candidates:
        urls = _openverse_search(q)
        if not urls:
            continue
        print(f"  🔎 Openverse: {len(urls)} CC0/public-domain candidates for '{q}'")
        for url in urls:
            try:
                img = requests.get(
                    url, timeout=20,
                    headers={"User-Agent": "Mozilla/5.0 XeL-Studio/2.0"},
                ).content
            except Exception:
                continue
            if _validate_image is not None:
                v = _validate_image(img, "openverse")
                if not v["valid"]:
                    continue
                print(f"  ✅ Stock photo verified ({v['width']}×{v['height']}, "
                      f"{len(img):,} bytes) for '{q}'")
            elif len(img) < 5000:
                continue
            return img

    print(f"  ⚠️ No verifiable Openverse result (tried: {', '.join(candidates)})")
    return None


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


def _call_g4f_image(prompt: str, deadline_ts: float | None = None) -> bytes | None:
    """Attempt image generation via g4f. `deadline_ts` lets the engine use the
    full remaining window while guaranteeing it returns in time for the fallback."""
    try:
        from gemini_image_gen import generate_image_gemini
        return generate_image_gemini(prompt, deadline_ts=deadline_ts)
    except ImportError:
        print("  ⚠️ g4f image gen not available (g4f not installed?)")
        return None
    except Exception as e:
        print(f"  ❌ g4f image error: {e}")
        return None


def _call_rest_image(prompt: str, deadline_ts: float | None = None) -> bytes | None:
    """Official, documented free/credit-tier REST providers (Together AI,
    Nebius Studio…). Verified, key-pool paced, with failover. Runs AFTER g4f and
    is INERT (returns None) until a provider key (TOGETHER_API_KEY /
    NEBIUS_API_KEY) is configured."""
    try:
        from rest_image_providers import generate_rest_image
        return generate_rest_image(prompt, deadline_ts=deadline_ts)
    except Exception as e:
        print(f"  ⚠️ REST image tier error: {str(e)[:120]}")
        return None


def generate_and_upload_image(prompt: str, article_id: str, fallback_query: str = "",
                              fallback_category: str = "") -> str:
    """
    Image pipeline (verified at every tier):
      1. Cloudflare Workers AI (PRIMARY) → content-verified → Cloudinary
         (inert until CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are set)
      2. g4f (Flux …) → content-verified → Cloudinary           (free fallback)
      3. Relevant stock photo (Openverse, keyless) → content-verified → Cloudinary
      4. Gray placeholder → Cloudinary  (absolute last resort)

    `fallback_query` (usually the article title) drives the stock search so the
    fallback image is on-topic rather than a generic gray box.
    """

    print(f"\n{'─'*50}")
    print("🖼️ IMAGE PIPELINE (Cloudflare → g4f → stock → placeholder)")
    print(f"   Article ID: {article_id}")
    print(f"{'─'*50}")

    # Sanitize prompt
    clean_prompt = re.sub(r"[^\w\s,.\-!?']", "", prompt)
    clean_prompt = re.sub(r"\s+", " ", clean_prompt).strip()
    if len(clean_prompt) > 300:
        clean_prompt = clean_prompt[:300].rsplit(" ", 1)[0]

    enhanced_prompt = clean_prompt
    print(f"   Prompt: \"{clean_prompt[:80]}...\"")

    # ── Tier 1: Cloudflare Workers AI (PRIMARY) ──────────────
    # Fast, verified, key-pool paced. Inert (instant None) until
    # CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are configured.
    rest_deadline = min(time.time() + 50, PIPELINE_START + PIPELINE_SOFT_BUDGET - 60)
    rest_bytes = _call_rest_image(enhanced_prompt, rest_deadline)
    if rest_bytes:
        result = _upload_bytes_to_cloudinary(rest_bytes, article_id)
        if result:
            print(f"  ✅ IMAGE SUCCESS (Cloudflare verified → Cloudinary)")
            return result

    # ── Tier 2: g4f generation, deadline-coordinated ─────────
    # The engine retries aggressively (round-robin over the model chain) until
    # this deadline. The deadline reserves IMAGE_FALLBACK_RESERVE seconds so the
    # verified stock fallback + upload always finish before the job wall.
    gen_deadline = _image_generation_deadline()
    gen_window = gen_deadline - time.time()
    if gen_window < IMAGE_MIN_GEN_WINDOW:
        print(f"  ⏱️ Only {gen_window:.0f}s left before fallback reserve — "
              f"skipping g4f, going straight to the verified stock photo")
        g4f_bytes = None
    else:
        print(f"  ⏱️ g4f window: {gen_window:.0f}s "
              f"(reserving {IMAGE_FALLBACK_RESERVE}s for fallback + upload)")
        g4f_bytes = _call_g4f_image(enhanced_prompt, deadline_ts=gen_deadline)

    if g4f_bytes:
        result = _upload_bytes_to_cloudinary(g4f_bytes, article_id)
        if result:
            print(f"  ✅ IMAGE SUCCESS (g4f verified → Cloudinary)")
            return result

    # ── Fallback 1: relevant, real stock photo (verified) ────
    print(f"  ⚠️ no verified image from Cloudflare or g4f — trying on-topic stock photo")
    stock_bytes = _fetch_relevant_stock_image(fallback_query or clean_prompt, fallback_category)
    if stock_bytes:
        result = _upload_bytes_to_cloudinary(stock_bytes, article_id)
        if result:
            print(f"  ✅ IMAGE SUCCESS (stock photo → Cloudinary)")
            return result

    # ── Fallback 2: Gray placeholder (last resort) ───────────
    print(f"  ⚠️ Stock fallback unavailable, using gray placeholder")
    return _upload_placeholder_to_cloudinary(article_id)


# ─── Parse JSON Response ─────────────────────────────────────


def _strip_json_artifacts(text: str) -> str:
    """Remove ALL possible JSON formatting artifacts from article text."""
    if not text:
        return ""
    # Remove JSON wrapper: {"articleText": "..."}
    text = re.sub(r'^\s*\{\s*"articleText"\s*:\s*"?', '', text)
    # Remove any trailing JSON keys and closing brace
    text = re.sub(r'"?\s*,\s*"(?:category|title|imagePrompt)"\s*:.*$', '', text, flags=re.DOTALL)
    text = re.sub(r'\s*\}\s*$', '', text)
    # Remove stray JSON artifacts
    text = text.replace('\\n', '\n').replace('\\\"', '"')
    text = re.sub(r'^\s*"', '', text)           # leading quote
    text = re.sub(r'"\s*$', '', text)           # trailing quote
    text = re.sub(r'^\s*\[\s*', '', text)      # leading bracket
    text = re.sub(r'\s*\]\s*$', '', text)      # trailing bracket
    return text.strip()


def _sanitize_article_text(text: str) -> str:
    """Ensure article text is in proper bullet point format.

    Handles these LLM output patterns:
    1. Already has bullets: '- **Bold** text' -> keep
    2. Bold-start without bullet: '**Bold** text' -> add '- '
    3. Numbered items: '1. **Bold** text' -> convert to '- '
    4. Plain text lines -> add '- ' prefix if substantial
    """
    if not text:
        return ""

    lines = [l.strip() for l in text.split('\n') if l.strip()]
    formatted = []

    for line in lines:
        if len(line) < 5:
            continue
        # Already a bullet
        if re.match(r'^[-\u2022\u25cf\u25aa\u2023]\s+', line):
            formatted.append(line)
        # Numbered list: 1. text, 2) text
        elif re.match(r'^\d+[.)\s]+', line):
            cleaned = re.sub(r'^\d+[.)\s]+', '', line).strip()
            if cleaned:
                formatted.append(f"- {cleaned}")
        # Bold-start without bullet marker
        elif line.startswith('**'):
            formatted.append(f"- {line}")
        # Plain text with substance
        elif len(line.split()) >= 8:
            formatted.append(f"- {line}")
        else:
            formatted.append(line)

    return '\n'.join(formatted)


def parse_article_response(text: str) -> tuple[str, str, str, str]:
    """Extract articleText, category, title, and imagePrompt from JSON response.
    Returns (article_text, category, title, image_prompt).

    Uses 3-strategy parsing: direct JSON -> embedded JSON search -> regex extraction.
    """
    clean = text.strip()
    # Strip markdown code fences
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*\n?", "", clean)
        clean = re.sub(r"\n?```\s*$", "", clean)

    article = ""
    category = ""
    title = ""
    img_prompt = ""
    valid_categories = {"ai-tech", "disability", "health", "world", "general", "sports"}

    # Strategy 1: Direct JSON parse
    parsed = None
    try:
        parsed = json.loads(clean)
    except json.JSONDecodeError:
        # Strategy 2: Find embedded JSON object in the text
        json_match = re.search(r'\{[^{}]*"articleText"[^{}]*\}', clean, re.DOTALL)
        if json_match:
            try:
                parsed = json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

    if parsed and isinstance(parsed, dict):
        article = parsed.get("articleText", "").strip()
        category = parsed.get("category", "").strip().lower()
        title = parsed.get("title", "").strip()
        img_prompt = parsed.get("imagePrompt", "").strip()
    else:
        # Strategy 3: Regex extraction from malformed text
        art_match = re.search(r'"articleText"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"', clean)
        if art_match:
            article = art_match.group(1)
        else:
            article = clean

        cat_match = re.search(r'"category"\s*:\s*"([^"]*)"', clean)
        if cat_match:
            category = cat_match.group(1).strip().lower()

        title_match = re.search(r'"title"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"', clean)
        if title_match:
            title = title_match.group(1).strip()

        img_match = re.search(r'"imagePrompt"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"', clean)
        if img_match:
            img_prompt = img_match.group(1).strip()

    # Validate category
    if category not in valid_categories:
        category = ""

    # Deep-clean article text: strip ALL JSON artifacts
    article = _strip_json_artifacts(article)
    # Ensure proper bullet format
    article = _sanitize_article_text(article)

    # Clean title
    if title:
        title = _strip_json_artifacts(title)
        title = title.strip('"\'')
        title = re.sub(
            r'^(Breaking\s*News|Breaking|BREAKING|Update|Report|News|Spotlight|Alert|'
            r'Headline|Tech|AI|Analysis|Exclusive|Latest|Just\s*In|Flash|Urgent|'
            r'Development|Watch)[:\s\u2014\u2013-]+',
            '', title, flags=re.IGNORECASE
        )
        title = re.sub(r'^[:\s\u2014\u2013-]+', '', title).strip()

    # Clean image prompt
    if img_prompt:
        img_prompt = _strip_json_artifacts(img_prompt)
        img_prompt = img_prompt.strip('"\'')
        img_prompt = img_prompt.replace("**", "")
        img_prompt = re.sub(r'^(Optimized\s+)?Cinematic\s+Prompt:\s*', '', img_prompt, flags=re.IGNORECASE).strip()
        img_prompt = re.sub(r'^(Image\s+)?Prompt:\s*', '', img_prompt, flags=re.IGNORECASE).strip()

    return (article, category, title, img_prompt)


# ─── Pre-Processing: Noise Removal & Compression ─────────────


def _clean_snippet(text: str) -> str:
    """Remove noise from search result text: HTML entities, breadcrumbs, URLs, boilerplate."""
    if not text:
        return ""
    text = html.unescape(text)
    text = re.sub(r'https?://\S+|www\.\S+', '', text)
    text = re.sub(r'\w+\.com\s*[\u203a>].*', '', text)
    text = re.sub(r'(?i)(read more|click here|learn more|subscribe now|sign up|cookie)', '', text)
    text = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _truncate_description(text: str, max_chars: int = 120) -> str:
    """Truncate description to max_chars, breaking at word boundary."""
    if len(text) <= max_chars:
        return text
    truncated = text[:max_chars].rsplit(" ", 1)[0]
    return truncated + "..." if truncated else text[:max_chars]


def _cross_dedup_sentences(results: list[dict]) -> list[dict]:
    """Remove duplicate sentences across multiple search result descriptions."""
    seen_hashes = set()
    for r in results:
        desc = r.get("description", "")
        if not desc:
            continue
        sentences = re.split(r'(?<=[.!?])\s+', desc)
        unique = []
        for s in sentences:
            norm = re.sub(r'\W+', '', s.lower())
            if len(norm) < 10:
                unique.append(s)
                continue
            h = hash(norm)
            if h not in seen_hashes:
                seen_hashes.add(h)
                unique.append(s)
        r["description"] = " ".join(unique)
    return results


def _build_llm_context(results: list[dict], max_items: int = 25) -> str:
    """Build compact numbered-list context for the LLM prompt.

    Cleans, truncates, deduplicates sentences, and formats as:
      1. Title | Description
      2. Title | Description

    This saves ~37% tokens vs json.dumps(indent=2).
    """
    cleaned = []
    for r in results:
        title = _clean_snippet(r.get("title", "")).strip()
        desc = _clean_snippet(r.get("description", "")).strip()
        if not title and not desc:
            continue
        cleaned.append({"title": title, "description": desc})

    sliced = cleaned[:max_items]
    print(f"\U0001f4e6 LLM context: {len(sliced)} of {len(cleaned)} results (top {max_items} selected)")

    sliced = _cross_dedup_sentences(sliced)

    for item in sliced:
        item["description"] = _truncate_description(item["description"], 120)

    out_lines = []
    for i, item in enumerate(sliced, 1):
        title = item["title"]
        desc = item["description"]
        if desc:
            out_lines.append(f"{i}. {title} | {desc}")
        else:
            out_lines.append(f"{i}. {title}")

    return "\n".join(out_lines)


# ─── Cerebras LLM ────────────────────────────────────────────


# Provider definitions â tried in order. Each entry is one attempt.
LLM_PROVIDERS = [
    {
        "name": "Groq/gpt-oss-120b",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "openai/gpt-oss-120b",
        "key_env": "GROQ_API_KEY",
        "max_tokens": 3000,
        "supports_json_mode": False,  # reasoning model, JSON mode broken on Groq
    },
    {
        "name": "Groq/gpt-oss-20b",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "openai/gpt-oss-20b",
        "key_env": "GROQ_API_KEY",
        "max_tokens": 3000,
        "supports_json_mode": False,
    },
    {
        "name": "Groq/gpt-oss-120b (Key-2)",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "openai/gpt-oss-120b",
        "key_env": "GROQ_API_KEY_2",
        "max_tokens": 3000,
        "supports_json_mode": False,
    },
    {
        "name": "Groq/gpt-oss-20b (Key-2)",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "openai/gpt-oss-20b",
        "key_env": "GROQ_API_KEY_2",
        "max_tokens": 3000,
        "supports_json_mode": False,
    },
    {
        "name": "Groq/gpt-oss-120b (Key-3)",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "openai/gpt-oss-120b",
        "key_env": "GROQ_API_KEY_3",
        "max_tokens": 3000,
        "supports_json_mode": False,
    },
    {
        "name": "Groq/gpt-oss-20b (Key-3)",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "openai/gpt-oss-20b",
        "key_env": "GROQ_API_KEY_3",
        "max_tokens": 3000,
        "supports_json_mode": False,
    },
    {
        "name": "Cerebras/llama3.1-8b",
        "base_url": "https://api.cerebras.ai/v1",
        "model": "llama3.1-8b",
        "key_env": "CEREBRAS_API_KEY",
        "max_tokens": 4096,
        "supports_json_mode": True,
    },
    {
        "name": "Cerebras/llama3.1-8b (Key-2)",
        "base_url": "https://api.cerebras.ai/v1",
        "model": "llama3.1-8b",
        "key_env": "CEREBRAS_API_KEY_2",
        "max_tokens": 4096,
        "supports_json_mode": True,
    },
    {
        "name": "Cerebras/llama3.1-8b (Key-3)",
        "base_url": "https://api.cerebras.ai/v1",
        "model": "llama3.1-8b",
        "key_env": "CEREBRAS_API_KEY_3",
        "max_tokens": 4096,
        "supports_json_mode": True,
    },
]

# Fatal HTTP codes â DO NOT retry, immediately switch provider
FATAL_HTTP_CODES = {401, 402, 403, 404}
# Transient HTTP codes â sleep briefly and retry same provider
TRANSIENT_HTTP_CODES = {429, 500, 502, 503}


def call_llm_robust(system_prompt: str, user_prompt: str, task_name: str,
                    temperature: float = 0.4) -> str:
    """Call LLM with multi-provider instant rotation.

    Provider chain: Groq gpt-oss-120b \u2192 gpt-oss-20b (Key-1) \u2192
                    Groq gpt-oss-120b \u2192 gpt-oss-20b (Key-2) \u2192
                    Cerebras llama3.1-8b (Key 1-3).

    INSTANT ROTATION: Any error = immediately try next provider. Zero waiting.
    The outer 60s retry loop handles cooldowns naturally.
    """
    last_error = None

    for provider in LLM_PROVIDERS:
        api_key = os.environ.get(provider["key_env"])
        if not api_key:
            continue

        provider_name = provider["name"]
        try:
            print(f"  \u26a1 {task_name}: {provider_name}...")

            payload = {
                "model": provider["model"],
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": temperature,
                "max_tokens": provider["max_tokens"],
            }
            if provider["supports_json_mode"]:
                payload["response_format"] = {"type": "json_object"}

            resp = requests.post(
                f"{provider['base_url']}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=90,
            )

            # Any non-200 = instant rotation to next provider
            if resp.status_code != 200:
                error_msg = resp.text[:150]
                print(f"  \u274c {provider_name}: HTTP {resp.status_code} \u2014 {error_msg}")
                print(f"  \U0001f504 Instant switch to next provider...")
                last_error = RuntimeError(f"{provider_name}: HTTP {resp.status_code}")
                continue  # next provider immediately

            # \u2500\u2500 Parse response \u2500\u2500
            data = resp.json()
            content = (data.get("choices", [{}])[0]
                       .get("message", {})
                       .get("content", "")
                       .strip())

            usage = data.get("usage", {})
            reasoning = usage.get("completion_tokens_details", {}).get("reasoning_tokens", 0)
            finish = data.get("choices", [{}])[0].get("finish_reason", "?")

            print(f"  \U0001f4ca Tokens: prompt={usage.get('prompt_tokens', 0)} "
                  f"completion={usage.get('completion_tokens', 0)} "
                  f"reasoning={reasoning} finish={finish}")

            # Strip <think>...</think> blocks (reasoning models)
            content = re.sub(r'<think>[\s\S]*?</think>', '', content).strip()

            if not content:
                print(f"  \u26a0\ufe0f {provider_name}: empty response \u2014 instant switch...")
                last_error = ValueError(f"{provider_name}: empty response")
                continue  # next provider immediately

            print(f"  \u2705 {task_name} succeeded with {provider_name}")
            return content

        except requests.exceptions.Timeout:
            print(f"  \u26a0\ufe0f {provider_name}: timeout \u2014 instant switch...")
            last_error = RuntimeError(f"{provider_name}: timeout")
            continue  # next provider immediately
        except Exception as e:
            print(f"  \u26a0\ufe0f {provider_name}: {str(e)[:150]} \u2014 instant switch...")
            last_error = e
            continue  # next provider immediately

    raise ValueError(f"All providers exhausted for {task_name}: {str(last_error)[:150]}")


def call_llm_article(system_prompt: str, user_prompt: str) -> tuple[str, str, str, str]:
    """Call LLM for article generation and parse the JSON response."""
    raw = call_llm_robust(system_prompt, user_prompt, "Article Generation")
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
                source_urls = data.get("source_urls", [])
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


    # Validate that at least one LLM API key is available
    groq_key = os.environ.get("GROQ_API_KEY")
    groq_key_2 = os.environ.get("GROQ_API_KEY_2")
    groq_key_3 = os.environ.get("GROQ_API_KEY_3")
    c_keys = [
        os.environ.get("CEREBRAS_API_KEY"),
        os.environ.get("CEREBRAS_API_KEY_2"),
        os.environ.get("CEREBRAS_API_KEY_3"),
    ]
    has_cerebras = any(c_keys)

    if not groq_key and not groq_key_2 and not groq_key_3 and not has_cerebras:
        raise RuntimeError("No LLM API keys set (need GROQ_API_KEY or CEREBRAS_API_KEY)")

    available_providers = []
    groq_count = sum(1 for k in [groq_key, groq_key_2, groq_key_3] if k)
    if groq_count:
        available_providers.append(f"Groq ({groq_count} keys: gpt-oss-120b, gpt-oss-20b)")
    if has_cerebras:
        available_providers.append(f"Cerebras ({sum(1 for k in c_keys if k)} keys)")
    print(f"ð LLM providers: {' â '.join(available_providers)}")
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
    initial_result = perform_search(search_query, 7)

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
            fb_result = perform_search(fb_query, 7)
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
            broad_result = perform_search("latest breaking news today", 7)
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
    # Build rich sources with title + URL for frontend display
    source_sources = [
        {"url": r.get("url", ""), "title": (r.get("title", "") or "").strip()}
        for r in scraped_data if r.get("url")
    ]

    # 5. Cerebras article generation (with LLM dedup)
    system_prompt = (
        'You are a professional news reporter and journalist writing for a general audience. '
        'Use simple, clear, everyday language — like a TV news anchor or newspaper journalist would. '
        'Avoid jargon, technical terms, or complex vocabulary. '
        'You must strictly base your news summary ONLY on the provided search results. '
        'DO NOT hallucinate or add external information not present in the search results. '
        'Output valid JSON: {"articleText": "...", "category": "...", "title": "...", "imagePrompt": "..."}. '
        'Valid categories: ai-tech, disability, health, world, general, sports. '
        'Pick the BEST matching category for the article topic. '
        'The title MUST be a unique, professional, specific 10-20 word news headline in Title Case. '
        'Use VARIED headline structures — rotate between these styles: '
        '(a) [Subject] + [Action Verb] + [Object] (e.g. "Google Launches New AI Chip"), '
        '(b) [Subject] + [Verb] + [Impact/Result] (e.g. "Tesla Sales Surge 40 Percent in Q2"), '
        '(c) [Number/Stat] + [Context] (e.g. "50 Million Users Join Threads in First Week"). '
        'NEVER start the title with "What" or "How" or "Why". '
        'Start with the actual subject name (a person, company, country, or product). '
        'Use a strong active verb. NO colons, NO prefixes like Breaking or Update. '
        'Mention specific names, products, numbers, or places in the title. '
        'The imagePrompt MUST be a vivid 30-50 word visual scene description for an AI image generator. '
        'Describe a SPECIFIC scene that matches the article topic — NOT generic tech imagery. '
        'Include: subject, setting, lighting, color palette, camera angle, photography style. '
        'NEVER describe people at computers, glowing servers, or generic robots. '
        'Write about ONE SINGLE story in depth. NEVER mix multiple unrelated topics. '
        'No other keys, no markdown, no explanation.'
    )

    # Build LLM context: clean, dedupe sentences, slice top 25, compress
    # NOTE: ALL source_urls (50-60+) are kept for the website display
    llm_context = _build_llm_context(scraped_data, max_items=25)

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

        # Layer 5: RapidFuzz token_set_ratio (catches word reordering)
        fuzz_score = 0.0
        if HAS_RAPIDFUZZ:
            fuzz_score = rfuzz.token_set_ratio(title_a, title_b) / 100.0

        # Combined score: weighted average with RapidFuzz boost
        base_score = (word_overlap * 0.25) + (bigram_overlap * 0.25) + (entity_overlap * 0.3) + (fuzz_score * 0.2)
        # If RapidFuzz alone strongly matches (>0.85), trust it
        score = max(base_score, fuzz_score * 0.9)
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
            llm_context = _build_llm_context(scraped_data, max_items=25)
            print(f"📋 After enhanced dedup: {len(scraped_data)} unique results remain")
        else:
            print("⚠️ All results matched existing titles — keeping originals for LLM to handle")

    user_prompt = f"""Write a news summary STRICTLY using ONLY the facts from the search results below. Do not include any information that is not in these results.{dedup_section}

Search results:
{llm_context}

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
10. NO HALLUCINATION (CRITICAL): You must base all facts, numbers, and quotes purely on the provided search results. If the search results do not contain enough information, summarize what is available without making up details.
11. YOU MUST decide the category. Pick ONE from: ai-tech, disability, health, world, general, sports
   - ai-tech: AI, technology, open source AI, startups, chips, coding, Anthropic, OpenAI, etc.
   - disability: assistive tech, blind, deaf, wheelchair, accessibility, visually impaired, inclusion
   - health: healthcare, medical, mental health, wellness, disease, treatment
   - world: geopolitics, regulation, policy, climate, environment, international trade
   - general: business, earnings, crypto, entertainment, social media, anything else
   - sports: sports achievements, athletic records, championships, Olympic, tournaments, incredible sports moments
12. TITLE (CRITICAL): You MUST generate a unique, professional news headline (10-20 words, Title Case). NEVER start with "What", "How", or "Why". Always start with the actual subject name (person, company, country, product). Use a strong active verb. Vary the structure: sometimes [Subject Verbs Object], sometimes [Number/Stat + Context], sometimes [Subject + Verb + Impact]. Be specific with names/numbers/places. NO colons, NO prefixes.
13. IMAGE PROMPT (CRITICAL): Write a vivid 30-50 word visual scene description for an AI image generator. The scene MUST directly depict the specific topic of your article. Include: specific subject/object, setting/location, lighting mood, color palette, camera angle, and photography style. NEVER use generic tech clichés like glowing servers, people at computers, abstract holograms, or robots. Instead show the REAL OBJECT of the news (the product, the building, the landscape, the document, the handshake, the protest, the lab equipment, the sports arena, the factory floor).

Return JSON: {{ "articleText": "your bullet points", "category": "one-of-the-six", "title": "Your Unique Professional Headline Here", "imagePrompt": "A vivid 30-50 word scene description matching the article topic" }}"""

    # 5a. Call LLM via multi-provider chain (Groq primary â Cerebras fallback)
    article_text = ""

    try:
        article_text, ai_category, inline_title, inline_image_prompt = call_llm_article(system_prompt, user_prompt)

        if ai_category:
            print(f"ð¤ AI picked category: {ai_category}")

        word_count = len(article_text.split())
        print(f"ð First attempt: {word_count} words")

        # Auto-retry if too short
        if word_count < 120:
            print(f"â ï¸ Too short ({word_count} words), retrying...")
            retry_prompt = f"""{user_prompt}

CRITICAL CORRECTION: Your previous attempt was ONLY {word_count} words. UNACCEPTABLE.
You MUST write between 130 to 170 words using 3-4 bullet points. Each bullet MUST be separated by a newline.
Each bullet MUST start with **Bold Keyword**. ADD more factual details, specific numbers, names, and context.
STAY on the SAME SINGLE topic â do NOT add unrelated stories to fill space."""

            try:
                retry_text, retry_cat, retry_title, retry_img = call_llm_article(system_prompt, retry_prompt)
                retry_wc = len(retry_text.split())
                print(f"ð Retry: {retry_wc} words")
                if retry_wc > word_count:
                    article_text = retry_text
                    if retry_cat:
                        ai_category = retry_cat
                    if retry_title:
                        inline_title = retry_title
                    if retry_img:
                        inline_image_prompt = retry_img
                    print(f"â Retry accepted: {retry_wc} words")
            except Exception:
                print("â ï¸ Retry failed, keeping first attempt")

        print(f"â Article generation succeeded")
    except Exception as e:
        raise RuntimeError(f"All LLM providers failed for article generation: {e}")

    if not article_text:
        raise RuntimeError("All LLM providers failed for article generation")

    word_count = len(article_text.split())
    print(f"ð Article: {word_count} words")

    # 6. Title — already generated inline with article (no separate API call needed)
    title = ""
    if inline_title and len(inline_title.split()) >= 6:
        title = inline_title
        print(f"📰 Inline Title ({len(title.split())} words): \"{title}\"")
    else:
        # Fallback: extract from article content
        print("📰 Inline title missing, building from article content...")
        fallback = article_text.replace("**", "").strip()
        segments = re.split(r'[\n•\-]', fallback)
        segments = [s.strip().rstrip('.').strip() for s in segments if s.strip()]
        good_segments = [
            s for s in segments
            if 8 <= len(s.split()) <= 30
            and not s.lower().startswith(('search results', 'the query', 'json', '{', 'output', 'return', 'note:', 'source:'))
            and not re.match(r'^\s*[\{\[]', s)
            and not re.match(r'^https?://', s)
        ]
        if good_segments:
            raw_fb = re.sub(r'[\*\#\_\`]', '', good_segments[0]).strip()
            words = raw_fb.split()
            if len(words) > 20:
                raw_fb = ' '.join(words[:20])
            title = raw_fb
        else:
            title = f"{topic.title()} — Latest Developments and Key Updates"
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

    # 7. Image prompt — already generated inline with article (no separate API call)
    QUALITY_BOOST = (
        "cinematic composition, high resolution, sharp focus, "
        "professional color grading, no text no words no letters no watermarks"
    )
    detected_cat = (ai_category or category or "general").lower().strip()

    if inline_image_prompt and len(inline_image_prompt.split()) >= 8:
        image_prompt = f"{inline_image_prompt}, {QUALITY_BOOST}"
        print(f'🎨 Inline Image Prompt ({len(image_prompt.split())} words): "{image_prompt[:150]}..."')
    else:
        # Fallback: build a descriptive prompt from title + topic
        print("🎨 Inline image prompt missing, building from article content...")
        image_prompt = f"{title}, {topic}, {detected_cat} news, editorial photography, {QUALITY_BOOST}"
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
    #    NO time limit — let the engine use the full 15-min workflow aggressively
    article_id = str(uuid.uuid4())
    heartbeat.start("generating image...")
    try:
        image_url = generate_and_upload_image(image_prompt, article_id,
                                              fallback_query=title, fallback_category=category)
    except Exception as img_err:
        print(f"⚠️ Image generation crashed: {str(img_err)[:200]} — using placeholder")
        image_url = PLACEHOLDER_IMAGE_URL
    finally:
        heartbeat.stop()

    # 10. Save to Firestore

    news_item = {
        "id": article_id,
        "title": title,
        "summary": article_text,
        "image_url": image_url,
        "source_urls": source_urls,  # plain URLs for dedup/history
        "sources": source_sources,   # rich sources: [{url, title}] for frontend display
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
    # Share one time origin with the image-generation deadline so the whole run
    # (incl. retries) stays under the 15-min job wall.
    MAX_RETRY_SECONDS = PIPELINE_SOFT_BUDGET  # keep total runtime under the 15-min job wall
    RETRY_WAIT = 60          # wait 60 seconds between retries
    start_time = PIPELINE_START
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
            heartbeat.start(f"Waiting {RETRY_WAIT}s before retry...")
            time.sleep(RETRY_WAIT)
            heartbeat.stop()
