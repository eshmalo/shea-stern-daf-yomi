#!/usr/bin/env python3
"""
logo_audit.py — locate the TorahAnytime watermark per video format and find every
video whose watermark falls OUTSIDE the current delogo box, so we know which ones
to re-process (and with what box).

Why this exists: the pipeline burns ONE hardcoded delogo box (refresh.py default
x=1:y=288:w=96:h=71) into all ~1131 videos. That box fits the RECENT format
(608-wide, small corner watermark) but the older catalog (640-wide) carries a much
larger "Torah Anytime" overlay that the box only half-covers — so the logo is still
visible on those. This tool measures the real watermark box per format and lists the
affected videos.

Method — CROSS-VIDEO AVERAGING (robust, needs no reference image):
  the watermark is the ONE thing identical across every lecture. Average the
  bottom-left corner across many DIFFERENT videos of the same resolution: the varied
  backgrounds wash out, the watermark survives. Edges of that average = the watermark;
  its bounding box (+pad) is the delogo box that format needs.

Usage:
  python3 build/logo_audit.py calibrate [--per-res 60]   # measure the box per resolution + save viz to build/logo_audit/
  python3 build/logo_audit.py scan [--limit N]           # probe resolution for the whole catalog, classify, write affected list
  python3 build/logo_audit.py verify --ids a,b,c          # spot-check specific R2 outputs (raw-vs-delogo'd corner crops)
"""
import argparse, json, os, ssl, subprocess, sys, urllib.request
import concurrent.futures as cf
from collections import Counter, defaultdict

import numpy as np
import cv2

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(HERE, "build")
OUTDIR = os.path.join(BUILD, "logo_audit")
RES_CACHE = os.path.join(BUILD, ".logo_res_cache.json")
SCORE_CACHE = os.path.join(BUILD, ".logo_score_cache.json")
TEMPLATE_NPY = os.path.join(OUTDIR, "template.npy")
MANIFEST = os.path.join(HERE, "media", "manifest.json")
# template-match threshold separating large-watermark (affected) from small/none (covered).
# validated on known cases: small videos score 0.04-0.26, large score 0.67-0.96 -> 0.40 sits in the gap.
WM_THRESHOLD = 0.40
API = "https://api.torahanytime.com"
SPEAKER = 587
R2 = "https://pub-b220b8133d864a38af9b5ab5144ff375.r2.dev"
CURRENT_BOX = (1, 288, 96, 71)   # x,y,w,h baked in by refresh.py today
# Validated by calibrate (172-video cross-video mean) + direct R2 spot-checks:
NEW_BOX_LARGE = (1, 287, 181, 71)   # covers the older "Torah Anytime" overlay; x>=1 (delogo needs a border), y+h<=height-1

# crop region we sample (frame-relative): the whole bottom-left where the watermark lives
CROP_W, CROP_H, CROP_X, CROP_Y = 240, 100, 0, 260

try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()


def get_catalog():
    url = f"{API}/speakers/{SPEAKER}/lectures?limit=5000&offset=0"
    req = urllib.request.Request(url, headers={"User-Agent": "logo-audit/1.0"})
    raw = json.loads(urllib.request.urlopen(req, timeout=90, context=CTX).read().decode("utf-8", "replace"))["lecture"]
    return [x for x in raw if x.get("video_url")]


def probe_width(url):
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                            "-show_entries", "stream=width,height", "-of", "csv=p=0", url],
                           capture_output=True, text=True, timeout=45)
        w, h = r.stdout.strip().split(",")
        return f"{int(w)}x{int(h)}"
    except Exception:
        return None


def grab_crop(url, ts, dest):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(ts), "-i", url,
                    "-vf", f"crop={CROP_W}:{CROP_H}:{CROP_X}:{CROP_Y}", "-vframes", "1", dest],
                   capture_output=True, timeout=75)
    return os.path.exists(dest)


