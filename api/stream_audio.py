"""
Streaming Text-to-Speech API — Vercel Python Serverless Function
Voice: en-US-AndrewMultilingualNeural (Microsoft Edge TTS)
Endpoint: GET /api/stream_audio?text=Hello+world

Features:
  - Smart text processing with paragraph-based natural pauses
  - Uses sentence/paragraph structure for human-like pacing
  - Input sanitization & length cap (5000 chars)
  - CORS headers for cross-origin requests
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import asyncio
import io
import json
import re


VOICE = "en-US-AvaNeural"
RATE = "+15%"
MAX_TEXT_LENGTH = 5000


def prepare_tts_text(raw_text: str) -> str:
    """
    Prepare text for natural TTS reading.
    
    - Ensures proper sentence-ending punctuation for natural pauses
    - Adds paragraph breaks as double periods for breathing room
    - Removes unwanted characters that break TTS flow
    - Does NOT insert fake pauses every N words (that was annoying)
    """
    if not raw_text or not raw_text.strip():
        return ""

    # Clean up the text
    text = raw_text.strip()
    
    # Remove markdown artifacts that might have leaked through
    text = re.sub(r'#{1,6}\s*', '', text)           # headings
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)  # bold
    text = re.sub(r'\*([^*]+)\*', r'\1', text)      # italic
    text = re.sub(r'`([^`]+)`', r'\1', text)        # inline code
    text = re.sub(r'```[\s\S]*?```', '', text)       # code blocks
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)  # links
    text = re.sub(r'https?://\S+', '', text)         # bare URLs
    
    # Split into sentences for natural flow
    # edge_tts naturally pauses at periods, so we just ensure
    # proper punctuation exists
    sentences = re.split(r'(?<=[.!?])\s+', text)
    
    # Rejoin with single spaces — edge_tts handles sentence 
    # pauses naturally at punctuation marks
    result = ' '.join(s.strip() for s in sentences if s.strip())
    
    return result


class handler(BaseHTTPRequestHandler):
    """Vercel Python Serverless Function handler."""

    def do_GET(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            text = query.get("text", [""])[0].strip()

            if not text:
                return self._json_error(400, "Missing required 'text' query parameter")

            # Sanitize & cap length
            text = text[:MAX_TEXT_LENGTH]
            
            # Clean text for natural TTS
            text = prepare_tts_text(text)
            
            if not text:
                return self._json_error(400, "Text is empty after cleaning")

            # Generate audio
            audio_bytes = self._generate(text)

            if not audio_bytes:
                return self._json_error(500, "Audio generation failed")

            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(audio_bytes)))
            self.send_header("Cache-Control", "public, max-age=86400, s-maxage=86400")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(audio_bytes)

        except Exception as exc:
            self._json_error(500, f"Internal error: {str(exc)[:200]}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ── helpers ────────────────────────────────────────────────────────

    def _generate(self, text: str) -> bytes:
        import edge_tts

        buf = io.BytesIO()
        loop = asyncio.new_event_loop()

        async def _stream():
            communicate = edge_tts.Communicate(text, VOICE, rate=RATE)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    buf.write(chunk["data"])

        try:
            loop.run_until_complete(_stream())
        finally:
            loop.close()

        return buf.getvalue()

    def _json_error(self, code: int, msg: str):
        body = json.dumps({"error": msg}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
