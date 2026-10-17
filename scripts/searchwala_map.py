"""
Map a SearchWala /search response to the pipeline's source list.

SearchWala's `search_results` entries carry url/title/snippet only; the
extracted page text lives in `results` (one or more passages per URL).
The pipeline used to read `extracted_text` from `search_results`, which
never existed there, so every SearchWala source reached the news writer
with an empty description. This joins each hit with its extracted text,
falling back to the snippet.

Shared by run_news_cycle.py and scraper_health.py.
"""

from urllib.parse import urldefrag

MAX_DESC_CHARS = 2000  # the LLM context builder trims further (120 chars/item)


def _key(url: str) -> str:
    return urldefrag(url or "")[0].rstrip("/").lower()


def map_searchwala_results(data: dict, limit: int = 10) -> list[dict]:
    passages: dict[str, list[str]] = {}
    for p in data.get("results") or []:
        text = (p.get("extracted_text") or "").strip()
        if p.get("url") and text:
            passages.setdefault(_key(p["url"]), []).append(text)

    mapped = []
    for hit in (data.get("search_results") or [])[:limit]:
        url = hit.get("url", "")
        text = " ".join(passages.get(_key(url), [])) or hit.get("extracted_text") or hit.get("snippet") or ""
        mapped.append({"title": hit.get("title", ""), "description": text[:MAX_DESC_CHARS], "url": url})
    return mapped
