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

Tested June 2026 (g4f v7.5.7):
  ✅ flux-dev  → 70KB, rich detail, HuggingFace Gradio (~35s)
  ✅ flux      → 64KB, clean/fast, HuggingFace Gradio (~29s)
  ❌ All others → 503/text-plain/API-key-required
"""

import io
import os
import sys
import time
import signal
import threading
import requests
from typing import Optional

# Content verification stack (pixel/colour metrics). These are now HARD
# dependencies — declared in scripts/requirements.txt. If they are somehow
# missing we fall back to magic-byte+size checks only and warn LOUDLY, because
# that means an unverified image could reach the frontend.
try:
    from PIL import Image as _PILImage
    import numpy as _np
    _HAVE_CV = True
except Exception as _cv_err:  # pragma: no cover
    _HAVE_CV = False
    _CV_IMPORT_ERR = str(_cv_err)

# ─── Configuration ───────────────────────────────────────────

# Models in priority order — ONLY verified working models (June 2026)
# Uses g4f Auto provider for all models — no hardcoded providers
MODEL_CHAIN = [
    {"name": "flux",        "label": "FLUX",        "quality": "best",   "avg_time": 25, "retries": 3},
    {"name": "flux-dev",    "label": "FLUX Dev",    "quality": "best",   "avg_time": 22, "retries": 2},
    {"name": "gpt-image",   "label": "GPT Image",   "quality": "good",   "avg_time": 20, "retries": 2},
]

MAX_RETRIES_PER_MODEL = 3          # Attempts per model before moving to next
PER_ATTEMPT_TIMEOUT = 60           # Max seconds for a single generation attempt
DOWNLOAD_TIMEOUT = 30              # Max seconds for image download
DOWNLOAD_RETRIES = 3               # Download retry count
MIN_IMAGE_SIZE = 2000              # Minimum valid image size in bytes
BACKOFF_BASE = 2                   # Exponential backoff base (2^attempt seconds)
GLOBAL_TIME_BUDGET = 780           # 13 min — use the full 15-min workflow aggressively
HEARTBEAT_INTERVAL = 10            # Print heartbeat every N seconds during waits

# ─── Content verification thresholds ─────────────────────────
# Calibrated against real flux output vs. blank/solid baselines (June 2026):
#   real flux:  contrast≈65  entropy≈5.7  detail≈159  colours≈3580
#   solid junk: contrast=0   entropy=0    detail=0    colours=1
# Thresholds sit FAR below real images so legitimate (even minimalist) photos
# always pass, while blank / solid / corrupt / placeholder images are rejected.
MIN_LONG_EDGE_PX = 256             # Reject thumbnails smaller than this on the long edge
BRIGHTNESS_MIN = 10                # Reject near-pure-black (mean luma 0-255)
BRIGHTNESS_MAX = 246               # Reject near-pure-white
MIN_CONTRAST_STD = 5.0             # Reject flat / near-uniform images
MIN_ENTROPY_BITS = 1.5             # Reject images with almost no information
MIN_DETAIL_VAR = 5.0              # Reject images with no edges/detail (gradient var)
MIN_UNIQUE_COLORS = 24             # Reject near-solid-colour images (5-bit/channel quantised)
ANALYSIS_MAX_EDGE = 256            # Downscale long edge to this before computing metrics (speed)

# Average-hash blocklist for known provider error / placeholder images.
# Add 16-hex-char aHash strings here (or one per line in bad_image_hashes.txt)
# to instantly reject recurring junk frames from a flaky provider.
KNOWN_BAD_HASHES: set[str] = set()
# Perceptual hashes of frames rejected earlier in THIS run (reset per engine call)
# so a provider that keeps returning the same junk image is abandoned quickly.
_RUN_REJECTED_HASHES: set[str] = set()
_BAD_HASH_FILE = os.path.join(os.path.dirname(__file__), "bad_image_hashes.txt")
try:
    if os.path.exists(_BAD_HASH_FILE):
        with open(_BAD_HASH_FILE) as _bf:
            for _line in _bf:
                _h = _line.strip().lower()
                if _h and not _h.startswith("#"):
                    KNOWN_BAD_HASHES.add(_h)
except Exception:
    pass


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


def _average_hash(img: "_PILImage.Image") -> str:
    """8×8 average-hash → 16-char hex string. Used to match known junk frames."""
    small = img.convert("L").resize((8, 8), _PILImage.BILINEAR)
    px = _np.asarray(small, dtype=_np.float32)
    bits = (px > px.mean()).flatten()
    val = 0
    for b in bits:
        val = (val << 1) | int(b)
    return f"{val:016x}"


def _content_metrics(img: "_PILImage.Image") -> dict:
    """
    Compute pixel/colour statistics that separate a real image from a blank,
    solid-colour, or corrupt one. Operates on a downscaled RGB copy for speed.
    Returns: brightness, contrast, entropy, detail, colors, ahash.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    # Downscale (preserve aspect) so metrics are O(256²) regardless of input size
    scale = ANALYSIS_MAX_EDGE / max(w, h)
    if scale < 1.0:
        rgb = rgb.resize((max(1, int(w * scale)), max(1, int(h * scale))), _PILImage.BILINEAR)

    arr = _np.asarray(rgb, dtype=_np.float32)
    gray = arr.mean(axis=2)

    brightness = float(gray.mean())
    contrast = float(gray.std())

    # Unique colours, quantised to 5 bits/channel (matches the calibration table)
    q = (arr.astype(_np.uint16) >> 3)
    codes = (q[..., 0].astype(_np.uint32) << 10) | (q[..., 1].astype(_np.uint32) << 5) | q[..., 2].astype(_np.uint32)
    colors = int(_np.unique(codes).size)

    # Shannon entropy of the luminance histogram (bits)
    hist, _ = _np.histogram(gray, bins=64, range=(0, 255))
    p = hist.astype(_np.float64)
    p = p[p > 0] / p.sum()
    entropy = float(-(p * _np.log2(p)).sum()) if p.size else 0.0

    # Detail / edge energy — variance of first differences (no-edge ⇒ ~0)
    detail = float(_np.diff(gray, axis=1).var() + _np.diff(gray, axis=0).var())

    return {
        "brightness": brightness, "contrast": contrast, "entropy": entropy,
        "detail": detail, "colors": colors, "ahash": _average_hash(img),
    }


