#!/usr/bin/env python3
"""
backfill_cloud.py — DORMANT go-live tool. Uploads the LOCAL intro-trimmed media
store (media/<id>.mp3|mp4) to a configured S3-compatible bucket (Cloudflare R2 /
Backblaze B2 / AWS S3), preserving the same keys: media/<id>.<ext>.

It does NOT touch manifest.json — paths there stay RELATIVE. Going live is then a
two-step, no-reprocessing flip:
    1. python3 build/backfill_cloud.py --all        # mirror local media/ -> bucket
    2. set data/content.json options.mediaBaseUrl = "https://<your-cdn-base>"

Idempotent/resumable: skips objects already in the bucket (HEAD check) unless
--force. Progress -> build/backfill_cloud.log.

  python3 build/backfill_cloud.py --check           # config + bucket reachability
  python3 build/backfill_cloud.py --all             # upload every local media file
  python3 build/backfill_cloud.py --ids 457569      # upload specific ids
  python3 build/backfill_cloud.py --all --force      # re-upload even if present

Config: build/cloud.config (git-ignored) or env vars — see cloud.config.example.
Requires the `aws` CLI on PATH. INERT until cloud.config is provided.
"""
import argparse, glob, os, re, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(HERE, "build")
sys.path.insert(0, BUILD)
import cloud                                         # noqa: E402

MEDIA = os.path.join(HERE, "media")
LOG = os.path.join(BUILD, "backfill_cloud.log")


def log(msg):
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    try:
        open(LOG, "a").write(line + "\n")
    except Exception:
        pass


def local_files(ids=None):
    files = []
    for p in sorted(glob.glob(os.path.join(MEDIA, "*.mp3")) + glob.glob(os.path.join(MEDIA, "*.mp4"))):
        name = os.path.basename(p)
        m = re.match(r"(\d+)\.(mp3|mp4)$", name)
        if not m:
            continue
        if ids and int(m.group(1)) not in ids:
            continue
        files.append((name, p))
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if args.check:
        return cloud.check()
    if not cloud.configured():
        log("cloud NOT configured — set build/cloud.config (see cloud.config.example). missing: "
            + ", ".join(cloud.missing()))
        return 2

    ids = {int(x) for x in args.ids.split(",") if x.strip()} if args.ids.strip() else None
    if not ids and not args.all:
        log("pass --all or --ids"); return 4

    files = local_files(ids)
    cfg = cloud.load_config()
    log(f"cloud sync start: {len(files)} local files -> bucket {cfg['S3_BUCKET']} "
        f"({cfg['S3_ENDPOINT_URL']}), cdn {cfg['CDN_BASE_URL']}")

    up = skip = err = 0
    for n, (name, path) in enumerate(files, 1):
        key = f"media/{name}"
        try:
            if not args.force and cloud.exists(key):
                skip += 1
                continue
            cloud.upload(path, key)
            up += 1
            log(f"[{n}/{len(files)}] uploaded {key}")
        except Exception as e:
            err += 1
            log(f"[{n}/{len(files)}] ERROR {key}: {e}")

    log(f"cloud sync done: {up} uploaded, {skip} already present, {err} errors. "
        f"Set content.json options.mediaBaseUrl='{cfg['CDN_BASE_URL']}' to serve from the CDN.")
    return 0 if err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
