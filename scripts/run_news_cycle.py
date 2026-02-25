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
    "Meta AI Llama open source model news",
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

    # ── Climate & Environment ──
    "climate change environmental research news",
    "climate technology clean energy innovation news",
    "climate policy energy transition sustainability news",

    # ── World Affairs & Geopolitics ──
    "geopolitical technology competition world news",
    "international trade technology policy news",
    "digital privacy surveillance regulation world news",

    # ── CEO & Business Leaders ──
    "tech CEO statements leadership announcements news",
    "Elon Musk Sam Altman Sundar Pichai CEO news",
    "tech industry leader interview insights news",

    # ── Science & Space ──
    "space technology SpaceX NASA launch news",
    "science discovery research breakthrough news",
    "biotechnology genetics medical research news",

    # ── Health & Society ──
    "healthcare technology innovation AI news",
    "mental health digital wellness technology news",

    # ── Business & Economy ──
    "tech company earnings big tech stock news",
    "tech startup unicorn IPO funding news",
    "cryptocurrency blockchain Web3 news",

    # ── Culture & Entertainment ──
    "social media platform changes updates news",
    "gaming esports streaming industry news",
]

FALLBACK_QUERIES = [
    "artificial intelligence news today",
    "latest technology breakthrough news",
    "tech CEO AI announcements today",
    "climate technology disability news today",
]

# ─── Helpers ─────────────────────────────────────────────────


def detect_category(query: str) -> str:
    """Detect category from search query."""
    q = query.lower()
    # Disability & Accessibility
    if any(kw in q for kw in [
        "disability", "assistive", "accessible", "accessibility", "inclusion",
    ]):
        return "accessibility"
    # Climate & Environment
    if any(kw in q for kw in [
        "climate", "environment", "clean energy", "sustainability", "energy transition",
    ]):
        return "climate"
    # Science & Space
    if any(kw in q for kw in [
        "space", "spacex", "nasa", "physics", "astronomy",
        "biotechnology", "genetics", "science discovery", "research breakthrough",
        "quantum",
    ]):
        return "science"
    # Health & Society
    if any(kw in q for kw in [
        "healthcare", "health", "mental health", "wellness",
    ]):
        return "health"
    # Business & Economy
    if any(kw in q for kw in [
        "earnings", "stock", "ipo", "funding", "startup", "unicorn",
        "crypto", "blockchain", "web3", "ceo", "leader",
    ]):
        return "business"
    # World & Geopolitics
    if any(kw in q for kw in [
        "geopolitical", "international", "trade", "privacy", "surveillance",
        "world", "regulation",
    ]):
        return "world"
    # Culture & Entertainment
    if any(kw in q for kw in [
        "social media", "streaming", "gaming", "esports", "entertainment",
    ]):
        return "entertainment"
    # AI & Tech (default)
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
            print("⚠️ No Cloudinary credentials — images will use Pollinations URL directly")





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


# ─── URL History ─────────────────────────────────────────────


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


# ─── Image Generation (Direct FLUX.1-dev) & Cloudinary Upload ─

# Calls HuggingFace Space FLUX.1-dev Gradio API directly — no g4f,
# no subprocess, no broken import patching. Same model g4f uses
# under the hood, but with a simple requests-based approach.

FLUX_SPACE_URL = "https://black-forest-labs-flux-1-dev.hf.space"
FLUX_API_NAME = "infer"
FLUX_TIMEOUT = 120  # seconds for image generation

POLLINATIONS_URL = "https://image.pollinations.ai/prompt"
POLLINATIONS_TIMEOUT = 60  # seconds

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


