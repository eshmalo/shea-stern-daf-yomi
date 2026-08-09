#!/usr/bin/env python3
"""
lambda_function.py — admin API for monseydafyomi.com (AWS Lambda, Function URL).

Lets Rabbi Stern (single admin password) upload/replace audio+video and attach
worksheet PDFs to any page. Files go browser -> R2 directly via presigned URLs;
this function only authenticates, signs, and maintains site/admin-data.json in
the R2 bucket (which the public site reads).

Routes (all JSON; CORS locked to ALLOWED_ORIGINS):
  POST /login          {password}                          -> {token, exp}
  GET  /state          (auth)                              -> {data, cdnBase}
  POST /presign        (auth) {kind,pageKey,filename,contentType,size}
                       -> {mode:'single',key,url} | {mode:'multipart',key,uploadId,partSize}
  POST /sign-part      (auth) {key,uploadId,partNumber}    -> {url}
  POST /complete       (auth) {key,uploadId,parts:[{PartNumber,ETag}]}
  POST /abort          (auth) {key,uploadId}
  POST /mutate         (auth) {ops:[...]}                  -> {data}
  POST /delete-object  (auth) {key}   (site/uploads/ only)

Env (set by deploy.sh): S3_ENDPOINT_URL, S3_BUCKET, R2_ACCESS_KEY_ID,
R2_SECRET_ACCESS_KEY, CDN_BASE_URL, ADMIN_PW_HASH (pbkdf2$<iters>$<salthex>$<hashhex>),
SESSION_SECRET, ALLOWED_ORIGINS (comma-separated).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time

import boto3
from botocore.config import Config

# ---------- config ----------

DATA_KEY = "site/admin-data.json"
HISTORY_PREFIX = "site/history/"
UPLOAD_PREFIX = "site/uploads/"
TOKEN_TTL = 12 * 3600
MULTIPART_THRESHOLD = 95 * 1024 * 1024   # single PUT below this
PART_SIZE = 100 * 1024 * 1024
PRESIGN_TTL = 3600

SIZE_CAPS = {"audio": 2 * 1024**3, "video": 6 * 1024**3, "worksheet": 200 * 1024**2}

# The ONLY site-text fields the admin page may change, as dotted paths into
# data/content.json, with per-field length caps. An allowlist (not a deep merge)
# is deliberate: unknown keys — including __proto__ and options.mediaBaseUrl,
# which would repoint every media file — can never be written.
# Keep in sync with ADMIN_TEXT_FIELDS in app.js.
CONTENT_FIELDS = {
    "masthead.hebrew": 80, "masthead.english": 80, "masthead.subtitle": 160,
    "donate.heading": 80, "donate.blurb": 1200, "donate.dedicationNote": 400,
    "donate.zelle.name": 80, "donate.zelle.email": 160,
    "contact.email": 160, "contact.phone": 60, "contact.whatsapp": 60,
    "phone.label": 80, "phone.number": 40, "phone.extension": 12, "phone.note": 200,
    "sponsor.heading": 80, "sponsor.blurb": 1200, "sponsor.contactEmail": 160,
    "sponsor.amounts.daf": 16, "sponsor.amounts.week": 16, "sponsor.amounts.masechta": 16,
    "about.heading": 80,
}

# content-type -> file extension, per kind (server picks the extension)
TYPES = {
    "audio": {"audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
              "audio/wav": "wav", "audio/ogg": "ogg"},
    "video": {"video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"},
    "worksheet": {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
                  "image/webp": "webp", "image/gif": "gif",
                  "application/msword": "doc",
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
                  "application/vnd.ms-powerpoint": "ppt",
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx"},
}

PAGEKEY_RE = re.compile(
    r"^(daf:[A-Za-z' \-]{2,30}:\d{1,3}"
    r"|parsha:[A-Za-z'’ \-]{2,40}"
    r"|holiday:[A-Za-z'’/ \-&]{2,40}"
    r"|category:[A-Za-z'’/ \-&]{2,40})$")
# keys that admin-data may reference (attach/override): our uploads, pipeline media,
# or the rabbi's pre-existing archive/ materials
REF_KEY_RE = re.compile(r"^(site/uploads/(audio|video|worksheet)/[A-Za-z0-9._/\-]{1,220}"
                        r"|media/[A-Za-z0-9._/\-]{1,220}"
                        r"|archive/.{1,900})$", re.S)
UPLOAD_KEY_RE = re.compile(r"^site/uploads/(audio|video|worksheet)/[a-z0-9\-]{1,80}/"
                           r"\d{10,12}-[a-f0-9]{8}\.[a-z0-9]{2,5}$")

_s3 = None


def s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["S3_ENDPOINT_URL"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
    return _s3


def bucket():
    return os.environ["S3_BUCKET"]


# ---------- auth ----------

# Best-effort, per-container throttle (documented limitation: each warm Lambda
# container has its own counters). Lockout is PER-IP so a stranger's failures
# can't lock the admin out; a much higher global cap bounds total guess volume.
_fails = {"n": 0, "at": 0.0, "ip": {}}


def check_password(pw):
    try:
        scheme, iters, salt, want = os.environ["ADMIN_PW_HASH"].split("$")
        if scheme != "pbkdf2":
            return False
        got = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(got.hex(), want)
    except Exception:
        return False


def make_token():
    exp = int(time.time()) + TOKEN_TTL
    nonce = secrets.token_hex(8)
    msg = f"{exp}.{nonce}"
    sig = hmac.new(os.environ["SESSION_SECRET"].encode(), msg.encode(), hashlib.sha256).hexdigest()
    return f"{msg}.{sig}", exp


def check_token(token):
    try:
        exp_s, nonce, sig = token.split(".")
        if int(exp_s) < time.time():
            return False
        msg = f"{exp_s}.{nonce}"
        want = hmac.new(os.environ["SESSION_SECRET"].encode(), msg.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, want)
    except Exception:
        return False


# ---------- admin-data document ----------

def empty_data():
    return {"version": 1, "updated": "", "media": {"pages": {}, "lectures": {}},
            "attachments": {"pages": {}}, "content": {}}


class Unavailable(Exception):
    pass


def load_data():
    # Missing file = fresh install → empty doc. ANY other failure must raise:
    # silently returning an empty doc here would let the next save_data()
    # overwrite the live manifest with a near-empty one.
    try:
        raw = s3().get_object(Bucket=bucket(), Key=DATA_KEY)["Body"].read()
    except s3().exceptions.NoSuchKey:
        return empty_data()
    except Exception:
        raise Unavailable("could not read the site data — try again in a minute")
    try:
        d = json.loads(raw)
        if not isinstance(d, dict) or "media" not in d or "attachments" not in d:
            raise ValueError("bad shape")
        return d
    except Exception:
        # corrupt file: preserve the evidence, then refuse to operate on it
        try:
            s3().copy_object(Bucket=bucket(), Key=HISTORY_PREFIX + f"corrupt-{int(time.time())}.json",
                             CopySource={"Bucket": bucket(), "Key": DATA_KEY})
        except Exception:
            pass
        raise Unavailable("the site data file is corrupt; a copy was saved under site/history/ — "
                          "restore a good version from there over " + DATA_KEY)


def save_data(d):
    d["updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    body = json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode()
    # history copy first, then overwrite the live doc
    s3().put_object(Bucket=bucket(), Key=HISTORY_PREFIX + f"admin-data-{int(time.time())}.json",
                    Body=body, ContentType="application/json")
    s3().put_object(Bucket=bucket(), Key=DATA_KEY, Body=body,
                    ContentType="application/json", CacheControl="no-store")


def object_exists(key):
    try:
        s3().head_object(Bucket=bucket(), Key=key)
        return True
    except Exception:
        return False


# ---------- validation helpers ----------

def s(v, cap):
    """Coerce to a trimmed string with a length cap; reject controls."""
    if not isinstance(v, str):
        raise Bad("expected string")
    v = v.strip()
    if not v or len(v) > cap or any(ord(c) < 32 for c in v):
        raise Bad("bad string value")
    return v


class Bad(Exception):
    pass


def valid_page_key(v):
    v = s(v, 60)
    if not PAGEKEY_RE.match(v):
        raise Bad("bad pageKey")
    return v


def valid_ref_key(v):
    v = s(v, 950)
    if ".." in v or v.startswith("/") or not REF_KEY_RE.match(v):
        raise Bad("bad object key")
    return v


def slug(v):
    out = re.sub(r"[^a-z0-9]+", "-", v.lower()).strip("-")
    return out[:80] or "page"


def valid_content_value(key, v):
    """One site-text field. Empty string means 'go back to the file's own value'."""
    cap = CONTENT_FIELDS[key]
    if not isinstance(v, str):
        raise Bad(key + " must be text")
    v = v.strip()
    if len(v) > cap:
        raise Bad(f"{key} is too long (limit {cap} characters)")
    allow_nl = cap >= 400                       # only the long blurbs may wrap lines
    if any(ord(c) < 32 and not (allow_nl and c == "\n") for c in v):
        raise Bad(key + " contains an invalid character")
    if v and key.lower().endswith("email") and (v.count("@") != 1 or " " in v):
        raise Bad(key + " must be an email address")
    return v


