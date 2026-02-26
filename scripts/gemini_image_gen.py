#!/usr/bin/env python3
"""
Gemini Web Image Generation (Cookie-based + Indian Proxy)
==========================================================
Generates images via Google Gemini's web interface using gemini-webapi.
Routes all requests through Indian proxy to match cookie origin IP.

Auth: Requires __Secure-1PSID and __Secure-1PSIDTS cookies from gemini.google.com
Proxy: Fetches free Indian proxies automatically before each request.

Usage:
    from gemini_image_gen import generate_image_gemini
    img_bytes = generate_image_gemini("A futuristic city")
"""

import asyncio
import os
import sys
import time
import tempfile
import requests

try:
    from gemini_webapi import GeminiClient
    _webapi_available = True
except ImportError:
    _webapi_available = False


# ── Free Indian Proxy Fetcher ────────────────────────────────

# Sources for free Indian HTTP/HTTPS proxies (updated frequently)
PROXY_SOURCES = [
    "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
]

_cached_indian_proxies: list[str] = []
_proxy_cache_time: float = 0
PROXY_CACHE_TTL = 600  # 10 min cache


def _fetch_indian_proxies() -> list[str]:
    """Fetch free Indian proxy IPs from public lists, filtered by geo-check."""
    global _cached_indian_proxies, _proxy_cache_time

    # Return cached if fresh
    if _cached_indian_proxies and (time.time() - _proxy_cache_time) < PROXY_CACHE_TTL:
        return _cached_indian_proxies

    all_proxies = []
    for source_url in PROXY_SOURCES:
        try:
            resp = requests.get(source_url, timeout=10)
            if resp.status_code == 200:
                lines = resp.text.strip().split("\n")
                all_proxies.extend([l.strip() for l in lines if l.strip() and ":" in l])
        except Exception:
            continue

    if not all_proxies:
        print("  ⚠️ Could not fetch any proxy lists")
        return []

    print(f"  🌐 Fetched {len(all_proxies)} proxies from {len(PROXY_SOURCES)} sources")

    # Test proxies for Indian geo (check via ip-api.com)
    indian_proxies = []
    tested = 0
    for proxy_str in all_proxies[:100]:  # Test max 100
        if len(indian_proxies) >= 5:  # Get 5 working Indian proxies
            break
        tested += 1
        try:
            proxy_url = f"http://{proxy_str}"
            r = requests.get(
                "http://ip-api.com/json/?fields=countryCode",
                proxies={"http": proxy_url, "https": proxy_url},
                timeout=5,
            )
            if r.status_code == 200:
                data = r.json()
                if data.get("countryCode") == "IN":
                    indian_proxies.append(proxy_str)
                    print(f"  ✅ Indian proxy found: {proxy_str}")
        except Exception:
            continue

    print(f"  🇮🇳 Found {len(indian_proxies)} Indian proxies (tested {tested})")

    _cached_indian_proxies = indian_proxies
    _proxy_cache_time = time.time()
    return indian_proxies


# ── Gemini Image Generation ──────────────────────────────────


async def _generate_image_async(prompt: str, psid: str, psidts: str, proxy: str | None = None) -> bytes | None:
    """Async image generation via Gemini web interface with optional proxy."""
    kwargs = {}
    if proxy:
        proxy_url = f"http://{proxy}"
        kwargs["proxies"] = {"https": proxy_url, "http": proxy_url}
        print(f"  🌐 Routing through Indian proxy: {proxy}")

    client = GeminiClient(psid, psidts, proxy=proxy_url if proxy else None)
    await client.init(timeout=60, auto_close=True, close_delay=30, auto_refresh=True)

    image_prompt = f"Generate a photorealistic image: {prompt}"
    response = await client.generate_content(image_prompt)

    if response.images:
        img = response.images[0]
        with tempfile.TemporaryDirectory() as tmpdir:
            filepath = os.path.join(tmpdir, "generated.png")
            await img.save(path=tmpdir, filename="generated.png")
            if os.path.isfile(filepath):
                with open(filepath, "rb") as f:
                    return f.read()

    return None