def _call_flux_gradio(prompt: str) -> str | None:
    """
    Call FLUX.1-dev HuggingFace Space via Gradio API.
    Returns the generated image URL, or None on failure.
    
    API flow: POST to queue → poll SSE for result → extract file URL.
    
    IMPORTANT: Gradio SSE sends multiple events:
      - event: generating  → intermediate progress frames (noisy/incomplete)
      - event: complete     → final rendered image
    We MUST wait for 'complete' and ignore 'generating' frames.
    """
    import json as _json

    hf_token = os.environ.get("HF_TOKEN", "")
    headers = {"Authorization": f"Bearer {hf_token}"} if hf_token else {}

    # Step 1: Queue the generation request
    # Args: [prompt, seed, randomize_seed, width, height, guidance_scale, num_steps]
    try:
        print(f"  📤 Queuing FLUX.1-dev generation...")
        queue_resp = requests.post(
            f"{FLUX_SPACE_URL}/gradio_api/call/{FLUX_API_NAME}",
            json={"data": [prompt, 0, True, 1024, 1024, 3.5, 28]},
            headers=headers,
            timeout=30,
        )
        if queue_resp.status_code != 200:
            print(f"  ❌ Queue failed ({queue_resp.status_code}): {queue_resp.text[:150]}")
            return None
        event_id = queue_resp.json().get("event_id")
        print(f"  📋 Queued: event_id={event_id}")
    except Exception as e:
        print(f"  ❌ Queue request failed: {e}")
        return None

    # Step 2: Poll SSE stream for the FINAL result
    try:
        print(f"  ⏳ Waiting for FLUX.1-dev result (timeout={FLUX_TIMEOUT}s)...")
        sse_resp = requests.get(
            f"{FLUX_SPACE_URL}/gradio_api/call/{FLUX_API_NAME}/{event_id}",
            headers=headers,
            stream=True,
            timeout=FLUX_TIMEOUT,
        )

        image_url = None
        current_event = ""

        for line in sse_resp.iter_lines(decode_unicode=True):
            if not line:
                continue

            # Track the SSE event type
            if line.startswith("event: "):
                current_event = line[7:].strip()
                if current_event == "generating":
                    print(f"  🔄 Generating (progress frame, skipping)...")
                continue

            # Only process data from "complete" events
            if not line.startswith("data: "):
                continue

            # Skip data from intermediate "generating" events (latent noise frames)
            if current_event != "complete":
                continue

            raw = line[6:]
            if not (raw.startswith("[") or raw.startswith("{")):
                continue

            try:
                parsed = _json.loads(raw)
                if isinstance(parsed, list):
                    for item in parsed:
                        if isinstance(item, dict):
                            url = item.get("url", "")
                            if url:
                                if not url.startswith("http"):
                                    image_url = f"{FLUX_SPACE_URL}/gradio_api/file={url}"
                                else:
                                    image_url = url
                                break
            except _json.JSONDecodeError:
                pass

            if image_url:
                break

        if image_url:
            print(f"  📎 FLUX final image: {image_url[:100]}...")
        else:
            print(f"  ❌ No image URL in FLUX response")
        return image_url


    except requests.exceptions.Timeout:
        print(f"  ❌ FLUX timed out after {FLUX_TIMEOUT}s")
        return None
    except Exception as e:
        print(f"  ❌ FLUX SSE error: {e}")
        return None


def _call_pollinations(prompt: str) -> bytes | None:
    """Fallback: Generate image via Pollinations.ai (free, no API key)."""
    import urllib.parse as _urlparse

    encoded = _urlparse.quote(prompt[:500])
    url = f"{POLLINATIONS_URL}/{encoded}?width=1024&height=576&nologo=true"
    print(f"  🌸 Trying Pollinations.ai fallback...")

    try:
        resp = requests.get(url, timeout=POLLINATIONS_TIMEOUT)
        if resp.status_code == 200 and len(resp.content) > 5000:
            print(f"  ✅ Pollinations returned {len(resp.content)} bytes")
            return resp.content
        print(f"  ❌ Pollinations: status={resp.status_code}, size={len(resp.content)}")
        return None
    except Exception as e:
        print(f"  ❌ Pollinations failed: {e}")
        return None


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


def generate_and_upload_image(prompt: str, article_id: str) -> str:
    """
    Image pipeline with 3-level fallback:
      1. FLUX.1-dev (HuggingFace Space) → Cloudinary
      2. Pollinations.ai (free) → Cloudinary
      3. Placeholder → Cloudinary
    """
    import re as _re

    print(f"\n{'─'*50}")
    print("🖼️ IMAGE PIPELINE (FLUX → Pollinations → Placeholder)")
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

    # ── Attempt 1: FLUX.1-dev ────────────────────────────────
    image_url = _call_flux_gradio(enhanced_prompt)
    if image_url:
        try:
            print(f"  ⬇️ Downloading FLUX image...")
            dl = requests.get(image_url, timeout=60)
            dl.raise_for_status()
            if len(dl.content) > 1000:
                result = _upload_bytes_to_cloudinary(dl.content, article_id)
                if result:
                    print(f"  ✅ IMAGE SUCCESS (FLUX.1-dev → Cloudinary)")
                    return result
        except Exception as e:
            print(f"  ❌ FLUX download failed: {e}")

    # ── Attempt 2: Pollinations.ai ───────────────────────────
    poll_bytes = _call_pollinations(clean_prompt)
    if poll_bytes:
        result = _upload_bytes_to_cloudinary(poll_bytes, article_id)
        if result:
            print(f"  ✅ IMAGE SUCCESS (Pollinations → Cloudinary)")
            return result

    # ── Attempt 3: Placeholder ───────────────────────────────
    print(f"  ⚠️ All image sources failed, using placeholder")
    return _upload_placeholder_to_cloudinary(article_id)


# ─── Parse JSON Response ─────────────────────────────────────


