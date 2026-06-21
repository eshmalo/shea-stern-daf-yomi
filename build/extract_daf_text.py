#!/usr/bin/env python3
"""
extract_daf_text.py — build NATIVE, self-hosted daf text from the local Sefaria
library (KHK). For every Bavli masechta we write data/daf/<Masechta>.json:

    { "2a": {"he": "...", "en": "..."}, "2b": {...}, ... }

The app renders this directly (Hebrew + English, per amud) — no external sites,
fully independent. Text: William Davidson Talmud (Hebrew/Aramaic public domain;
English by Rabbi Adin Even-Israel Steinsaltz, CC-BY-NC, via Sefaria).

Usage:
    python3 build/extract_daf_text.py --khk "/Users/elazarshmalo/Desktop/KHK"
"""
import argparse, json, os, re, sys

# my masechta name -> Sefaria Bavli directory name
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


def find_file(khk, sefaria_name, lang, fname):
    base = os.path.join(khk, "Talmud", "Bavli")
    for seder in os.listdir(base):
        d = os.path.join(base, seder, sefaria_name, lang)
        if os.path.isdir(d):
            p = os.path.join(d, fname)
            if os.path.exists(p):
                return p
            cand = [x for x in os.listdir(d) if x.endswith(".txt")]
            if cand:
                return os.path.join(d, cand[0])
    return None


def parse(path):
    """split a WD file into {amud: 'joined text'}"""
    if not path:
        return {}
    txt = open(path, encoding="utf-8", errors="replace").read()
    parts = re.split(r'(Daf \d+[ab])', txt)
    out = {}
    for i in range(1, len(parts), 2):
        amud = parts[i].replace("Daf ", "").strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        lines = [l.rstrip() for l in body.split("\n") if l.strip()]
        if lines:
            out[amud] = "\n".join(lines)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--khk", default="/Users/elazarshmalo/Desktop/KHK")
    args = ap.parse_args()
    if not os.path.isdir(args.khk):
        sys.exit(f"KHK not found: {args.khk}")
    os.makedirs(OUT, exist_ok=True)

    index = {}
    for myname, sef in SEFARIA.items():
        he = parse(find_file(args.khk, sef, "Hebrew", "William Davidson Edition - Aramaic.txt"))
        en = parse(find_file(args.khk, sef, "English", "William Davidson Edition - English.txt"))
        amudim = sorted(set(he) | set(en), key=lambda a: (int(re.match(r'\d+', a).group()), a))
        daf = {a: {"he": he.get(a, ""), "en": en.get(a, "")} for a in amudim}
        key = myname.replace(" ", "_")
        path = os.path.join(OUT, key + ".json")
        json.dump(daf, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
        index[myname] = {"file": f"data/daf/{key}.json", "amudim": len(daf), "kb": os.path.getsize(path) // 1024}
        print(f"  {myname:16} {len(daf):4} amudim  {index[myname]['kb']:6} KB")

    json.dump(index, open(os.path.join(OUT, "_index.json"), "w"), ensure_ascii=False, indent=2)
    total = sum(v["kb"] for v in index.values())
    print(f"\n{len(index)} masechtos, {total/1024:.1f} MB total -> {OUT}")
    print("Source: William Davidson Talmud (Sefaria). Hebrew public domain; English © Steinsaltz, CC-BY-NC.")


if __name__ == "__main__":
    main()
