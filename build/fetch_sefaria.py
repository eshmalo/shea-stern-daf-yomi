#!/usr/bin/env python3
"""
fetch_sefaria.py — mirror the public Sefaria text corpus to disk (no auth).

Sefaria publishes its whole corpus in a public GCS bucket (gs://sefaria-export).
This pulls the canonical TEXT formats — json/ (structured, richest) and txt/
(plain text) — plus schemas/ (the index metadata), so the library is fully local
and independent of any service. The bulky derivative trees (cltk-*, links, misc)
are skipped by default; pass --prefixes to include them.

Resumable & idempotent: skips any file already on disk with the right size.
Disk-guarded: stops cleanly if free space would drop below the floor.

  python3 build/fetch_sefaria.py                       # json/ + txt/ + schemas/
  python3 build/fetch_sefaria.py --prefixes json/      # just the structured JSON
  python3 build/fetch_sefaria.py --dest /path/to/store
"""
import argparse, json, os, ssl, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime, timezone

API = "https://storage.googleapis.com/storage/v1/b/sefaria-export/o"
OBJ = "https://storage.googleapis.com/sefaria-export/"
DEST_DEFAULT = "/Users/elazarshmalo/Desktop/AI Workspace/Sefaria-Export"
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch_sefaria.log")

try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE


def log(msg):
    line = f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    try: open(LOG, "a").write(line + "\n")
    except Exception: pass


def free_gb(path):
    st = os.statvfs(path); return st.f_bavail * st.f_frsize / 1e9


def list_prefix(prefix):
    """Return [(name, size), …] for every object under a prefix."""
    out, tok = [], None
    while True:
        url = f"{API}?prefix={urllib.parse.quote(prefix)}&maxResults=1000" + (f"&pageToken={tok}" if tok else "")
        with urllib.request.urlopen(url, timeout=120, context=CTX) as r:
            d = json.load(r)
        for it in d.get("items", []):
            out.append((it["name"], int(it.get("size", 0))))
        tok = d.get("nextPageToken")
        if not tok:
            return out


def fetch_one(name, size, dest):
    out = os.path.join(dest, name)
    if os.path.exists(out) and os.path.getsize(out) == size:
        return ("skip", size)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".part"
    req = urllib.request.Request(OBJ + urllib.parse.quote(name), headers={"User-Agent": "sefaria-mirror/1.0"})
    with urllib.request.urlopen(req, timeout=300, context=CTX) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk: break
            f.write(chunk)
    os.replace(tmp, out)
    return ("get", size)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default=DEST_DEFAULT)
    ap.add_argument("--prefixes", default="json/,txt/,schemas/")
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--min-free-gb", type=float, default=6.0)
    args = ap.parse_args()
    os.makedirs(args.dest, exist_ok=True)
    prefixes = [p for p in args.prefixes.split(",") if p]

    log(f"mirror -> {args.dest}  prefixes={prefixes}  free={free_gb(args.dest):.1f} GB")
    got = skipped = failed = 0; bytes_got = 0; stopped = False
    cap = args.workers * 2

    for prefix in prefixes:
        if stopped: break
        log(f"listing {prefix} …")
        objs = list_prefix(prefix)
        log(f"{prefix}: {len(objs)} objects ({sum(s for _, s in objs)/1e9:.2f} GB)")
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            inflight, i = set(), 0
            while (i < len(objs) and not stopped) or inflight:
                while i < len(objs) and len(inflight) < cap and not stopped:
                    name, size = objs[i]; i += 1
                    inflight.add(ex.submit(fetch_one, name, size, args.dest))
                if not inflight:
                    break
                done, inflight = wait(inflight, return_when=FIRST_COMPLETED)
                for fut in done:
                    try:
                        kind, size = fut.result()
                        if kind == "get": got += 1; bytes_got += size
                        else: skipped += 1
                    except Exception as e:
                        failed += 1
                        if failed <= 30: log(f"  FAIL: {str(e)[:120]}")
                n = got + skipped + failed
                if n % 500 == 0:
                    log(f"  {n} done ({got} new, {skipped} skip, {failed} fail) · {bytes_got/1e9:.2f} GB · free {free_gb(args.dest):.1f} GB")
                if free_gb(args.dest) < args.min_free_gb:
                    log(f"free disk below floor ({args.min_free_gb} GB) — stopping"); stopped = True

    log(f"DONE. {got} new, {skipped} already present, {failed} failed · {bytes_got/1e9:.2f} GB fetched · free {free_gb(args.dest):.1f} GB")


if __name__ == "__main__":
    main()
