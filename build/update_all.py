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
LOCK = os.path.join(BUILD, ".update_all.lock")
PY = sys.executable or "python3"


def log(msg):
    line = f"[{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}] {msg}"
    print(line, flush=True)
    try:
        open(LOG, "a").write(line + "\n")
    except Exception:
        pass


def acquire_lock():
    """One run at a time. A long media pass can outlast the hourly interval, and
    two runs would fight over media/manifest.json and the git index. Returns the
    held file handle (kept open for the process lifetime) or None if busy."""
    try:
        import fcntl
        fh = open(LOCK, "w")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        fh.write(str(os.getpid())); fh.flush()
        return fh
    except Exception:
        return None


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


AUTO_MSG = "auto: refresh library + media manifest"
DATA_PATHS = ["data/library.json", "data/orig_audio.json", "media/manifest.json"]
PUSH_TIMEOUT = 600  # seconds; a push that hangs this long is treated as a failed run


def data_paths():
    """The data files publish() owns, limited to the ones that exist (git add and
    git commit both refuse a pathspec that matches nothing)."""
    return [p for p in DATA_PATHS if os.path.exists(os.path.join(HERE, p))]


def unpushed_subjects(g):
    """Subjects of the commits on local main that origin/main (as of the last
    fetch/push) lacks, newest first. A failed push leaves exactly that: the data
    commit exists locally, and the remote-tracking ref stays behind it.
    Local-only (no network call). None if git could not answer."""
    try:
        out = subprocess.run(g + ["log", "--format=%s", "origin/main..HEAD"],
                             capture_output=True, encoding="utf-8", errors="replace",
                             timeout=30)
    except Exception:
        return None
    if out.returncode != 0:
        return None
    # %s never contains a newline, so this is exactly one entry per commit
    # (an empty subject stays an entry, and it is not an auto commit).
    return out.stdout.splitlines()


def push_protection_hit(stderr):
    """True when GitHub secret-scanning PUSH PROTECTION rejected the push. GitHub
    answers 'GH013: Repository rule violations' with a 'GITHUB PUSH PROTECTION'
    section and 'Push cannot contain secrets' (older servers: 'GH009: Secrets
    detected'). GH013 alone is not enough: other repository rules use it too, and
    squashing history cannot fix those."""
    s = (stderr or "").lower()
    return ("push cannot contain secrets" in s or "github push protection" in s
            or ("gh009" in s and "secret" in s))


def push(g):
    """One `git push origin main`, with stderr captured so publish() can tell push
    protection from other failures. git's own output is passed through, so
    launchd.err.log keeps the full receipt as before. Returns (rc, stderr)."""
    p = subprocess.run(g + ["push", "-q", "origin", "main"], capture_output=True,
                       encoding="utf-8", errors="replace", timeout=PUSH_TIMEOUT)
    for stream, text in ((sys.stdout, p.stdout), (sys.stderr, p.stderr)):
        if text:
            try:
                stream.write(text); stream.flush()
            except Exception:
                pass
    return p.returncode, p.stderr or ""


def squash_past_push_protection(g):
    """GitHub push protection rejected the push. Every later push would contain the
    same flagged commit, so retrying alone can never clear it (2026-09-11 to 09-17:
    96 runs blocked on a TorahAnytime stream URL in data/library.json that matched
    a secret pattern). The flagged text sits in volatile tokenized URLs, so replace
    the unpushed auto commits with ONE fresh commit of the current data files and
    push once. Never loops: if that is rejected too, log it and stop; the next run
    tries again with newer data. Only ever rewrites commits that are all the job's
    own data commits and that GitHub never accepted."""
    subjects = unpushed_subjects(g)
    if not subjects or any(s != AUTO_MSG for s in subjects):
        log("publish: GitHub push protection rejected the push, and the unpushed commits are "
            "not all auto data commits — leaving history alone, not pushing")
        return 1
    log(f"publish: GitHub push protection rejected the push (secret pattern in the data; the "
        f"tokenized stream URLs in library.json are a known false positive). Squashing "
        f"{len(subjects)} unpushed auto commit(s) into one fresh commit of the current data")
    if subprocess.call(g + ["reset", "-q", "--soft", "origin/main"]) != 0:
        log("publish: reset --soft origin/main failed — will retry next run"); return 1
    paths = data_paths()
    subprocess.call(g + ["add", "--"] + paths)
    if subprocess.call(g + ["diff", "--cached", "--quiet", "--"] + paths) == 0:
        log("publish: after the squash the data matches GitHub — nothing to publish"); return 0
    if subprocess.call(g + ["commit", "-q", "-m", AUTO_MSG, "--"] + paths) != 0:
        log("publish: commit after the squash failed — the data is still staged; will retry next run")
        return 1
    rc, err = push(g)
    if rc == 0:
        log("publish: pushed data refresh after squashing past push protection (the live site redeploys)")
        return 0
    if push_protection_hit(err):
        log("publish: push protection rejected the fresh commit too — the CURRENT data still "
            "matches a secret pattern. Stopping (no loop); the next run squashes again with "
            "newer data. git's full message is in launchd.err.log")
        return 1
    log("publish: push after the squash failed — will retry next run")
    return 1