def measure_box(mean_gray):
    """Given the cross-video MEAN crop (grayscale float32), return the watermark bbox
    in FRAME coordinates (x,y,w,h). Edges of the mean isolate the persistent watermark;
    the moving content / varied backgrounds contribute little. We keep strong-edge
    components in the left ~90% of the crop (the wood-grain texture sits far right)."""
    gx = cv2.Sobel(mean_gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(mean_gray, cv2.CV_32F, 0, 1, ksize=3)
    edge = np.sqrt(gx * gx + gy * gy)
    edge = edge / (edge.max() + 1e-6)
    b = (edge > 0.22).astype(np.uint8) * 255
    b = cv2.morphologyEx(b, cv2.MORPH_CLOSE, np.ones((5, 17), np.uint8))   # weld glyphs/words
    b = cv2.morphologyEx(b, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))     # drop wood-grain specks
    cnts, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = [cv2.boundingRect(c) for c in cnts if cv2.contourArea(c) > 80]
    # watermark sits in the left part of the crop; ignore components starting far right (texture)
    boxes = [bx for bx in boxes if bx[0] < int(CROP_W * 0.92)]
    if not boxes:
        return None, b
    x = min(bx[0] for bx in boxes); y = min(bx[1] for bx in boxes)
    X = max(bx[0] + bx[2] for bx in boxes); Y = max(bx[1] + bx[3] for bx in boxes)
    pad = 4
    x = max(0, x - pad); y = max(0, y - pad)
    X = min(CROP_W, X + pad); Y = min(CROP_H, Y + pad)
    # to frame coords
    return (x + CROP_X, y + CROP_Y, X - x, Y - y), b


def calibrate(args):
    os.makedirs(OUTDIR, exist_ok=True)
    cat = get_catalog()
    step = max(1, len(cat) // (args.per_res * 3))
    sample = cat[::step][: args.per_res * 4]
    tmp = os.path.join(OUTDIR, "_frames"); os.makedirs(tmp, exist_ok=True)

    def work(item):
        i, x = item
        vid, url = x["id"], x["video_url"]
        ts = 90 + (i * 53) % 1100
        dest = os.path.join(tmp, f"{vid}.png")
        if not grab_crop(url, ts, dest):
            return None
        res = probe_width(url)
        return (vid, res, dest)

    got = []
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for r in ex.map(work, list(enumerate(sample))):
            if r and r[1]:
                got.append(r)
    bywidth = defaultdict(list)
    for vid, res, p in got:
        bywidth[res].append(p)
    print(f"sampled {len(got)} videos; resolutions: {dict(Counter(r for _, r, _ in got))}\n")
    cx, cy, cw, ch = CURRENT_BOX
    print(f"CURRENT box (all videos): x={cx}:y={cy}:w={cw}:h={ch}  -> covers x {cx}..{cx+cw}, y {cy}..{cy+ch}\n")
    recommended = {}
    for res, paths in sorted(bywidth.items(), key=lambda kv: -len(kv[1])):
        if len(paths) < 4:
            print(f"{res}: only {len(paths)} samples — skipping"); continue
        stack = np.stack([cv2.imread(p, cv2.IMREAD_GRAYSCALE).astype(np.float32) for p in paths], 0)
        mean = stack.mean(0)
        box, binimg = measure_box(mean)
        cv2.imwrite(os.path.join(OUTDIR, f"mean_{res}.png"),
                    cv2.resize(mean.astype(np.uint8), (CROP_W * 3, CROP_H * 3), interpolation=cv2.INTER_NEAREST))
        vis = cv2.cvtColor(mean.astype(np.uint8), cv2.COLOR_GRAY2BGR)
        cv2.rectangle(vis, (cx, cy - CROP_Y), (cx + cw, cy + ch - CROP_Y), (0, 255, 0), 1)   # current=green
        if box:
            bx, by, bw, bh = box
            cv2.rectangle(vis, (bx, by - CROP_Y), (bx + bw, by + bh - CROP_Y), (0, 0, 255), 1)  # detected=red
        cv2.imwrite(os.path.join(OUTDIR, f"box_{res}.png"),
                    cv2.resize(vis, (CROP_W * 3, CROP_H * 3), interpolation=cv2.INTER_NEAREST))
        if box:
            bx, by, bw, bh = box
            fits = bx >= cx - 2 and by >= cy - 2 and bx + bw <= cx + cw + 2 and by + bh <= cy + ch + 2
            recommended[res] = box
            print(f"{res}: {len(paths):3} videos | DETECTED watermark box  x={bx}:y={by}:w={bw}:h={bh}  "
                  f"-> current box {'COVERS it ✓' if fits else 'MISSES it ✗ (logo leaks)'}")
        else:
            print(f"{res}: {len(paths):3} videos | no watermark detected")
    print(f"\nviz saved to {OUTDIR}/  (mean_<res>.png, box_<res>.png : green=current, red=detected)")
    json.dump({r: list(b) for r, b in recommended.items()},
              open(os.path.join(OUTDIR, "recommended_boxes.json"), "w"), indent=2)
    return recommended


def edge_of_mean(vid, url, dur=0, nf=4, tag="s"):
    """Per-video temporal mean of nf frames -> Sobel edge map. Frames are sampled at FRACTIONS
    of the video's duration so short talks (the catalog has 1-9 min ones) still yield enough
    frames — fixed timestamps fell past the end and produced too few frames. The watermark is
    constant so it survives the mean; the moving content blurs to mid-gray."""
    tmp = os.path.join(OUTDIR, "_frames"); os.makedirs(tmp, exist_ok=True)
    try:
        dur = float(dur)
    except Exception:
        dur = 0
    if dur and dur > 8:
        fracs = [0.18, 0.38, 0.58, 0.78][:nf]
        times = [max(2, dur * f) for f in fracs]
    else:
        times = [5 + k * 8 for k in range(nf)]   # unknown/very short: cluster early
    frames = []

    def pull(kt):
        k, t = kt
        out = os.path.join(tmp, f"{tag}{vid}_{k}.png")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.1f}", "-i", url,
                        "-vf", f"crop={CROP_W}:90:0:270", "-vframes", "1", out],
                       capture_output=True, timeout=60)
        return out if os.path.exists(out) else None

    with cf.ThreadPoolExecutor(max_workers=nf) as ex:
        for p in ex.map(pull, list(enumerate(times))):
            if p:
                im = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
                if im is not None:
                    frames.append(im.astype(np.float32))
                os.remove(p)
    if len(frames) < 3:
        return None
    M = np.stack(frames, 0).mean(0)
    return np.sqrt(cv2.Sobel(M, cv2.CV_32F, 1, 0, 3) ** 2 + cv2.Sobel(M, cv2.CV_32F, 0, 1, 3) ** 2)


