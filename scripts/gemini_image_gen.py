#!/usr/bin/env python3
"""
Image Generation — g4f primary (3 retries + polling), Pollinations backup
"""

import os
import sys
import time
import requests
from urllib.parse import quote


# ── Priority 1: g4f with active polling ──────────────────────

def _poll_g4f_image(client, model: str, prompt: str, poll_interval: float = 2.0, max_wait: int = 120) -> bytes | None:
    """
    Generate image via g4f with active polling.
    Keeps the process alive by polling until image is ready or timeout.
    """
    start = time.time()
    
    try:
        print(f"    ⏳ Sending request to {model}...")
        response = client.images.generate(
            model=model,
            prompt=prompt,
            response_format="url",
        )
        
        # Poll: keep checking the response until we get valid data
        elapsed = time.time() - start
        print(f"    ⏱️ Response received in {elapsed:.1f}s")
        
        if not response or not response.data or len(response.data) == 0:
            print(f"    ⚠️ Empty response from {model}")
            return None
        
        image_url = response.data[0].url
        if not image_url:
            print(f"    ⚠️ No URL in response from {model}")
            return None
        
        print(f"    📎 Got URL, downloading image...")
        
        # Active polling download — retry download if it fails
        for dl_attempt in range(1, 4):
            try:
                # Keep-alive connection with streaming to prevent timeout
                dl = requests.get(
                    image_url, 
                    timeout=60, 
                    stream=True,
                    headers={"User-Agent": "Mozilla/5.0 XeL-News/1.0"}
                )
                
                if dl.status_code == 200:
                    # Read in chunks to keep connection alive
                    chunks = []
                    for chunk in dl.iter_content(chunk_size=8192):
                        if chunk:
                            chunks.append(chunk)
                            # Active polling: print progress to keep GitHub Actions alive
                            if len(chunks) % 10 == 0:
                                print(f"    📥 Downloading... {sum(len(c) for c in chunks):,} bytes", flush=True)
                    
                    image_bytes = b"".join(chunks)
                    
                    if len(image_bytes) > 1000:
                        total_elapsed = time.time() - start
                        print(f"    ✅ Downloaded {len(image_bytes):,} bytes in {total_elapsed:.1f}s")
                        return image_bytes
                    else:
                        print(f"    ⚠️ Image too small: {len(image_bytes)} bytes")
                else:
                    print(f"    ⚠️ Download status {dl.status_code}, attempt {dl_attempt}/3")
                    
            except Exception as dl_err:
                print(f"    ⚠️ Download error [{dl_attempt}/3]: {str(dl_err)[:100]}")
            
            if dl_attempt < 3:
                time.sleep(2)
                print(f"    🔄 Retrying download...", flush=True)
        
    except Exception as e:
        elapsed = time.time() - start
        print(f"    ❌ Error after {elapsed:.1f}s: {str(e)[:150]}")
    
    return None


def _try_g4f(prompt: str) -> bytes | None:
    """g4f with 3 retry attempts per model + active polling."""
    try:
        from g4f.client import Client as G4FClient
    except ImportError:
        print("  ⚠️ g4f not installed")
        return None

    client = G4FClient()
    # Model priority (tested March 2026, g4f v7.2.5):
    #   flux-dev  → BEST quality (138KB, rich detail, artistic composition) — HuggingFace Gradio
    #   flux      → Good quality (126KB, clean but less artistic) — HuggingFace Gradio
    # All others FAIL: dall-e-3 (needs cookie), dall-e/sd-3 (530), sdxl/gpt-image (wrong content),
    #   flux-schnell/flux-pro/flux-kontext (need API key), sd-3.5-large (503), sdxl-turbo (text/plain)
    models = ["flux-dev", "flux"]

    for model in models:
        print(f"  🎨 Trying g4f model: {model}")
        for attempt in range(1, 4):  # 3 retries
            print(f"  🎨 g4f [{attempt}/3] {model}...", flush=True)
            
            # Keep-alive heartbeat before request
            print(f"    💓 Heartbeat: {time.strftime('%H:%M:%S')} - starting generation", flush=True)
            
            result = _poll_g4f_image(client, model, prompt)
            
            if result:
                return result
            
            # Keep-alive heartbeat between retries
            if attempt < 3:
                wait = 3 * attempt
                print(f"    💓 Heartbeat: {time.strftime('%H:%M:%S')} - waiting {wait}s before retry", flush=True)
                # Active wait: print dots to keep GitHub Actions alive
                for i in range(wait):
                    time.sleep(1)
                    if (i + 1) % 5 == 0:
                        print(f"    ⏳ Waiting... {i+1}/{wait}s", flush=True)

        print(f"  ⚠️ Model {model} failed after 3 attempts, trying next...")

    return None


# ── Priority 2: Pollinations (backup only) ───────────────────

def _try_pollinations(prompt: str) -> bytes | None:
    """Pollinations.ai as last resort backup."""
    encoded = quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{encoded}?width=1024&height=576&nologo=true&seed={int(time.time())}"

    for attempt in range(1, 3):
        try:
            print(f"  🎨 Pollinations [{attempt}/2] generating...", flush=True)
            print(f"    💓 Heartbeat: {time.strftime('%H:%M:%S')}", flush=True)
            
            resp = requests.get(url, timeout=90, stream=True, headers={
                "User-Agent": "Mozilla/5.0 XeL-News/1.0"
            })
            
            if resp.status_code == 200:
                chunks = []
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        chunks.append(chunk)
                
                image_bytes = b"".join(chunks)
                if len(image_bytes) > 5000:
                    print(f"  ✅ Pollinations: {len(image_bytes):,} bytes")
                    return image_bytes
                else:
                    print(f"  ⚠️ Pollinations: too small ({len(image_bytes)} bytes)")
            else:
                print(f"  ⚠️ Pollinations: status={resp.status_code}")
        except Exception as e:
            print(f"  ❌ Pollinations error [{attempt}]: {str(e)[:150]}")
        if attempt < 2:
            time.sleep(3)

    return None


# ── Main Entry Point ─────────────────────────────────────────

def generate_image_gemini(prompt: str, retries: int = 2) -> bytes | None:
    """
    Priority 1: g4f (3 retries per model, 5 models, active polling)
    Priority 2: Pollinations.ai (backup)
    """
    print(f"  📷 Starting image generation with active polling...", flush=True)
    print(f"  💓 Heartbeat: {time.strftime('%H:%M:%S')} - process alive", flush=True)

    # 1. g4f — primary (3 retries per model + polling)
    result = _try_g4f(prompt)
    if result:
        print(f"  💓 Heartbeat: {time.strftime('%H:%M:%S')} - image ready, size={len(result):,}", flush=True)
        return result

    # 2. Pollinations — backup
    print(f"  📷 g4f failed, trying Pollinations backup...", flush=True)
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