def publish():
    """Push the refreshed catalog + media manifest to GitHub so the LIVE site
    (GitHub Pages) serves them — this is what makes a newly-posted shiur appear
    on monseydafyomi.com with its de-watermarked R2 copy, hands-free.

    Commits only DATA_PATHS, and pushes only when every unpushed commit is the
    job's own `auto: refresh library + media manifest` commit: a commit made by
    hand in the live checkout is never pushed (or rebased) by the job. A push that
    GitHub push protection rejects is recovered by squash_past_push_protection()."""
    g = ["git", "-C", HERE]
    try:
        if subprocess.call(g + ["rev-parse", "--is-inside-work-tree"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) != 0:
            log("publish: not a git checkout — skipped"); return 0
        paths = data_paths()
        if not paths:
            log("publish: no data files found — skipped"); return 0
        subprocess.call(g + ["add", "--"] + paths)
        if subprocess.call(g + ["diff", "--cached", "--quiet", "--"] + paths) == 0:
            # Nothing new to commit — but a push that failed on an earlier run
            # (e.g. the login keychain was locked) left its commit stranded here.
            # Before this check, such a commit waited for the NEXT data change
            # (receipt: 2026-09-23 02:08 push failed, 03:08 "no data changes").
            if not unpushed_subjects(g):
                log("publish: no data changes"); return 0
            log("publish: no new data, but an earlier refresh never reached GitHub — retrying the push")
        # `-- paths`: commit only the data files, even if something else is staged.
        elif subprocess.call(g + ["commit", "-q", "-m", AUTO_MSG, "--"] + paths) != 0:
            log("publish: commit failed"); return 1
        # Refresh origin/main first, so "unpushed" means what the remote really lacks.
        subprocess.call(g + ["fetch", "-q", "origin", "main"])
        subjects = unpushed_subjects(g)
        if subjects is None:
            log("publish: could not list the unpushed commits — not pushing"); return 1
        if not subjects:
            log("publish: no data changes (GitHub already has them)"); return 0
        others = [s for s in subjects if s != AUTO_MSG]
        if others:
            log(f"publish: unpushed non-data commits; not pushing ({len(others)} of "
                f"{len(subjects)} unpushed commits are not '{AUTO_MSG}', e.g. "
                f"'{others[0][:80]}'). Push or remove them by hand; the data waits.")
            return 1
        # --autostash: media work in flight leaves other files dirty; rebase must
        # not abort on them.
        if subprocess.call(g + ["pull", "-q", "--rebase", "--autostash", "origin", "main"]) != 0:
            # Never leave the live checkout mid-rebase (the next run would commit
            # on a detached HEAD). No-op when no rebase is in progress.
            subprocess.call(g + ["rebase", "--abort"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            log("publish: pull --rebase failed — not pushing; will retry next run"); return 1
        rc, err = push(g)
        if rc == 0:
            log("publish: pushed data refresh (the live site redeploys)")
            return 0
        if push_protection_hit(err):
            return squash_past_push_protection(g)
        log("publish: push failed — will retry next run")
        return 1
    except Exception as e:
        log(f"publish: FAILED {str(e)[:160]}")
        return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-media", action="store_true", help="refresh catalog + texts only (skip media processing)")
    ap.add_argument("--sefaria-prefixes", default="json/,schemas/", help="which Sefaria bucket trees to keep current")
    ap.add_argument("--sefaria-min-free-gb", type=float, default=8.0)
    ap.add_argument("--force-sefaria", action="store_true", help="mirror Sefaria even if already done today")
    ap.add_argument("--no-sefaria", action="store_true", help="skip the Sefaria mirror entirely")
    args = ap.parse_args()

    lock = acquire_lock()
    if not lock:
        log("another update is still running — skipping this tick"); return 0

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

    # Publish EVERY run (cheap when nothing changed): the site only shows what
    # GitHub has, so a refreshed manifest must reach the repo to go live.
    rc_pub = publish()

    log(f"================= update: done (lectures {rc_lec}, sefaria {rc_sef}, publish {rc_pub}) =================")
    return 0 if rc_lec == 0 and rc_sef == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
