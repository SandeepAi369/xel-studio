#!/usr/bin/env python3
"""Patch g4f broken Copilot provider.

g4f's Copilot.py has a broken import (click_trunstile typo). Since
CopilotAccount.py imports the Copilot class from Copilot.py, we must
write a valid stub that exports a dummy Copilot class.
"""
import subprocess
import os
import sys


def main():
    # Find g4f install location via pip
    result = subprocess.run(
        [sys.executable, "-m", "pip", "show", "g4f"],
        capture_output=True, text=True
    )
    loc = ""
    for line in result.stdout.split("\n"):
        if line.startswith("Location:"):
            loc = line.split(":", 1)[1].strip()
            break

    if not loc:
        print("g4f not installed, skipping patch")
        return

    copilot_path = os.path.join(loc, "g4f", "Provider", "Copilot.py")
    if not os.path.exists(copilot_path):
        print(f"Copilot.py not found at {copilot_path}")
        return

    print(f"Patching: {copilot_path}")

    stub = (
        '# Stub: replaces broken Copilot provider to prevent import crash\n'
        '# All symbols that other g4f modules import from here are stubbed.\n'
        'from __future__ import annotations\n'
        '\n'
        '# --- Stub functions imported by other g4f modules ---\n'
        'def get_headers(*args, **kwargs):\n'
        '    return {}\n'
        '\n'
        'def get_har_files(*args, **kwargs):\n'
        '    return []\n'
        '\n'
        'def readHAR(*args, **kwargs):\n'
        '    return None, None, {}\n'
        '\n'
        'def click_trunstile(*args, **kwargs):\n'
        '    pass\n'
        '\n'
        'def get_fake_cookie(*args, **kwargs):\n'
        '    return {}\n'
        '\n'
        '# --- Stub classes ---\n'
        'class Conversation:\n'
        '    conversation_id: str = ""\n'
        '    def __init__(self, conversation_id: str = ""):\n'
        '        self.conversation_id = conversation_id\n'
        '\n'
        'class Copilot:\n'
        '    working = False\n'
        '    label = "Copilot (disabled)"\n'
        '    url = ""\n'
        '    supports_stream = False\n'
        '    default_model = "Copilot"\n'
        '    models = []\n'
        '    model_aliases = {}\n'
        '    @classmethod\n'
        '    def create_completion(cls, *args, **kwargs):\n'
        '        raise RuntimeError("Copilot provider is disabled")\n'
        '    @classmethod\n'
        '    def create_authed(cls, *args, **kwargs):\n'
        '        raise RuntimeError("Copilot provider is disabled")\n'
    )

    with open(copilot_path, "w") as f:
        f.write(stub)
    print("Stub written successfully")

    # Verify g4f can import now
    try:
        from g4f.client import Client
        print("✅ g4f Client imports OK")
    except Exception as e:
        print(f"⚠️ g4f still has issues: {e}")


if __name__ == "__main__":
    main()
