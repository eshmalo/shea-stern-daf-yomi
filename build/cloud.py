#!/usr/bin/env python3
"""
cloud.py — tiny S3-compatible (Cloudflare R2 / Backblaze B2 / AWS S3) helper for
the media pipeline. Config comes from env vars or build/cloud.config (git-ignored,
KEY=VALUE lines); env wins. Uses the installed `aws` CLI via --endpoint-url and
passes ONLY our scoped keys in the subprocess env, so it never touches other AWS
credentials on the machine.

  python3 build/cloud.py check     # print config status + verify the bucket is reachable
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(HERE, "build")
CONFIG = os.path.join(BUILD, "cloud.config")

REQUIRED = ["S3_ENDPOINT_URL", "S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "CDN_BASE_URL"]
ALL_KEYS = REQUIRED + ["S3_REGION"]
CONTENT_TYPE = {"mp3": "audio/mpeg", "mp4": "video/mp4", "m4a": "audio/mp4",
                "webm": "video/webm", "mov": "video/quicktime", "json": "application/json"}


def load_config():
    cfg = {}
    if os.path.exists(CONFIG):
        for line in open(CONFIG):
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    for k in ALL_KEYS:                      # env overrides file
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    cfg.setdefault("S3_REGION", "auto")
    return cfg


def configured(cfg=None):
    cfg = cfg or load_config()
    return all(cfg.get(k) for k in REQUIRED)


def missing(cfg=None):
    cfg = cfg or load_config()
    return [k for k in REQUIRED if not cfg.get(k)]


def _env(cfg):
    e = dict(os.environ)
    e["AWS_ACCESS_KEY_ID"] = cfg["AWS_ACCESS_KEY_ID"]
    e["AWS_SECRET_ACCESS_KEY"] = cfg["AWS_SECRET_ACCESS_KEY"]
    e["AWS_DEFAULT_REGION"] = cfg.get("S3_REGION", "auto")
    e.pop("AWS_PROFILE", None)              # don't let a profile override our keys
    return e


def cdn_url(key, cfg=None):
    cfg = cfg or load_config()
    return cfg["CDN_BASE_URL"].rstrip("/") + "/" + key.lstrip("/")


def exists(key, cfg=None):
    cfg = cfg or load_config()
    r = subprocess.run(["aws", "s3api", "head-object", "--endpoint-url", cfg["S3_ENDPOINT_URL"],
                        "--bucket", cfg["S3_BUCKET"], "--key", key],
                       env=_env(cfg), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return r.returncode == 0


def upload(local_path, key, cfg=None):
    """Upload local_path to <bucket>/<key> with the right Content-Type. Returns CDN URL."""
    cfg = cfg or load_config()
    ext = key.rsplit(".", 1)[-1].lower()
    ct = CONTENT_TYPE.get(ext, "application/octet-stream")
    subprocess.check_call(["aws", "s3", "cp", local_path, f"s3://{cfg['S3_BUCKET']}/{key}",
                           "--endpoint-url", cfg["S3_ENDPOINT_URL"],
                           "--content-type", ct, "--only-show-errors"], env=_env(cfg))
    return cdn_url(key, cfg)


def check():
    cfg = load_config()
    print("config source :", "build/cloud.config" if os.path.exists(CONFIG) else "(no file)", "+ env")
    for k in ALL_KEYS:
        v = cfg.get(k, "")
        shown = v if k in ("S3_ENDPOINT_URL", "S3_BUCKET", "S3_REGION", "CDN_BASE_URL") else (v[:4] + "…" if v else "")
        print(f"  {k:22} {'SET ' + ('('+shown+')' if shown else '') if v else 'MISSING'}")
    if not configured(cfg):
        print("\nNOT fully configured — missing:", ", ".join(missing(cfg)))
        return 1
    print("\nbucket reachable? listing", cfg["S3_BUCKET"], "…")
    r = subprocess.run(["aws", "s3", "ls", f"s3://{cfg['S3_BUCKET']}/", "--endpoint-url", cfg["S3_ENDPOINT_URL"]],
                       env=_env(cfg), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    print(r.stdout.strip() or "(empty bucket)")
    print("RESULT:", "OK ✓" if r.returncode == 0 else f"FAILED (aws exit {r.returncode})")
    return r.returncode


if __name__ == "__main__":
    sys.exit(check() if (len(sys.argv) > 1 and sys.argv[1] == "check") else check())
