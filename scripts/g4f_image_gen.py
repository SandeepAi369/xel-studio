#!/usr/bin/env python3
"""
g4f Image Generation Helper — called as a subprocess.
Generates an image using g4f and prints the image URL to stdout.

Usage: python g4f_image_gen.py "prompt text"
Exit codes:
  0 = success (URL printed to stdout)
  1 = all models failed (no output)
"""
import sys
import json

def main():
    if len(sys.argv) < 2:
        print("Usage: python g4f_image_gen.py 'prompt'", file=sys.stderr)
        sys.exit(1)

    prompt = sys.argv[1]
    models = ["flux", "flux-realism", "sdxl", "dalle"]

    try:
        from g4f.client import Client
    except Exception as e:
        print(f"g4f import error: {e}", file=sys.stderr)
        sys.exit(1)

    client = Client()

    for model in models:
        try:
            print(f"Trying model: {model}", file=sys.stderr)
            response = client.images.generate(
                model=model,
                prompt=prompt,
                response_format="url",
            )
            if response and response.data and len(response.data) > 0:
                url = response.data[0].url
                if url:
                    # Print ONLY the URL to stdout (no other text)
                    print(url)
                    sys.exit(0)
        except Exception as e:
            print(f"  {model} failed: {e}", file=sys.stderr)
            continue

    print("All models failed", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
