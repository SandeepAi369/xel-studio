import os
import sys
import time

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("google-genai package not installed. Installing it now for testing...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "google-genai>=0.1.0"])
    from google import genai
    from google.genai import types

def test_gemini_models():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("❌ GEMINI_API_KEY is not set. Export it first, e.g.:")
        print("   export GEMINI_API_KEY=your-key-here")
        sys.exit(1)
    client = genai.Client(api_key=api_key)
    
    models_to_test = ["gemini-3-pro-image", "gemini-3.1-flash-image"]
    prompt = "A futuristic city skyline at sunset, high detail, cyberpunk style"
    
    for model in models_to_test:
        print(f"\n=========================================")
        print(f"Testing model: {model}")
        print(f"=========================================")
        try:
            t0 = time.time()
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                ),
            )
            elapsed = time.time() - t0
            
            if response.candidates and response.candidates[0].content.parts:
                for part in response.candidates[0].content.parts:
                    if part.image and part.image.image_bytes:
                        image_bytes = part.image.image_bytes
                        print(f"✅ SUCCESS: Generated image using {model} in {elapsed:.1f}s")
                        print(f"✅ Image size: {len(image_bytes)} bytes")
                        
                        # Save sample image
                        filename = f"test_output_{model}.png"
                        with open(filename, "wb") as f:
                            f.write(image_bytes)
                        print(f"✅ Saved sample to {filename}")
                        break
                else:
                    print(f"❌ Error: No image bytes found in response")
            else:
                print(f"❌ Error: No candidates or parts in response")
                print(response)
        except Exception as e:
            print(f"❌ API Exception for {model}: {e}")

if __name__ == "__main__":
    test_gemini_models()
