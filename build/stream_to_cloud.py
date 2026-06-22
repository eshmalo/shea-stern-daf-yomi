#!/usr/bin/env python3
"""
stream_to_cloud.py — DISK-LIGHT self-host-to-cloud for media that won't fit locally.

For each shiur it does: download from TorahAnytime -> cut the ~7.5s intro (ffmpeg)
-> upload the trimmed file straight to the configured S3/R2 bucket -> delete the
local temp. Never keeps more than ONE file on disk at a time, so the ~221 GB of
video can be hosted on a laptop with little free space. The manifest is updated
with RELATIVE paths (media/<id>.<ext>), so the site's one-line `mediaBaseUrl`
switch serves them from R2.

Resumable & idempotent: skips any object already in the bucket (HEAD) unless
--force. Writes the manifest atomically after each item. Logs to
build/stream_to_cloud.log.

  python3 build/stream_to_cloud.py --check                 # config + bucket reachability
  python3 build/stream_to_cloud.py --kind video --all      # stream every TA video -> R2
  python3 build/stream_to_cloud.py --kind audio --ids 457569
  python3 build/stream_to_cloud.py --kind video --all --trim 7.5 --min-free-gb 5

Requires build/cloud.config (or env) + ffmpeg + the `aws` CLI. INERT until configured.
"""
import argparse, json, os, shutil, ssl, subprocess, sys, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(HERE, "build")
sys.path.insert(0, BUILD)
import cloud  # noqa: E402

API = "https://api.torahanytime.com"
MEDIA = os.path.join(HERE, "media")
MANIFEST = os.path.join(MEDIA, "manifest.json")
LOG = os.path.join(BUILD, "stream_to_cloud.log")
TMP = os.path.join(MEDIA, ".stream_tmp")

try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()
    CTX.check_hostname = False
    CTX.verify_mode = ssl.CERT_NONE


def log(msg):
    line = f"[{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}] {msg}"
    print(line, flush=True)
    try:
        open(LOG, "a").write(line + "\n")
    except Exception:
        pass


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "stream/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "stream/1.0"})
    with urllib.request.urlopen(req, timeout=900, context=CTX) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)


def free_gb(path):
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize / 1e9


def load_manifest():
    if os.path.exists(MANIFEST):
        try:
            return json.load(open(MANIFEST))
        except Exception:
            pass
    return {}


