#!/usr/bin/env python3
"""
Cloudinary orphan cleanup for AI News images.

Every news image is uploaded as  xel-news/<news-id>  where <news-id> is the
UUID of its Firestore document in the `news` collection. When a news item is
deleted (24 h TTL cron, manual delete…), its image stays in Cloudinary.
This job finds and removes those orphans — safely, in two phases:

  Phase 1  QUARANTINE  Tag orphans with `xel-orphan-YYYYMMDD` (the date they
                       were quarantined). Nothing is deleted and the image
                       keeps working. Remove the tag to undo.
  Phase 2  DELETE      Images whose quarantine tag is at least QUARANTINE_DAYS
                       old are re-checked against Firestore and deleted only
                       if they are STILL orphaned. Images that became live
                       again are untagged instead.

An image counts as an orphan only if ALL of these hold:
  * it is in the `xel-news/` folder and its name is exactly a UUID
    (article images and anything else are never considered);
  * no document with that ID exists in Firestore `news`;
  * no live news document references its URL in `image_url`;
  * it was uploaded more than GRACE_HOURS ago (never races a running
    news cycle, which uploads the image before writing the document).

Fail-closed guards — the job aborts WITHOUT touching anything if:
  * Firestore can't be read, or returns fewer than MIN_LIVE_NEWS documents;
  * more than MAX_ORPHAN_RATIO of recent images would be orphans
    (recent = newer than the news TTL, which should almost all be live).

Modes (env MODE): "dry-run" (default — report only), "quarantine",
"full" (quarantine + delete). Per-run caps limit how much any run can do.

Credentials (existing GitHub secrets, never printed):
  FIREBASE_SERVICE_ACCOUNT (JSON) and CLOUDINARY_CLOUD_NAME /
  CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET (or CLOUDINARY_URL).
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import cloudinary
import cloudinary.api
import cloudinary.uploader
import firebase_admin
from firebase_admin import credentials, firestore

FOLDER = "xel-news"
NEWS_COLLECTION = "news"
TAG_PREFIX = "xel-orphan-"
UUID_RE = re.compile(r"^xel-news/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

GRACE_HOURS = 24
QUARANTINE_DAYS = 7
RECENT_DAYS = 1            # news TTL is 24 h: recent images should almost all be live
MIN_LIVE_NEWS = 5
MAX_ORPHAN_RATIO = 0.5     # of recent images
MAX_TAG_PER_RUN = int(os.environ.get("MAX_TAG_PER_RUN", "3000"))
MAX_DELETE_PER_RUN = int(os.environ.get("MAX_DELETE_PER_RUN", "1000"))

MODE = os.environ.get("MODE", "dry-run").strip().lower()
NOW = datetime.now(timezone.utc)
TODAY_TAG = f"{TAG_PREFIX}{NOW:%Y%m%d}"


def log(msg: str) -> None:
    print(msg, flush=True)


def summary(lines: list[str]) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


def abort(reason: str) -> None:
    log(f"🛑 ABORT (nothing changed): {reason}")
    log(f"::error title=Cloudinary cleanup aborted::{reason} (nothing changed)")
    summary([f"## 🧹 Cloudinary cleanup — aborted", "", f"🛑 {reason}", "", "Nothing was tagged or deleted."])
    sys.exit(1)


def init() -> firestore.Client:
    creds_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT") or os.environ.get("FIREBASE_CREDENTIALS")
    if not creds_json:
        abort("FIREBASE_SERVICE_ACCOUNT is not set")
    firebase_admin.initialize_app(credentials.Certificate(json.loads(creds_json)))

    if os.environ.get("CLOUDINARY_URL"):
        cloudinary.config(cloudinary_url=os.environ["CLOUDINARY_URL"], secure=True)
    elif all(os.environ.get(k) for k in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET")):
        cloudinary.config(
            cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
            api_key=os.environ["CLOUDINARY_API_KEY"],
            api_secret=os.environ["CLOUDINARY_API_SECRET"],
            secure=True,
        )
    else:
        abort("Cloudinary credentials are not set")
    return firestore.client()


def live_news(db: firestore.Client) -> tuple[set[str], set[str]]:
    """IDs and image URLs of every live news document. Raises on any read error."""
    ids, urls = set(), set()
    for doc in db.collection(NEWS_COLLECTION).select(["image_url"]).stream():
        ids.add(doc.id)
        url = (doc.to_dict() or {}).get("image_url")
        if url:
            urls.add(url.split("?")[0])
    return ids, urls


def parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def list_assets(**kwargs) -> list[dict]:
    """All image assets for a listing call, following cursors."""
    out, cursor = [], None
    while True:
        params = dict(max_results=500, tags=True, **kwargs)
        if cursor:
            params["next_cursor"] = cursor
        res = cloudinary.api.resources(type="upload", resource_type="image", **params)
        out.extend(res.get("resources", []))
        cursor = res.get("next_cursor")
        if not cursor:
            return out


def quarantine_tags(asset: dict) -> list[str]:
    return [t for t in (asset.get("tags") or []) if t.startswith(TAG_PREFIX)]


def tag_date(tag: str) -> datetime | None:
    try:
        return datetime.strptime(tag[len(TAG_PREFIX):], "%Y%m%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def is_orphan(asset: dict, ids: set[str], urls: set[str]) -> bool:
    pid = asset["public_id"]
    if not UUID_RE.match(pid):
        return False                                   # not a news image name: never touch
    if pid.split("/", 1)[1] in ids:
        return False                                   # live news doc exists
    if (asset.get("secure_url") or "").split("?")[0] in urls:
        return False                                   # referenced by a live doc
    if NOW - parse_time(asset["created_at"]) < timedelta(hours=GRACE_HOURS):
        return False                                   # too new: could be mid-cycle
    return True


def main() -> None:
    if MODE not in ("dry-run", "quarantine", "full"):
        abort(f"unknown MODE {MODE!r}")
    log(f"🧹 Cloudinary orphan cleanup — mode={MODE}, grace={GRACE_HOURS}h, quarantine={QUARANTINE_DAYS}d")
    db = init()

    # 1. Live news (fail closed)
    try:
        ids, urls = live_news(db)
    except Exception as e:
        abort(f"could not read Firestore: {type(e).__name__}")
    log(f"📰 Live news documents: {len(ids)}")
    if len(ids) < MIN_LIVE_NEWS:
        abort(f"only {len(ids)} live news documents (< {MIN_LIVE_NEWS}); refusing to judge orphans")

    # 2. Images in the news folder
    assets = list_assets(prefix=f"{FOLDER}/")
    news_assets = [a for a in assets if UUID_RE.match(a["public_id"])]
    log(f"☁️ Images under {FOLDER}/: {len(assets)} ({len(news_assets)} with news-ID names)")

    recent = [a for a in news_assets if NOW - parse_time(a["created_at"]) < timedelta(days=RECENT_DAYS)]
    recent_missing = [a for a in recent if a["public_id"].split("/", 1)[1] not in ids]
    if recent and len(recent_missing) / len(recent) > MAX_ORPHAN_RATIO:
        abort(f"{len(recent_missing)}/{len(recent)} images from the last {RECENT_DAYS} day(s) have no live "
              f"news doc — looks like a data problem, not normal expiry")

    orphans = [a for a in news_assets if is_orphan(a, ids, urls)]
    already = [a for a in orphans if quarantine_tags(a)]
    to_tag = [a for a in orphans if not quarantine_tags(a)][:MAX_TAG_PER_RUN]
    orphan_bytes = sum(a.get("bytes", 0) for a in orphans)
    log(f"🔎 Orphans: {len(orphans)} ({orphan_bytes / 1e6:.1f} MB); already quarantined: {len(already)}; "
        f"to tag this run: {len(to_tag)}")

    # 3. Phase 1 — quarantine (tag only; image keeps working)
    tagged = 0
    if MODE in ("quarantine", "full") and to_tag:
        pids = [a["public_id"] for a in to_tag]
        for i in range(0, len(pids), 1000):
            cloudinary.uploader.add_tag(TODAY_TAG, pids[i:i + 1000])
            tagged += len(pids[i:i + 1000])
        log(f"🏷️ Tagged {tagged} orphan(s) with '{TODAY_TAG}'")

    # 4. Release anything quarantined that is live again; collect deletables.
    #    Works from the folder listing, so every quarantined news image is seen.
    released, deletable = [], []
    cutoff = NOW - timedelta(days=QUARANTINE_DAYS)
    for a in news_assets:
        tags = quarantine_tags(a)
        if not tags:
            continue
        if not is_orphan(a, ids, urls):
            released.append((a["public_id"], tags))      # live again: untag, never delete
            continue
        dates = [d for d in (tag_date(t) for t in tags) if d]
        if dates and min(dates) <= cutoff:
            deletable.append(a["public_id"])
    deletable = deletable[:MAX_DELETE_PER_RUN]

    if released and MODE in ("quarantine", "full"):
        for pid, tags in released:
            for t in tags:
                cloudinary.uploader.remove_tag(t, [pid])
        log(f"↩️ Released {len(released)} image(s) that are referenced again")

    # 5. Phase 2 — delete quarantined orphans past the quarantine window
    deleted = 0
    if MODE == "full" and deletable:
        for i in range(0, len(deletable), 100):
            res = cloudinary.api.delete_resources(deletable[i:i + 100], resource_type="image", type="upload")
            deleted += sum(1 for v in res.get("deleted", {}).values() if v == "deleted")
        log(f"🗑️ Deleted {deleted} quarantined orphan(s)")

    log(f"✅ Done. live={len(ids)} images={len(news_assets)} orphans={len(orphans)} "
        f"tagged={tagged} released={len(released)} eligible_delete={len(deletable)} deleted={deleted}")
    # Annotation: readable via the GitHub API (check-run annotations)
    log(f"::notice title=Cloudinary cleanup ({MODE})::live_news={len(ids)} news_images={len(news_assets)} "
        f"orphans={len(orphans)} orphan_mb={orphan_bytes / 1e6:.1f} already_quarantined={len(already)} "
        f"tagged={tagged} released={len(released)} eligible_delete={len(deletable)} deleted={deleted}")
    sample = "\n".join(f"- `{a['public_id']}` ({a['created_at'][:10]})" for a in orphans[:10]) or "- none"
    summary([
        f"## 🧹 Cloudinary cleanup — {MODE}", "",
        "| | |", "|---|---|",
        f"| Live news documents | {len(ids)} |",
        f"| Images with news-ID names in `{FOLDER}/` | {len(news_assets)} |",
        f"| Orphans (all checks passed) | {len(orphans)} ({orphan_bytes / 1e6:.1f} MB) |",
        f"| Already quarantined | {len(already)} |",
        f"| Tagged this run | {tagged} |",
        f"| Released (live again) | {len(released)} |",
        f"| Eligible for deletion | {len(deletable)} |",
        f"| Deleted this run | {deleted} |",
        "", "Sample orphans:", sample,
    ])


if __name__ == "__main__":
    main()