# ---------- ops ----------

def apply_op(d, op):
    name = s(op.get("op", ""), 40)
    if name == "set_page_media":
        pk, kind = valid_page_key(op.get("pageKey")), s(op.get("kind"), 10)
        if kind not in ("audio", "video"):
            raise Bad("kind must be audio|video")
        key = valid_ref_key(op.get("key"))
        if not object_exists(key):
            raise Bad("object not found: " + key)
        ent = d["media"]["pages"].setdefault(pk, {})
        ent[kind] = {"key": key, "label": s(op.get("label", "Shiur"), 120),
                     "updated": int(time.time())}
    elif name == "clear_page_media":
        pk, kind = valid_page_key(op.get("pageKey")), s(op.get("kind"), 10)
        ent = d["media"]["pages"].get(pk) or {}
        ent.pop(kind, None)
        if not ent:
            d["media"]["pages"].pop(pk, None)
    elif name == "set_lecture_media":
        try:
            lid = str(int(op.get("lectureId")))
        except (TypeError, ValueError):
            raise Bad("bad lectureId")
        kind = s(op.get("kind"), 10)
        if kind not in ("audio", "video"):
            raise Bad("kind must be audio|video")
        key = valid_ref_key(op.get("key"))
        if not object_exists(key):
            raise Bad("object not found: " + key)
        d["media"]["lectures"].setdefault(lid, {})[kind] = {"key": key, "updated": int(time.time())}
    elif name == "clear_lecture_media":
        try:
            lid = str(int(op.get("lectureId")))
        except (TypeError, ValueError):
            raise Bad("bad lectureId")
        kind = s(op.get("kind"), 10)
        ent = d["media"]["lectures"].get(lid) or {}
        ent.pop(kind, None)
        if not ent:
            d["media"]["lectures"].pop(lid, None)
    elif name == "add_attachment":
        pk = valid_page_key(op.get("pageKey"))
        key = valid_ref_key(op.get("key"))
        if not object_exists(key):
            raise Bad("object not found: " + key)
        lst = d["attachments"]["pages"].setdefault(pk, [])
        if len(lst) >= 40:
            raise Bad("too many attachments on this page")
        lst.append({"id": secrets.token_hex(6), "title": s(op.get("title"), 200),
                    "key": key, "contentType": s(op.get("contentType", "application/pdf"), 100),
                    "size": max(0, int(op.get("size", 0))), "uploaded": int(time.time())})
    elif name == "remove_attachment":
        pk, aid = valid_page_key(op.get("pageKey")), s(op.get("id"), 20)
        lst = d["attachments"]["pages"].get(pk) or []
        lst[:] = [a for a in lst if a.get("id") != aid]
        if not lst:
            d["attachments"]["pages"].pop(pk, None)
    elif name == "rename_attachment":
        pk, aid = valid_page_key(op.get("pageKey")), s(op.get("id"), 20)
        for a in d["attachments"]["pages"].get(pk) or []:
            if a.get("id") == aid:
                a["title"] = s(op.get("title"), 200)
                break
        else:
            raise Bad("attachment not found")
    elif name == "set_content":
        vals = op.get("values")
        if not isinstance(vals, dict) or not (1 <= len(vals) <= 40):
            raise Bad("values must be an object of 1..40 fields")
        if not isinstance(d.get("content"), dict):
            d["content"] = {}
        c = d["content"]
        for k, v in vals.items():
            if k not in CONTENT_FIELDS:         # blocks __proto__, options.*, anything unlisted
                raise Bad("not an editable field: " + str(k)[:60])
            vv = valid_content_value(k, v)
            if vv:
                c[k] = vv
            else:
                c.pop(k, None)
    elif name == "clear_content":
        d["content"] = {}
    elif name == "move_attachment":
        pk, aid = valid_page_key(op.get("pageKey")), s(op.get("id"), 20)
        step = int(op.get("dir", 0))
        if step not in (-1, 1):
            raise Bad("dir must be -1 or 1")
        lst = d["attachments"]["pages"].get(pk) or []
        idx = next((i for i, a in enumerate(lst) if a.get("id") == aid), -1)
        j = idx + step
        if idx < 0 or not (0 <= j < len(lst)):
            raise Bad("cannot move")
        lst[idx], lst[j] = lst[j], lst[idx]
    else:
        raise Bad("unknown op")


