#!/usr/bin/env python3
"""
extract_torah.py — build NATIVE, self-hosted Chumash text from the local Sefaria
export mirror. For every sefer we write data/torah/<SeferEn>.json:

    { "<ParshaEn>": {"ref": "1:1–6:8", "verses": [
        {"c":1, "v":1, "he": "<verse with taamim>", "on": "<Onkelos>", "ra": ["<Rashi>", ...]},
        ... ]}, ... }

"on" is omitted when Onkelos is missing; "ra" is omitted when the verse has no
Rashi. The app renders this directly — no external sites, fully independent.
Text: Tanach with Ta'amei Hamikra; Targum Onkelos (Yemenite Taj vocalization);
Rashi merged edition (Rosenbaum-Silbermann / On Your Way / Metsudah), via Sefaria.

Usage:
    python3 build/extract_torah.py --export "/Users/elazarshmalo/Desktop/AI Workspace/Sefaria-Export/json"
"""
import argparse, json, os, re, sys

# my sefer name -> Sefaria book directory name
SEFARIA = {
    "Bereishit": "Genesis", "Shemot": "Exodus", "Vayikra": "Leviticus",
    "Bamidbar": "Numbers", "Devarim": "Deuteronomy",
}

# Standard Masoretic parsha boundaries, 1-based inclusive (chapter, verse).
# An end-verse of None means "last verse of that chapter" — resolved from the data,
# because editions differ on chapter splits.
PARSHIYOS = {
    "Bereishit": [
        ("Bereishit", (1, 1), (6, 8)), ("Noach", (6, 9), (11, 32)),
        ("Lech Lecha", (12, 1), (17, 27)), ("Vayeira", (18, 1), (22, 24)),
        ("Chayei Sarah", (23, 1), (25, 18)), ("Toldot", (25, 19), (28, 9)),
        ("Vayetzei", (28, 10), (32, 3)), ("Vayishlach", (32, 4), (36, 43)),
        ("Vayeshev", (37, 1), (40, 23)), ("Mikeitz", (41, 1), (44, 17)),
        ("Vayigash", (44, 18), (47, 27)), ("Vayechi", (47, 28), (50, 26)),
    ],
    "Shemot": [
        ("Shemot", (1, 1), (6, 1)), ("Va'eira", (6, 2), (9, 35)),
        ("Bo", (10, 1), (13, 16)), ("Beshalach", (13, 17), (17, 16)),
        ("Yitro", (18, 1), (20, None)), ("Mishpatim", (21, 1), (24, 18)),
        ("Terumah", (25, 1), (27, 19)), ("Tetzaveh", (27, 20), (30, 10)),
        ("Ki Tisa", (30, 11), (34, 35)), ("Vayakhel", (35, 1), (38, 20)),
        ("Pekudei", (38, 21), (40, 38)),
    ],
    "Vayikra": [
        ("Vayikra", (1, 1), (5, None)), ("Tzav", (6, 1), (8, 36)),
        ("Shemini", (9, 1), (11, 47)), ("Tazria", (12, 1), (13, 59)),
        ("Metzora", (14, 1), (15, 33)), ("Acharei Mot", (16, 1), (18, 30)),
        ("Kedoshim", (19, 1), (20, 27)), ("Emor", (21, 1), (24, 23)),
        ("Behar", (25, 1), (26, 2)), ("Bechukotai", (26, 3), (27, 34)),
    ],
    "Bamidbar": [
        ("Bamidbar", (1, 1), (4, 20)), ("Naso", (4, 21), (7, 89)),
        ("Be'halot'cha", (8, 1), (12, 16)), ("Shelach", (13, 1), (15, 41)),
        ("Korach", (16, 1), (18, 32)), ("Chukat", (19, 1), (22, 1)),
        ("Balak", (22, 2), (25, 9)), ("Pinchas", (25, 10), (30, 1)),
        ("Matot", (30, 2), (32, 42)), ("Masay", (33, 1), (36, 13)),
    ],
    "Devarim": [
        ("Devarim", (1, 1), (3, 22)), ("V'etchanan", (3, 23), (7, 11)),
        ("Ekev", (7, 12), (11, 25)), ("Re'eh", (11, 26), (16, 17)),
        ("Shoftim", (16, 18), (21, 9)), ("Ki Tetzei", (21, 10), (25, 19)),
        ("Ki Tavo", (26, 1), (29, 8)), ("Nitzavim", (29, 9), (30, 20)),
        ("Vayelech", (31, 1), (31, 30)), ("Ha'azinu", (32, 1), (32, 52)),
        ("V'Zot Haberacha", (33, 1), (34, 12)),
    ],
}

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "data", "torah")

FOOTNOTE_RE = re.compile(r'<sup[^>]*>.*?</sup>\s*(?:<i\s+class="footnote"[^>]*>.*?</i>)?', re.I | re.S)
TAG_RE = re.compile(r'<[^>]+>')
WS_RE = re.compile(r'\s+')


