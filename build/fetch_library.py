#!/usr/bin/env python3
"""
Refresh data/library.json from TorahAnytime's public API.

The website already auto-updates in the browser (it calls the same API live),
so this script is OPTIONAL. Its jobs:
  * keep a committed snapshot fresh -> instant first paint + offline fallback
  * detect newly-posted shiurim and print/report them (great for a cron job
    that opens an issue, sends an email, posts to a channel, etc.)

Usage:
    python3 build/fetch_library.py                 # refresh snapshot
    python3 build/fetch_library.py --speaker 587   # any speaker id
No dependencies beyond the standard library.
"""
import argparse, json, os, ssl, sys, urllib.request
from datetime import date

API = "https://api.torahanytime.com"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(HERE, "data", "library.json")
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()
    CTX.check_hostname = False
    CTX.verify_mode = ssl.CERT_NONE


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ta-library/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def lean(x):
    cat = (x.get("categories") or [{}])[0]
    sub = (x.get("subcategories") or [{}])[0]
    return {
        "id": x["id"],
        "title": (x.get("title") or "").strip(),
        "slug": x.get("slug") or "",
        "recorded": x.get("date_recorded"),
        "posted": (x.get("date_to_show") or x.get("date_created") or "")[:10],
        "duration": x.get("duration") or 0,
        "category": cat.get("name") or "Uncategorized",
        "category_en": cat.get("english_name"),
        "series": sub.get("name") or "",
        "lang": x.get("language_name") or "",
        "thumb": x.get("thumbnail_url") or "",
        "audio": x.get("mp3_url") or x.get("audio_url") or "",
        "video": x.get("video_url") or "",
        "is_short": bool(x.get("is_short")),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speaker", type=int, default=587)
    ap.add_argument("--out", default=SNAP)
    args = ap.parse_args()

    prev_ids = set()
    if os.path.exists(args.out):
        try:
            prev_ids = {l["id"] for l in json.load(open(args.out))["lectures"]}
        except Exception:
            pass

    spk = get(f"{API}/speakers/{args.speaker}")
    raw = get(f"{API}/speakers/{args.speaker}/lectures?limit=5000&offset=0")
    lecs = [lean(x) for x in raw.get("lecture", [])]
    lecs.sort(key=lambda r: (r["posted"] or "", r["id"]), reverse=True)

    added = [l for l in lecs if l["id"] not in prev_ids]

    snap = {
        "speaker": {
            "id": args.speaker,
            "name": f"{spk.get('title') or ''} {spk.get('name_first') or ''} {spk.get('name_last') or ''}".strip(),
            "title": spk.get("title"),
            "first": spk.get("name_first"),
            "last": spk.get("name_last"),
            "desc": spk.get("desc") or "",
            "source": f"https://www.torahanytime.com/speakers/{args.speaker}",
        },
        "generated_at": date.today().isoformat(),
        "count": len(lecs),
        "lectures": lecs,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump(snap, open(args.out, "w"), ensure_ascii=False, separators=(",", ":"))

    print(f"snapshot: {len(lecs)} shiurim  ->  {args.out}")
    if prev_ids:
        print(f"new since last snapshot: {len(added)}")
        for l in added[:25]:
            print(f"   + [{l['id']}] {l['series'] or l['category']}: {l['title']}  ({l['recorded']})")
    # expose for CI: write a marker the workflow can read
    if added and prev_ids:
        with open(os.path.join(HERE, "build", "NEW_LECTURES.txt"), "w") as f:
            f.write("\n".join(f"{l['id']}\t{l['title']}" for l in added))
    return 0


if __name__ == "__main__":
    sys.exit(main())
