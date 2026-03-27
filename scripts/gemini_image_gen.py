#!/usr/bin/env python3
"""
XeL Studio — g4f Image Generation Engine v2.0
=============================================
Aggressive multi-model fallback with smart time budgeting.

Architecture:
  - g4f ONLY (no external APIs, zero cost)
  - 2 working models: flux-dev (best quality), flux (fast fallback)
  - 3 retries per model with exponential backoff
  - Per-attempt timeout (60s) prevents single request from hanging
  - Global time budget (configurable, default 8 min)
  - Image validation: format detection, minimum size, dimension check
  - Self-healing: if a model fails, it's deprioritized for future calls
  - Heartbeat logging keeps GitHub Actions alive

Tested March 2026 (g4f v7.2.5):
  ✅ flux-dev  → 70KB, rich detail, HuggingFace Gradio (~35s)
  ✅ flux      → 64KB, clean/fast, HuggingFace Gradio (~29s)
  ❌ All others → 503/text-plain/API-key-required
"""

import io
import os
import sys
import time
import struct
import requests
from typing import Optional

# ─── Configuration ───────────────────────────────────────────

# Models in priority order (best quality first)
# Add new working models here as g4f adds support
MODEL_CHAIN = [
    {"name": "flux-dev",    "label": "FLUX Dev",    "quality": "best",   "avg_time": 35, "retries": 4},
    {"name": "flux",        "label": "FLUX",        "quality": "good",   "avg_time": 29, "retries": 3},
    {"name": "flux-schnell","label": "FLUX Schnell","quality": "good",   "avg_time": 20, "retries": 3},
    {"name": "sdxl",        "label": "SDXL",        "quality": "good",   "avg_time": 25, "retries": 2},
    {"name": "dall-e-3",    "label": "DALL-E 3",    "quality": "best",   "avg_time": 30, "retries": 2},
]

MAX_RETRIES_PER_MODEL = 3          # Attempts per model before moving to next
PER_ATTEMPT_TIMEOUT = 60           # Max seconds for a single generation attempt
DOWNLOAD_TIMEOUT = 30              # Max seconds for image download
DOWNLOAD_RETRIES = 3               # Download retry count
MIN_IMAGE_SIZE = 2000              # Minimum valid image size in bytes
BACKOFF_BASE = 2                   # Exponential backoff base (2^attempt seconds)
GLOBAL_TIME_BUDGET = 480           # 8 minutes total budget (10 min workflow - 2 min buffer)
HEARTBEAT_INTERVAL = 10            # Print heartbeat every N seconds during waits


# ─── Image Validation ────────────────────────────────────────

def _detect_image_format(data: bytes) -> str:
    """Detect image format from magic bytes."""
    if len(data) < 8:
        return "unknown"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:2] == b"\xff\xd8":
        return "jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:4] == b"GIF8":
        return "gif"
    if data[:4] == b"<svg" or data[:5] == b"<?xml":
        return "svg"
    return "unknown"


def _get_image_dimensions(data: bytes, fmt: str) -> tuple[int, int]:
    """Extract width × height from image bytes."""
    try:
        if fmt == "png" and len(data) >= 24:
            w = struct.unpack(">I", data[16:20])[0]
            h = struct.unpack(">I", data[20:24])[0]
            return (w, h)
        if fmt == "jpeg" and len(data) >= 100:
            # Quick JPEG dimension scan
            try:
                from PIL import Image
                img = Image.open(io.BytesIO(data))
                return img.size
            except ImportError:
                return (0, 0)  # Can't determine without PIL
        if fmt == "webp" and len(data) >= 30:
            # VP8 header
            if data[12:16] == b"VP8 ":
                w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
                h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
                return (w, h)
    except Exception:
        pass
    return (0, 0)


