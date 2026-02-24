#!/usr/bin/env python3
"""Trigger workflow, wait for completion, fetch and display pipeline logs."""
import requests, time, zipfile, io

GH_TOKEN = "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"
REPO = "Sandeepchch/xel-studio"
H = {"Authorization": f"Bearer {GH_TOKEN}", "Accept": "application/vnd.github+json"}

# Trigger
r = requests.post(f"https://api.github.com/repos/{REPO}/actions/workflows/news_cron.yml/dispatches", headers=H, json={"ref": "main"})
print(f"Triggered: {r.status_code}")
time.sleep(8)

# Get run
r = requests.get(f"https://api.github.com/repos/{REPO}/actions/runs?per_page=1", headers=H)
run = r.json()["workflow_runs"][0]
run_id = run["id"]
print(f"Run {run_id}: {run['status']}")

# Poll
while run["status"] in ("queued", "in_progress"):
    time.sleep(15)
    run = requests.get(f"https://api.github.com/repos/{REPO}/actions/runs/{run_id}", headers=H).json()
    print(f"  ... {run['status']} / {run.get('conclusion', '-')}")

print(f"\nResult: {run.get('conclusion', 'N/A')}")

# Fetch logs
logs = requests.get(f"https://api.github.com/repos/{REPO}/actions/runs/{run_id}/logs", headers=H)
if logs.status_code == 200:
    z = zipfile.ZipFile(io.BytesIO(logs.content))
    for name in z.namelist():
        if "Run news" in name:
            content = z.read(name).decode("utf-8", errors="replace")
            # Show only image pipeline and result lines
            for line in content.split("\n"):
                if any(kw in line for kw in ["IMAGE", "Attempt", "Prompt:", "Download", "Cloudinary", "Placeholder", "Pipeline", "Saved", "Result", "complete", "Image:", "url="]):
                    print(line.split("Z ")[-1] if "Z " in line else line)
