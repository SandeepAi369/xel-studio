#!/usr/bin/env python3
"""
Image Generation — g4f primary (3 retries), Pollinations backup
"""

import os
import sys
import time
import requests
from urllib.parse import quote


# ── Priority 1: g4f (3 retries per model) ────────────────────

def _try_g4f(prompt: str) -> bytes | None:
    """g4f with 3 retry attempts per model."""
    try:
        from g4f.client import Client as G4FClient
    except ImportError:
        print("  ⚠️ g4f not installed")
        return None

    client = G4FClient()
    models = ["flux", "dall-e-3", "dall-e", "sdxl", "sd-3"]

    for model in models:
        print(f"  🎨 Trying g4f model: {model}")
        for attempt in range(1, 4):  # 3 retries
            try:
                print(f"  🎨 g4f [{attempt}/3] {model}...")
                response = client.images.generate(
                    model=model,
                    prompt=prompt,
                    response_format="url",
                )
                if response and response.data and len(response.data) > 0:
                    image_url = response.data[0].url
                    if image_url:
                        dl = requests.get(image_url, timeout=60, headers={
                            "User-Agent": "Mozilla/5.0 XeL-News/1.0"
                        })
                        if dl.status_code == 200 and len(dl.content) > 1000:
                            print(f"  ✅ g4f: {len(dl.content):,} bytes ({model})")
                            return dl.content
                        else:
                            print(f"  ⚠️ Download issue: status={dl.status_code}, size={len(dl.content)}")
                print(f"  ⚠️ No image URL from g4f ({model})")
            except Exception as e:
                print(f"  ❌ g4f error [{attempt}/3] ({model}): {str(e)[:150]}")

            if attempt < 3:
                wait = 3 * attempt
                print(f"  ⏳ Waiting {wait}s before retry...")
                time.sleep(wait)

        print(f"  ⚠️ Model {model} failed after 3 attempts, trying next...")

    return None


# ── Priority 2: Pollinations (backup only) ───────────────────

def _try_pollinations(prompt: str) -> bytes | None:
    """Pollinations.ai as last resort backup."""
    encoded = quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{encoded}?width=1024&height=576&nologo=true&seed={int(time.time())}"

    for attempt in range(1, 3):
        try:
            print(f"  🎨 Pollinations [{attempt}/2] generating...")
            resp = requests.get(url, timeout=90, headers={
                "User-Agent": "Mozilla/5.0 XeL-News/1.0"
            })
            if resp.status_code == 200 and len(resp.content) > 5000:
                print(f"  ✅ Pollinations: {len(resp.content):,} bytes")
                return resp.content
            else:
                print(f"  ⚠️ Pollinations: status={resp.status_code}, size={len(resp.content)}")
        except Exception as e:
            print(f"  ❌ Pollinations error [{attempt}]: {str(e)[:150]}")
        if attempt < 2:
            time.sleep(3)

    return None


# ── Main Entry Point ─────────────────────────────────────────

def generate_image_gemini(prompt: str, retries: int = 2) -> bytes | None:
    """
    Priority 1: g4f (3 retries per model, 5 models)
    Priority 2: Pollinations.ai (backup)
    """

    # 1. g4f — primary (3 retries per model)
    print("  📷 Trying g4f (primary)...")
    result = _try_g4f(prompt)
    if result:
        return result

    # 2. Pollinations — backup
    print("  📷 Trying Pollinations (backup)...")
    result = _try_pollinations(prompt)
    if result:
        return result

    print("  ❌ All image providers failed")
    return None


# ── Standalone test ──────────────────────────────────────────
if __name__ == "__main__":
    prompt = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else (
        "A futuristic cityscape at golden hour, photorealistic, cinematic lighting"
    )
    print(f"Prompt: \"{prompt[:80]}...\"")
    t0 = time.time()
    result = generate_image_gemini(prompt)
    print(f"Duration: {time.time() - t0:.1f}s")
    if result:
        out = os.path.join(os.path.dirname(__file__), "test_output.png")
        with open(out, "wb") as f:
            f.write(result)
        print(f"Saved: {out} ({len(result):,} bytes)")
    else:
        print("No image generated")
        sys.exit(1)
