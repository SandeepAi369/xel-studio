#!/usr/bin/env python3
"""
News Pipeline Worker — GitHub Actions Background Runner
========================================================
Pipeline: Dynamic Query → Tavily Search → URL Dedup →
          Cerebras (GPT-OSS 120B / llama3.1-8b) → g4f Image Gen (Flux/DALL-E) →
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

# ─── Search Queries (categorized) ────────────────────────────

SEARCH_QUERIES = [
    # ── AI & Tech (merged category) ──
    "artificial intelligence latest news breakthroughs",
    "OpenAI Google DeepMind Anthropic AI announcements",
    "generative AI tools products launches",
    "AI industry acquisitions funding deals",
    "Nvidia AMD semiconductor chip AI hardware news",
    "Apple Google Microsoft tech announcements",
    "Sam Altman Sundar Pichai Satya Nadella CEO statements AI",
    "Elon Musk xAI Grok AI news",
    "Meta AI Mark Zuckerberg announcements",
    "Amazon AWS Bedrock AI cloud updates",
    "AI regulation policy government updates",
    "machine learning research papers breakthroughs",
    "robotics automation AI industry news",
    "quantum computing AI breakthrough news",
    "cybersecurity AI threats data breach news",
    "tech startup unicorn funding news",
    "cloud computing infrastructure updates",
    "space technology SpaceX NASA news",
    "electric vehicle autonomous driving AI news",
    # ── Disability ──
    "disability technology assistive tech accessibility news",
    "disability rights inclusion policy news",
    "accessible technology innovations disabled people",
    "disability employment inclusion workplace news",
    "disability awareness advocacy campaign news",
    "assistive devices AI disability healthcare",
    "special education disability inclusion schools news",
    "disability sports paralympics achievements news",
    # ── World ──
    "global technology regulation policy news",
    "geopolitical technology competition news",
    "international tech policy digital sovereignty",
    "global economy technology impact news",
    "climate technology clean energy innovation news",
    # ── General ──
    "social media platform changes updates news",
    "healthcare technology innovation news",
    "education technology digital learning news",
    "fintech digital payments banking innovation news",
    "entertainment streaming gaming industry news",
    "science discovery research breakthrough news",
]

FALLBACK_QUERIES = [
    "technology AI news today",
    "latest tech announcements",
    "disability accessibility news",
    "science innovation news",
]

# ─── Helpers ─────────────────────────────────────────────────


def detect_category(query: str) -> str:
    q = query.lower()
    # Disability keywords
    if any(kw in q for kw in [
        "disability", "assistive", "accessible", "accessibility",
        "inclusion", "paralympic", "special education",
    ]):
        return "disability"
    # World / geopolitical
    if any(kw in q for kw in [
        "global", "geopolitical", "international", "sovereignty",
        "climate", "regulation policy",
    ]):
        return "world"
    # AI & Tech
    if any(kw in q for kw in [
        "ai", "artificial intelligence", "openai", "nvidia", "tech",
        "chip", "cloud", "quantum", "robot", "cyber", "startup",
        "spacex", "nasa", "electric vehicle", "ceo", "altman",
        "pichai", "nadella", "zuckerberg", "musk",
    ]):
        return "ai-tech"
    return "general"


def generate_title(topic: str, category: str) -> str:
    prefixes = {
        "ai-tech": ["AI & Tech:", "Tech Update:", "AI News:", "Innovation:", "Tech Spotlight:"],
        "disability": ["Accessibility:", "Disability News:", "Inclusion Update:", "Disability & Tech:"],
        "world": ["Global Update:", "World News:", "Global Tech:", "World Report:"],
        "general": ["News:", "Update:", "Report:", "Spotlight:"],
    }
    prefix = random.choice(prefixes.get(category, prefixes["general"]))
    return f"{prefix} {topic}"


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


# ─── Image Generation (g4f) & Cloudinary Upload ─────────────

# g4f handles provider rotation internally (Pollinations, Together, etc.)
# We generate the image, download the bytes, upload to Cloudinary,
# and save the Cloudinary URL to Firestore.

IMAGE_MODELS = ["flux", "flux-realism", "sdxl", "dalle"]
IMAGE_MAX_RETRIES = 3
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


def generate_and_upload_image(prompt: str, article_id: str) -> str:
    """
    Generate image via g4f library (multi-provider, multi-model),
    download the actual image bytes, upload to Cloudinary,
    and return the Cloudinary secure URL.

    Falls back through: flux → flux-realism → sdxl → dalle
    g4f handles provider rotation internally for each model.
    """
    import re as _re
    import sys
    import types
    import base64

    # ─── Patch broken g4f Copilot provider ───
    # g4f has a broken Copilot.py module (typo 'click_trunstile' and
    # missing dependencies). We create a complete mock module with
    # a dummy Copilot class so g4f's provider discovery doesn't crash.
    for mod_name in [
        "g4f.Provider.Copilot",
        "g4f.Provider.needs_auth.Copilot",
    ]:
        if mod_name not in sys.modules:
            dummy = types.ModuleType(mod_name)
            # Create a dummy Copilot class
            dummy_class = type("Copilot", (), {
                "__init__": lambda self, *a, **kw: None,
                "create_completion": lambda *a, **kw: iter([]),
                "create_async_generator": lambda *a, **kw: None,
                "supports_message_history": True,
                "supports_system_message": True,
                "supports_stream": True,
                "working": False,  # Mark as non-working so g4f skips it
                "url": "",
                "model": "",
            })
            dummy.Copilot = dummy_class
            dummy.click_trunstile = lambda *a, **kw: None
            sys.modules[mod_name] = dummy

    g4f_available = False
    G4FClient = None
    try:
        from g4f.client import Client as G4FClient
        g4f_available = True
        print("  ✅ g4f client imported successfully")
    except Exception as e:
        print(f"  ⚠️ g4f import issue: {e}")
        # Try alternative: import just PollinationsAI provider directly
        try:
            from g4f.client import Client as G4FClient
            g4f_available = True
            print("  ✅ g4f client imported on second attempt")
        except Exception as e2:
            print(f"  ❌ g4f import fully failed: {e2}")
            print("  🔄 Falling back to placeholder...")
            return _upload_placeholder_to_cloudinary(article_id)

    print(f"\n{'─'*50}")
    print("🖼️ IMAGE PIPELINE START (g4f → Cloudinary)")
    print(f"   Article ID: {article_id}")
    print(f"   Models to try: {IMAGE_MODELS}")
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

    g4f_client = G4FClient()
    last_error = ""

    for attempt, model_name in enumerate(IMAGE_MODELS, 1):
        print(f"\n  🎨 Attempt {attempt}/{len(IMAGE_MODELS)} — Model: {model_name}")

        # Step 1: Generate image via g4f
        image_url = None
        try:
            print(f"  ⬇️ Calling g4f images.generate(model='{model_name}')...")
            response = g4f_client.images.generate(
                model=model_name,
                prompt=enhanced_prompt,
                response_format="url",
            )

            if response and response.data and len(response.data) > 0:
                image_url = response.data[0].url
                print(f"  📎 g4f returned URL: {image_url[:100]}...")
            else:
                print(f"  ❌ g4f returned empty response")
                continue

        except Exception as e:
            last_error = str(e)
            print(f"  ❌ g4f generate failed: {last_error[:200]}")
            time.sleep(2)
            continue

        if not image_url:
            print(f"  ❌ No image URL from g4f")
            continue

        # Step 2: Download the actual image bytes
        image_bytes = None
        try:
            print(f"  ⬇️ Downloading image from URL (timeout=60s)...")
            dl_resp = requests.get(image_url, timeout=60)
            dl_resp.raise_for_status()

            content_type = dl_resp.headers.get("content-type", "")
            content_length = len(dl_resp.content)
            print(f"  📦 Download: type={content_type}, size={content_length} bytes")

            if content_length < 1000:
                print(f"  ❌ Image too small ({content_length} bytes), likely error page")
                continue

            image_bytes = dl_resp.content
            print(f"  ✅ Image downloaded: {content_length} bytes")

        except Exception as e:
            last_error = str(e)
            print(f"  ❌ Image download failed: {last_error[:200]}")
            time.sleep(2)
            continue

        # Step 3: Upload to Cloudinary
        try:
            print(f"  ☁️ Uploading to Cloudinary (public_id=xel-news/{article_id})...")
            result = cloudinary.uploader.upload(
                image_bytes,
                public_id=article_id,
                folder="xel-news",
                resource_type="image",
                overwrite=True,
            )
            cloudinary_url = result.get("secure_url", "")
            print(f"  ☁️ Cloudinary URL: {cloudinary_url[:80]}...")
            print(f"  ☁️ Format: {result.get('format')}, "
                  f"Size: {result.get('bytes')} bytes, "
                  f"Dims: {result.get('width')}x{result.get('height')}")

            if cloudinary_url:
                print(f"  ✅ IMAGE PIPELINE SUCCESS — Cloudinary URL ready")
                return cloudinary_url
            else:
                print(f"  ❌ Cloudinary returned empty URL")
                continue

        except Exception as e:
            last_error = str(e)
            print(f"  ❌ Cloudinary upload failed: {last_error[:200]}")
            continue

    # All models exhausted — upload placeholder to Cloudinary
    print(f"\n  ⚠️ All {len(IMAGE_MODELS)} models failed. Last error: {last_error[:100]}")
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


# ─── Main Pipeline ───────────────────────────────────────────


def generate_news():
    t0 = time.time()
    print("⚡ NEWS PIPELINE (GitHub Actions) — Cerebras GPT-OSS 120B + Tavily + Cloudinary")

    # Init services
    db = init_firebase()
    init_cloudinary()

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

    # 6. Generate image prompt
    image_prompt = ""
    try:
        img_completion = cerebras_client.chat.completions.create(
            model="llama3.1-8b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You generate stunning, futuristic, high-detail image descriptions for news article "
                        "thumbnails. Output ONLY the description text, nothing else. No quotes, no explanation."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Based on this news article, write a 40-60 word futuristic and stylish image description "
                        f"for an AI image generator. The image should be dramatic, editorial-quality, widescreen "
                        f"16:9. Include: glowing neon light effects, rich vibrant colors, futuristic technology "
                        f"elements, cinematic depth-of-field, photorealistic detail. The image must fully cover "
                        f"the frame edge-to-edge with no borders or empty space. Do NOT include any text, words, "
                        f"or letters in the image.\n\nArticle: {article_text[:600]}"
                    ),
                },
            ],
            temperature=0.8,
            max_tokens=150,
        )
        image_prompt = (img_completion.choices[0].message.content or "").strip()
        print(f'🎨 Image prompt: "{image_prompt[:100]}..."')
    except Exception as e:
        print(f"⚠️ Image prompt generation failed: {e}")
        image_prompt = (
            "futuristic technology command center with glowing holographic displays, "
            "neon blue and purple ambient lighting, sleek metallic surfaces with reflections, "
            "dramatic cinematic wide-angle shot, photorealistic editorial photograph, "
            "edge-to-edge composition"
        )

    # 7. Generate title
    title = generate_title(topic, category)

    # 8. Generate image via g4f + upload to Cloudinary
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
    print(f"   Image:    {'Cloudinary (g4f)' if 'cloudinary' in image_url else 'Placeholder'}")
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