def generate_image_gemini(
    prompt: str,
    retries: int = 2,
) -> bytes | None:
    """
    Generate an image using Gemini's web interface (cookie-based).
    Automatically routes through Indian proxy to prevent IP mismatch.

    Args:
        prompt: Text description of the image to generate.
        retries: Number of retry attempts.

    Returns:
        Image bytes (PNG/JPEG) or None if generation fails.
    """
    if not _webapi_available:
        print("  ⚠️ gemini-webapi not installed. Run: pip install gemini-webapi")
        return None

    psid = os.environ.get("GEMINI_SECURE_1PSID", "")
    psidts = os.environ.get("GEMINI_SECURE_1PSIDTS", "")

    if not psid:
        print("  ⚠️ No GEMINI_SECURE_1PSID set — skipping Gemini web image generation")
        return None

    # Fetch Indian proxies to route requests through Indian IP
    indian_proxies = _fetch_indian_proxies()

    for attempt in range(1, retries + 1):
        # Pick a proxy for this attempt (cycle through available ones)
        proxy = indian_proxies[(attempt - 1) % len(indian_proxies)] if indian_proxies else None

        try:
            print(f"  🎨 Gemini Web [{attempt}/{retries}] generating image...")
            if not proxy:
                print(f"  ⚠️ No Indian proxy available, trying direct connection...")

            image_bytes = asyncio.run(_generate_image_async(prompt, psid, psidts, proxy))

            if image_bytes and len(image_bytes) > 1000:
                print(f"  ✅ Gemini Web: generated {len(image_bytes):,} bytes")
                return image_bytes
            elif image_bytes:
                print(f"  ⚠️ Image too small: {len(image_bytes)} bytes")
            else:
                print(f"  ⚠️ No image in response (Gemini may have returned text only)")

        except Exception as e:
            err_str = str(e)
            print(f"  ❌ Gemini Web error [{attempt}]: {err_str[:200]}")

            # If proxy failed, try next proxy
            if proxy and indian_proxies:
                indian_proxies.remove(proxy)
                print(f"  🔄 Removed bad proxy, {len(indian_proxies)} remaining")

            if attempt < retries:
                wait = 5 * attempt
                print(f"  ⏳ Waiting {wait}s before retry...")
                time.sleep(wait)

    print(f"  ❌ Gemini Web: all {retries} attempts failed")
    return None


# ── Standalone test ──────────────────────────────────────────
if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))
    except ImportError:
        pass

    prompt = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else (
        "A futuristic cityscape at golden hour, photorealistic, "
        "cinematic lighting, highly detailed, 8k"
    )

    print("=" * 60)
    print("🧪 GEMINI WEB IMAGE GENERATION TEST (with Indian Proxy)")
    print("=" * 60)
    print(f"📝 Prompt: \"{prompt[:80]}...\"")
    print()

    t0 = time.time()
    result = generate_image_gemini(prompt)
    duration = time.time() - t0

    print()
    print(f"⏱️  Duration: {duration:.1f}s")

    if result:
        if result[:8] == b'\x89PNG\r\n\x1a\n':
            fmt = "PNG"
        elif result[:2] == b'\xff\xd8':
            fmt = "JPEG"
        elif result[:4] == b'RIFF':
            fmt = "WebP"
        else:
            fmt = "unknown"

        out_path = os.path.join(os.path.dirname(__file__), "test_gemini_output.png")
        with open(out_path, "wb") as f:
            f.write(result)

        print(f"📊 Format: {fmt}, Size: {len(result):,} bytes")
        print(f"💾 Saved to: {out_path}")
        print("✅ TEST PASSED")
    else:
        print("❌ No image generated")
        print("❌ TEST FAILED")
        sys.exit(1)

    print("=" * 60)