def parse_article_response(text: str) -> str:
    """Extract articleText from JSON response."""
    clean = text.strip()
    if clean.startswith("```"):
        import re
        clean = re.sub(r"^```(?:json)?\s*\n?", "", clean)
        clean = re.sub(r"\n?```\s*$", "", clean)
    try:
        parsed = json.loads(clean)
        if "articleText" in parsed:
            return parsed["articleText"].strip()
    except json.JSONDecodeError:
        pass
    return clean


# ─── Cerebras LLM ────────────────────────────────────────────


def call_cerebras(client: Cerebras, model: str, system_prompt: str, user_prompt: str) -> str:
    """Call Cerebras API and return article text."""
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
    Daily cleanup:
      1. Delete the 15 OLDEST articles from 'news' collection
         → Before deleting, archive their source URLs to 'news_history'
           so the AI dedup system remembers them and won't regenerate.
      2. Purge 'news_history' entries older than 10 days (they've served
         their dedup purpose by then).
    """
    print("\n🧹 CLEANUP — Removing old news...")

    # ── 1. Delete the 15 oldest articles from 'news' ─────────
    try:
        # Get all news ordered by date ASCENDING (oldest first)
        all_news = list(
            db.collection(COLLECTION)
            .order_by("date", direction=firestore.Query.ASCENDING)
            .stream()
        )
        total = len(all_news)

        if total <= 15:
            print(f"  ✅ Only {total} articles — no cleanup needed yet")
        else:
            # Take the 15 oldest
            to_delete = all_news[:15]
            batch = db.batch()
            count = 0

            for doc_snap in to_delete:
                data = doc_snap.to_dict()

                # ── Archive to news_history BEFORE deleting ──
                # This ensures the AI remembers these URLs for dedup
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
            print(f"  🗑️ Deleted {count} oldest articles (of {total} total), archived to history for dedup")

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
    print("⚡ NEWS PIPELINE (GitHub Actions) — Cerebras + Tavily + FLUX/Pollinations + Cloudinary")

    # Init services
    db = init_firebase()
    init_cloudinary()

    # Run cleanup before generating new article
    cleanup_old_news(db)

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

    # 3. Load URL history + Run Tavily search
    known_urls = load_history_urls(db)
    initial_result = search_tavily(search_query, 3)

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
        fallback_result = search_tavily(fallback_query, 3)
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

    # 5. Cerebras article generation
    system_prompt = (
        'You are a strict, factual tech journalist. You MUST output valid JSON with exactly one key: '
        '"articleText". No other keys, no markdown, no explanation — ONLY the JSON object.'
    )

    cerebras_data = [{"title": r["title"], "description": r["description"]} for r in scraped_data]

    user_prompt = f"""Write a news article based ONLY on the search results below.

Search results:
{json.dumps(cerebras_data, indent=2)}

STRICT RULES FOR articleText:
1. Write STRICTLY based on facts from the search results above. NO speculation, NO invented info.
2. Pick the single most prominent or interesting news story. Do NOT mix unrelated topics.
3. Write clean, professional prose that a news reader would enjoy. Rewrite facts naturally.
4. Structure as 2-3 well-developed paragraphs separated by double newlines.
5. Start with a punchy, attention-grabbing opening. Do NOT start with "In" or "The".
6. NEVER mention search engines, APIs, scraped data, prompts, or internal system details.
7. NEVER include specific dates like "as of February 2026" or "on February 22". Write timelessly — use phrases like "recently", "this week", or just state the news directly without date references.
8. Include relevant context: who, what, where, why, and implications.

WORD COUNT REQUIREMENT (CRITICAL):
- You MUST write BETWEEN 175 and 225 words. This is MANDATORY.
- Under 170 words is COMPLETELY UNACCEPTABLE.
- Count your words. If under 175, ADD factual context, background, or analysis.

Return JSON: {{ "articleText": "your 175-225 word article" }}"""

    MODELS = ["gpt-oss-120b", "llama3.1-8b"]
    article_text = ""
    used_model = ""

    for model_name in MODELS:
        try:
            print(f"🔄 Trying Cerebras model: {model_name}")
            article_text = call_cerebras(cerebras_client, model_name, system_prompt, user_prompt)
            used_model = model_name

            word_count = len(article_text.split())
            print(f"📝 First attempt: {word_count} words")

            # Auto-retry if too short
            if word_count < 170:
                print(f"⚠️ Too short ({word_count} words), retrying...")
                retry_prompt = f"""{user_prompt}

