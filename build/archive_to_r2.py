#!/usr/bin/env python3
"""
archive_to_r2.py — host EVERY remaining file from the OneDrive originals archive on R2,
so the local zips can be deleted without losing anything.

upload_originals.py already puts the best per-daf recording in media/orig/<Mas>/dafNN.m4a
(what the site plays). This uploads EVERYTHING ELSE — alternate/extra recordings, all the
non-daf audio (parsha, topical, dated), every source PDF, images, the few videos, docs —
VERBATIM to  archive/<original path inside the zip>.  Result: media/orig/ (curated, for the
site) + archive/ (complete backup) together hold 100% of the archive content.

Streams each file out of the zip (one temp at a time, disk-frugal), skips files already on
R2 (resumable), preserves the original folder/filename under archive/.

Usage:
  python3 build/archive_to_r2.py --dry-run     # show what/how-much would upload
  python3 build/archive_to_r2.py               # do it
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

    # members already served from media/orig/ (best per-daf) — don't duplicate them here
    best = uo.collect(args.zips)
    skip_members = {(z, member) for v in best.values() for (z, member, _sz, _e) in v.values()}

    zips = []
    for g in args.zips:
        zips += glob.glob(g)
    zips = sorted(zips)

    todo = []  # (zip, member, size)
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            for i in zf.infolist():
                if i.is_dir():
                    continue
                if (z, i.filename) in skip_members:
                    continue
                todo.append((z, i.filename, i.file_size))
    gb = sum(s for _, _, s in todo) / 1e9
    print(f"to host under {PREFIX}: {len(todo)} files, {gb:.1f} GB "
          f"(excludes {len(skip_members)} per-daf-best already in media/orig/){' [DRY RUN]' if args.dry_run else ''}\n")

    done = skipped = failed = 0
    for n, (z, member, size) in enumerate(todo, 1):
        key = PREFIX + member.lstrip("/")
        if not args.force and cloud.exists(key):
            skipped += 1
            continue
        if args.dry_run:
            if n <= 25:
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
                print(f"  …{done} uploaded / {skipped} skipped / {n} seen")
        except Exception as e:
            failed += 1
            print(f"  FAIL {member}: {str(e)[:120]}")
            if tmp:
                try: os.remove(tmp)
                except Exception: pass
    print(f"\ndone. uploaded {done}, already-on-R2 {skipped}, failed {failed}. -> s3://…/{PREFIX}")


if __name__ == "__main__":
    main()
