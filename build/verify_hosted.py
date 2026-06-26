#!/usr/bin/env python3
"""
verify_hosted.py — prove that EVERY unique file in the local OneDrive daf zips is on R2
before anything local is deleted. This is the safety gate for removing the local copies.

It replicates the exact placement logic of the two upload tools to compute the expected R2
key for every unique content blob (by CRC-32):
  - best per-daf, misfiles excluded            -> media/orig/<Mas>/dafNN.ext   (from upload_originals)
  - every other unique blob (incl. misfiles)   -> archive/<original path>       (from archive_to_r2)
then lists what's actually on R2 and reports any MISSING keys or SIZE mismatches.

Exit 0 + "ALL HOSTED" == safe to delete the local zips. Any missing/mismatch == DO NOT delete.

Usage:
  python3 build/verify_hosted.py
"""
import glob, os, subprocess, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cloud
import upload_originals as uo


def expected_keys(zips):
    """{r2key: (crc, size)} for every unique content blob, matching the upload tools' logic."""
    best = uo.collect(zips)
    ambiguous = uo.find_ambiguous(best)
    exp = {}
    seen = set()
    for mas, dd in best.items():
        for daf, (z, member, size, ext, crc) in dd.items():
            if (mas, daf) in ambiguous:
                continue
            exp[f"media/orig/{mas.replace(' ', '_')}/daf{daf}{ext}"] = (crc, size)
            seen.add(crc)
    for z in sorted(zips):                       # SAME order archive_to_r2 uses
        with zipfile.ZipFile(z) as zf:
            for i in zf.infolist():
                if i.is_dir() or i.file_size == 0:
                    continue
                if i.CRC in seen:
                    continue
                seen.add(i.CRC)
                exp[uo.r2_safe_key("archive/", i.filename, i.CRC)] = (i.CRC, i.file_size)
    return exp


def r2_listing(prefix, cfg):
    """{key: size} for everything under s3://bucket/<prefix> (recursive)."""
    r = subprocess.run(["aws", "s3", "ls", f"s3://{cfg['S3_BUCKET']}/{prefix}", "--recursive",
                        "--endpoint-url", cfg["S3_ENDPOINT_URL"]],
                       env=cloud._env(cfg), capture_output=True, text=True)
    out = {}
    for line in r.stdout.splitlines():
        parts = line.split(None, 3)              # date time size key (key may contain spaces)
        if len(parts) == 4 and parts[2].isdigit():
            out[parts[3]] = int(parts[2])
    return out


def main():
    if not cloud.configured():
        sys.exit("cloud not configured")
    cfg = cloud.load_config()
    zips = [z for g in uo.DEFAULT_ZIP_GLOBS for z in glob.glob(g)]
    print(f"computing expected R2 layout from {len(zips)} zips …")
    exp = expected_keys(zips)
    print(f"unique content blobs expected on R2: {len(exp)} "
          f"({sum(s for _, s in exp.values())/1e9:.1f} GB)")
    print("listing R2 (media/orig/ + archive/) …")
    actual = {}
    actual.update(r2_listing("media/orig/", cfg))
    actual.update(r2_listing("archive/", cfg))
    print(f"objects on R2 under those prefixes: {len(actual)}")

    missing = [k for k in exp if k not in actual]
    mism = [(k, exp[k][1], actual[k]) for k in exp if k in actual and actual[k] != exp[k][1]]
    print()
    if not missing and not mism:
        print(f"ALL HOSTED ✓  every one of the {len(exp)} unique blobs is on R2 with matching size.")
        print("=> safe to remove the local zips.")
        return 0
    print(f"NOT COMPLETE ✗  missing: {len(missing)}, size-mismatch: {len(mism)} — DO NOT delete local.")
    for k in missing[:20]:
        print(f"  MISSING  {k}")
    for k, e, a in mism[:20]:
        print(f"  SIZE  {k}  expected {e} got {a}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
