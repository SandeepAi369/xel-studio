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
import queue
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
# Uses g4f Auto provider for all models — no hardcoded providers.
# NOTE on "2× retries": the OLD engine stopped after a fixed ~7 attempts (which
# is why it died in ~2 min). The retry *limit* is now governed by MAX_ROUNDS
# (default 40) × these models, bounded by the deadline — i.e. far more than 2×
# the old attempt budget, while actually using the full time window.
MODEL_CHAIN = [
    {"name": "flux",        "label": "FLUX",      "quality": "best"},
    {"name": "flux-dev",    "label": "FLUX Dev",  "quality": "best"},
    {"name": "gpt-image",   "label": "GPT Image", "quality": "good"},
]

PER_ATTEMPT_TIMEOUT = 75           # Max seconds to wait on one generation request
DOWNLOAD_TIMEOUT = 30              # Max seconds for image download
DOWNLOAD_RETRIES = 3               # Download retry count
MIN_IMAGE_SIZE = 2000              # Minimum valid image size in bytes
GLOBAL_TIME_BUDGET = 780           # Fallback budget when no deadline is passed in
HEARTBEAT_INTERVAL = 10            # Print heartbeat every N seconds during waits

# ─── Aggression / multi-request config (env-tunable) ─────────
# The engine cycles the model chain in ROUNDS until the time budget is (almost)
# gone, firing PARALLEL_REQUESTS request(s) per batch.
#
# IMPORTANT (measured June 2026): the free HF-backed providers enforce a
# per-IP queue of *one* in-flight request ("Queue full for IP … max: 1") and a
# small ZeroGPU quota. Firing 2+ parallel, or hammering with no pause, COLLIDES
# and BURNS the quota — making things worse, not better. So we default to 1
# concurrent request and PACE retries with adaptive backoff. Raise IMAGE_PARALLEL
# only if you add an authenticated HF token that lifts the per-IP queue limit.
PARALLEL_REQUESTS = int(os.getenv("IMAGE_PARALLEL", "1"))   # concurrent requests per batch
MAX_ROUNDS = int(os.getenv("IMAGE_MAX_ROUNDS", "40"))      # hard cap on full-chain cycles
MIN_ATTEMPT_BUDGET = 35            # don't START a batch with less than this much time left
SOFT_BACKOFF = 5                   # pause after a transient miss (timeout / empty / verify-fail)
HARD_BACKOFF = 15                  # longer pause after a quota/auth/queue error, to let it breathe
# After this many CONSECUTIVE hard provider blocks (quota/api_key/queue/402…),
# the IP is clearly throttled — stop spinning and hand off to the verified stock
# fallback rather than burning the rest of the window for nothing.
MAX_HARD_FAILS = int(os.getenv("IMAGE_MAX_HARD_FAILS", "9"))
GLOBAL_HEARTBEAT_SECS = 8          # watchdog prints engine status at least this often

# Substrings that mark a "hard" provider block (won't recover by instant retry)
_HARD_ERROR_MARKERS = (
    "quota", "api_key", "api key", "queue full", "unauthorized", "forbidden",
    "401", "402", "403", "payment", "exceeded", "no auth", "rate limit", "429",
)


def _is_hard_error(msg: str) -> bool:
    m = (msg or "").lower()
    return any(k in m for k in _HARD_ERROR_MARKERS)

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


