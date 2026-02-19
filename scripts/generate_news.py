#!/usr/bin/env python3
"""
Hourly AI & Tech News Generator v3.0
====================================
AI-FIRST news pipeline: Prioritizes Artificial Intelligence, LLMs, and ML news.
Falls back to general tech news when AI headlines are scarce.

Features:
- Runs every hour via GitHub Actions, adds 1 article per run
- AI-priority: prefers AI news, falls back to tech
- Category tagging: Each article tagged as "ai" or "tech"  
- AI news always sorted first in output
- Title-based fuzzy dedup (prevents same story from different sources)
- 200-250 word Gemini AI summaries
- FIFO rotation (50 most recent articles)

Usage:
    cd /home/sandeep/signature-prime
    source venv/bin/activate
    python scripts/generate_news.py

Environment:
    GEMINI_API_KEY: Your Google Gemini API key
"""

import json
import os
import re
import time
import uuid
from datetime import datetime
from html import unescape
from pathlib import Path
from typing import Optional

import feedparser
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Try to import Google Generative AI
try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    print("Warning: google-generativeai not installed. Run: pip install google-generativeai")

# =============================================================================
# CONFIGURATION
# =============================================================================

# AI-FOCUSED RSS Feeds (primary - fetched first, higher priority)
AI_RSS_FEEDS = [
    ("AI & ML News", "https://news.google.com/rss/search?q=artificial+intelligence+OR+machine+learning+OR+LLM+OR+deep+learning+OR+GPT+OR+neural+network&hl=en-US&gl=US&ceid=US:en"),
    ("AI Models & Companies", "https://news.google.com/rss/search?q=OpenAI+OR+Google+AI+OR+Microsoft+AI+OR+Meta+AI+OR+Anthropic+OR+Claude+OR+Gemini+AI+OR+Copilot+AI&hl=en-US&gl=US&ceid=US:en"),
    ("Open Source AI", "https://news.google.com/rss/search?q=open+source+AI+OR+Llama+OR+Mistral+OR+Hugging+Face+OR+Stable+Diffusion+OR+AI+model+release&hl=en-US&gl=US&ceid=US:en"),
]

# General Tech News (secondary - fallback when AI news is scarce)
TECH_RSS_FEEDS = [
    ("Tech News", "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en"),
]

# AI detection keywords (for accurate categorization)
AI_KEYWORDS = [
    'artificial intelligence', 'machine learning', 'deep learning', 'neural network',
    'llm', 'large language model', 'gpt', 'chatgpt', 'openai', 'gemini ai', 'copilot',
    'anthropic', 'claude', 'midjourney', 'stable diffusion', 'dall-e', 'sora',
    'hugging face', 'transformer', 'diffusion model', 'generative ai', 'gen ai',
    'ai model', 'ai agent', 'ai chatbot', 'ai assistant', 'ai tool', 'ai startup',
    'ai regulation', 'ai safety', 'ai ethics', 'ai chip', 'ai hardware',
    'nvidia ai', 'google ai', 'microsoft ai', 'meta ai', 'apple ai', 'amazon ai',
    'llama', 'mistral', 'phi-', 'qwen', 'deepseek', 'perplexity',
    'computer vision', 'natural language processing', 'nlp', 'reinforcement learning',
    'ai research', 'ai paper', 'ai benchmark', 'ai training', 'fine-tuning',
    'rag', 'retrieval augmented', 'vector database', 'embedding',
    'autonomous', 'self-driving', 'robotics ai', 'ai robot',
    'text-to-image', 'text-to-video', 'text-to-speech', 'speech-to-text',
    'ai-powered', 'ai-driven', 'ai-generated', 'ai-based',
]

# File paths
DATA_DIR = Path(__file__).parent.parent / "data"
PUBLIC_DATA_DIR = Path(__file__).parent.parent / "public" / "data"
NEWS_FILE = DATA_DIR / "tech_news.json"

# HARD LIMITS
MAX_PROCESS_LIMIT = 1   # 1 article per hourly run
MAX_STORAGE_LIMIT = 50

# AI vs Tech ratio
AI_TARGET_RATIO = 0.70
MIN_AI_ARTICLES = 5

# Gemini models
GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]


# =============================================================================
# GEMINI AI INITIALIZATION
# =============================================================================

