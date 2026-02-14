#!/usr/bin/env python3
"""
Daily News Generator Script - Safe Mode
========================================
Fetches technology + AI news from Google News RSS, generates AI summaries using Gemini,
and maintains a rotating list of up to 50 news items.

Features:
- Hard limit of 10 articles per run (prevents rate limit issues)
- Strict 20-second sleep between API calls
- 30-second recovery sleep on errors
- No placeholder images (clean, honest approach)
- FIFO rotation (keeps only 50 most recent articles)
- 200-250 word detailed summaries per article

Usage:
    cd /home/sandeep/signature-prime
    source venv/bin/activate
    python scripts/generate_news.py

Environment:
    GEMINI_API_KEY: Your Google Gemini API key (set in .env file)
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

# Load environment variables from .env file
load_dotenv()

# Try to import Google Generative AI
try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    print("⚠️  google-generativeai not installed. Run: pip install google-generativeai")

# =============================================================================
# CONFIGURATION - Safe Mode Settings
# =============================================================================

# Google News RSS Feed (Technology Topic)
GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en"

# AI / Machine Learning News RSS Feed
AI_NEWS_RSS_URL = "https://news.google.com/rss/search?q=artificial+intelligence+OR+machine+learning+OR+LLM+OR+deep+learning+OR+GPT+OR+neural+network&hl=en-US&gl=US&ceid=US:en"

# File paths
DATA_DIR = Path(__file__).parent.parent / "data"
PUBLIC_DATA_DIR = Path(__file__).parent.parent / "public" / "data"
NEWS_FILE = DATA_DIR / "tech_news.json"

# HARD LIMITS - Rate Limit Protection
MAX_PROCESS_LIMIT = 10      # Maximum articles to process per run (HARD LIMIT)
MAX_STORAGE_LIMIT = 50      # Maximum articles to store in JSON (FIFO rotation)
SLEEP_AFTER_SUCCESS = 20    # Seconds to wait after successful API call
SLEEP_AFTER_ERROR = 30      # Seconds to wait after API error (rate limit recovery)

# Gemini model configuration (try latest first, fallback to older)
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
        print("⚠️  GEMINI_API_KEY not set. AI summaries will be skipped.")
        return None
    
    genai.configure(api_key=api_key)
    
    # Try models in order of preference
    for model_name in GEMINI_MODELS:
        try:
            model = genai.GenerativeModel(model_name)
            # Quick test to verify model works
            model.generate_content("test")
            print(f"✅ Using Gemini model: {model_name}")
            return model
        except Exception as e:
            print(f"❌ Model {model_name} not available: {e}")
            continue
    
    print("⚠️  No Gemini model available. Using original summaries.")
    return None


# =============================================================================
# RSS FEED PARSING
# =============================================================================

def extract_image_from_entry(entry) -> Optional[str]:
    """
    Extract image URL from RSS feed entry.
    Returns None if no image found (NO placeholders).
    """
    # Check media:content
    if hasattr(entry, 'media_content') and entry.media_content:
        for media in entry.media_content:
            if media.get('url') and media.get('medium') == 'image':
                return media['url']
            if media.get('url'):
                return media['url']
    
    # Check media:thumbnail
    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
        for thumb in entry.media_thumbnail:
            if thumb.get('url'):
                return thumb['url']
    
    # Check enclosure
    if hasattr(entry, 'enclosures') and entry.enclosures:
        for enclosure in entry.enclosures:
            if enclosure.get('type', '').startswith('image/'):
                return enclosure.get('href') or enclosure.get('url')
    
    # Check links for image
    if hasattr(entry, 'links'):
        for link in entry.links:
            if link.get('type', '').startswith('image/'):
                return link.get('href')
    
    # Parse description HTML for images
    description = getattr(entry, 'description', '') or getattr(entry, 'summary', '')
    if description:
        soup = BeautifulSoup(description, 'html.parser')
        img = soup.find('img')
        if img and img.get('src'):
            return img['src']
    
    # No image found - return None (clean approach)
    return None


def extract_source_from_entry(entry) -> str:
    """Extract the source/publisher name from RSS entry."""
    # Try source attribute
    if hasattr(entry, 'source') and entry.source:
        if hasattr(entry.source, 'title'):
            return entry.source.title
    
    # Try author
    if hasattr(entry, 'author') and entry.author:
        return entry.author
    
    # Try to extract from Google News format "Title - Source Name"
    title = getattr(entry, 'title', '')
    match = re.search(r'-\s*([^-]+)$', title)
    if match:
        return match.group(1).strip()
    
    # Extract from link domain
    link = getattr(entry, 'link', '')
    if link:
        from urllib.parse import urlparse
        parsed = urlparse(link)
        domain = parsed.netloc.replace('www.', '')
        return domain.split('.')[0].capitalize()
    
    return "Tech News"


def clean_title(title: str) -> str:
    """Clean the title by removing source suffix (Google News format)."""
    cleaned = re.sub(r'\s*-\s*[^-]+$', '', title)
    return unescape(cleaned.strip())


def fetch_google_news() -> list:
    """Fetch and parse Google News RSS feeds (Tech + AI)."""
    all_entries = []
    seen_links = set()

    feeds = [
        ("Tech News", GOOGLE_NEWS_RSS_URL),
        ("AI News", AI_NEWS_RSS_URL),
    ]

    for feed_name, feed_url in feeds:
        print(f"\n📡 Fetching {feed_name} RSS feed...")
        try:
            feed = feedparser.parse(feed_url)

            if feed.bozo:
                print(f"⚠️  {feed_name} feed parsing issue: {feed.bozo_exception}")

            if not feed.entries:
                print(f"❌ No entries found in {feed_name} RSS feed")
                continue

            # Deduplicate entries by link
            new_count = 0
            for entry in feed.entries:
                link = getattr(entry, 'link', '')
                if link and link not in seen_links:
                    seen_links.add(link)
                    all_entries.append(entry)
                    new_count += 1

            print(f"✅ Found {len(feed.entries)} entries in {feed_name} feed ({new_count} unique)")

        except Exception as e:
            print(f"❌ Error fetching {feed_name} RSS feed: {e}")

    print(f"\n📊 Total unique entries across all feeds: {len(all_entries)}")
    return all_entries


# =============================================================================
# AI SUMMARY GENERATION (with Rate Limit Protection)
# =============================================================================

def generate_ai_summary(model, title: str, original_summary: str) -> tuple[str, bool]:
    """
    Generate a detailed 200-250 word summary using Gemini AI.
    
    Returns:
        tuple: (summary_text, was_successful)
    """
    if not model:
        # No model available - use cleaned original summary
        soup = BeautifulSoup(original_summary, 'html.parser')
        text = soup.get_text(separator=' ', strip=True)
        words = text.split()[:250]
        return ' '.join(words) + ('...' if len(text.split()) > 250 else ''), False
    
    prompt = f"""You are a professional tech journalist writing detailed news coverage for enthusiasts.
