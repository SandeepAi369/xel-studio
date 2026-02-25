#!/usr/bin/env python3
"""
Gemini API Image Generation
============================
Generates images via Google's Gemini / Imagen models.
Simple API call — no browser, no sessions, no Playwright.

Supports dual API key fallback via GEMINI_API_KEY and GEMINI_API_KEY_2.

Usage:
    # As a module:
    from gemini_image_gen import generate_image_gemini
    img_bytes = generate_image_gemini("A futuristic city")

    # Standalone test:
    python scripts/gemini_image_gen.py "A robot painting"
"""

import base64
import os
import sys
import time

try:
    from google import genai
    from google.genai import types
    _genai_available = True
except ImportError:
    _genai_available = False


# Models to try, in priority order
# gemini-2.0-flash-exp-image-generation — dedicated image gen model
# gemini-2.5-flash-image — Nano Banana (speed-optimized)
IMAGE_MODELS = [
    "gemini-2.0-flash-exp-image-generation",
    "gemini-2.5-flash-image",
]


def _try_gemini_model(client, model_name: str, prompt: str) -> bytes | None:
    """Try generating an image using a Gemini-style model (generate_content)."""
    response = client.models.generate_content(
        model=model_name,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        ),
    )

    if response and response.candidates:
        for part in response.candidates[0].content.parts:
            if hasattr(part, 'inline_data') and part.inline_data is not None:
                image_data = part.inline_data.data
                if isinstance(image_data, str):
                    return base64.b64decode(image_data)
                return bytes(image_data)
    return None


def generate_image_gemini(
    prompt: str,
    api_key: str | None = None,
    retries: int = 2,
) -> bytes | None:
    """
    Generate an image using Gemini's native image generation API.
    Supports dual API key fallback (GEMINI_API_KEY, GEMINI_API_KEY_2).

    Args:
        prompt: Text description of the image to generate.
        api_key: Google AI API key override. Falls back to env vars.
        retries: Number of retry attempts per model per key.

    Returns:
        Image bytes (PNG/JPEG) or None if generation fails.
    """
    if not _genai_available:
        print("  ⚠️ google-genai not installed. Run: pip install google-genai")
        return None

    # Collect available API keys
    keys = []
    if api_key:
        keys.append(("provided", api_key))
    env_key1 = os.environ.get("GEMINI_API_KEY")
    env_key2 = os.environ.get("GEMINI_API_KEY_2")
    if env_key1 and ("provided", env_key1) not in keys:
        keys.append(("primary", env_key1))
    if env_key2:
        keys.append(("fallback", env_key2))

    if not keys:
        print("  ⚠️ No GEMINI_API_KEY set — skipping Gemini image generation")
        return None

    for key_label, key_value in keys:
        print(f"  🔑 Trying Gemini API key: {key_label}")
        client = genai.Client(api_key=key_value)

        for model_name in IMAGE_MODELS:
            for attempt in range(1, retries + 1):
                try:
                    print(f"  🎨 [{model_name}] attempt {attempt}/{retries}...")

                    image_bytes = _try_gemini_model(client, model_name, prompt)

                    if image_bytes and len(image_bytes) > 1000:
                        print(f"  ✅ Gemini: generated {len(image_bytes):,} bytes ({key_label} key)")
                        return image_bytes
                    elif image_bytes:
                        print(f"  ⚠️ Image too small: {len(image_bytes)} bytes")
                    else:
                        print(f"  ⚠️ No image in response")

                except Exception as e:
                    err_str = str(e)
                    short_err = err_str[:150]
                    print(f"  ❌ Error [{model_name}] attempt {attempt}: {short_err}")

                    if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                        if attempt < retries:
                            wait = 5 * attempt
                            print(f"  ⏳ Rate limited, waiting {wait}s...")
                            time.sleep(wait)
                        else:
                            # Exhausted retries on this model, try next
                            print(f"  ⏩ Quota exhausted for this key+model, moving on...")
                            break
                    elif "not found" in err_str.lower() or "not supported" in err_str.lower():
                        print(f"  ⏩ Model not available, skipping...")
                        break
                    elif attempt < retries:
                        time.sleep(2 * attempt)

    print(f"  ❌ Gemini: all keys and models exhausted")
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
    print("🧪 GEMINI IMAGE GENERATION TEST")
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
