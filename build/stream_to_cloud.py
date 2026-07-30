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
RES_CACHE = os.path.join(BUILD, ".logo_res_cache.json")       # {id: "WxH"} — shared with logo_audit.py
SCORE_CACHE = os.path.join(BUILD, ".logo_score_cache.json")   # {id: template score} — from logo_audit.py scan

# Delogo boxes (measured by logo_audit.py calibrate, validated on R2 spot-checks).
# Most videos carry the small corner watermark; some of the 640-wide era carry a
# much larger "Torah Anytime" overlay — logo_audit's per-video template score
# (>= 0.40) is what identifies those, NOT the resolution alone (851 of 1094
# 640x360 videos have the small mark). delogo needs x>=1 and a border all around.
DELOGO_BY_RES = {
    "608x360": "x=1:y=288:w=96:h=71",
}
DELOGO_DEFAULT = "x=1:y=288:w=96:h=71"
DELOGO_LARGE = "x=1:y=287:w=181:h=71"
WM_THRESHOLD = 0.40


def delogo_for_res(res):
    """The right watermark box for a video's WxH. Known formats use their measured
    box; anything else scales the standard corner box by frame height (the TA
    watermark is anchored bottom-left and scales with the frame), clamped inside
    the frame with the 1px border delogo requires."""
    box = DELOGO_BY_RES.get(res)
    if box:
        return box
    try:
        w, h = (int(v) for v in res.split("x"))
    except Exception:
        return DELOGO_DEFAULT
    s = h / 360.0
    bw = max(8, min(int(96 * s), w - 2))
    bh = max(8, min(int(71 * s), h - 2))
    y = max(1, min(int(288 * s), h - bh - 1))
    return f"x=1:y={y}:w={bw}:h={bh}"


def probe_res(url_or_path):
    """WxH of the first video stream — ffprobe reads just the header, works on URLs."""
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", url_or_path],
            timeout=120)
        return out.decode().strip().splitlines()[0]
    except Exception:
        return ""

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
    ap.add_argument("--delogo", default="", help="ffmpeg delogo box 'x=..:y=..:w=..:h=..' to erase the TA watermark (video only; forces a re-encode), or 'auto' to pick the right box per video format")
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
    res_cache, score_cache = {}, {}
    if args.delogo == "auto":
        try:
            res_cache = json.load(open(RES_CACHE))
        except Exception:
            res_cache = {}
        try:
            score_cache = json.load(open(SCORE_CACHE))
        except Exception:
            score_cache = {}
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
        # 'auto' resolves the right watermark box for THIS video: the logo_audit
        # template score decides small-vs-large overlay; the frame size (header
        # probe over http; cached) sizes/positions the small box.
        delogo = args.delogo
        if args.kind == "video" and args.delogo == "auto":
            score = score_cache.get(str(lid))
            if score is not None and score >= WM_THRESHOLD:
                delogo = DELOGO_LARGE
            else:
                res = res_cache.get(str(lid)) or probe_res(src)
                if res and res_cache.get(str(lid)) != res:
                    res_cache[str(lid)] = res
                    try:
                        json.dump(res_cache, open(RES_CACHE, "w"))
                    except Exception:
                        pass
                delogo = delogo_for_res(res) if res else DELOGO_DEFAULT
        ent0 = manifest.get(str(lid), {})
        delogo_done = args.kind == "video" and delogo and ent0.get("delogo") == delogo and ent0.get("video") == key
        if not args.force and (delogo_done or (not (args.kind == "video" and delogo) and cloud.exists(key))):
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
            if args.kind == "video" and delogo:
                # burn out the bottom-left TorahAnytime watermark — re-encode video (delogo
                # can't stream-copy), audio copied untouched. Hardware encoder for speed,
                # libx264 as a portable fallback.
                vf = ["-vf", f"delogo={delogo}"]
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
            if args.kind == "video" and delogo:
                ent["delogo"] = delogo                    # mark watermark-removed (makes the pass resumable)
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
