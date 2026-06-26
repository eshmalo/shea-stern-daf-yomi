#!/usr/bin/env python3
"""
upload_originals.py — take the Rabbi's ORIGINAL daf-yomi audio out of the OneDrive
zips (no TorahAnytime intro / watermark), upload it to R2, and record a per-daf map
the site can prefer over the TA-sourced audio.

The zips hold ~2,270 per-daf recordings across 35 masechtos, named like
"…/מסכת שבת/פרק ב/Shabbos Daf 31.m4a" or "…/Avodah Zarah Daf 11.m4a". We parse the
masechta (Hebrew folder) + daf (from the filename), pick ONE recording per daf
(the largest = the full shiur), stream it out of the zip, and upload to
  media/orig/<Masechta_Key>/daf<NN>.<ext>
Never extracts the whole archive (disk-frugal: one temp file at a time). Resumable:
skips dafim already on R2 unless --force.

Usage:
  python3 build/upload_originals.py --masechta "Avodah Zarah"     # pilot one masechta
  python3 build/upload_originals.py --all                          # everything
  python3 build/upload_originals.py --all --dry-run                # plan only, no upload
"""
import argparse, glob, json, os, re, sys, tempfile, zipfile
import collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cloud

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data")
ORIG_JSON = os.path.join(DATA, "orig_audio.json")
DEFAULT_ZIP_GLOBS = [
    os.path.expanduser("~/Downloads/Daf-Yomi-20260625T231048Z-3-*.zip"),
    os.path.expanduser("~/Downloads/מסכת עבודה זרה-20260625T231051Z-3-*.zip"),
]
DAF_RE = re.compile(r'\b[Dd]af[\s_-]*(\d{1,3})\b')
HEB2EN = {'ברכות':'Berachos','שבת':'Shabbos','עירובין':'Eruvin','פסחים':'Pesachim','יומא':'Yoma','סוכה':'Sukkah',
'ביצה':'Beitzah','ראש השנה':'Rosh Hashanah','תענית':'Taanis','מגילה':'Megillah','מועד קטן':'Moed Katan','חגיגה':'Chagigah',
'יבמות':'Yevamos','כתובות':'Kesubos','נדרים':'Nedarim','נזיר':'Nazir','סוטה':'Sotah','גיטין':'Gittin','קידושין':'Kiddushin',
'בבא קמא':'Bava Kamma','בבא מציעא':'Bava Metzia','בבא בתרא':'Bava Basra','סנהדרין':'Sanhedrin','מכות':'Makkos',
'שבועות':'Shevuos','עבודה זרה':'Avodah Zarah','הוריות':'Horayos','זבחים':'Zevachim','מנחות':'Menachos','חולין':'Chullin',
'בכורות':'Bechoros','ערכין':'Arachin','תמורה':'Temurah','כריתות':'Kerisos','מעילה':'Meilah','תמיד':'Tamid','נדה':'Niddah'}
AUDIO_EXT = (".m4a", ".mp3")


def masechta_of(parts):
    for p in parts[:-1]:
        s = re.sub(r'\s+', ' ', p.replace('מסכת', '').replace('2nd time', '').replace('1st', '').replace('2nd', '')).strip()
        if s in HEB2EN:
            return HEB2EN[s]
    return None


def collect(zip_globs):
    """Return {masechta: {daf: (zip_path, member, size, ext)}} keeping the LARGEST file per daf."""
    zips = []
    for g in zip_globs:
        zips += glob.glob(g)
    best = collections.defaultdict(dict)
    for z in sorted(zips):
        with zipfile.ZipFile(z) as zf:
            for i in zf.infolist():
                if i.is_dir():
                    continue
                ext = os.path.splitext(i.filename)[1].lower()
                if ext not in AUDIO_EXT:
                    continue
                parts = i.filename.split('/')
                mas = masechta_of(parts)
                m = DAF_RE.search(parts[-1])
                if not (mas and m):
                    continue
                daf = int(m.group(1))
                cur = best[mas].get(daf)
                if cur is None or i.file_size > cur[2]:
                    best[mas][daf] = (z, i.filename, i.file_size, ext, i.CRC)
    return best


