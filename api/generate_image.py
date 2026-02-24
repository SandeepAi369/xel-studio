"""
/api/generate-image — g4f FLUX Image Generation (Serverless)
============================================================
Uses g4f library to generate images via FLUX model.
g4f auto-rotates between providers (Pollinations, Together, HuggingSpace).
No API key required — completely free.

Called internally by /api/cron/generate-news TypeScript route.
Returns JSON with image URL on success.
"""

from http.server import BaseHTTPRequestHandler
import json
import traceback

# Lazy import g4f to reduce cold start time
_g4f_client = None

def get_client():
    global _g4f_client
    if _g4f_client is None:
        from g4f.client import Client
        _g4f_client = Client()
    return _g4f_client


def generate_image(prompt: str, model: str = "flux") -> dict:
    """Generate an image using g4f with FLUX model and provider auto-rotation."""
    client = get_client()

    # Enhance prompt for photorealistic quality
    enhanced = f"{prompt}, photorealistic, 8k, highly detailed, sharp focus, professional lighting, cinematic"

    # Try up to 3 attempts with different approaches
    errors = []
    models_to_try = [model, "flux", "dalle-3"]  # fallback chain

    for attempt, m in enumerate(models_to_try, 1):
        try:
            response = client.images.generate(
                model=m,
                prompt=enhanced,
                response_format="url"
            )

            if response and response.data and len(response.data) > 0:
                url = response.data[0].url
                if url and len(url) > 10:
                    return {
                        "success": True,
                        "url": url,
                        "model": m,
                        "attempt": attempt,
                    }

            errors.append(f"Attempt {attempt} ({m}): Empty response")
        except Exception as e:
            errors.append(f"Attempt {attempt} ({m}): {str(e)}")

    return {
        "success": False,
        "url": None,
        "errors": errors,
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # Read request body
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body) if body else {}

            prompt = data.get("prompt", "")
            model = data.get("model", "flux")

            if not prompt:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "prompt is required"}).encode())
                return

            # Generate image
            result = generate_image(prompt, model)

            status = 200 if result["success"] else 500
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "error": str(e),
                "traceback": traceback.format_exc()
            }).encode())

    def do_GET(self):
        """Health check endpoint"""
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "status": "ok",
            "service": "g4f-image-generator",
            "models": ["flux", "dalle-3"],
        }).encode())