def _validate_image(data: bytes, model_name: str) -> dict:
    """
    Verify that `data` is a real, non-blank, decodable image — not an error
    page, a truncated download, or a solid-colour / placeholder frame.

    Returns dict with:
      valid, format, width, height, size, issues (list), metrics (dict)
    A False `valid` is the signal the engine uses to REGENERATE.
    """
    result = {
        "valid": False, "format": "unknown",
        "width": 0, "height": 0, "size": len(data), "issues": [], "metrics": {},
    }

    # ── Cheap gates first: size, then magic-byte / HTML-error sniff ──
    if len(data) < MIN_IMAGE_SIZE:
        result["issues"].append(f"too small ({len(data)} bytes, min {MIN_IMAGE_SIZE})")
        return result

    fmt = _detect_image_format(data)
    result["format"] = fmt

    if fmt == "unknown":
        try:
            text_preview = data[:200].decode("utf-8", errors="replace")
            if "<html" in text_preview.lower() or "error" in text_preview.lower():
                result["issues"].append("received HTML/error page instead of image")
                return result
        except Exception:
            pass
        result["issues"].append("unrecognized image format")
        return result

    if fmt == "svg":
        result["issues"].append("SVG format not suitable for news thumbnails")
        return result

    # ── Content verification requires PIL+numpy ──
    if not _HAVE_CV:
        # Hard deps missing — accept on magic-byte+size only, but warn LOUDLY.
        print(f"      ⚠️⚠️ CONTENT VERIFICATION DISABLED (Pillow/numpy not installed: "
              f"{globals().get('_CV_IMPORT_ERR', '?')}). Accepting on format+size only.")
        result["valid"] = True
        return result

    # ── Decode for real — catches truncated/corrupt files that pass magic bytes ──
    try:
        img = _PILImage.open(io.BytesIO(data))
        img.load()
    except Exception as e:
        result["issues"].append(f"undecodable image ({type(e).__name__}: {str(e)[:60]})")
        return result

    w, h = img.size
    result["width"], result["height"] = w, h
    if max(w, h) < MIN_LONG_EDGE_PX:
        result["issues"].append(f"dimensions too small ({w}×{h}, min long edge {MIN_LONG_EDGE_PX})")
        return result

    # ── Pixel/colour metrics ──
    try:
        m = _content_metrics(img)
    except Exception as e:
        # Never let a metrics bug reject a real image — accept but note it.
        result["issues"].append(f"metrics error, accepted on decode ({str(e)[:60]})")
        result["valid"] = True
        return result
    result["metrics"] = m

    # Known-junk perceptual-hash blocklist
    if m["ahash"] in KNOWN_BAD_HASHES:
        result["issues"].append(f"matches known placeholder/error image (ahash {m['ahash']})")
        return result

    # Content gates — any failure ⇒ regenerate
    if m["brightness"] < BRIGHTNESS_MIN or m["brightness"] > BRIGHTNESS_MAX:
        result["issues"].append(f"brightness out of range ({m['brightness']:.0f})")
    if m["contrast"] < MIN_CONTRAST_STD:
        result["issues"].append(f"flat/near-uniform (contrast {m['contrast']:.1f} < {MIN_CONTRAST_STD})")
    if m["colors"] < MIN_UNIQUE_COLORS:
        result["issues"].append(f"near-solid colour ({m['colors']} colours < {MIN_UNIQUE_COLORS})")
    if m["entropy"] < MIN_ENTROPY_BITS:
        result["issues"].append(f"no information (entropy {m['entropy']:.2f} < {MIN_ENTROPY_BITS})")
    if m["detail"] < MIN_DETAIL_VAR:
        result["issues"].append(f"no detail/edges (detail {m['detail']:.1f} < {MIN_DETAIL_VAR})")

    if result["issues"]:
        return result

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
    Background heartbeat thread keeps GitHub Actions alive during
    the blocking API call. SIGALRM enforces PER_ATTEMPT_TIMEOUT.
    Returns valid image bytes or None.
    """
    t0 = time.time()

    # ── Background heartbeat during the blocking API call ──
    beat_stop = threading.Event()
    def _api_heartbeat():
        tick = 0
        while not beat_stop.wait(8):
            tick += 1
            elapsed = time.time() - t0
            _heartbeat(f"generating with {model}... {elapsed:.0f}s")

    beat_thread = threading.Thread(target=_api_heartbeat, daemon=True)
    beat_thread.start()

    try:
        _heartbeat(f"requesting {model}...")

        # ── Enforce per-attempt timeout via SIGALRM ──
        try:
            def _attempt_timeout(signum, frame):
                raise TimeoutError(f"{model} timed out after {PER_ATTEMPT_TIMEOUT}s")

            signal.signal(signal.SIGALRM, _attempt_timeout)
            signal.alarm(PER_ATTEMPT_TIMEOUT)
        except (ValueError, OSError):
            pass  # signal.alarm not available (non-main thread / Windows)

        try:
            response = client.images.generate(
                model=model,
                prompt=prompt,
                response_format="url",
            )
        finally:
            try:
                signal.alarm(0)  # Cancel alarm
            except (ValueError, OSError):
                pass

        # Stop the heartbeat thread now that the API call is done
        beat_stop.set()

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

        # Verify content — a False verdict here is what triggers REGENERATE
        validation = _validate_image(image_bytes, model)
        m = validation.get("metrics") or {}
        if not validation["valid"]:
            issues = ", ".join(validation["issues"])
            print(f"      ❌ Verification failed: {issues}")
            # Remember the junk frame for this run so we don't re-accept a
            # near-identical placeholder a provider keeps handing back.
            if m.get("ahash"):
                _RUN_REJECTED_HASHES.add(m["ahash"])
            return None

        # Defence-in-depth: if this exact frame was rejected earlier this run,
        # treat it as junk even if metrics now wobble above threshold.
        if m.get("ahash") and m["ahash"] in _RUN_REJECTED_HASHES:
            print(f"      ❌ Verification failed: repeat of a frame already rejected this run (ahash {m['ahash']})")
            return None

        total = time.time() - t0
        dims = f"{validation['width']}×{validation['height']}" if validation["width"] > 0 else "?"
        metric_str = ""
        if m:
            metric_str = (f" | contrast {m['contrast']:.0f} entropy {m['entropy']:.1f}b "
                          f"detail {m['detail']:.0f} colours {m['colors']}")
        print(f"      ✅ Verified {validation['format'].upper()} {dims} "
              f"({len(image_bytes):,} bytes, {total:.1f}s){metric_str}")
        return image_bytes

    except TimeoutError as te:
        elapsed = time.time() - t0
        print(f"      ⏰ {te} (after {elapsed:.1f}s) — skipping to next model")
        return None
    except Exception as e:
        elapsed = time.time() - t0
        print(f"      ❌ Error after {elapsed:.1f}s: {str(e)[:150]}")
        return None
    finally:
        beat_stop.set()  # Always ensure heartbeat thread stops


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
    _RUN_REJECTED_HASHES.clear()  # fresh junk-frame memory for this article

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