def build_template():
    """Cross-video mean-edge of known-large videos (recorded before the watermark redesign),
    cropped to the 'Torah Anytime' big-text patch that sits RIGHT of the current box."""
    if os.path.exists(TEMPLATE_NPY):
        return np.load(TEMPLATE_NPY)
    cat = [x for x in get_catalog() if x.get("date_recorded") and x["date_recorded"] < "2024-03-01"]
    step = max(1, len(cat) // 36); pool = cat[::step][:36]
    Es = []
    for x in pool:
        E = edge_of_mean(x["id"], x["video_url"], dur=x.get("duration", 0), nf=3, tag="t")
        if E is not None:
            Es.append(E)
    full = np.stack(Es, 0).mean(0)
    tpl = full[28:82, 110:205].astype(np.float32)   # the distinctive "orah / nytime" patch
    os.makedirs(OUTDIR, exist_ok=True)
    np.save(TEMPLATE_NPY, tpl)
    print(f"built watermark template from {len(Es)} known-large videos -> {TEMPLATE_NPY}")
    return tpl


def wm_score(vid, url, tpl, dur=0):
    """Normalized-cross-correlation of the per-video mean-edge against the watermark template,
    over the watermark neighborhood (allows a few px of drift). High = large watermark present."""
    E = edge_of_mean(vid, url, dur=dur)
    if E is None:
        return None
    search = E[22:90, 100:215].astype(np.float32)
    if search.shape[0] < tpl.shape[0] or search.shape[1] < tpl.shape[1]:
        return None
    return float(cv2.matchTemplate(search, tpl, cv2.TM_CCOEFF_NORMED).max())


def scan(args):
    os.makedirs(OUTDIR, exist_ok=True)
    cat = get_catalog()
    if args.limit:
        cat = cat[: args.limit]
    rescache = json.load(open(RES_CACHE)) if os.path.exists(RES_CACHE) else {}
    scores = json.load(open(SCORE_CACHE)) if os.path.exists(SCORE_CACHE) else {}
    tpl = build_template()
    # retry videos that failed last time (cached as None) as well as the never-scored ones
    todo = [x for x in cat if scores.get(str(x["id"])) is None]
    print(f"catalog video lectures: {len(cat)} | scored (cached): {len(cat)-len(todo)} | to score/retry: {len(todo)}")

    def work(x):
        vid = str(x["id"])
        res = rescache.get(vid) or probe_width(x["video_url"])
        s = wm_score(vid, x["video_url"], tpl, dur=x.get("duration", 0))
        return vid, res, s

    done = 0
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for vid, res, s in ex.map(work, todo):
            if res:
                rescache[vid] = res
            scores[vid] = s
            done += 1
            if done % 40 == 0:
                json.dump(scores, open(SCORE_CACHE, "w")); json.dump(rescache, open(RES_CACHE, "w"))
                print(f"  scored {done}/{len(todo)} …")
    json.dump(scores, open(SCORE_CACHE, "w")); json.dump(rescache, open(RES_CACHE, "w"))

    man = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}
    # Per-video classification by template-match score (NOT resolution/date — the watermark toggles
    # across periods). score >= WM_THRESHOLD => the large "Torah Anytime" overlay is present and the
    # current box leaves it exposed -> AFFECTED, needs re-processing with the larger box.
    def sc(x):
        return scores.get(str(x["id"]))
    affected = [x for x in cat if sc(x) is not None and sc(x) >= WM_THRESHOLD]
    covered = [x for x in cat if sc(x) is not None and sc(x) < WM_THRESHOLD]
    failed = [x for x in cat if sc(x) is None]
    border = [x for x in cat if sc(x) is not None and 0.30 <= sc(x) < 0.50]
    out = [{"id": x["id"], "res": rescache.get(str(x["id"])), "score": round(sc(x), 3),
            "date": x.get("date_recorded"), "title": x.get("title", ""),
            "delogo": man.get(str(x["id"]), {}).get("delogo")}
           for x in sorted(affected, key=lambda y: -sc(y))]
    json.dump(out, open(os.path.join(OUTDIR, "affected_videos.json"), "w"), indent=2)
    print(f"\nAFFECTED  (large watermark, score>={WM_THRESHOLD}): {len(affected)} of {len(cat)}")
    print(f"COVERED   (small/none, box OK):                {len(covered)}")
    if failed:
        print(f"UNSCORED  (frame pull failed):                 {len(failed)} — re-run scan to retry")
    if border:
        print(f"BORDERLINE (0.30-0.50, eyeball these):         {len(border)} -> {[x['id'] for x in border][:15]}")
    print(f"  -> affected list written to {OUTDIR}/affected_videos.json")
    print(f"\nRECOMMENDED delogo box for affected videos: "
          f"x={NEW_BOX_LARGE[0]}:y={NEW_BOX_LARGE[1]}:w={NEW_BOX_LARGE[2]}:h={NEW_BOX_LARGE[3]}")
    print("highest-scoring affected (most obvious logo):")
    for x in out[:10]:
        print(f"  {x['id']}  score={x['score']}  {x['res']}  {x['date']}  {x['title'][:40]}")


