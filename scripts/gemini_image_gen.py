#!/usr/bin/env python3
"""
Gemini Official API Image Generation
======================================
Generates images via Google's official Gemini API using google-genai SDK.
Uses API key authentication — no cookies, no IP restrictions, no proxies.

Models (in order of preference):
  1. gemini-3.1-flash-image-preview (Nano Banana 2) — best all-around
  2. gemini-2.5-flash-image (Nano Banana) — high-volume, fast, 500 free/day

Auth: Requires GEMINI_API_KEY from https://aistudio.google.com/apikey

Usage:
    # As a module:
    from gemini_image_gen import generate_image_gemini
    img_bytes = generate_image_gemini("A futuristic city")

    # Standalone test:
    python scripts/gemini_image_gen.py "A robot painting"
"""

import os
import sys
import time
import base64

try:
    from google import genai
    _genai_available = True
except ImportError:
    _genai_available = False


# Models in priority order (newest → stable fallback)
GEMINI_IMAGE_MODELS = [
    "gemini-3.1-flash-image-preview",   # Nano Banana 2 (launched Feb 26, 2026)
    "gemini-2.5-flash-image",           # Nano Banana (stable, 500 free/day)
]


def generate_image_gemini(
    prompt: str,
    retries: int = 2,
) -> bytes | None:
    """
    Generate an image using Google's official Gemini API.

    Args:
        prompt: Text description of the image to generate.
        retries: Number of retry attempts per model.

    Returns:
        Image bytes (PNG) or None if generation fails.
    """
    if not _genai_available:
        print("  ⚠️ google-genai not installed. Run: pip install google-genai")
        return None

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("  ⚠️ No GEMINI_API_KEY set — skipping Gemini image generation")
        return None

    client = genai.Client(api_key=api_key)

    for model in GEMINI_IMAGE_MODELS:
        print(f"  🎨 Trying model: {model}")

        for attempt in range(1, retries + 1):
            try:
                print(f"  🎨 Gemini API [{attempt}/{retries}] generating image...")

                response = client.models.generate_content(
                    model=model,
                    contents=[f"Generate a photorealistic image: {prompt}"],
                )

                # Extract image from response parts
                if response and response.candidates:
                    for part in response.candidates[0].content.parts:
                        if hasattr(part, 'inline_data') and part.inline_data is not None:
                            image_bytes = part.inline_data.data
                            if isinstance(image_bytes, str):
                                image_bytes = base64.b64decode(image_bytes)

                            if image_bytes and len(image_bytes) > 1000:
                                print(f"  ✅ Gemini API: generated {len(image_bytes):,} bytes ({model})")
                                return image_bytes
                            else:
                                print(f"  ⚠️ Image too small: {len(image_bytes) if image_bytes else 0} bytes")

                print(f"  ⚠️ No image in response (model may have returned text only)")

            except Exception as e:
                err_str = str(e)
                print(f"  ❌ Gemini API error [{attempt}]: {err_str[:200]}")

                if attempt < retries:
                    wait = 5 * attempt
                    print(f"  ⏳ Waiting {wait}s before retry...")
                    time.sleep(wait)

        print(f"  ⚠️ Model {model} failed, trying next...")

    print(f"  ❌ Gemini API: all models and attempts failed")
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
    print("🧪 GEMINI OFFICIAL API IMAGE GENERATION TEST")
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
