#!/usr/bin/env python3
"""
XeL Studio — Official REST Image Tier
=====================================
Compliant, documented free/credit-tier image generation as a fallback layer
*after* the g4f engine. Every provider here is an official, documented,
OpenAI-compatible `/v1/images/generations` endpoint used within its own terms:

  • Together AI   — FLUX.1-schnell-Free endpoint (+ $25 signup credit)
  • Nebius Studio — flux-schnell ($0.0013/img, 30 img/min, free signup credit)

Multi-tier algorithmic logic block
----------------------------------
  1. PRIORITY providers (env-ordered), each with a POOL of API keys.
  2. PACING: per-provider min-interval (token-bucket-lite) so we stay under the
     documented RPM instead of getting throttled.
  3. TOKEN DISTRIBUTION: round-robin across a key pool; a key that returns 429 is
     put on cooldown (not hammered); a 401/403 key is dropped from the pool.
  4. ERROR HANDLING: 429→cooldown+rotate, 401/403→drop, 5xx/timeout→short
     backoff+retry, 400→stop (request-shape issue, won't fix by retrying).
  5. VERIFICATION: every image is gated by the SAME _validate_image() verifier
     as the rest of the pipeline; a fail triggers a fresh-seed regenerate.
  6. DEADLINE-AWARE and fully INERT — returns None when no key is configured, so
     it changes nothing until you add TOGETHER_API_KEY / NEBIUS_API_KEY.

Env configuration (any subset):
  TOGETHER_API_KEY = key1[,key2,...]
  NEBIUS_API_KEY   = key1[,key2,...]
  REST_IMAGE_PRIORITY  = "together,nebius"   # optional order override
  TOGETHER_IMAGE_MODEL / NEBIUS_IMAGE_MODEL  # optional model override
  TOGETHER_MIN_INTERVAL / NEBIUS_MIN_INTERVAL  # optional pacing override (secs)
"""
import os
import time
import base64
import random
import threading
import requests

IMG_W, IMG_H = 1024, 576
REQUEST_TIMEOUT = float(os.getenv("REST_REQUEST_TIMEOUT", "35"))
DOWNLOAD_TIMEOUT = 30
SOFT_BACKOFF = float(os.getenv("REST_SOFT_BACKOFF", "4"))
RATE_COOLDOWN = float(os.getenv("REST_RATE_COOLDOWN", "30"))
MAX_ATTEMPTS_PER_PROVIDER = int(os.getenv("REST_MAX_ATTEMPTS", "6"))


# ─── Provider payload builders (OpenAI-compatible images/generations) ─────────

def _together_payload(prompt: str, seed: int) -> dict:
    return {
        "model": os.getenv("TOGETHER_IMAGE_MODEL", "black-forest-labs/FLUX.1-schnell-Free"),
        "prompt": prompt, "width": IMG_W, "height": IMG_H,
        "steps": 4, "n": 1, "response_format": "url", "seed": seed,
    }


def _nebius_payload(prompt: str, seed: int) -> dict:
    return {
        "model": os.getenv("NEBIUS_IMAGE_MODEL", "black-forest-labs/flux-schnell"),
        "prompt": prompt, "width": IMG_W, "height": IMG_H,
        "num_inference_steps": 4, "n": 1, "response_format": "b64_json", "seed": seed,
    }


PROVIDERS = {
    "together": {
        "url": "https://api.together.ai/v1/images/generations",
        "env": "TOGETHER_API_KEY", "payload": _together_payload,
        "min_interval": float(os.getenv("TOGETHER_MIN_INTERVAL", "6.5")),  # ~9 rpm, safe on free
    },
    "nebius": {
        "url": "https://api.studio.nebius.ai/v1/images/generations",
        "env": "NEBIUS_API_KEY", "payload": _nebius_payload,
        "min_interval": float(os.getenv("NEBIUS_MIN_INTERVAL", "2.2")),    # 30 rpm documented
    },
}


# ─── Key pool with round-robin + cooldown + drop ─────────────────────────────