Write a comprehensive, engaging, and informative summary of 200 to 250 words for this news article.
Cover the key details, context, implications, and why it matters.
Make it exciting, well-structured, and accessible. Do not include the title in the summary.
Do not use bullet points or lists - write in flowing paragraphs.

Title: {title}

Original Summary/Description: {original_summary}

Write ONLY the 200-250 word detailed summary, nothing else:"""

    try:
        response = model.generate_content(prompt)
        summary = response.text.strip()
        
        # Ensure it's within bounds (allow up to 280, trim to 250 if over)
        words = summary.split()
        if len(words) > 280:
            words = words[:250]
            summary = ' '.join(words) + '...'
        
        return summary, True
        
    except Exception as e:
        print(f"   ❌ AI Error: {str(e)[:100]}...")
        
        # Fallback to cleaned original
        soup = BeautifulSoup(original_summary, 'html.parser')
        text = soup.get_text(separator=' ', strip=True)
        words = text.split()[:250]
        return ' '.join(words) + ('...' if len(text.split()) > 250 else ''), False

# =============================================================================
# JSON FILE OPERATIONS
# =============================================================================

def load_existing_news() -> list:
    """Load existing news from JSON file."""
    if not NEWS_FILE.exists():
        return []
    
    try:
        with open(NEWS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('news', [])
    except Exception as e:
        print(f"⚠️  Error loading existing news: {e}")
        return []


def save_news(news_items: list) -> None:
    """Save news items to JSON file with FIFO rotation."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    # FIFO ROTATION: Keep only the top MAX_STORAGE_LIMIT items
    if len(news_items) > MAX_STORAGE_LIMIT:
        print(f"🔄 FIFO Rotation: Trimming from {len(news_items)} to {MAX_STORAGE_LIMIT} items")
        news_items = news_items[:MAX_STORAGE_LIMIT]
    
    data = {"news": news_items}
    
    with open(NEWS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"💾 Saved {len(news_items)} news items to {NEWS_FILE.name}")

    # Also copy to public/data/ for Next.js static serving
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    public_file = PUBLIC_DATA_DIR / "tech_news.json"
    import shutil
    shutil.copy2(NEWS_FILE, public_file)
    print(f"📋 Synced to {public_file}")