def clean(s):
    """Strip footnote markers + bodies, then ALL remaining HTML tags; collapse
    whitespace. The Rashi dibbur-hamatchil separator (dash or period after the
    bolded lemma) is plain text and survives untouched."""
    s = FOOTNOTE_RE.sub("", s)
    s = TAG_RE.sub("", s)
    return WS_RE.sub(" ", s).strip()


def load_text(path):
    """load a Sefaria export file's 'text' array (0-based [chapters][verses])"""
    with open(path, encoding="utf-8") as f:
        return json.load(f)["text"]


def find_onkelos(export, book):
    """prefer the Yemenite Taj vocalization (one book's filename has a stray
    trailing space before .json — match by prefix), else merged.json"""
    d = os.path.join(export, "Tanakh", "Targum", "Onkelos", "Torah", f"Onkelos {book}", "Hebrew")
    for f in sorted(os.listdir(d)):
        if f.startswith("Targum Onkelos, vocalized according to the Yemenite Taj"):
            return os.path.join(d, f)
    return os.path.join(d, "merged.json")


def cell(arr, c, v):
    """1-based fetch from a Sefaria [chap][verse] array; None if out of range"""
    if c - 1 < len(arr) and v - 1 < len(arr[c - 1]):
        return arr[c - 1][v - 1]
    return None


def build_sefer(sefer, torah, onkelos, rashi):
    """slice one book into parshiyos; hard-validate contiguity + coverage"""
    n_ch = len(torah)
    out, stats = {}, {"verses": 0, "on": 0, "ra": 0}
    expect = (1, 1)                                       # next verse the parsha list must start at
    for name, (c1, v1), (c2, v2) in PARSHIYOS[sefer]:
        if v2 is None:
            v2 = len(torah[c2 - 1])                       # "end of chapter" — trust the data
        if (c1, v1) != expect:
            sys.exit(f"FATAL {sefer}/{name}: starts {c1}:{v1}, expected {expect[0]}:{expect[1]} (gap/overlap)")
        verses = []
        c, v = c1, v1
        while (c, v) <= (c2, v2):
            he = clean(cell(torah, c, v) or "")
            if not he:
                sys.exit(f"FATAL {sefer} {c}:{v}: empty Hebrew verse")
            row = {"c": c, "v": v, "he": he}
            on = cell(onkelos, c, v)
            if isinstance(on, str) and clean(on):
                row["on"] = clean(on)
                stats["on"] += 1
            ra = cell(rashi, c, v)
            if isinstance(ra, list):
                ra = [clean(str(x)) for x in ra]
                ra = [x for x in ra if x]
                if ra:
                    row["ra"] = ra
                    stats["ra"] += 1
            verses.append(row)
            stats["verses"] += 1
            v += 1
            if v > len(torah[c - 1]):
                c, v = c + 1, 1
        out[name] = {"ref": f"{c1}:{v1}–{c2}:{v2}", "verses": verses}
        expect = (c, v)
    if expect != (n_ch + 1, 1):
        sys.exit(f"FATAL {sefer}: parshiyos end at {expect}, book has {n_ch} chapters (uncovered tail)")
    if stats["verses"] != sum(len(ch) for ch in torah):
        sys.exit(f"FATAL {sefer}: sliced {stats['verses']} verses, data has {sum(len(ch) for ch in torah)}")
    return out, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", default="/Users/elazarshmalo/Desktop/AI Workspace/Sefaria-Export/json")
    args = ap.parse_args()
    if not os.path.isdir(args.export):
        sys.exit(f"Sefaria export not found: {args.export}")
    os.makedirs(OUT, exist_ok=True)

    index, total = {}, 0
    for sefer, book in SEFARIA.items():
        torah = load_text(os.path.join(args.export, "Tanakh", "Torah", book, "Hebrew", "Tanach with Ta'amei Hamikra.json"))
        onkelos = load_text(find_onkelos(args.export, book))
        rashi = load_text(os.path.join(args.export, "Tanakh", "Rishonim on Tanakh", "Rashi", "Torah",
                                       f"Rashi on {book}", "Hebrew", "merged.json"))
        data, st = build_sefer(sefer, torah, onkelos, rashi)
        path = os.path.join(OUT, sefer + ".json")
        json.dump(data, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
        kb = os.path.getsize(path) // 1024
        index[sefer] = {"file": f"data/torah/{sefer}.json", "parshiyos": len(data), "verses": st["verses"], "kb": kb}
        total += st["verses"]
        print(f"  {sefer:10} {len(data):2} parshiyos {st['verses']:5} verses  "
              f"on {100*st['on']/st['verses']:5.1f}%  rashi {100*st['ra']/st['verses']:5.1f}%  {kb:5} KB")

    json.dump(index, open(os.path.join(OUT, "_index.json"), "w"), ensure_ascii=False, indent=2)
    note = "" if total == 5845 else f"  (spec says 5845 — data's own count wins)"
    print(f"\nTorah total: {total} verses{note} -> {OUT}")
    print("Source: Sefaria export — Ta'amei Hamikra Tanach, Onkelos (Yemenite Taj), Rashi merged edition.")


if __name__ == "__main__":
    main()