def get_gemini_model():
    """Initialize and return the best available Gemini model."""
    if not GENAI_AVAILABLE:
        return None
    
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Warning: GEMINI_API_KEY not set.")
        return None
    
    genai.configure(api_key=api_key)
    
    for model_name in GEMINI_MODELS:
        try:
            model = genai.GenerativeModel(model_name)
            model.generate_content("test")
            print(f"Using Gemini model: {model_name}")
            return model
        except Exception as e:
            print(f"Model {model_name} not available: {e}")
            continue
    
    print("No Gemini model available.")
    return None


# =============================================================================
# CATEGORY DETECTION
# =============================================================================

def is_ai_article(title: str, summary: str = "") -> bool:
    """Determine if an article is AI-related based on title and summary."""
    text = (title + " " + summary).lower()
    for keyword in AI_KEYWORDS:
        if keyword.lower() in text:
            return True
    return False


def categorize_article(title: str, summary: str, feed_type: str) -> str:
    """Categorize article as 'ai' or 'tech'."""
    if feed_type == "ai" and is_ai_article(title, summary):
        return "ai"
    if is_ai_article(title, summary):
        return "ai"
    return "tech"


# =============================================================================
# RSS FEED PARSING
# =============================================================================

def extract_image_from_entry(entry) -> Optional[str]:
    """Extract image URL from RSS feed entry."""
    if hasattr(entry, 'media_content') and entry.media_content:
        for media in entry.media_content:
            if media.get('url') and media.get('medium') == 'image':
                return media['url']
            if media.get('url'):
                return media['url']
    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
        for thumb in entry.media_thumbnail:
            if thumb.get('url'):
                return thumb['url']
    if hasattr(entry, 'enclosures') and entry.enclosures:
        for enclosure in entry.enclosures:
            if enclosure.get('type', '').startswith('image/'):
                return enclosure.get('href') or enclosure.get('url')
    if hasattr(entry, 'links'):
        for link in entry.links:
            if link.get('type', '').startswith('image/'):
                return link.get('href')
    description = getattr(entry, 'description', '') or getattr(entry, 'summary', '')
    if description:
        soup = BeautifulSoup(description, 'html.parser')
        img = soup.find('img')
        if img and img.get('src'):
            return img['src']
    return None


def extract_source_from_entry(entry) -> str:
    """Extract the source/publisher name from RSS entry."""
    if hasattr(entry, 'source') and entry.source:
        if hasattr(entry.source, 'title'):
            return entry.source.title
    if hasattr(entry, 'author') and entry.author:
        return entry.author
    title = getattr(entry, 'title', '')
    match = re.search(r'-\s*([^-]+)$', title)
    if match:
        return match.group(1).strip()
    link = getattr(entry, 'link', '')
    if link:
        from urllib.parse import urlparse
        parsed = urlparse(link)
        domain = parsed.netloc.replace('www.', '')
        return domain.split('.')[0].capitalize()
    return "Tech News"


def clean_title(title: str) -> str:
    """Clean the title by removing source suffix."""
    cleaned = re.sub(r'\s*-\s*[^-]+$', '', title)
    return unescape(cleaned.strip())


def fetch_all_news():
    """Fetch news from all RSS feeds, separated into AI and Tech entries."""
    ai_entries = []
    tech_entries = []
    seen_links = set()

    # First: AI feeds
    print("\n=== FETCHING AI NEWS (Primary) ===")
    for feed_name, feed_url in AI_RSS_FEEDS:
        print(f"Fetching {feed_name}...")
        try:
            feed = feedparser.parse(feed_url)
            if not feed.entries:
                print(f"No entries in {feed_name}")
                continue
            new_count = 0
            for entry in feed.entries:
                link = getattr(entry, 'link', '')
                if link and link not in seen_links:
                    seen_links.add(link)
                    entry._feed_type = "ai"
                    ai_entries.append(entry)
                    new_count += 1
            print(f"{feed_name}: {len(feed.entries)} entries ({new_count} unique)")
        except Exception as e:
            print(f"Error fetching {feed_name}: {e}")

    # Second: Tech feeds
    print("\n=== FETCHING TECH NEWS (Secondary) ===")
    for feed_name, feed_url in TECH_RSS_FEEDS:
        print(f"Fetching {feed_name}...")
        try:
            feed = feedparser.parse(feed_url)
            if not feed.entries:
                print(f"No entries in {feed_name}")
                continue
            new_count = 0
            for entry in feed.entries:
                link = getattr(entry, 'link', '')
                if link and link not in seen_links:
                    seen_links.add(link)
                    title = getattr(entry, 'title', '')
                    summary = getattr(entry, 'summary', '') or getattr(entry, 'description', '')
                    if is_ai_article(title, summary):
                        entry._feed_type = "ai"
                        ai_entries.append(entry)
                    else:
                        entry._feed_type = "tech"
                        tech_entries.append(entry)
                    new_count += 1
            print(f"{feed_name}: {len(feed.entries)} entries ({new_count} unique)")
        except Exception as e:
            print(f"Error fetching {feed_name}: {e}")

    print(f"\nFeed Summary: {len(ai_entries)} AI + {len(tech_entries)} Tech = {len(ai_entries) + len(tech_entries)} total")
    return ai_entries, tech_entries