# ---------- handlers ----------

def h_login(body, ip):
    now = time.time()
    if now - _fails["at"] > 3600:
        _fails["n"] = 0
        _fails["ip"] = {}
    ip_n = _fails["ip"].get(ip, 0)
    if ip_n >= 25 or _fails["n"] >= 500:
        return 429, {"error": "too many attempts; try again later"}
    pw = body.get("password")
    if not isinstance(pw, str) or len(pw) > 256 or not check_password(pw):
        _fails["n"] += 1
        _fails["at"] = now
        if len(_fails["ip"]) < 10000:
            _fails["ip"][ip] = ip_n + 1
        time.sleep(min(0.4 * (2 ** min(ip_n + 1, 4)), 6))
        print(json.dumps({"evt": "login_fail", "ip": ip, "fails": ip_n + 1}))
        return 401, {"error": "wrong password"}
    _fails["ip"].pop(ip, None)
    token, exp = make_token()
    print(json.dumps({"evt": "login_ok", "ip": ip}))
    return 200, {"token": token, "exp": exp}


def h_state(_body):
    return 200, {"data": load_data(), "cdnBase": os.environ["CDN_BASE_URL"].rstrip("/")}


def h_presign(body):
    kind = s(body.get("kind"), 12)
    if kind not in TYPES:
        raise Bad("kind must be audio|video|worksheet")
    ctype = s(body.get("contentType"), 100)
    ext = TYPES[kind].get(ctype)
    if not ext:
        raise Bad(f"content type {ctype} not allowed for {kind}")
    size = int(body.get("size", 0))
    if not (0 < size <= SIZE_CAPS[kind]):
        raise Bad(f"size must be 1..{SIZE_CAPS[kind]} bytes")
    pk = valid_page_key(body.get("pageKey"))
    key = f"{UPLOAD_PREFIX}{kind}/{slug(pk)}/{int(time.time())}-{secrets.token_hex(4)}.{ext}"
    if size <= MULTIPART_THRESHOLD:
        url = s3().generate_presigned_url(
            "put_object", Params={"Bucket": bucket(), "Key": key, "ContentType": ctype},
            ExpiresIn=PRESIGN_TTL)
        return 200, {"mode": "single", "key": key, "url": url}
    up = s3().create_multipart_upload(Bucket=bucket(), Key=key, ContentType=ctype)
    return 200, {"mode": "multipart", "key": key, "uploadId": up["UploadId"], "partSize": PART_SIZE}