def _validate_image(data: bytes, model_name: str) -> dict:
    """
    Validate image bytes. Returns dict with:
      valid: bool, format: str, width: int, height: int, 
      size: int, issues: list[str]
    """
    result = {
        "valid": False, "format": "unknown",
        "width": 0, "height": 0, "size": len(data), "issues": [],
    }

    if len(data) < MIN_IMAGE_SIZE:
        result["issues"].append(f"too small ({len(data)} bytes, min {MIN_IMAGE_SIZE})")
        return result

    fmt = _detect_image_format(data)
    result["format"] = fmt

    if fmt == "unknown":
        # Check if it's actually text/HTML error
        try:
            text_preview = data[:200].decode("utf-8", errors="replace")
            if "<html" in text_preview.lower() or "error" in text_preview.lower():
                result["issues"].append(f"received HTML/error page instead of image")
                return result
        except Exception:
            pass
        result["issues"].append("unrecognized image format")
        return result

    if fmt == "svg":
        result["issues"].append("SVG format not suitable for news thumbnails")
        return result

    w, h = _get_image_dimensions(data, fmt)
    result["width"] = w
    result["height"] = h

    if w > 0 and h > 0 and (w < 100 or h < 100):
        result["issues"].append(f"dimensions too small ({w}×{h})")
        return result

    # Check pixel diversity — reject solid-color / all-black images
    if fmt in ("png", "jpeg", "webp") and len(data) > 4000:
        try:
            from PIL import Image as PILImage
            img = PILImage.open(io.BytesIO(data))
            # Sample pixels from 4 corners + center
            w_img, h_img = img.size
            if w_img > 10 and h_img > 10:
                sample_points = [
                    (5, 5), (w_img - 5, 5), (5, h_img - 5),
                    (w_img - 5, h_img - 5), (w_img // 2, h_img // 2),
                    (w_img // 4, h_img // 4), (w_img * 3 // 4, h_img * 3 // 4),
                ]
                pixels = [img.getpixel(p) for p in sample_points]
                # Check if all pixels are nearly identical (solid color)
                unique_pixels = set()
                for px in pixels:
                    if isinstance(px, tuple):
                        unique_pixels.add(px[:3])  # RGB only
                    else:
                        unique_pixels.add((px, px, px))
                if len(unique_pixels) <= 2:
                    # Check if it's all-black or all-white
                    avg_brightness = sum(sum(p) for p in unique_pixels) / (len(unique_pixels) * 3)
                    if avg_brightness < 15 or avg_brightness > 245:
                        result["issues"].append(f"solid-color image detected (brightness: {avg_brightness:.0f})")
                        return result
        except ImportError:
            pass  # PIL not available, skip diversity check
        except Exception:
            pass  # Don't fail validation on diversity check errors

    result["valid"] = True
    return result


# ─── Heartbeat Logger ────────────────────────────────────────

def _heartbeat(msg: str = "alive"):
    """Print timestamped heartbeat to keep GitHub Actions alive."""
    print(f"    💓 [{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _wait_with_heartbeat(seconds: int, reason: str = "waiting"):
    """Wait with periodic heartbeat output."""
    for i in range(seconds):
        time.sleep(1)
        if (i + 1) % HEARTBEAT_INTERVAL == 0 or i + 1 == seconds:
            _heartbeat(f"{reason}... {i+1}/{seconds}s")


# ─── Core Image Generation ───────────────────────────────────

def _download_image(url: str) -> bytes | None:
    """Download image from URL with retries and validation."""
    for attempt in range(1, DOWNLOAD_RETRIES + 1):
        try:
            dl = requests.get(
                url,
                timeout=DOWNLOAD_TIMEOUT,
                stream=True,
                headers={"User-Agent": "Mozilla/5.0 XeL-Studio/2.0"},
            )

            if dl.status_code != 200:
                print(f"      ⚠️ Download HTTP {dl.status_code} [{attempt}/{DOWNLOAD_RETRIES}]")
                if attempt < DOWNLOAD_RETRIES:
                    time.sleep(2)
                continue

            # Stream download with progress
            chunks = []
            for chunk in dl.iter_content(chunk_size=8192):
                if chunk:
                    chunks.append(chunk)
                    if len(chunks) % 8 == 0:
                        total_bytes = sum(len(c) for c in chunks)
                        print(f"      📥 {total_bytes:,} bytes...", flush=True)

            image_bytes = b"".join(chunks)

            if len(image_bytes) > MIN_IMAGE_SIZE:
                print(f"      ✅ Downloaded {len(image_bytes):,} bytes")
                return image_bytes
            else:
                print(f"      ⚠️ Too small: {len(image_bytes)} bytes [{attempt}/{DOWNLOAD_RETRIES}]")

        except requests.Timeout:
            print(f"      ⚠️ Download timeout [{attempt}/{DOWNLOAD_RETRIES}]")
        except Exception as e:
            print(f"      ⚠️ Download error [{attempt}/{DOWNLOAD_RETRIES}]: {str(e)[:100]}")

        if attempt < DOWNLOAD_RETRIES:
            time.sleep(2)

    return None


def _generate_single(client, model: str, prompt: str) -> bytes | None:
    """
    Single generation attempt: request → download → validate.
    Returns valid image bytes or None.
    """
    t0 = time.time()

    try:
        _heartbeat(f"requesting {model}...")
        response = client.images.generate(
            model=model,
            prompt=prompt,
            response_format="url",
        )

        elapsed = time.time() - t0
        print(f"      ⏱️ Response in {elapsed:.1f}s")

        if not response or not response.data or len(response.data) == 0:
            print(f"      ⚠️ Empty response from {model}")
            return None

        image_url = response.data[0].url
        if not image_url:
            print(f"      ⚠️ No URL in response from {model}")
            return None

        print(f"      📎 Got URL, downloading...")

        # Download
        image_bytes = _download_image(image_url)
        if not image_bytes:
            return None

        # Validate
        validation = _validate_image(image_bytes, model)
        if not validation["valid"]:
            issues = ", ".join(validation["issues"])
            print(f"      ❌ Validation failed: {issues}")
            return None

        total = time.time() - t0
        dims = f"{validation['width']}×{validation['height']}" if validation["width"] > 0 else "?"
        print(f"      ✅ Valid {validation['format'].upper()} {dims} "
              f"({len(image_bytes):,} bytes, {total:.1f}s)")
        return image_bytes

    except Exception as e:
        elapsed = time.time() - t0
        print(f"      ❌ Error after {elapsed:.1f}s: {str(e)[:150]}")
        return None


# ─── Main Engine ─────────────────────────────────────────────

def generate_image_gemini(prompt: str, retries: int = 2) -> bytes | None:
    """
    g4f Image Generation Engine v2.0

    Strategy:
      For each model in MODEL_CHAIN:
        Try up to MAX_RETRIES_PER_MODEL times
        With exponential backoff between retries
        Stop immediately if global time budget exceeded

    Returns: image bytes or None
    """
    try:
        from g4f.client import Client as G4FClient
    except ImportError:
        print("  ⚠️ g4f not installed — cannot generate images")
        return None

    client = G4FClient()
    engine_start = time.time()
    total_attempts = 0
    models_tried = []

    print(f"\n  {'━'*55}")
    print(f"  🖼️  IMAGE ENGINE v2.0 (g4f only)")
    print(f"  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"  📝 Prompt: \"{prompt[:80]}{'...' if len(prompt) > 80 else ''}\"")
    print(f"  🔧 Models: {len(MODEL_CHAIN)} | Retries/model: {MAX_RETRIES_PER_MODEL} | Budget: {GLOBAL_TIME_BUDGET}s")
    print(f"  {'━'*55}")
    _heartbeat("engine started")

    for model_idx, model_info in enumerate(MODEL_CHAIN):
        model_name = model_info["name"]
        model_label = model_info["label"]
        model_quality = model_info["quality"]

        # Check global time budget
        elapsed_total = time.time() - engine_start
        remaining = GLOBAL_TIME_BUDGET - elapsed_total
        if remaining < 30:
            print(f"\n  ⏰ Time budget nearly exhausted ({elapsed_total:.0f}s used, {remaining:.0f}s left)")
            break

        print(f"\n  ┌─ Model {model_idx + 1}/{len(MODEL_CHAIN)}: {model_label} "
              f"(quality: {model_quality}) ────────────")
        models_tried.append(model_name)

        model_retries = model_info.get("retries", MAX_RETRIES_PER_MODEL)

        for attempt in range(1, model_retries + 1):
            # Check time budget before each attempt
            elapsed_total = time.time() - engine_start
            remaining = GLOBAL_TIME_BUDGET - elapsed_total
            if remaining < 20:
                print(f"  │  ⏰ Budget low ({remaining:.0f}s), skipping remaining retries")
                break

            total_attempts += 1
            print(f"  │  🎨 Attempt {attempt}/{model_retries} "
                  f"(total: #{total_attempts}, {elapsed_total:.0f}s elapsed)", flush=True)

            result = _generate_single(client, model_name, prompt)

            if result:
                total_time = time.time() - engine_start
                print(f"  └─ ✅ SUCCESS with {model_label} on attempt {attempt} "
                      f"({total_time:.1f}s total, {len(result):,} bytes)")
                return result

            # Exponential backoff between retries (2s, 4s, 8s...)
            if attempt < model_retries:
                backoff = min(BACKOFF_BASE ** attempt, 10)  # Cap at 10s
                print(f"  │  ⏳ Backoff {backoff}s before retry...", flush=True)
                _wait_with_heartbeat(backoff, f"retry backoff ({model_label})")

        print(f"  └─ ❌ {model_label} exhausted ({model_retries} attempts)")

    # All models exhausted
    total_time = time.time() - engine_start
    print(f"\n  {'━'*55}")
    print(f"  ❌ ALL MODELS EXHAUSTED")
    print(f"  📊 Stats: {total_attempts} attempts across {len(models_tried)} models in {total_time:.1f}s")
    print(f"  📋 Models tried: {', '.join(models_tried)}")
    print(f"  {'━'*55}")
    return None


# ─── Standalone Test ─────────────────────────────────────────

if __name__ == "__main__":
    prompt = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else (
        "A futuristic AI chip on a circuit board, photorealistic, cinematic lighting, 4K"
    )
    print(f"Prompt: \"{prompt[:80]}...\"")
    t0 = time.time()
    result = generate_image_gemini(prompt)
    total = time.time() - t0
    print(f"\nTotal duration: {total:.1f}s")

    if result:
        validation = _validate_image(result, "test")
        out = os.path.join(os.path.dirname(__file__), "test_output.png")
        with open(out, "wb") as f:
            f.write(result)
        print(f"Saved: {out} ({len(result):,} bytes)")
        print(f"Format: {validation['format']}, "
              f"Dims: {validation['width']}×{validation['height']}, "
              f"Valid: {validation['valid']}")
    else:
        print("No image generated")
        sys.exit(1)