class _KeyPool:
    """Distributes load across a provider's API keys; cools 429'd keys, drops
    dead ones."""
    def __init__(self, keys):
        self.keys = list(dict.fromkeys(k.strip() for k in keys if k.strip()))
        self.cool = {}      # key -> epoch until which it's resting
        self.i = 0
        self.lock = threading.Lock()

    def next_key(self):
        with self.lock:
            n = len(self.keys)
            now = time.time()
            for _ in range(n):
                k = self.keys[self.i % n]
                self.i += 1
                if self.cool.get(k, 0) <= now:
                    return k
            return None  # all keys cooling or pool empty

    def cooldown(self, key, secs):
        with self.lock:
            self.cool[key] = time.time() + secs

    def drop(self, key):
        with self.lock:
            if key in self.keys:
                self.keys.remove(key)

    def alive(self):
        return len(self.keys) > 0


# ─── Per-provider request pacing (min-interval) ──────────────────────────────

_pace_lock = threading.Lock()
_last_call = {}


def _pace(provider: str, min_interval: float, deadline_ts):
    """Sleep just enough to honour the provider's RPM. Returns False if waiting
    would blow the deadline."""
    with _pace_lock:
        now = time.time()
        wait = min_interval - (now - _last_call.get(provider, 0.0))
        if wait > 0:
            if deadline_ts and now + wait > deadline_ts:
                return False
            time.sleep(wait)
        _last_call[provider] = time.time()
    return True


# ─── Response → bytes ────────────────────────────────────────────────────────

def _extract_bytes(data: dict):
    """Pull image bytes from an OpenAI-compatible images response (url or
    b64_json), tolerating minor schema variations."""
    items = data.get("data") or data.get("images") or []
    if isinstance(items, dict):
        items = [items]
    for it in items:
        if isinstance(it, str):
            cand = it
        elif isinstance(it, dict):
            cand = it.get("url") or it.get("b64_json") or it.get("image") or it.get("b64")
        else:
            cand = None
        if not cand:
            continue
        if isinstance(cand, str) and cand.startswith("http"):
            try:
                return requests.get(cand, timeout=DOWNLOAD_TIMEOUT,
                                    headers={"User-Agent": "XeL-Studio/3.0"}).content
            except Exception:
                continue
        s = cand.split(",", 1)[1] if isinstance(cand, str) and cand.startswith("data:") else cand
        try:
            return base64.b64decode(s)
        except Exception:
            continue
    return None


def _classify(status: int) -> str:
    if status == 200:
        return "ok"
    if status == 429:
        return "rate"
    if status in (401, 403):
        return "auth"
    if 500 <= status < 600:
        return "server"
    return "bad"


# ─── One provider, with full pacing/rotation/error handling ──────────────────

