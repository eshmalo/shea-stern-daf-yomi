#!/usr/bin/env python3
"""
backfill.py — LOCAL-FIRST bulk backfill: download every shiur, CUT the ~7.5s
TorahAnytime intro, and store our own copy under media/. Manifest paths are kept
RELATIVE (media/<id>.mp3) so the store is portable — going live later is a
one-line switch (content.json options.mediaBaseUrl), no reprocessing.

RESUMABLE & IDEMPOTENT: skips any id whose trimmed local file already exists and
is recorded in the manifest. Writes the manifest atomically after EACH item, so
an interruption loses at most one in-flight file — just re-run to continue.

DISK GUARD: stops gracefully before free space drops below --min-free-gb (default
15) so it can never fill the drive. Progress is logged to build/backfill.log.

  python3 build/backfill.py --all                 # everything, audio + video
  python3 build/backfill.py --all --no-video      # audio only (recommended when disk is tight)
  python3 build/backfill.py --all --kind video    # only the video copies
  python3 build/backfill.py --limit 20            # newest 20 not-yet-done
  python3 build/backfill.py --ids 457569,457353   # specific shiurim
  python3 build/backfill.py --all --min-free-gb 25

Requires ffmpeg on PATH. Reuses the tested networking in selfhost_media.py.
"""
import argparse, json, os, shutil, subprocess, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(HERE, "build")
sys.path.insert(0, BUILD)
from selfhost_media import get, download, API     # noqa: E402  (single source of truth for fetch)

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


def free_gb(path=MEDIA):
    try:
        return shutil.disk_usage(path).free / 1024**3
    except Exception:
        return shutil.disk_usage(HERE).free / 1024**3


def load_manifest():
    try:
        return json.load(open(MANIFEST))
    except Exception:
        return {}


def save_manifest(m):
    tmp = MANIFEST + ".tmp"
    json.dump(m, open(tmp, "w"), indent=2, ensure_ascii=False)
    os.replace(tmp, MANIFEST)                       # atomic


def trim(src_tmp, out, kind, trim_s):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(trim_s), "-i", src_tmp, "-c", "copy"]
    if kind == "video":
        cmd += ["-movflags", "+faststart"]
    cmd += [out]
    if subprocess.call(cmd) != 0:                   # fallback: re-encode if stream-copy fails
        if kind == "audio":
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(trim_s), "-i", src_tmp,
                   "-c:a", "libmp3lame", "-q:a", "4", out]
        else:
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(trim_s), "-i", src_tmp, out]
        if subprocess.call(cmd) != 0:
            raise RuntimeError("ffmpeg trim failed")


def done(manifest, lid, kind):
    """True if this id/kind is already trimmed locally AND recorded in manifest."""
    e = manifest.get(str(lid), {})
    rel = e.get(kind)
    if not rel:
        return False
    ext = "mp3" if kind == "audio" else "mp4"
    f = os.path.join(MEDIA, f"{lid}.{ext}")
    return os.path.isfile(f) and os.path.getsize(f) > 0


def process(lid, x, kind, trim_s, manifest):
    ext = "mp3" if kind == "audio" else "mp4"
    src = (x.get("mp3_url") or x.get("audio_url")) if kind == "audio" else x.get("video_url")
    if not src:
        return "skip-nourl"
    out = os.path.join(MEDIA, f"{lid}.{ext}")
    os.makedirs(TMP, exist_ok=True)
    raw = os.path.join(TMP, f"{lid}.src.{ext}")
    try:
        download(src, raw)
        trim(raw, out, kind, trim_s)
    finally:
        if os.path.exists(raw):
            os.remove(raw)
    entry = manifest.get(str(lid), {})
    entry[kind] = f"media/{lid}.{ext}"             # RELATIVE — portable
    entry["intro_trimmed"] = trim_s
    entry["title"] = x.get("title", "")
    manifest[str(lid)] = entry
    save_manifest(manifest)                          # atomic, after each item
    return "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speaker", type=int, default=587)
    ap.add_argument("--ids", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--oldest-first", action="store_true")
    ap.add_argument("--kind", choices=["audio", "video", "both"], default="both")
    ap.add_argument("--no-video", action="store_true", help="audio only (alias for --kind audio)")
    ap.add_argument("--trim", type=float, default=7.5)
    ap.add_argument("--min-free-gb", type=float, default=15.0, help="stop before free disk drops below this")
    args = ap.parse_args()
    kinds = ["audio"] if (args.no_video or args.kind == "audio") else (["video"] if args.kind == "video" else ["audio", "video"])

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
        if not args.all and args.limit <= 0:
            log("refusing unbounded run: pass --all, --limit N, or --ids"); return 4
        # keep only ids that still need at least one kind
        ids = [i for i in ids if any(not done(manifest, i, k) and
                                     ((byid[i].get("mp3_url") or byid[i].get("audio_url")) if k == "audio" else byid[i].get("video_url"))
                                     for k in kinds)]
        if args.limit > 0:
            ids = ids[: args.limit]

    log(f"backfill start: {len(ids)} shiurim, kinds={kinds}, trim={args.trim}s, "
        f"free={free_gb():.1f}GB, floor={args.min_free_gb}GB")

    tally = {"ok": 0, "skip-done": 0, "skip-nourl": 0, "error": 0}
    stopped = False
    for n, lid in enumerate(ids, 1):
        x = byid.get(lid)
        if not x:
            continue
        for kind in kinds:
            if kind == "video" and not x.get("video_url"):
                continue
            if done(manifest, lid, kind):
                tally["skip-done"] += 1
                continue
            fg = free_gb()
            if fg < args.min_free_gb:
                log(f"DISK FLOOR reached: {fg:.1f}GB free < {args.min_free_gb}GB — stopping (resumable). "
                    f"Processed so far: {tally}")
                stopped = True
                break
            try:
                r = process(lid, x, kind, args.trim, manifest)
                tally[r if r in tally else "ok"] += 1
                if r == "ok":
                    log(f"[{n}/{len(ids)}] {lid} {kind} {x.get('title','')[:40]} ✓  (free {free_gb():.1f}GB)")
            except Exception as e:
                tally["error"] += 1
                log(f"[{n}/{len(ids)}] {lid} {kind} ERROR: {e}")
        if stopped:
            break

    man = load_manifest()
    hosted = sum(1 for v in man.values() if v.get("audio"))
    log(f"backfill {'STOPPED (disk floor)' if stopped else 'done'}: tally={tally}, "
        f"manifest now {len(man)} shiurim ({hosted} with audio), free={free_gb():.1f}GB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
