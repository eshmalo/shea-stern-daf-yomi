#!/usr/bin/env python3
"""
refresh.py — end-to-end auto-update for the Daf Yomi site.

One command that does the whole loop:
  1. pull Rabbi Stern's TorahAnytime page  (fetch_library.py -> data/library.json)
  2. detect newly-posted shiurim           (diff vs the previous snapshot)
  3. self-host them with the intro CUT      (selfhost_media.py, audio + video)
  4. update media/manifest.json

Designed to run unattended (hourly via launchd). It only processes shiurim that
are NEW since the last snapshot AND not already in the manifest, so a normal run
trims just the daf(s) posted in the last hour and disk use stays bounded.

  python3 build/refresh.py                  # snapshot + self-host new shiurim
  python3 build/refresh.py --max 10         # cap how many new ids to trim per run
  python3 build/refresh.py --no-video       # audio only
  python3 build/refresh.py --backfill 25    # ALSO trim 25 of the oldest not-yet-hosted (opt-in; 60GB+ for all)
  python3 build/refresh.py --snapshot-only  # just refresh the catalog, no media

Requires: ffmpeg/ffprobe on PATH (for the media step). No deps beyond stdlib
(+ certifi if present). Logs a timestamped line per run to build/refresh.log.
"""
import argparse, json, os, ssl, subprocess, sys, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(HERE, "build")
SNAP = os.path.join(HERE, "data", "library.json")
MEDIA = os.path.join(HERE, "media")
MANIFEST = os.path.join(MEDIA, "manifest.json")
LOG = os.path.join(BUILD, "refresh.log")
PY = sys.executable or "python3"

API = "https://api.torahanytime.com"
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()
    CTX.check_hostname = False
    CTX.verify_mode = ssl.CERT_NONE


def log(msg):
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "refresh/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90, context=CTX) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def load_ids(path):
    try:
        return {l["id"] for l in json.load(open(path))["lectures"]}
    except Exception:
        return set()


def load_manifest():
    try:
        return json.load(open(MANIFEST))
    except Exception:
        return {}


def already_hosted(manifest, lid, want_video):
    """True if this id is fully self-hosted (audio, and video too if it has one)."""
    e = manifest.get(str(lid))
    if not e:
        return False
    if not e.get("audio"):
        return False
    if want_video and not e.get("video"):
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speaker", type=int, default=587)
    ap.add_argument("--max", type=int, default=12, help="max NEW ids to self-host per run (safety cap)")
    ap.add_argument("--backfill", type=int, default=0, help="ALSO host this many of the oldest not-yet-hosted shiurim")
    ap.add_argument("--no-video", action="store_true", help="audio only (skip video copies)")
    ap.add_argument("--snapshot-only", action="store_true", help="refresh catalog only, no media")
    ap.add_argument("--trim", type=float, default=7.5)
    ap.add_argument("--delogo", default="x=1:y=288:w=96:h=71", help="ffmpeg delogo box to erase the TA watermark from new videos ('' to disable)")
    args = ap.parse_args()

    log(f"refresh start (speaker {args.speaker}, max {args.max}, backfill {args.backfill}, video {not args.no_video})")

    # 1+2. snapshot the catalog, detecting new ids vs the previous snapshot.
    prev = load_ids(SNAP)
    rc = subprocess.call([PY, os.path.join(BUILD, "fetch_library.py"), "--speaker", str(args.speaker)])
    if rc != 0:
        log(f"ERROR: fetch_library.py exited {rc} — aborting"); return rc
    now = load_ids(SNAP)
    new_ids = sorted(now - prev)
    log(f"catalog: {len(now)} shiurim total, {len(new_ids)} new since last snapshot")

    if args.snapshot_only:
        log("snapshot-only: done"); return 0

    # figure out media availability + which ids still need hosting
    raw = {x["id"]: x for x in get(f"{API}/speakers/{args.speaker}/lectures?limit=5000&offset=0")["lecture"]}
    manifest = load_manifest()

    def has_video(lid):
        return bool((raw.get(lid) or {}).get("video_url"))

    # newly-posted ids that aren't fully hosted yet
    targets = [i for i in new_ids if not already_hosted(manifest, i, has_video(i) and not args.no_video)][: args.max]

    # optional backfill of the oldest not-yet-hosted shiurim (opt-in)
    if args.backfill > 0:
        # oldest first = ascending id is a decent proxy; use posted date when available
        order = sorted(raw.values(), key=lambda x: (x.get("date_to_show") or x.get("date_created") or "", x["id"]))
        missing = [x["id"] for x in order
                   if not already_hosted(manifest, x["id"], has_video(x["id"]) and not args.no_video)
                   and x["id"] not in targets]
        targets += missing[: args.backfill]

    if not targets:
        log("no shiurim need self-hosting this run — up to date"); return 0

    log(f"self-hosting {len(targets)} shiurim: {targets}")
    ids_csv = ",".join(str(i) for i in targets)

    # Prefer the cloud path when configured: trim + upload to the bucket/CDN and
    # point the manifest at CDN URLs. Falls back to LOCAL self-host otherwise.
    sys.path.insert(0, BUILD)
    try:
        import cloud
        use_cloud = cloud.configured()
    except Exception:
        use_cloud = False

    if use_cloud:
        # Process new shiurim exactly like the catalog: intro trimmed + (video)
        # the TA watermark removed, then uploaded to the bucket/CDN. Uses
        # stream_to_cloud.py (disk-light, resumable) — one pass per kind.
        log("cloud configured -> uploading new shiurim to bucket/CDN (intro-trim + de-watermark)")
        ST = os.path.join(BUILD, "stream_to_cloud.py")
        rc_a = subprocess.call([PY, ST, "--speaker", str(args.speaker), "--kind", "audio",
                                "--ids", ids_csv, "--trim", str(args.trim)])
        rc_v = 0
        if not args.no_video:
            vcmd = [PY, ST, "--speaker", str(args.speaker), "--kind", "video",
                    "--ids", ids_csv, "--trim", str(args.trim)]
            if args.delogo:
                vcmd += ["--delogo", args.delogo]
            rc_v = subprocess.call(vcmd)
        log(f"cloud pass exit (audio {rc_a}, video {rc_v})")
    else:
        # LOCAL store (default): idempotent, disk-guarded, relative-path manifest.
        cmd = [PY, os.path.join(BUILD, "backfill.py"), "--speaker", str(args.speaker),
               "--ids", ids_csv, "--trim", str(args.trim)]
        if args.no_video:
            cmd.append("--no-video")
        rc_a = subprocess.call(cmd)
        rc_v = 0
        log(f"local backfill pass exit {rc_a}")

    man = load_manifest()
    log(f"refresh done — manifest now holds {len(man)} self-hosted shiurim")
    return 0 if (rc_a == 0 and rc_v == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