def find_ambiguous(best):
    """(masechta,daf) pairs whose chosen recording is BYTE-IDENTICAL (same CRC) to another
    daf's recording — i.e. one file misfiled under two identities. We can't know which label
    is correct, so we EXCLUDE all of them (those dafim fall back to the correctly-labelled TA
    audio) and report them for manual review."""
    crc2ids = collections.defaultdict(set)
    for mas, dd in best.items():
        for daf, rec in dd.items():
            crc2ids[rec[4]].add((mas, daf))
    return {(mas, daf) for mas, dd in best.items() for daf, rec in dd.items()
            if len(crc2ids[rec[4]]) > 1}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--masechta", help="only this masechta (English name, e.g. 'Avodah Zarah')")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--zips", nargs="*", default=DEFAULT_ZIP_GLOBS, help="zip glob(s)")
    ap.add_argument("--force", action="store_true", help="re-upload even if already on R2")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not (args.masechta or args.all):
        sys.exit("pass --masechta NAME or --all")
    if not cloud.configured():
        sys.exit("cloud not configured (build/cloud.config)")

    best = collect(args.zips)
    ambiguous = find_ambiguous(best)   # computed on the FULL set so cross-masechta misfiles are caught
    if ambiguous:
        rep = os.path.join(os.path.dirname(ORIG_JSON), "..", "build", "logo_audit", "ambiguous_dafim.json")
        rep = os.path.normpath(rep)
        os.makedirs(os.path.dirname(rep), exist_ok=True)
        json.dump(sorted([list(a) for a in ambiguous]), open(rep, "w"))
        print(f"EXCLUDING {len(ambiguous)} misfiled/ambiguous dafim (same recording under >1 identity) -> {rep}")
    # drop ambiguous from every masechta
    best = {mas: {d: r for d, r in dd.items() if (mas, d) not in ambiguous} for mas, dd in best.items()}
    if args.masechta:
        if args.masechta not in best:
            sys.exit(f"no audio found for '{args.masechta}'. have: {sorted(best)}")
        best = {args.masechta: best[args.masechta]}

    out = {}
    if os.path.exists(ORIG_JSON):
        out = json.load(open(ORIG_JSON))

    total = sum(len(v) for v in best.values())
    print(f"{total} daf-recordings across {len(best)} masechtos "
          f"({sum(f[2] for v in best.values() for f in v.values())/1e9:.1f} GB){' [DRY RUN]' if args.dry_run else ''}\n")
    done = skipped = failed = 0
    for mas in sorted(best):
        key = mas.replace(" ", "_")
        out.setdefault(mas, {})
        for daf in sorted(best[mas]):
            z, member, size, ext, _crc = best[mas][daf]
            r2key = f"media/orig/{key}/daf{daf}{ext}"
            if not args.force and cloud.exists(r2key):
                out[mas][str(daf)] = r2key; skipped += 1
                continue
            if args.dry_run:
                print(f"  would upload {mas} daf {daf}  ({size/1e6:.0f} MB)  <- {os.path.basename(member)}")
                done += 1
                continue   # do NOT write the map on a dry run — it must reflect only real uploads
            try:
                with zipfile.ZipFile(z) as zf, tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tf:
                    tmp = tf.name
                    with zf.open(member) as src:
                        while True:
                            b = src.read(1 << 20)
                            if not b:
                                break
                            tf.write(b)
                cloud.upload(tmp, r2key)
                os.remove(tmp)
                out[mas][str(daf)] = r2key
                done += 1
                if done % 10 == 0:
                    json.dump(out, open(ORIG_JSON, "w"), ensure_ascii=False, indent=1)
                    print(f"  …{mas}: uploaded {done} (skipped {skipped})")
            except Exception as e:
                failed += 1
                print(f"  FAIL {mas} daf {daf}: {str(e)[:120]}")
                try: os.remove(tmp)
                except Exception: pass
        if not args.dry_run:
            json.dump(out, open(ORIG_JSON, "w"), ensure_ascii=False, indent=1)
            print(f"{mas}: {len(out[mas])} dafim mapped")
    if not args.dry_run:
        json.dump(out, open(ORIG_JSON, "w"), ensure_ascii=False, indent=1)
    print(f"\ndone. uploaded {done}, already-on-R2 {skipped}, failed {failed}. map -> {ORIG_JSON}")


if __name__ == "__main__":
    main()
