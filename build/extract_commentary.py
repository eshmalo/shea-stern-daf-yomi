#!/usr/bin/env python3
"""
extract_commentary.py — build NATIVE Rashi + Tosafos text (Hebrew) per amud from
the local Sefaria library (KHK), so we can render the daf "like the original"
(three-column Tzuras HaDaf: Gemara center, Rashi + Tosafos on the margins) —
fully self-hosted, no external sites.

Writes data/daf/<Masechta>.comm.json:
    { "2a": {"r": ["<rashi comment>", ...], "t": ["<tosafos comment>", ...]}, ... }

Each comment is one dibur (Sefaria Vilna segment line). Loaded lazily by the app
only when the reader opens the "Daf" layout.

Usage: python3 build/extract_commentary.py --khk "/Users/elazarshmalo/Desktop/KHK"
"""
import argparse, json, os, re, sys

SEFARIA = {
    "Berachos": "Berakhot", "Shabbos": "Shabbat", "Eruvin": "Eruvin", "Pesachim": "Pesachim",
    "Yoma": "Yoma", "Sukkah": "Sukkah", "Beitzah": "Beitzah", "Rosh Hashanah": "Rosh Hashanah",
    "Taanis": "Taanit", "Megillah": "Megillah", "Moed Katan": "Moed Katan", "Chagigah": "Chagigah",
    "Yevamos": "Yevamot", "Kesubos": "Ketubot", "Nedarim": "Nedarim", "Nazir": "Nazir",
    "Sotah": "Sotah", "Gittin": "Gittin", "Kiddushin": "Kiddushin", "Bava Kamma": "Bava Kamma",
    "Bava Metzia": "Bava Metzia", "Bava Basra": "Bava Batra", "Sanhedrin": "Sanhedrin",
    "Makkos": "Makkot", "Shevuos": "Shevuot", "Avodah Zarah": "Avodah Zarah", "Horayos": "Horayot",
    "Zevachim": "Zevachim", "Menachos": "Menachot", "Chullin": "Chullin", "Bechoros": "Bekhorot",
    "Arachin": "Arakhin", "Temurah": "Temurah", "Kerisos": "Keritot", "Meilah": "Meilah",
    "Tamid": "Tamid", "Niddah": "Niddah",
}
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "data", "daf")
TAG_RE = re.compile(r"<[^>]+>")              # strip stray html
LINE_RE = re.compile(r"^Line \d+$")


def find_comm(khk, kind, sefaria_name):
    """kind = 'Rashi' | 'Tosafot'. Return Hebrew merged.txt path or None."""
    base = os.path.join(khk, "Talmud", "Bavli", "Rishonim on Talmud", kind)
    if not os.path.isdir(base):
        return None
    want = f"{kind} on {sefaria_name}"
    for seder in os.listdir(base):
        d = os.path.join(base, seder, want, "Hebrew")
        if os.path.isdir(d):
            for fn in ("merged.txt", "Vilna Edition.txt"):
                p = os.path.join(d, fn)
                if os.path.exists(p):
                    return p
            cand = [x for x in os.listdir(d) if x.endswith(".txt")]
            if cand:
                return os.path.join(d, sorted(cand)[0])
    return None


def parse_comments(path):
    """split a Rashi/Tosafos file into {amud: [comment, ...]} (drops Line markers)."""
    if not path:
        return {}
    txt = open(path, encoding="utf-8", errors="replace").read()
    parts = re.split(r"(Daf \d+[ab])", txt)
    out = {}
    for i in range(1, len(parts), 2):
        amud = parts[i].replace("Daf ", "").strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        comments = []
        for raw in body.split("\n"):
            s = TAG_RE.sub("", raw).strip()
            if not s or LINE_RE.match(s):
                continue
            comments.append(s)
        if comments:
            out[amud] = comments
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--khk", default="/Users/elazarshmalo/Desktop/KHK")
    ap.add_argument("--only", default="", help="comma-list of masechtos to (re)build; default all")
    args = ap.parse_args()
    if not os.path.isdir(args.khk):
        sys.exit(f"KHK not found: {args.khk}")
    os.makedirs(OUT, exist_ok=True)
    only = {x.strip() for x in args.only.split(",") if x.strip()}

    total_kb = 0
    for myname, sef in SEFARIA.items():
        if only and myname not in only:
            continue
        rashi = parse_comments(find_comm(args.khk, "Rashi", sef))
        tos = parse_comments(find_comm(args.khk, "Tosafot", sef))
        amudim = sorted(set(rashi) | set(tos), key=lambda a: (int(re.match(r"\d+", a).group()), a))
        if not amudim:
            print(f"  {myname:16} (no Rashi/Tosafos found)")
            continue
        data = {a: {"r": rashi.get(a, []), "t": tos.get(a, [])} for a in amudim}
        key = myname.replace(" ", "_")
        path = os.path.join(OUT, key + ".comm.json")
        json.dump(data, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
        kb = os.path.getsize(path) // 1024
        total_kb += kb
        nr = sum(len(v["r"]) for v in data.values())
        nt = sum(len(v["t"]) for v in data.values())
        print(f"  {myname:16} {len(amudim):4} amudim  rashi:{nr:5} tosafos:{nt:5}  {kb:6} KB")

    print(f"\ncommentary -> {OUT}  ({total_kb/1024:.1f} MB total)")
    print("Source: Rashi + Tosafos, Vilna Edition (public domain), via Sefaria.")


if __name__ == "__main__":
    main()
