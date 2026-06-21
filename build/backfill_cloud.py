#!/usr/bin/env python3
"""
backfill_cloud.py — push self-hosted, intro-trimmed media to S3-compatible cloud
storage + CDN, and point manifest.json at the CDN URLs.

For each shiur (and each kind audio/video):
  * if a trimmed local copy media/<id>.<ext> exists -> upload that (no re-download)
  * else download the TA source -> cut the ~7.5s intro with ffmpeg -> upload
  * record the CDN URL in media/manifest.json and write the manifest AFTER each
    item, so an interruption loses at most one in-flight file.

RESUMABLE & IDEMPOTENT: skips anything whose manifest entry is already a CDN URL
(use --verify to also HEAD-check the object exists; --force to redo everything).
Progress is logged to build/backfill.log.

  python3 build/backfill_cloud.py --check               # config + bucket sanity only
  python3 build/backfill_cloud.py --ids 457569,457353   # specific shiurim (the proof batch)
  python3 build/backfill_cloud.py --limit 5             # newest 5 not-yet-uploaded
  python3 build/backfill_cloud.py --all                 # entire back-catalog (~60GB)
  python3 build/backfill_cloud.py --all --no-video      # audio only
  python3 build/backfill_cloud.py --all --oldest-first  # process oldest dapim first

Requires: ffmpeg + the `aws` CLI on PATH, and a configured build/cloud.config
(or env vars) — see build/cloud.config.example.
"""
import argparse, json, os, subprocess, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(HERE, "build")
sys.path.insert(0, BUILD)
import cloud                                      # noqa: E402
from selfhost_media import get, download, API     # noqa: E402  (reuse tested networking)

MEDIA = os.path.join(HERE, "media")
TMP = os.path.join(MEDIA, ".tmp")
MANIFEST = os.path.join(MEDIA, "manifest.json")
LOG = os.path.join(BUILD, "backfill.log")


def log(msg):
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    try:
        open(LOG, "a").write(line + "\n")
    except Exception:
        pass


def load_manifest():
    try:
        return json.load(open(MANIFEST))
    except Exception:
        return {}


def save_manifest(m):
    tmp = MANIFEST + ".tmp"
    json.dump(m, open(tmp, "w"), indent=2, ensure_ascii=False)
    os.replace(tmp, MANIFEST)                      # atomic — never leaves a half-written manifest


def is_cdn(val):
    return isinstance(val, str) and val.startswith(("http://", "https://"))


def trim(src_tmp, out, kind, trim_s):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(trim_s), "-i", src_tmp, "-c", "copy"]
    if kind == "video":
        cmd += ["-movflags", "+faststart"]
    cmd += [out]
    if subprocess.call(cmd) != 0:                  # fallback: re-encode if stream-copy fails
        if kind == "audio":
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(trim_s), "-i", src_tmp,
                   "-c:a", "libmp3lame", "-q:a", "4", out]
        else:
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(trim_s), "-i", src_tmp, out]
        subprocess.call(cmd)


