#!/usr/bin/env python3
"""
archive_to_r2.py — host EVERY remaining UNIQUE file from the OneDrive originals archive on
R2, so the local zips can be deleted without losing anything — with NO duplicate content.

upload_originals.py already puts the best per-daf recording (deduped, misfiles excluded) in
media/orig/<Mas>/dafNN.m4a. This uploads everything else — the misfiled/ambiguous recordings,
genuinely-different alternate recordings, all the non-daf audio, every source PDF, images, the
few videos, docs — VERBATIM to  archive/<original path>.

Content-dedup: each file's stored CRC-32 is the fingerprint. We skip any blob already hosted in
media/orig/, and within this pass upload each unique blob only once (later identical copies are
skipped). Result: media/orig/ + archive/ together hold 100% of the content with zero duplicates.
Streams each file out of the zip (one temp at a time). Resumable (skips files already on R2).

Usage:
  python3 build/archive_to_r2.py --dry-run
  python3 build/archive_to_r2.py
"""
import argparse, glob, os, sys, tempfile, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cloud
import upload_originals as uo

PREFIX = "archive/"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zips", nargs="*", default=uo.DEFAULT_ZIP_GLOBS)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not cloud.configured():
        sys.exit("cloud not configured (build/cloud.config)")

    # CRCs already hosted in media/orig/ (best per-daf, MINUS the excluded misfiles) — don't re-host them
    best = uo.collect(args.zips)
    ambiguous = uo.find_ambiguous(best)
    hosted_crc = {rec[4] for mas, dd in best.items() for d, rec in dd.items() if (mas, d) not in ambiguous}

    zips = sorted(z for g in args.zips for z in glob.glob(g))
    seen = set(hosted_crc)
    todo, dup_skipped = [], 0
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            for i in zf.infolist():
                if i.is_dir() or i.file_size == 0:
                    continue
                if i.CRC in seen:                 # already hosted (media/orig) or already queued here
                    dup_skipped += 1
                    continue
                seen.add(i.CRC)
                todo.append((z, i.filename, i.file_size, i.CRC))
    gb = sum(s for _, _, s in todo) / 1e9
    print(f"to host under {PREFIX}: {len(todo)} unique files, {gb:.1f} GB")
    print(f"  content-duplicates skipped: {dup_skipped} (already in media/orig/ or identical copies)")
    print(f"  (misfiled/ambiguous recordings ARE hosted here so nothing is lost){' [DRY RUN]' if args.dry_run else ''}\n")

    done = skipped = failed = 0
    for n, (z, member, size, crc) in enumerate(todo, 1):
        key = uo.r2_safe_key(PREFIX, member, crc)
        if not args.force and cloud.exists(key):
            skipped += 1
            continue
        if args.dry_run:
            if n <= 20:
                print(f"  would upload {size/1e6:7.1f} MB  {member}")
            continue
        tmp = None
        try:
            ext = os.path.splitext(member)[1] or ".bin"
            with zipfile.ZipFile(z) as zf, tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tf:
                tmp = tf.name
                with zf.open(member) as src:
                    while True:
                        b = src.read(1 << 20)
                        if not b:
                            break
                        tf.write(b)
            cloud.upload(tmp, key)
            os.remove(tmp); tmp = None
            done += 1
            if done % 50 == 0:
                print(f"  …{done} uploaded / {skipped} already-on-R2 / {n} seen")
        except Exception as e:
            failed += 1
            print(f"  FAIL {member}: {str(e)[:120]}")
            if tmp:
                try: os.remove(tmp)
                except Exception: pass
    print(f"\ndone. uploaded {done}, already-on-R2 {skipped}, failed {failed}. -> s3://…/{PREFIX}")


if __name__ == "__main__":
    main()