def h_sign_part(body):
    key = s(body.get("key"), 300)
    if not UPLOAD_KEY_RE.match(key):
        raise Bad("bad upload key")
    part = int(body.get("partNumber", 0))
    if not (1 <= part <= 10000):
        raise Bad("bad partNumber")
    url = s3().generate_presigned_url(
        "upload_part",
        Params={"Bucket": bucket(), "Key": key, "UploadId": s(body.get("uploadId"), 500),
                "PartNumber": part},
        ExpiresIn=PRESIGN_TTL)
    return 200, {"url": url}


def h_complete(body):
    key = s(body.get("key"), 300)
    if not UPLOAD_KEY_RE.match(key):
        raise Bad("bad upload key")
    parts = body.get("parts")
    if not isinstance(parts, list) or not (1 <= len(parts) <= 10000):
        raise Bad("bad parts")
    plist = [{"PartNumber": int(p["PartNumber"]), "ETag": s(p.get("ETag"), 100)} for p in parts]
    s3().complete_multipart_upload(Bucket=bucket(), Key=key,
                                   UploadId=s(body.get("uploadId"), 500),
                                   MultipartUpload={"Parts": plist})
    return 200, {"ok": True, "key": key}


def h_abort(body):
    key = s(body.get("key"), 300)
    if not UPLOAD_KEY_RE.match(key):
        raise Bad("bad upload key")
    s3().abort_multipart_upload(Bucket=bucket(), Key=key, UploadId=s(body.get("uploadId"), 500))
    return 200, {"ok": True}