def process(lid, x, kind, trim_s, manifest, verify, force):
    """Ensure <id> <kind> is trimmed + uploaded + recorded. Returns one of:
    'skip-nourl' | 'skip-done' | 'uploaded' | 'uploaded-from-local' | 'error'."""
    ext = "mp3" if kind == "audio" else "mp4"
    key = f"{lid}.{ext}"
    entry = manifest.get(str(lid), {})

    src = (x.get("mp3_url") or x.get("audio_url")) if kind == "audio" else x.get("video_url")
    if not src:
        return "skip-nourl"

    if not force and is_cdn(entry.get(kind)):
        if not verify or cloud.exists(key):
            return "skip-done"

    local = os.path.join(MEDIA, f"{lid}.{ext}")
    from_local = os.path.isfile(local) and os.path.getsize(local) > 0
    try:
        if not from_local:                         # download + trim to a temp file
            os.makedirs(TMP, exist_ok=True)
            raw = os.path.join(TMP, f"{lid}.src.{ext}")
            download(src, raw)
            local = os.path.join(TMP, f"{lid}.{ext}")
            trim(raw, local, kind, trim_s)
            os.remove(raw)

        url = cloud.upload(local, key)
        entry[kind] = url
        entry["intro_trimmed"] = trim_s
        entry["title"] = x.get("title", "")
        manifest[str(lid)] = entry
        save_manifest(manifest)

        if not from_local and os.path.dirname(local) == TMP:
            os.remove(local)                       # clean temp; keep any pre-existing media/<id>
        return "uploaded-from-local" if from_local else "uploaded"
    except Exception as e:
        log(f"  ERROR {lid} {kind}: {e}")
        return "error"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speaker", type=int, default=587)
    ap.add_argument("--ids", default="")
    ap.add_argument("--limit", type=int, default=0, help="process newest N not-yet-uploaded (0 = no limit)")
    ap.add_argument("--all", action="store_true", help="process the whole catalog")
    ap.add_argument("--oldest-first", action="store_true")
    ap.add_argument("--no-video", action="store_true")
    ap.add_argument("--trim", type=float, default=7.5)
    ap.add_argument("--verify", action="store_true", help="HEAD-check the object even if manifest says done")
    ap.add_argument("--force", action="store_true", help="re-trim + re-upload everything")
    ap.add_argument("--check", action="store_true", help="just print config + bucket status and exit")
    args = ap.parse_args()

    if args.check:
        return cloud.check()
    if not cloud.configured():
        log("cloud NOT configured — set build/cloud.config (see cloud.config.example). missing: "
            + ", ".join(cloud.missing()))
        return 2
    if subprocess.call(["bash", "-lc", "command -v ffmpeg >/dev/null"]) != 0:
        log("ffmpeg not found on PATH"); return 3

    raw = get(f"{API}/speakers/{args.speaker}/lectures?limit=5000&offset=0")["lecture"]
    byid = {x["id"]: x for x in raw}
    manifest = load_manifest()

    if args.ids.strip():
        ids = [int(x) for x in args.ids.split(",") if x.strip()]
    else:
        order = sorted(raw, key=lambda x: (x.get("date_to_show") or x.get("date_created") or "", x["id"]),
                       reverse=not args.oldest_first)
        ids = [x["id"] for x in order]
        if not args.all:                           # default needs an explicit bound
            if args.limit <= 0:
                log("refusing to run unbounded: pass --all, --limit N, or --ids"); return 4
        # drop ids already fully done (audio + video-if-present) unless force
        def done(lid):
            e = manifest.get(str(lid), {})
            want_v = bool(byid[lid].get("video_url")) and not args.no_video
            return is_cdn(e.get("audio")) and (is_cdn(e.get("video")) if want_v else True)
        if not args.force:
            ids = [i for i in ids if not done(i)]
        if args.limit > 0:
            ids = ids[: args.limit]

    cfg = cloud.load_config()
    log(f"backfill start: {len(ids)} shiurim, endpoint {cfg['S3_ENDPOINT_URL']}, bucket {cfg['S3_BUCKET']}, "
        f"cdn {cfg['CDN_BASE_URL']}, video {not args.no_video}")

    tally = {}
    for n, lid in enumerate(ids, 1):
        x = byid.get(lid)
        if not x:
            log(f"[{n}/{len(ids)}] {lid}: not in catalog, skip"); tally["skip-missing"] = tally.get("skip-missing", 0) + 1
            continue
        kinds = ["audio"] + ([] if args.no_video else (["video"] if x.get("video_url") else []))
        results = []
        for kind in kinds:
            r = process(lid, x, kind, args.trim, manifest, args.verify, args.force)
            results.append(f"{kind}:{r}")
            tally[r] = tally.get(r, 0) + 1
        log(f"[{n}/{len(ids)}] {lid} {x.get('title','')[:42]} -> {', '.join(results)}")

    uploaded = sum(v for k, v in tally.items() if k.startswith("uploaded"))
    log(f"backfill done: {uploaded} uploads, manifest now {len(load_manifest())} shiurim. tally={tally}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