# =============================================================================
# AI SUMMARY GENERATION
# =============================================================================

def generate_ai_summary(model, title, original_summary, category):
    """Generate a detailed 200-250 word summary using Gemini AI."""
    if not model:
        soup = BeautifulSoup(original_summary, 'html.parser')
        text = soup.get_text(separator=' ', strip=True)
        words = text.split()[:250]
        return ' '.join(words) + ('...' if len(text.split()) > 250 else ''), False
    
    if category == "ai":
        prompt = f"""You are a professional AI & technology journalist writing detailed coverage for AI enthusiasts.
Write a comprehensive, engaging summary of 200 to 250 words for this AI/technology news article.
Focus on: What AI technology/model/company is involved, what changed, technical significance,
industry implications, and why AI enthusiasts should care.
Make it exciting, well-structured, and accessible. No title. No bullet points - flowing paragraphs only.

Title: {title}
Original: {original_summary}

Write ONLY the 200-250 word summary:"""
    else:
        prompt = f"""You are a professional tech journalist writing detailed news coverage for enthusiasts.
Write a comprehensive, engaging summary of 200 to 250 words for this technology news article.
Cover the key details, context, implications, and why it matters.
Make it exciting, well-structured, and accessible. No title. No bullet points - flowing paragraphs only.

Title: {title}
Original: {original_summary}

Write ONLY the 200-250 word summary:"""

    try:
        response = model.generate_content(prompt)
        summary = response.text.strip()
        words = summary.split()
        if len(words) > 280:
            words = words[:250]
            summary = ' '.join(words) + '...'
        return summary, True
    except Exception as e:
        print(f"   AI Error: {str(e)[:100]}...")
        soup = BeautifulSoup(original_summary, 'html.parser')
        text = soup.get_text(separator=' ', strip=True)
        words = text.split()[:250]
        return ' '.join(words) + ('...' if len(text.split()) > 250 else ''), False


# =============================================================================
# JSON FILE OPERATIONS
# =============================================================================

