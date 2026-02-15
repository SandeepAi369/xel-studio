#!/usr/bin/env python3
"""
Local Streaming TTS Server — Optimized for low latency
Port: 5328

Optimizations:
  - Speaking rate +12% for natural but faster reading
  - Chunk streaming start logged for timing
  - CORS fully open for local dev
"""

from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import edge_tts
import uvicorn
import time

app = FastAPI(title="Signature TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VOICE = "en-US-AvaNeural"
RATE = "+12%"  # Slightly faster for snappier reading
MAX_TEXT_LENGTH = 5000


@app.get("/stream_audio")
async def stream_audio(
    text: str = Query(..., max_length=MAX_TEXT_LENGTH),
    rate: str = Query(default=RATE),
):
    """Stream TTS audio chunks as they're generated."""
    clean = text.strip()
    if not clean:
        raise HTTPException(400, "Empty text")

    start = time.perf_counter()

    async def generate():
        first = True
        communicate = edge_tts.Communicate(
            clean[:MAX_TEXT_LENGTH],
            VOICE,
            rate=rate,
        )
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                if first:
                    elapsed = (time.perf_counter() - start) * 1000
                    print(f"  ⚡ First byte in {elapsed:.0f}ms | {len(clean)} chars")
                    first = False
                yield chunk["data"]

    return StreamingResponse(
        generate(),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Transfer-Encoding": "chunked",
        },
    )


@app.get("/health")
def health():
    return {"status": "ok", "voice": VOICE, "rate": RATE}


if __name__ == "__main__":
    print()
    print("  🔊 Signature TTS Server (Optimized)")
    print(f"  Voice: {VOICE} @ {RATE}")
    print("  URL:   http://localhost:5328")
    print()
    uvicorn.run(app, host="0.0.0.0", port=5328, log_level="info")