def _try_provider(name: str, spec: dict, pool: _KeyPool, prompt: str, deadline_ts) -> bytes | None:
    from gemini_image_gen import _validate_image  # reuse the production verifier

    for attempt in range(1, MAX_ATTEMPTS_PER_PROVIDER + 1):
        if deadline_ts and time.time() >= deadline_ts - 5:
            print(f"  ⏱️ [{name}] deadline reached — stopping")
            return None
        key = pool.next_key()
        if key is None:
            print(f"  ⏳ [{name}] all keys cooling/exhausted — moving on")
            return None
        if not _pace(name, spec["min_interval"], deadline_ts):
            print(f"  ⏱️ [{name}] pacing would exceed deadline — stopping")
            return None

        seed = random.randint(1, 2_000_000_000)
        try:
            r = requests.post(
                spec["url"],
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=spec["payload"](prompt, seed),
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as e:
            print(f"  ⚠️ [{name}#{attempt}] network: {str(e)[:90]} — backoff")
            time.sleep(SOFT_BACKOFF)
            continue

        kind = _classify(r.status_code)
        if kind == "auth":
            print(f"  🚫 [{name}#{attempt}] {r.status_code} auth — dropping this key")
            pool.drop(key)
            continue
        if kind == "rate":
            print(f"  ⏳ [{name}#{attempt}] 429 — cooling key {RATE_COOLDOWN:.0f}s, rotating")
            pool.cooldown(key, RATE_COOLDOWN)
            continue
        if kind == "server":
            print(f"  ⚠️ [{name}#{attempt}] {r.status_code} server — backoff")
            time.sleep(SOFT_BACKOFF)
            continue
        if kind == "bad":
            print(f"  ❌ [{name}#{attempt}] {r.status_code}: {r.text[:120]} — provider unusable")
            return None  # request-shape/credit problem: retrying won't help

        # 200 OK — extract + verify
        try:
            payload = r.json()
        except Exception:
            print(f"  ⚠️ [{name}#{attempt}] non-JSON 200 — backoff")
            time.sleep(SOFT_BACKOFF)
            continue
        img = _extract_bytes(payload)
        if not img:
            print(f"  ⚠️ [{name}#{attempt}] no image in 200 response — retry")
            continue
        v = _validate_image(img, name)
        m = v.get("metrics") or {}
        if not v["valid"]:
            print(f"  ❌ [{name}#{attempt}] verification failed: {', '.join(v['issues'])} — regen")
            continue
        print(f"  ✅ [{name}#{attempt}] verified {v['format'].upper()} {v['width']}×{v['height']} "
              f"({len(img):,}B | contrast {m.get('contrast',0):.0f} entropy {m.get('entropy',0):.1f}b "
              f"detail {m.get('detail',0):.0f} colours {m.get('colors',0)})")
        return img

    print(f"  ❌ [{name}] exhausted {MAX_ATTEMPTS_PER_PROVIDER} attempts")
    return None


def _active_providers():
    """Ordered list of (name, spec, pool) for providers that have ≥1 key set."""
    order = [p.strip() for p in os.getenv("REST_IMAGE_PRIORITY", "together,nebius").split(",") if p.strip()]
    out = []
    for name in order:
        spec = PROVIDERS.get(name)
        if not spec:
            continue
        raw = os.getenv(spec["env"], "")
        keys = [k for k in raw.split(",") if k.strip()]
        if keys:
            out.append((name, spec, _KeyPool(keys)))
    return out


def generate_rest_image(prompt: str, deadline_ts=None) -> bytes | None:
    """
    Try each configured official provider in priority order; return the first
    VERIFIED image's bytes, or None (→ caller falls through to the next tier).
    Inert (returns None instantly) when no provider key is configured.
    """
    providers = _active_providers()
    if not providers:
        return None
    full = f"Professional news editorial photography, 16:9, high resolution: {prompt}"
    print(f"\n  🌐 REST image tier: {', '.join(n for n, _, _ in providers)}")
    for name, spec, pool in providers:
        img = _try_provider(name, spec, pool, full, deadline_ts)
        if img:
            print(f"  🌐 REST tier SUCCESS via {name}")
            return img
    print(f"  🌐 REST tier: no verified image from any provider")
    return None


# ─── Standalone 5-run benchmark (runs live once a key is set) ─────────────────

if __name__ == "__main__":
    import sys
    for f in ("/home/sandeep/secure_keys/.env", "/home/sandeep/secure_keys/.env.local"):
        try:
            for line in open(f):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k, v)
        except Exception:
            pass
    if not _active_providers():
        print("No REST provider key configured (TOGETHER_API_KEY / NEBIUS_API_KEY). Nothing to benchmark.")
        sys.exit(0)
    PROMPTS = [
        "OpenAI unveils a new GPT model, futuristic AI data center, cinematic",
        "Federal Reserve building, finance and economy, editorial photo",
        "A humanoid robot assisting a doctor in a hospital, photorealistic",
        "Climate wildfire and renewable solar farm, dramatic lighting",
        "Electric vehicle charging in a modern city at dusk, sharp focus",
    ]
    ok = 0
    t0 = time.time()
    for i, p in enumerate(PROMPTS, 1):
        print(f"\n===== RUN {i}/5 =====")
        c0 = time.time()
        img = generate_rest_image(p)
        print(f"  run {i}: {'OK' if img else 'FAIL'} in {time.time()-c0:.1f}s")
        ok += 1 if img else 0
    print(f"\n5-RUN RESULT: {ok}/5 verified in {time.time()-t0:.1f}s")
    sys.exit(0 if ok == 5 else 1)