CRITICAL CORRECTION: Your previous attempt was ONLY {word_count} words. UNACCEPTABLE.
You MUST write AT LEAST 175 words and NO MORE than 225 words.
Expand with more factual details, background context, industry implications.
Do NOT repeat the same content. ADD NEW substantive information."""

                try:
                    retry_text = call_cerebras(cerebras_client, model_name, system_prompt, retry_prompt)
                    retry_wc = len(retry_text.split())
                    print(f"📝 Retry: {retry_wc} words")
                    if retry_wc > word_count:
                        article_text = retry_text
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

    # 6. Generate image prompt (60-80 words, photorealistic editorial style)
    image_prompt = ""
    try:
        img_completion = cerebras_client.chat.completions.create(
            model="llama3.1-8b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert visual director for a premium news publication. You write "
                        "photorealistic image descriptions that look like award-winning editorial photographs. "
                        "Output ONLY the image description, nothing else. Never include any text, words, "
                        "letters, logos, or watermarks in the description."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Write a 60-80 word photorealistic image description for this news article. "
                        f"The image should look like a real editorial photograph, NOT sci-fi or cartoon.\n\n"
                        f"STYLE RULES:\n"
                        f"- Photorealistic, shot on Canon EOS R5, 85mm lens, f/2.8\n"
                        f"- Natural lighting (golden hour, soft studio, or dramatic overcast)\n"
                        f"- Real-world setting that matches the article topic (office, lab, city, etc.)\n"
                        f"- Include specific visual details: materials, textures, environment\n"
                        f"- Cinematic composition, shallow depth-of-field, 16:9 widescreen\n"
                        f"- NO neon, NO glowing effects, NO holographic elements\n"
                        f"- NO text, words, letters, or UI elements in the image\n\n"
                        f"Article: {article_text[:600]}"
                    ),
                },
            ],
            temperature=0.7,
            max_tokens=200,
        )
        image_prompt = (img_completion.choices[0].message.content or "").strip()
        # Remove any quotes wrapping the response
        if image_prompt.startswith('"') and image_prompt.endswith('"'):
            image_prompt = image_prompt[1:-1]
        print(f'🎨 Image prompt ({len(image_prompt.split())} words): "{image_prompt[:120]}..."')
    except Exception as e:
        print(f"⚠️ Image prompt generation failed: {e}")
        image_prompt = (
            "A wide-angle editorial photograph of a modern technology workspace, "
            "warm golden-hour light streaming through floor-to-ceiling windows, "
            "sleek minimalist desk with multiple monitors showing data visualizations, "
            "shallow depth-of-field, professional Canon EOS R5 photography, "
            "crisp details, natural color palette, 16:9 cinematic composition"
        )

    # 7. Generate professional headline via LLM
    title = ""
    try:
        title_completion = cerebras_client.chat.completions.create(
            model="llama3.1-8b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a headline writer for Reuters, Bloomberg, and The Wall Street Journal. "
                        "You write crisp, professional headlines that immediately communicate the news. "
                        "Output ONLY the headline text. No quotes, no explanation, no labels."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Write ONE professional news headline for this article.\n\n"
                        f"MANDATORY RULES:\n"
                        f"1. Exactly 8-14 words, Title Case\n"
                        f"2. Start with the WHO or WHAT (company name, person, or key noun)\n"
                        f"3. Use a strong active verb (Launches, Unveils, Reports, Acquires, Faces, etc.)\n"
                        f"4. ABSOLUTELY NO prefix labels — no 'AI News:', 'Tech:', 'Breaking:', 'Report:', etc.\n"
                        f"5. ABSOLUTELY NO colons in the headline\n"
                        f"6. MUST be specific — mention actual names, products, or numbers\n\n"
                        f"GOOD examples: 'OpenAI Launches GPT-5 With Advanced Reasoning Capabilities'\n"
                        f"BAD examples: 'AI News: Latest Technology Breakthrough Updates Today'\n\n"
                        f"Article: {article_text[:500]}"
                    ),
                },
            ],
            temperature=0.4,
            max_tokens=50,
        )
        raw_title = (title_completion.choices[0].message.content or "").strip()
        # Clean up: remove any quotes, prefix patterns, or colons the LLM might add
        import re as _re
        raw_title = raw_title.strip('"\'')
        raw_title = _re.sub(r'^(Breaking|Update|Report|News|Spotlight|Alert|Headline|Tech|AI|Analysis)[:\s]+', '', raw_title, flags=_re.IGNORECASE)
        # Remove leading colon if still present
        raw_title = _re.sub(r'^[:\s]+', '', raw_title)
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

    # 8. Generate image via FLUX.1-dev + upload to Cloudinary
    article_id = str(uuid.uuid4())
    image_url = generate_and_upload_image(image_prompt, article_id)

    # 9. Save to Firestore

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
    print(f"   Image:    {'Cloudinary (FLUX.1-dev)' if 'cloudinary' in image_url else 'Placeholder'}")
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
