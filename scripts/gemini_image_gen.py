#!/usr/bin/env python3
"""
Image Generation via g4f (gpt4free)
====================================
Uses the g4f library to generate images via multiple free providers.
No API keys needed — g4f handles provider selection automatically.

Providers include: Flux, DALL-E (Bing), and other free image models.

Install: pip install -U g4f[image]

Usage:
    from gemini_image_gen import generate_image_gemini
    img_bytes = generate_image_gemini("A futuristic city")
"""

import os
import sys
import time
import requests

try:
    from g4f.client import Client as G4FClient
    _g4f_available = True
except ImportError:
    _g4f_available = False


# Image models to try in order (best quality → fastest)
IMAGE_MODELS = [
    "flux",          # High-quality, free
    "dall-e-3",      # Microsoft Bing DALL-E 3
    "dall-e",        # Bing DALL-E fallback
    "sdxl",          # Stable Diffusion XL
    "sd-3",          # Stable Diffusion 3
]


def generate_image_gemini(
    prompt: str,
    retries: int = 2,
) -> bytes | None:
    """
    Generate an image using g4f (gpt4free) multi-provider system.

    Tries multiple free image models (Flux, DALL-E 3, SDXL, SD3).
    Downloads the generated image and returns raw bytes.

    Args:
        prompt: Text description of the image to generate.
        retries: Number of retry attempts per model.

    Returns:
        Image bytes (PNG/JPEG) or None if all models fail.
    """
    if not _g4f_available:
        print("  ⚠️ g4f not installed. Run: pip install -U g4f[image]")
        return None

    client = G4FClient()

    for model in IMAGE_MODELS:
        print(f"  🎨 Trying g4f model: {model}")

        for attempt in range(1, retries + 1):
            try:
                print(f"  🎨 g4f [{attempt}/{retries}] generating with {model}...")

                response = client.images.generate(
                    model=model,
                    prompt=prompt,
                    response_format="url",
                )

                # Extract image URL from response
                if response and response.data and len(response.data) > 0:
                    image_url = response.data[0].url
                    if image_url:
                        print(f"  📎 Image URL: {image_url[:100]}...")

                        # Download the image bytes
                        dl = requests.get(image_url, timeout=60, headers={
                            "User-Agent": "Mozilla/5.0 XeL-News/1.0"
                        })
                        if dl.status_code == 200 and len(dl.content) > 1000:
                            print(f"  ✅ g4f: downloaded {len(dl.content):,} bytes ({model})")
                            return dl.content
                        else:
                            print(f"  ⚠️ Download failed: status={dl.status_code}, size={len(dl.content)}")

                print(f"  ⚠️ No image URL in g4f response for {model}")

            except Exception as e:
                err_str = str(e)
                print(f"  ❌ g4f error [{attempt}] ({model}): {err_str[:200]}")

                if attempt < retries:
                    wait = 3 * attempt
                    print(f"  ⏳ Waiting {wait}s before retry...")
                    time.sleep(wait)

        print(f"  ⚠️ Model {model} failed, trying next...")

    print(f"  ❌ g4f: all models failed")
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
    print("🧪 G4F IMAGE GENERATION TEST")
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

        out_path = os.path.join(os.path.dirname(__file__), "test_g4f_output.png")
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
