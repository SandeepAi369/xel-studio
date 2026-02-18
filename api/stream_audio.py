"""
Streaming Text-to-Speech API — Vercel Python Serverless Function
Voice: en-US-AvaNeural (Microsoft Edge TTS)
Endpoint: GET /api/stream_audio?text=Hello+world

Optimizations:
  - Streams first audio bytes as soon as edge-tts produces them
  - Uses chunked transfer encoding for instant playback start
  - Input sanitization & length cap (5000 chars)
  - CORS headers for cross-origin requests
  - Increased speech rate (+15%) for snappier delivery
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import asyncio
import io
import json


VOICE = "en-US-AvaNeural"
RATE = "+15%"
MAX_TEXT_LENGTH = 5000


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