def _generate_one_threadsafe(client, model: str, prompt: str, wid: int) -> tuple:
    """
    One generation attempt (request → download → verify), safe to run inside a
    worker thread. Uses NO signals (SIGALRM only works on the main thread); a
    hung request is bounded by the per-BATCH deadline instead, and its thread is
    a daemon so it can never block process exit.

    Returns (bytes | None, kind) where kind ∈
      "ok"     verified image
      "hard"   provider block that won't recover by instant retry (quota/auth/queue)
      "verify" generated but failed content verification (regenerate)
      "soft"   transient miss (timeout / empty / download fail)
    """
    t0 = time.time()
    try:
        response = client.images.generate(model=model, prompt=prompt, response_format="url")
    except Exception as e:
        msg = str(e)
        kind = "hard" if _is_hard_error(msg) else "soft"
        tag = "🚫" if kind == "hard" else "⚠️"
        print(f"      {tag} [{model}#{wid}] {kind} error after {time.time()-t0:.0f}s: {msg[:120]}")
        return None, kind

    if not response or not getattr(response, "data", None):
        print(f"      ⚠️ [{model}#{wid}] empty response ({time.time()-t0:.0f}s)")
        return None, "soft"
    url = response.data[0].url
    if not url:
        print(f"      ⚠️ [{model}#{wid}] no URL in response")
        return None, "soft"

    image_bytes = _download_image(url)
    if not image_bytes:
        return None, "soft"

    # Verify content — a False verdict here is what drives REGENERATE.
    v = _validate_image(image_bytes, model)
    m = v.get("metrics") or {}
    if not v["valid"]:
        print(f"      ❌ [{model}#{wid}] verification failed: {', '.join(v['issues'])}")
        if m.get("ahash"):
            _RUN_REJECTED_HASHES.add(m["ahash"])  # remember junk frame for this run
        return None, "verify"
    if m.get("ahash") and m["ahash"] in _RUN_REJECTED_HASHES:
        print(f"      ❌ [{model}#{wid}] repeat of a frame already rejected this run")
        return None, "verify"

    dims = f"{v['width']}×{v['height']}" if v["width"] > 0 else "?"
    metric_str = ""
    if m:
        metric_str = (f" | contrast {m['contrast']:.0f} entropy {m['entropy']:.1f}b "
                      f"detail {m['detail']:.0f} colours {m['colors']}")
    print(f"      ✅ [{model}#{wid}] Verified {v['format'].upper()} {dims} "
          f"({len(image_bytes):,} bytes, {time.time()-t0:.1f}s){metric_str}", flush=True)
    return image_bytes, "ok"


def _generate_batch(client, model: str, prompt: str, n: int, deadline_ts: float) -> tuple:
    """
    Fire `n` generation attempt(s) and return the FIRST verified frame.
    Bounded by PER_ATTEMPT_TIMEOUT *and* the global deadline. Workers are daemon
    threads delivering results through a queue, so a stuck provider request can
    never stall the engine or block process exit — we simply stop waiting.

    Returns (bytes | None, batch_kind) where batch_kind is "ok" on success,
    "hard" if every completed worker hit a hard provider block, else "soft".
    """
    budget = deadline_ts - time.time()
    if budget < MIN_ATTEMPT_BUDGET:
        return None, "soft"
    timeout = min(PER_ATTEMPT_TIMEOUT + DOWNLOAD_TIMEOUT, budget)

    result_q: "queue.Queue" = queue.Queue()

    def _worker(worker_id: int):
        try:
            result_q.put(_generate_one_threadsafe(client, model, prompt, worker_id))
        except Exception as e:
            print(f"      ❌ [{model}#{worker_id}] worker crash: {str(e)[:100]}")
            result_q.put((None, "soft"))

    for i in range(n):
        threading.Thread(target=_worker, args=(i + 1,), daemon=True).start()

    hard_stop = time.time() + timeout
    collected = 0
    kinds = []
    while collected < n and time.time() < hard_stop:
        try:
            wait_for = max(0.2, min(GLOBAL_HEARTBEAT_SECS, hard_stop - time.time()))
            img, kind = result_q.get(timeout=wait_for)
        except queue.Empty:
            _heartbeat(f"{model} batch in flight... {n - collected} pending, "
                       f"{hard_stop - time.time():.0f}s left")
            continue
        collected += 1
        kinds.append(kind)
        if img:
            return img, "ok"  # first verified frame wins; remaining workers abandoned
    if collected < n:
        _heartbeat(f"{model} batch timed out ({n - collected} still pending) — moving on")
    # A batch counts as "hard" only if something completed and ALL of it was hard.
    batch_kind = "hard" if (kinds and all(k == "hard" for k in kinds)) else "soft"
    return None, batch_kind


# ─── Main Engine ─────────────────────────────────────────────

