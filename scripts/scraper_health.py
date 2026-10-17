#!/usr/bin/env python3
"""
Scraper health check — SearchWala, exactly as the news pipeline uses it.

Sends the pipeline's real request (POST /search, focus_mode "lite",
max_results 10) for a few of its real queries and reports, per query:
  hits          entries in `search_results`
  text_hits     hits whose text reaches the news writer (see below)
  context_chars characters of article text the writer would get
  passages      entries in `results` (extracted page text)
plus engine health from /health/engines.

Exit 1 if SearchWala is down or returns no hits (the pipeline would then
fall back to Tavily). Results are also printed as ::notice annotations so
they can be read from the GitHub API.
"""

import json
import os
import sys
import time
import urllib.request

BASE = "http://localhost:8000"
QUERIES = [
    "artificial intelligence latest breakthroughs announcements",
    "AI regulation policy government updates",
    "disability technology assistive tech accessibility news",
]
# Mirror of the mapping in scripts/run_news_cycle.py (search_searchwala).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def post(path: str, body: dict, timeout: int = 150) -> dict:
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def get(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.load(r)


def pipeline_mapping(data: dict) -> list[dict]:
    """Same logic the pipeline uses to turn a SearchWala response into sources."""
    try:
        from searchwala_map import map_searchwala_results  # shared with the pipeline
        return map_searchwala_results(data)
    except ImportError:
        return [{"title": r.get("title", ""), "description": r.get("extracted_text", ""), "url": r.get("url", "")}
                for r in data.get("search_results", [])]


def main() -> int:
    try:
        get("/health")
    except Exception as e:
        print(f"::error title=SearchWala down::/health failed: {e}")
        return 1

    fails = 0
    lines = ["## 🔎 Scraper health (SearchWala)", "", "| Query | Hits | Hits with text | Text chars to writer | Passages | Seconds |",
             "|---|---|---|---|---|---|"]
    for q in QUERIES:
        t0 = time.time()
        try:
            data = post("/search", {"query": q, "max_results": 10, "focus_mode": "lite"})
        except Exception as e:
            fails += 1
            print(f"::error title=Search failed::{q}: {e}")
            continue
        secs = time.time() - t0
        mapped = pipeline_mapping(data)
        hits = len(data.get("search_results", []))
        text_hits = sum(1 for m in mapped if len(m["description"].strip()) >= 80)
        chars = sum(len(m["description"]) for m in mapped)
        passages = len(data.get("results", []))
        if hits == 0:
            fails += 1
        print(f"::notice title=SearchWala: {q[:40]}::hits={hits} text_hits={text_hits} "
              f"context_chars={chars} passages={passages} seconds={secs:.1f} mode={data.get('mode')}")
        lines.append(f"| {q} | {hits} | {text_hits} | {chars} | {passages} | {secs:.1f} |")

    try:
        eng = get("/health/engines")
        flat = json.dumps(eng)
        print(f"::notice title=SearchWala engines::{flat[:900]}")
    except Exception as e:
        print(f"::warning title=Engine health unavailable::{e}")

    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
