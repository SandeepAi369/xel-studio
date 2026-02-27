#!/usr/bin/env python3
"""
Image Generation — Multi-provider with fallbacks
=================================================
Priority 1: Pollinations.ai (free, no auth, direct URL)
Priority 2: g4f (gpt4free) multi-provider
Priority 3: Returns None (caller uses placeholder)

Usage:
    from gemini_image_gen import generate_image_gemini
    img_bytes = generate_image_gemini("A futuristic city")
"""

import os
import sys
import time
import requests
from urllib.parse import quote


# ── Provider 1: Pollinations.ai ──────────────────────────────

def _try_pollinations(prompt: str, retries: int = 2) -> bytes | None:
    """
    Generate image via Pollinations.ai — free, no auth, direct URL.
    Returns image bytes or None.
    """
    encoded = quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{encoded}?width=1024&height=576&nologo=true&seed={int(time.time())}"

    for attempt in range(1, retries + 1):
        try:
            print(f"  🎨 Pollinations [{attempt}/{retries}] generating...")
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

        if attempt < retries:
            time.sleep(3)

    return None


# ── Provider 2: g4f (gpt4free) ───────────────────────────────

def _try_g4f(prompt: str, retries: int = 1) -> bytes | None:
    """
    Generate image via g4f multi-provider system.
    Returns image bytes or None.
    """
    try:
        from g4f.client import Client as G4FClient
    except ImportError:
        print("  ⚠️ g4f not installed, skipping")
        return None

    client = G4FClient()
    models = ["flux", "dall-e-3", "dall-e", "sdxl", "sd-3"]

    for model in models:
        for attempt in range(1, retries + 1):
            try:
                print(f"  🎨 g4f [{attempt}/{retries}] {model}...")
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
            except Exception as e:
                print(f"  ❌ g4f error ({model}): {str(e)[:120]}")
            if attempt < retries:
                time.sleep(2)
    return None


# ── Main Entry Point ─────────────────────────────────────────

def generate_image_gemini(
    prompt: str,
    retries: int = 2,
) -> bytes | None:
    """
    Generate an image using multiple providers with fallbacks.
    
    Priority: Pollinations.ai → g4f → None (placeholder)

    Args:
        prompt: Text description of the image to generate.
        retries: Number of retry attempts per provider.

    Returns:
        Image bytes (PNG/JPEG) or None if all providers fail.
    """

    # 1. Pollinations.ai (most reliable, free, no auth)
    print("  📷 Trying Pollinations.ai...")
    result = _try_pollinations(prompt, retries)
    if result:
        return result

    # 2. g4f fallback
    print("  📷 Trying g4f fallback...")
    result = _try_g4f(prompt, retries=1)
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