def generate_image_gemini(prompt: str, retries: int = 2,
                          deadline_ts: "float | None" = None) -> bytes | None:
    """
    g4f Image Generation Engine v3.0 — aggressive, budget-driven, multi-request.

    Key properties (fixes "cuts off in 2 min / silently exits before fallback"):
      • Fires PARALLEL_REQUESTS concurrent generations per batch.
      • Cycles the whole MODEL_CHAIN in ROUNDS until `deadline_ts` is nearly
        reached — it NO LONGER stops after a fixed attempt count, so it uses the
        FULL time window instead of bailing after ~7 quick failures.
      • A global watchdog heartbeat guarantees continuous "alive" output.
      • Fully crash-guarded: any error returns None (never raises, never exits
        the process) so the caller can always reach its verified stock fallback.

    `deadline_ts` is an absolute time.time() value. When omitted it defaults to
    now + GLOBAL_TIME_BUDGET (used by the standalone test).
    """
    engine_start = time.time()
    if deadline_ts is None:
        deadline_ts = engine_start + GLOBAL_TIME_BUDGET
    budget = max(0.0, deadline_ts - engine_start)

    try:
        from g4f.client import Client as G4FClient
    except Exception as e:
        print(f"  ⚠️ g4f unavailable ({str(e)[:80]}) — cannot generate images")
        return None
    try:
        client = G4FClient()
    except Exception as e:
        print(f"  ⚠️ g4f client init failed ({str(e)[:80]})")
        return None

    _RUN_REJECTED_HASHES.clear()  # fresh junk-frame memory for this article

    # ── Global watchdog heartbeat (runs for the WHOLE engine lifetime) ──
    status = {"round": 0, "model": "-", "batches": 0}
    hb_stop = threading.Event()

    def _watchdog():
        while not hb_stop.wait(GLOBAL_HEARTBEAT_SECS):
            el = time.time() - engine_start
            left = deadline_ts - time.time()
            print(f"    💓 [{time.strftime('%H:%M:%S')}] engine alive — round {status['round']}, "
                  f"model {status['model']}, batch #{status['batches']}, "
                  f"{el:.0f}s used / {left:.0f}s left", flush=True)

    threading.Thread(target=_watchdog, daemon=True).start()

    print(f"\n  {'━'*55}")
    print(f"  🖼️  IMAGE ENGINE v3.0 (g4f, aggressive multi-request)")
    print(f"  📝 Prompt: \"{prompt[:80]}{'...' if len(prompt) > 80 else ''}\"")
    print(f"  🔧 {len(MODEL_CHAIN)} models | {PARALLEL_REQUESTS}× parallel/batch | "
          f"≤{MAX_ROUNDS} rounds | budget {budget:.0f}s")
    print(f"  {'━'*55}", flush=True)

    try:
        total_batches = 0
        hard_streak = 0          # consecutive hard provider blocks across the whole run
        bail_reason = None
        for round_no in range(1, MAX_ROUNDS + 1):
            if deadline_ts - time.time() < MIN_ATTEMPT_BUDGET:
                bail_reason = f"out of budget ({deadline_ts - time.time():.0f}s left)"
                break
            status["round"] = round_no
            print(f"\n  ╔═ ROUND {round_no}/{MAX_ROUNDS} "
                  f"({deadline_ts - time.time():.0f}s left) ═══════════════")

            for model_info in MODEL_CHAIN:
                left = deadline_ts - time.time()
                if left < MIN_ATTEMPT_BUDGET:
                    break
                status["model"] = model_info["label"]
                total_batches += 1
                status["batches"] = total_batches
                print(f"  ║ 🎨 {model_info['label']} batch #{total_batches} "
                      f"({PARALLEL_REQUESTS}× req, {left:.0f}s left, hard-streak {hard_streak})",
                      flush=True)

                result, kind = _generate_batch(client, model_info["name"], prompt,
                                               PARALLEL_REQUESTS, deadline_ts)
                if result:
                    total = time.time() - engine_start
                    print(f"  ╚═ ✅ SUCCESS via {model_info['label']} "
                          f"(round {round_no}, batch #{total_batches}, "
                          f"{total:.1f}s, {len(result):,} bytes)")
                    return result

                # Track sustained hard blocks (quota/auth/queue) so we don't spin
                # the whole window on an IP the providers are refusing to serve.
                if kind == "hard":
                    hard_streak += 1
                else:
                    hard_streak = 0
                if hard_streak >= MAX_HARD_FAILS:
                    bail_reason = (f"providers hard-blocked {hard_streak}× in a row "
                                   f"(quota/auth/queue) — handing off to fallback")
                    break

                # Adaptive backoff: breathe longer after hard blocks (lets quota
                # recover and paces us across the full window), short otherwise.
                back = HARD_BACKOFF if kind == "hard" else SOFT_BACKOFF
                remaining = deadline_ts - time.time()
                if remaining > MIN_ATTEMPT_BUDGET:
                    _wait_with_heartbeat(int(min(back, remaining - 2)),
                                         f"backoff/{kind} ({model_info['label']})")

            if bail_reason:
                break

        if bail_reason:
            print(f"\n  ⏹️  Stopping: {bail_reason}")
    except Exception as e:
        print(f"  ❌ Engine error (caught — returning None so caller can fall back): "
              f"{type(e).__name__}: {str(e)[:150]}")
    finally:
        hb_stop.set()

    total_time = time.time() - engine_start
    print(f"\n  {'━'*55}")
    print(f"  ❌ NO VERIFIED IMAGE after {status['batches']} batches in {total_time:.1f}s")
    print(f"  → caller will fall back to a verified stock photo")
    print(f"  {'━'*55}", flush=True)
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