def save_manifest(m):
    tmp = MANIFEST + ".tmp"
    json.dump(m, open(tmp, "w"), indent=2)
    os.replace(tmp, MANIFEST)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speaker", type=int, default=587)
    ap.add_argument("--kind", choices=["audio", "video"], default="video")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--ids", default="")
    ap.add_argument("--limit", type=int, default=0, help="cap the number processed this run")
    ap.add_argument("--trim", type=float, default=7.5)
    ap.add_argument("--min-free-gb", type=float, default=5.0, help="stop if free disk would drop below this")
    ap.add_argument("--force", action="store_true", help="re-upload even if already in the bucket")
    ap.add_argument("--delogo", default="", help="ffmpeg delogo box 'x=..:y=..:w=..:h=..' to erase the TA watermark (video only; forces a re-encode)")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if args.check:
        return cloud.check()
    if not cloud.configured():
        sys.exit("cloud not configured — fill build/cloud.config (see cloud.config.example). Missing: " + ", ".join(cloud.missing()))
    if subprocess.call(["bash", "-lc", "command -v ffmpeg >/dev/null"]) != 0:
        sys.exit("ffmpeg not found on PATH.")

    raw = get_json(f"{API}/speakers/{args.speaker}/lectures?limit=5000&offset=0")["lecture"]
    byid = {x["id"]: x for x in raw}
    ext = "mp3" if args.kind == "audio" else "mp4"
    srckey = (lambda x: x.get("mp3_url") or x.get("audio_url")) if args.kind == "audio" else (lambda x: x.get("video_url"))

    if args.ids.strip():
        ids = [int(x) for x in args.ids.split(",") if x.strip()]
    elif args.all:
        ids = [x["id"] for x in raw if srckey(x)]
    else:
        sys.exit("pass --all or --ids")

    os.makedirs(TMP, exist_ok=True)
    manifest = load_manifest()
    done = skipped = failed = 0
    log(f"stream {args.kind}: {len(ids)} candidates, free disk {free_gb(MEDIA):.1f} GB")

    for n, lid in enumerate(ids, 1):
        if args.limit and done >= args.limit:
            log(f"hit --limit {args.limit}; stopping"); break
        if free_gb(TMP) < args.min_free_gb + 1:
            log(f"free disk below floor ({args.min_free_gb} GB) — stopping gracefully"); break
        x = byid.get(lid)
        if not x:
            log(f"[{n}/{len(ids)}] {lid}: not found"); continue
        src = srckey(x)
        if not src:
            log(f"[{n}/{len(ids)}] {lid}: no {args.kind} url"); continue
        key = f"media/{lid}.{ext}"
        ent0 = manifest.get(str(lid), {})
        delogo_done = args.kind == "video" and args.delogo and ent0.get("delogo") == args.delogo and ent0.get("video") == key
        if not args.force and (delogo_done or (not (args.kind == "video" and args.delogo) and cloud.exists(key))):
            ent = ent0
            if ent.get(args.kind) != key:                 # ensure manifest records it
                ent[args.kind] = key; ent["intro_trimmed"] = args.trim; ent["title"] = x.get("title", "")
                manifest[str(lid)] = ent; save_manifest(manifest)
            skipped += 1
            if n % 25 == 0: log(f"[{n}/{len(ids)}] … {skipped} already done")
            continue

        raw_path = os.path.join(TMP, f"{lid}.src.{ext}")
        out_path = os.path.join(TMP, f"{lid}.{ext}")
        try:
            log(f"[{n}/{len(ids)}] {lid}: {x.get('title','')[:42]} … download")
            download(src, raw_path)
            head = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(args.trim), "-i", raw_path]
            if args.kind == "video" and args.delogo:
                # burn out the bottom-left TorahAnytime watermark — re-encode video (delogo
                # can't stream-copy), audio copied untouched. Hardware encoder for speed,
                # libx264 as a portable fallback.
                vf = ["-vf", f"delogo={args.delogo}"]
                cmd = head + vf + ["-c:v", "h264_videotoolbox", "-b:v", "900k", "-c:a", "copy", "-movflags", "+faststart", out_path]
                if subprocess.call(cmd) != 0:
                    cmd = head + vf + ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "copy", "-movflags", "+faststart", out_path]
                    subprocess.check_call(cmd)
            else:
                cmd = head + ["-c", "copy"] + (["-movflags", "+faststart"] if args.kind == "video" else []) + [out_path]
                if subprocess.call(cmd) != 0:             # fallback: re-encode if stream-copy fails
                    cmd = head + (["-c:a", "libmp3lame", "-q:a", "4"] if args.kind == "audio" else ["-movflags", "+faststart"]) + [out_path]
                    subprocess.check_call(cmd)
            os.remove(raw_path)
            mb = os.path.getsize(out_path) // (1 << 20)
            log(f"          upload {mb} MB -> s3://…/{key}")
            cloud.upload(out_path, key)
            ent = manifest.get(str(lid), {})
            ent[args.kind] = key                          # RELATIVE path (mediaBaseUrl resolves it)
            ent["intro_trimmed"] = args.trim
            ent["title"] = x.get("title", "")
            if args.kind == "video" and args.delogo:
                ent["delogo"] = args.delogo               # mark watermark-removed (makes the pass resumable)
            manifest[str(lid)] = ent
            save_manifest(manifest)
            done += 1
        except Exception as e:
            failed += 1
            log(f"          FAILED {lid}: {str(e)[:160]}")
        finally:
            for p in (raw_path, out_path):
                try:
                    if os.path.exists(p): os.remove(p)
                except Exception:
                    pass

    log(f"done. uploaded {done}, already-present {skipped}, failed {failed}. free disk {free_gb(MEDIA):.1f} GB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