def load_existing_news():
    """Load existing news from JSON file."""
    if not NEWS_FILE.exists():
        return []
    try:
        with open(NEWS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('news', [])
    except Exception as e:
        print(f"Error loading existing news: {e}")
        return []


def save_news(news_items):
    """Save news items to JSON with FIFO rotation and AI-first sorting."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    # Sort: AI first, then tech; within each by date descending
    ai_items = [item for item in news_items if item.get('category') == 'ai']
    tech_items = [item for item in news_items if item.get('category') != 'ai']
    ai_items.sort(key=lambda x: x.get('date', ''), reverse=True)
    tech_items.sort(key=lambda x: x.get('date', ''), reverse=True)
    sorted_items = ai_items + tech_items
    
    if len(sorted_items) > MAX_STORAGE_LIMIT:
        print(f"FIFO Rotation: {len(sorted_items)} -> {MAX_STORAGE_LIMIT}")
        sorted_items = sorted_items[:MAX_STORAGE_LIMIT]
    
    data = {"news": sorted_items}
    with open(NEWS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    ai_count = len([i for i in sorted_items if i.get('category') == 'ai'])
    tech_count = len(sorted_items) - ai_count
    print(f"Saved {len(sorted_items)} items ({ai_count} AI + {tech_count} Tech)")

    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    public_file = PUBLIC_DATA_DIR / "tech_news.json"
    import shutil
    shutil.copy2(NEWS_FILE, public_file)
    print(f"Synced to {public_file}")


# =============================================================================
# MAIN PROCESSING
# =============================================================================

def title_similarity(a: str, b: str) -> float:
    """Simple word-overlap similarity between two titles (0.0 to 1.0)."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a or not words_b:
        return 0.0
    overlap = len(words_a & words_b)
    return overlap / min(len(words_a), len(words_b))


def is_duplicate_title(title: str, existing_titles: list, threshold: float = 0.7) -> bool:
    """Check if a title is too similar to any existing title."""
    for existing in existing_titles:
        if title_similarity(title, existing) >= threshold:
            return True
    return False


def process_news_entries(ai_entries, tech_entries, model):
    """Process RSS entries with AI-PRIORITY ordering. Adds 1 article per run."""
    news_items = []
    existing_news = load_existing_news()
    existing_links = {item.get('source_link') for item in existing_news}
    existing_titles = [item.get('title', '') for item in existing_news]
    
    processed_count = 0
    
    print(f"\nProcessing: looking for 1 new article (AI preferred)")
    print("=" * 60)
    
    # Phase 1: Try AI entries first
    for entry in ai_entries:
        if processed_count >= MAX_PROCESS_LIMIT:
            break
        link = getattr(entry, 'link', '')
        if link in existing_links:
            continue
        title = clean_title(getattr(entry, 'title', 'Untitled'))
        if is_duplicate_title(title, existing_titles):
            print(f"   SKIP (duplicate title): {title[:55]}...")
            continue
        original_summary = getattr(entry, 'summary', '') or getattr(entry, 'description', '')
        processed_count += 1
        print(f"\n[AI] {title[:55]}...")
        image_url = extract_image_from_entry(entry)
        source_name = extract_source_from_entry(entry)
        print(f"   Generating AI summary...")
        summary, was_successful = generate_ai_summary(model, title, original_summary, "ai")
        print(f"   {'Summary OK' if was_successful else 'Fallback summary'}")
        published = getattr(entry, 'published_parsed', None)
        date = datetime(*published[:6]).isoformat() + 'Z' if published else datetime.utcnow().isoformat() + 'Z'
        news_items.append({
            "id": str(uuid.uuid4()), "title": title, "summary": summary,
            "image_url": image_url, "source_link": link, "source_name": source_name,
            "date": date, "category": "ai"
        })
    
    # Phase 2: Fall back to tech entries if no AI article found
    if processed_count == 0:
        print(f"\nNo new AI articles — trying Tech News")
        for entry in tech_entries:
            if processed_count >= MAX_PROCESS_LIMIT:
                break
            link = getattr(entry, 'link', '')
            if link in existing_links:
                continue
            title = clean_title(getattr(entry, 'title', 'Untitled'))
            if is_duplicate_title(title, existing_titles):
                print(f"   SKIP (duplicate title): {title[:55]}...")
                continue
            original_summary = getattr(entry, 'summary', '') or getattr(entry, 'description', '')
            category = categorize_article(title, original_summary, getattr(entry, '_feed_type', 'tech'))
            processed_count += 1
            print(f"\n[{category.upper()}] {title[:55]}...")
            image_url = extract_image_from_entry(entry)
            source_name = extract_source_from_entry(entry)
            summary, was_successful = generate_ai_summary(model, title, original_summary, category)
            print(f"   {'Summary OK' if was_successful else 'Fallback summary'}")
            published = getattr(entry, 'published_parsed', None)
            date = datetime(*published[:6]).isoformat() + 'Z' if published else datetime.utcnow().isoformat() + 'Z'
            news_items.append({
                "id": str(uuid.uuid4()), "title": title, "summary": summary,
                "image_url": image_url, "source_link": link, "source_name": source_name,
                "date": date, "category": category
            })
    
    ai_final = len([i for i in news_items if i['category'] == 'ai'])
    tech_final = len(news_items) - ai_final
    print(f"\nResult: {ai_final} AI + {tech_final} Tech = {len(news_items)} total")
    return news_items


def main():
    """Main function."""
    print("\n" + "=" * 60)
    print("AI & TECH NEWS GENERATOR v3.0 - HOURLY MODE (1 article/run)")
    print("=" * 60)
    
    model = get_gemini_model()
    ai_entries, tech_entries = fetch_all_news()
    if not ai_entries and not tech_entries:
        print("No entries to process.")
        return
    
    existing_news = load_existing_news()
    print(f"Existing articles: {len(existing_news)}")
    
    # Backfill category for old articles
    for item in existing_news:
        if 'category' not in item:
            item['category'] = categorize_article(item.get('title', ''), item.get('summary', ''), 'tech')
    
    new_items = process_news_entries(ai_entries, tech_entries, model)
    
    if not new_items:
        print("No new items.")
        if existing_news:
            save_news(existing_news)
        return
    
    combined = new_items + existing_news
    save_news(combined)
    
    ai_new = len([i for i in new_items if i.get('category') == 'ai'])
    tech_new = len(new_items) - ai_new
    print(f"\nDONE: {ai_new} AI + {tech_new} Tech = {len(new_items)} new articles")
    print(f"Total stored: {min(len(combined), MAX_STORAGE_LIMIT)}")


if __name__ == "__main__":
    main()
