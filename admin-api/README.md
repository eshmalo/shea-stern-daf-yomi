# Admin API — monseydafyomi.com

The backend for **`/admin/`** on the site: Rabbi Stern signs in with one admin
password and can, for **any page** (daf / parsha / yom tov):

- **upload or replace the audio and video** (his upload outranks the pipeline's
  copy and the TorahAnytime fallback), and
- **attach worksheets / source sheets** (PDF, picture, Word, PowerPoint) which
  appear on that page under **"Worksheets & sources"** with Open + Download.

## How it works

```
admin/ (GitHub Pages) ──login/presign/mutate──► AWS Lambda (this folder)
        │                                          │ signs uploads, validates ops
        │  file PUT (presigned, direct)            ▼
        └────────────────────────────────► Cloudflare R2 bucket
                                              ├─ site/uploads/…      (the files)
                                              ├─ site/admin-data.json (what's attached where)
                                              └─ site/history/…      (every prior version)
public site (app.js) ◄─── reads site/admin-data.json + files from the R2 CDN
```

- **Nothing here touches git or the hourly pipeline** — admin data lives only
  under the R2 `site/` prefix, which no pipeline script ever writes or deletes.
- Files upload **browser → R2 directly** with presigned URLs (multipart above
  95 MB), so multi-GB videos work and the Lambda never proxies bytes.
- `site/admin-data.json` is schema-validated on every write; every version is
  kept in `site/history/`. To roll back, copy a history file over the live key.

## Security model

- Single admin password (3 words + 6 hex chars ≈ 37 bits) → PBKDF2-SHA256
  (600k iterations) hash in the Lambda env; login is throttled per-IP with a
  global cap. The throttle is per-warm-container (documented residual risk) —
  the password entropy × PBKDF2 cost is the real defense, and
  `deploy.sh --new-password` also rotates SESSION_SECRET, killing all sessions.
- Sessions are stateless HMAC tokens (12 h). CORS is locked to the site origins.
- A corrupt or unreadable admin-data.json makes the API refuse writes (503)
  rather than ever overwriting the live file with an empty one.
- Accepted single-admin trade-offs: declared upload sizes are advisory
  (presigned PUT cannot bind length), and concurrent mutates are last-write-wins.
- Presigned uploads only mint keys under `site/uploads/<kind>/…`; manifest
  entries may only reference `site/uploads/`, `media/`, or `archive/` keys that
  actually exist; deletes only work on unreferenced `site/uploads/` objects.
- The public site treats admin-data as untrusted: keys are allowlist-checked
  again client-side and all text is HTML-escaped.

## Operate

```bash
python3 admin-api/test_lambda_function.py   # unit tests (no AWS needed)
admin-api/deploy.sh                          # deploy/update (idempotent)
admin-api/deploy.sh --new-password           # rotate the admin password
```

`deploy.sh` reads R2 creds from `build/cloud.config`, keeps generated secrets in
`admin-api/.secrets` (git-ignored), creates/updates Lambda `dafyomi-admin-api`
(us-west-2, public function URL) and sets the R2 bucket CORS. After the first
deploy, paste the printed URL into `admin/config.js`.

Logs: CloudWatch group `/aws/lambda/dafyomi-admin-api` (login_ok / login_fail
events include the source IP).
