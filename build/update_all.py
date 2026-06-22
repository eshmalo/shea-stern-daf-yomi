#!/usr/bin/env python3
"""
update_all.py — daily refresh of EVERY library the site depends on.

Runs once per day (launchd). Two steps, each resumable & idempotent:

  1. Lectures  (refresh.py)        — pull Rabbi Stern's TorahAnytime catalog,
     then for any NEW shiur: cut the intro, remove the TA watermark (video),
     and upload to the bucket/CDN. Updates media/manifest.json + the snapshot.
  2. Sefaria texts (fetch_sefaria) — keep the local corpus current: re-mirror
     new/changed objects from the public Sefaria bucket (skips files already on
     disk with the same size). Defaults to the prefixes already stored locally
     so it never kicks off a surprise multi-GB download.

Logs one block per run to build/update_all.log. Safe to run while the bulk
de-watermark pass is still going — both mark progress in the manifest / on disk
and skip finished work.

  python3 build/update_all.py                 # the daily job
  python3 build/update_all.py --no-media       # catalog + texts only, no media
  python3 build/update_all.py --sefaria-prefixes json/,txt/,schemas/   # also pull txt
"""
import argparse, os, subprocess, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(HERE, "build")
LOG = os.path.join(BUILD, "update_all.log")
PY = sys.executable or "python3"


def log(msg):
    line = f"[{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}] {msg}"
    print(line, flush=True)
    try:
        open(LOG, "a").write(line + "\n")
    except Exception:
        pass


def run(label, cmd):
    log(f"{label} → {' '.join(cmd[1:])}")
    try:
        rc = subprocess.call(cmd)
    except Exception as e:
        log(f"{label}: FAILED {str(e)[:180]}")
        return 1
    log(f"{label}: exit {rc}")
    return rc


SEF_MARKER = os.path.join(BUILD, ".sefaria_last_run")


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def sefaria_due():
    # The Sefaria corpus changes slowly; mirror it at most once per (UTC) day so the
    # frequent lecture polls stay light. Returns True if it hasn't run yet today.
    try:
        return open(SEF_MARKER).read().strip() != _today()
    except Exception:
        return True


def mark_sefaria():
    try:
        open(SEF_MARKER, "w").write(_today())
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-media", action="store_true", help="refresh catalog + texts only (skip media processing)")
    ap.add_argument("--sefaria-prefixes", default="json/,schemas/", help="which Sefaria bucket trees to keep current")
    ap.add_argument("--sefaria-min-free-gb", type=float, default=8.0)
    ap.add_argument("--force-sefaria", action="store_true", help="mirror Sefaria even if already done today")
    ap.add_argument("--no-sefaria", action="store_true", help="skip the Sefaria mirror entirely")
    args = ap.parse_args()

    log("================= update: start =================")
    # Lectures EVERY run: a newly-posted shiur is intro-trimmed, de-watermarked
    # (video), and uploaded to R2 promptly — not left showing the raw TA logo.
    lec = [PY, os.path.join(BUILD, "refresh.py")]
    if args.no_media:
        lec.append("--snapshot-only")
    rc_lec = run("lectures", lec)

    # Sefaria texts: heavy bucket scan, so cap at once per day.
    rc_sef = 0
    if args.no_sefaria:
        log("sefaria: skipped (--no-sefaria)")
    elif args.force_sefaria or sefaria_due():
        rc_sef = run("sefaria", [PY, os.path.join(BUILD, "fetch_sefaria.py"),
                                 "--prefixes", args.sefaria_prefixes,
                                 "--min-free-gb", str(args.sefaria_min_free_gb)])
        if rc_sef == 0:
            mark_sefaria()
    else:
        log("sefaria: already current today — skipped (runs once/day)")

    log(f"================= update: done (lectures {rc_lec}, sefaria {rc_sef}) =================")
    return 0 if rc_lec == 0 and rc_sef == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
