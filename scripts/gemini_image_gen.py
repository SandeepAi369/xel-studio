#!/usr/bin/env python3
"""
Gemini Web Image Generation (Cookie-based)
============================================
Generates images via Google Gemini's web interface using gemini-webapi.
Uses your premium Google account cookies — no API key quotas.

Auth: Requires __Secure-1PSID and __Secure-1PSIDTS cookies from gemini.google.com

Usage:
    # As a module:
    from gemini_image_gen import generate_image_gemini
    img_bytes = generate_image_gemini("A futuristic city")

    # Standalone test:
    python scripts/gemini_image_gen.py "A robot painting"
"""

import asyncio
import os
import sys
import time
import tempfile

try:
    from gemini_webapi import GeminiClient
    _webapi_available = True
except ImportError:
    _webapi_available = False


async def _generate_image_async(prompt: str, psid: str, psidts: str) -> bytes | None:
    """Async image generation via Gemini web interface."""
    client = GeminiClient(psid, psidts)
    await client.init(timeout=60, auto_close=True, close_delay=30, auto_refresh=True)

    # Ask Gemini to generate an image (must use "generate" keyword)
    image_prompt = f"Generate a photorealistic image: {prompt}"
    response = await client.generate_content(image_prompt)

    if response.images:
        # Save first generated image to temp file and read bytes
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

    for attempt in range(1, retries + 1):
        try:
            print(f"  🎨 Gemini Web [{attempt}/{retries}] generating image...")

            image_bytes = asyncio.run(_generate_image_async(prompt, psid, psidts))

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
    print("🧪 GEMINI WEB IMAGE GENERATION TEST")
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