def h_mutate(body):
    ops = body.get("ops")
    if not isinstance(ops, list) or not (1 <= len(ops) <= 20):
        raise Bad("ops must be a list of 1..20")
    d = load_data()
    for op in ops:
        if not isinstance(op, dict):
            raise Bad("each op must be an object")
        apply_op(d, op)
    save_data(d)
    return 200, {"data": d}


def h_delete_object(body):
    key = s(body.get("key"), 300)
    if not UPLOAD_KEY_RE.match(key):
        raise Bad("only admin-uploaded objects can be deleted")
    d = load_data()
    blob = json.dumps(d)
    if key in blob:
        raise Bad("object is still referenced; remove it from the page first")
    s3().delete_object(Bucket=bucket(), Key=key)
    return 200, {"ok": True}


ROUTES = {
    ("POST", "/login"): None,  # unauthenticated, special-cased
    ("GET", "/state"): h_state,
    ("POST", "/presign"): h_presign,
    ("POST", "/sign-part"): h_sign_part,
    ("POST", "/complete"): h_complete,
    ("POST", "/abort"): h_abort,
    ("POST", "/mutate"): h_mutate,
    ("POST", "/delete-object"): h_delete_object,
}


# ---------- http plumbing ----------

def cors_headers(origin):
    allowed = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    h = {"Content-Type": "application/json; charset=utf-8",
         "Cache-Control": "no-store",
         "X-Content-Type-Options": "nosniff"}
    if origin in allowed:
        h.update({"Access-Control-Allow-Origin": origin,
                  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                  "Access-Control-Allow-Headers": "content-type,authorization",
                  "Access-Control-Max-Age": "86400"})
    return h


def resp(status, obj, origin):
    return {"statusCode": status, "headers": cors_headers(origin),
            "body": json.dumps(obj, ensure_ascii=False)}


def lambda_handler(event, _context):
    http = (event.get("requestContext") or {}).get("http") or {}
    method = http.get("method", "GET")
    path = event.get("rawPath") or http.get("path") or "/"
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    origin = headers.get("origin", "")
    ip = http.get("sourceIp", "")

    if method == "OPTIONS":
        return {"statusCode": 204, "headers": cors_headers(origin), "body": ""}

    body = {}
    if method == "POST":
        raw = event.get("body") or ""
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8", "replace")
        if len(raw) > 1_000_000:
            return resp(413, {"error": "body too large"}, origin)
        try:
            body = json.loads(raw) if raw else {}
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return resp(400, {"error": "invalid JSON"}, origin)

    if (method, path) == ("POST", "/login"):
        code, out = h_login(body, ip)
        return resp(code, out, origin)

    fn = ROUTES.get((method, path))
    if fn is None:
        return resp(404, {"error": "not found"}, origin)

    auth = headers.get("authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    if not check_token(token):
        return resp(401, {"error": "not signed in"}, origin)

    try:
        code, out = fn(body)
        return resp(code, out, origin)
    except Bad as e:
        return resp(400, {"error": str(e)}, origin)
    except Unavailable as e:
        return resp(503, {"error": str(e)}, origin)
    except Exception as e:
        print(json.dumps({"evt": "server_error", "path": path, "err": repr(e)[:500]}))
        return resp(500, {"error": "server error"}, origin)
