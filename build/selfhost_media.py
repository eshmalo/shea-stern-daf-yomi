#!/usr/bin/env python3
"""
selfhost_media.py — download shiur media from TorahAnytime, CUT THE INTRO,
and store it locally so the app can serve our OWN copy.

Why: TorahAnytime prepends a standard ~7.5s intro to every file. This script
downloads each shiur's audio (or video), trims the first N seconds with ffmpeg,
saves it under media/, and writes media/manifest.json mapping lecture id ->
local file. The app prefers the self-hosted (intro-free) copy when present.

Scale note: the full library is ~1388 shiurim (~60 GB of audio). This is meant
to run over a subset for a demo, or as the engine for a bulk job writing to real
storage (S3 / Backblaze B2) behind a CDN. Pass --limit to bound it.

Requires: ffmpeg on PATH. No Python deps beyond the stdlib.

Examples:
  python3 build/selfhost_media.py --limit 8                 # newest 8 daf shiurim, audio
  python3 build/selfhost_media.py --ids 457363,457360       # specific shiurim
  python3 build/selfhost_media.py --limit 4 --kind video    # video instead of audio
  python3 build/selfhost_media.py --limit 8 --trim 7.5      # intro length (seconds)
"""
import argparse, json, os, ssl, subprocess, sys, urllib.request

API = "https://api.torahanytime.com"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(HERE, "media")
# Some Python builds (python.org macOS) ship without a usable CA bundle. Use
# certifi's bundle if present; otherwise fall back to an unverified context
# (these are public, unauthenticated media URLs).
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()
    CTX.check_hostname = False
    CTX.verify_mode = ssl.CERT_NONE


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "selfhost/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "selfhost/1.0"})
    with urllib.request.urlopen(req, timeout=600, context=CTX) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speaker", type=int, default=587)
    ap.add_argument("--limit", type=int, default=8, help="newest N daf shiurim")
    ap.add_argument("--ids", default="", help="comma-separated lecture ids (overrides --limit)")
    ap.add_argument("--kind", choices=["audio", "video"], default="audio")
    ap.add_argument("--trim", type=float, default=7.5, help="seconds of TorahAnytime intro to cut")
    ap.add_argument("--out", default=MEDIA)
    ap.add_argument("--base-url", default="", help="URL prefix for manifest paths (e.g. an S3/CDN base); default is relative media/")
    args = ap.parse_args()
    prefix = (args.base_url.rstrip("/") + "/") if args.base_url else "media/"

    if subprocess.call(["bash", "-lc", "command -v ffmpeg >/dev/null"]) != 0:
        sys.exit("ffmpeg not found on PATH — install it (brew install ffmpeg).")

    raw = get(f"{API}/speakers/{args.speaker}/lectures?limit=2000&offset=0")["lecture"]
    byid = {x["id"]: x for x in raw}

    if args.ids.strip():
        ids = [int(x) for x in args.ids.split(",") if x.strip()]
    else:
        # newest shiurim that look like a daf (have a daf number in the title)
        dafish = [x for x in raw if "daf" in (x.get("title") or "").lower()]
        ids = [x["id"] for x in dafish[:args.limit]]

    os.makedirs(args.out, exist_ok=True)
    manifest_path = os.path.join(args.out, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        try:
            manifest = json.load(open(manifest_path))
        except Exception:
            manifest = {}

    ext = "mp3" if args.kind == "audio" else "mp4"
    for n, lid in enumerate(ids, 1):
        x = byid.get(lid)
        if not x:
            print(f"[{n}/{len(ids)}] {lid}: not found, skip"); continue
        src = (x.get("mp3_url") or x.get("audio_url")) if args.kind == "audio" else x.get("video_url")
        if not src:
            print(f"[{n}/{len(ids)}] {lid}: no {args.kind} url, skip"); continue
        tmp = os.path.join(args.out, f".{lid}.src.{ext}")
        out = os.path.join(args.out, f"{lid}.{ext}")
        print(f"[{n}/{len(ids)}] {lid}: {x.get('title','')[:40]} … downloading", flush=True)
        download(src, tmp)
        # cut the intro: fast seek before -i, stream-copy (no re-encode).
        # video also gets +faststart so the browser can stream/seek it.
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(args.trim), "-i", tmp, "-c", "copy"]
        if args.kind == "video":
            cmd += ["-movflags", "+faststart"]
        cmd += [out]
        if subprocess.call(cmd) != 0:
            # fallback: re-encode (some streams won't stream-copy cleanly)
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(args.trim), "-i", tmp,
                   "-c:a", "libmp3lame", "-q:a", "4", out] if args.kind == "audio" else \
                  ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(args.trim), "-i", tmp, out]
            subprocess.call(cmd)
        os.remove(tmp)
        size = os.path.getsize(out)
        entry = manifest.get(str(lid), {})          # merge (keep audio AND video)
        entry["audio" if args.kind == "audio" else "video"] = f"{prefix}{lid}.{ext}"
        entry["intro_trimmed"] = args.trim
        entry["title"] = x.get("title", "")
        manifest[str(lid)] = entry
        print(f"          -> media/{lid}.{ext} ({size//1024} KB, intro -{args.trim}s)")

    json.dump(manifest, open(manifest_path, "w"), indent=2)
    print(f"\nmanifest: {len(manifest)} shiurim -> {manifest_path}")


if __name__ == "__main__":
    main()