def verify(args):
    os.makedirs(OUTDIR, exist_ok=True)
    cat = {str(x["id"]): x for x in get_catalog()}
    for vid in args.ids.split(","):
        vid = vid.strip()
        x = cat.get(vid)
        if not x:
            print(f"{vid}: not in catalog"); continue
        for label, url in (("raw", x["video_url"]), ("r2", f"{R2}/media/{vid}.mp4")):
            dest = os.path.join(OUTDIR, f"verify_{vid}_{label}.png")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "250", "-i", url,
                            "-vf", f"drawbox=x={CURRENT_BOX[0]}:y={CURRENT_BOX[1]}:w={CURRENT_BOX[2]}:h={CURRENT_BOX[3]}:color=red:t=1,"
                            f"crop=260:110:0:250,scale=780:330:flags=neighbor", "-vframes", "1", dest],
                           capture_output=True, timeout=75)
            print(f"  saved {dest}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("calibrate"); c.add_argument("--per-res", type=int, default=60); c.add_argument("--workers", type=int, default=10)
    s = sub.add_parser("scan"); s.add_argument("--limit", type=int, default=0); s.add_argument("--workers", type=int, default=12)
    v = sub.add_parser("verify"); v.add_argument("--ids", required=True)
    args = ap.parse_args()
    {"calibrate": calibrate, "scan": scan, "verify": verify}[args.cmd](args)


if __name__ == "__main__":
    main()