# =============================================================================
# MAIN PROCESSING LOOP (SAFE MODE)
# =============================================================================

def process_news_entries(entries: list, model) -> list:
    """
    Process RSS entries with STRICT rate limit protection.
    
    SAFE MODE:
    - Hard limit of MAX_PROCESS_LIMIT (10) articles
    - 20-second sleep after successful API call
    - 30-second sleep after errors
    - Breaks immediately when limit reached
    """
    news_items = []
    existing_news = load_existing_news()
    existing_links = {item.get('source_link') for item in existing_news}
    
    # Counter for processed items
    processed_count = 0
    
    print(f"\n🚀 Processing articles (SAFE MODE: max {MAX_PROCESS_LIMIT} articles)")
    print("=" * 60)
    
    for entry in entries:
        # ===== HARD LIMIT CHECK =====
        if processed_count >= MAX_PROCESS_LIMIT:
            print(f"\n✅ HARD LIMIT REACHED: {MAX_PROCESS_LIMIT} articles processed")
            break
        
        # Skip duplicates
        link = getattr(entry, 'link', '')
        if link in existing_links:
            continue
        
        title = clean_title(getattr(entry, 'title', 'Untitled'))
        original_summary = getattr(entry, 'summary', '') or getattr(entry, 'description', '')
        
        processed_count += 1
        print(f"\n📰 [{processed_count}/{MAX_PROCESS_LIMIT}] {title[:50]}...")
        
        # Extract image (None if not found - NO placeholders)
        image_url = extract_image_from_entry(entry)
        if image_url:
            print(f"   🖼️  Image found")
        else:
            print(f"   📝 Text-only card (no image)")
        
        # Extract source name
        source_name = extract_source_from_entry(entry)
        
        # Generate AI summary with rate limit protection
        print(f"   🤖 Generating AI summary...")
        summary, was_successful = generate_ai_summary(model, title, original_summary)
        
        if was_successful:
            print(f"   ✅ AI summary generated")
            # STRICT SLEEP: 20 seconds after successful API call
            if processed_count < MAX_PROCESS_LIMIT:
                print(f"   ⏳ Rate limit protection: sleeping {SLEEP_AFTER_SUCCESS}s...")
                time.sleep(SLEEP_AFTER_SUCCESS)
        else:
            print(f"   ⚠️  Using fallback summary")
            # ERROR RECOVERY: 30 seconds sleep after error
            if processed_count < MAX_PROCESS_LIMIT:
                print(f"   ⏳ Error recovery: sleeping {SLEEP_AFTER_ERROR}s...")
                time.sleep(SLEEP_AFTER_ERROR)
        
        # Parse date
        published = getattr(entry, 'published_parsed', None)
        if published:
            date = datetime(*published[:6]).isoformat() + 'Z'
        else:
            date = datetime.utcnow().isoformat() + 'Z'
        
        # Create news item
        news_item = {
            "id": str(uuid.uuid4()),
            "title": title,
            "summary": summary,
            "image_url": image_url,  # None if no image (clean approach)
            "source_link": link,
            "source_name": source_name,
            "date": date
        }
        
        news_items.append(news_item)
    
    print("\n" + "=" * 60)
    return news_items


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

def main():
    """Main function to run the news generation pipeline."""
    print("\n" + "=" * 60)
    print("📰 DAILY NEWS GENERATOR - SAFE MODE")
    print("=" * 60)
    print(f"   Max articles per run: {MAX_PROCESS_LIMIT}")
    print(f"   Max storage limit: {MAX_STORAGE_LIMIT}")
    print(f"   Sleep after success: {SLEEP_AFTER_SUCCESS}s")
    print(f"   Sleep after error: {SLEEP_AFTER_ERROR}s")
    
    # Initialize Gemini model
    model = get_gemini_model()
    
    # Fetch RSS entries
    entries = fetch_google_news()
    if not entries:
        print("\n❌ No news entries to process. Exiting.")
        return
    
    # Load existing news
    existing_news = load_existing_news()
    print(f"📂 Existing news items: {len(existing_news)}")
    
    # Process new entries (SAFE MODE)
    new_items = process_news_entries(entries, model)
    
    if not new_items:
        print("\n⚠️  No new items to add.")
        return
    
    # Combine: NEW items at TOP, then existing
    combined = new_items + existing_news
    
    # Save with FIFO rotation (keeps only top 50)
    save_news(combined)
    
    print("\n" + "=" * 60)
    print(f"✅ DONE!")
    print(f"   New items added: {len(new_items)}")
    print(f"   Total items: {min(len(combined), MAX_STORAGE_LIMIT)}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
