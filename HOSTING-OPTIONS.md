# Hosting & storage options — going live

Research + recommendation for serving the Daf Yomi site in production.
Prices are **2026**, USD unless noted; Hetzner is EUR ex-VAT (≈×1.08 for USD).
Nothing here has been provisioned — this is research only.

## Our actual requirements

| Need | Value |
|---|---|
| Static media (audio) | **~38 GB** (1,389 shiurim, all trimmed & local now) |
| Static media (video) | **~221 GB** (~1,127 shiurim, not yet downloaded) |
| **Total media** | **~260 GB**, growing ~1 daf/day (audio ~40 MB/day, video ~290 MB/day) |
| Static app | tiny: HTML/JS + daf-text JSON (~65 MB) + library.json |
| Playback | **HTTP Range / seek required** for `<audio>`/`<video>` |
| Egress | **could spike if popular → egress cost is the dominant risk** |
| Migration | manifest already uses relative paths + one-line `mediaBaseUrl`; S3 uploader (`backfill_cloud.py`) is built and dormant |

The egress requirement is what decides this. Media is static and the storage
bill is trivial at 260 GB everywhere (~$2–4/mo). What varies by 100× is **what
happens to the bill when a video goes around the community**.

---

## Category 1 — Object storage + CDN

| Option | Storage @260 GB/mo | Egress terms | Range? | Setup | Fits our design? |
|---|---|---|---|---|---|
| **Cloudflare R2** | $0.015/GB → **~$3.90** | **$0 egress, always** (incl. r2.dev + custom domain). Ops: GetObject $0.36/M | ✅ native | Easy: bucket + token + public URL | **Perfect** — uploader + `mediaBaseUrl` already target it |
| **Backblaze B2 + Cloudflare** | $6/TB → **~$1.56** | Free egress via Cloudflare Bandwidth Alliance… **BUT** Cloudflare free/Pro/Business TOS forbids serving **video** off the CDN unless it's on R2/Stream | ✅ | Medium: bucket + CF domain + cache rules | S3-compatible (one config change) — **but video TOS risk** |
| **Backblaze B2 + bunny.net** | $6/TB → **~$1.56** | bunny CDN egress **~$0.005–0.01/GB**, no video restriction | ✅ | Medium: B2 + bunny pull zone | S3-compatible; clean for media |
| **bunny.net (storage + CDN)** | HDD $0.01/GB → **~$2.60** | CDN **~$0.005–0.01/GB**, $1/mo min, media-built | ✅ native | Easy: storage zone + pull zone | S3-ish (its own API); media-optimized |
| **Wasabi** | $6.99/TB, **1 TB minimum → $6.99 floor** | "Free" egress but **1:1 ratio cap** — if monthly downloads > stored volume they throttle/contact you | ✅ | Medium | S3-compatible — **but the ratio cap is dangerous for a popular public video site** |
| **AWS S3 + CloudFront** | S3 $0.023/GB → **~$6** | CloudFront **$0.085/GB** after 1 TB free; S3→CF transfer free | ✅ | Higher (IAM, distribution, OAC) | S3-compatible — **egress cost balloons on spikes** |

**Egress reality at scale** (say a popular month does **2 TB** of downloads):
- R2: **$0** extra. bunny: ~$10–20. B2+Cloudflare: $0 *(audio only; video disallowed on free CDN)*. Wasabi: risk of throttling once downloads > storage. **S3+CloudFront: ~$170.**

CloudFront/S3 is the cautionary tale — a single viral shiur could cost more than a year of R2.

## Category 2 — Cheap VPS / storage VPS

| Option | ~Monthly @260 GB | Bandwidth | Range? | Notes |
|---|---|---|---|---|
| **Hetzner CX23 + Volume** | €3.99 VPS + €0.057/GB×260 = **€14.87 → ~€19 (~$20)** | 20 TB incl., then €1/TB | ✅ via nginx | You run/patch/secure the box. Disk grows at €57/TB. |
| **Hetzner Storage Box (BX31, 10 TB)** | **€20.80, unlimited traffic** | unlimited | ⚠️ | **Not a public web origin** — WebDAV/SFTP/Samba only, auth required; can't serve `<video>` to browsers directly. Backup target or origin *behind* a VPS only. |
| **Contabo Storage VPS** | ~$8 (400 GB SSD, "unlimited" traffic) | fair-use, 200 Mbit–1 Gbit | ✅ via nginx | Cheap big disk, but shared/variable perf; you operate it; fair-use throttling under real load. |
| **OVH / DigitalOcean** | DO Spaces $5 (250 GB, 1 TB egress) then $0.01/GB | metered | ✅ | DO Spaces is S3-compatible + CDN; fine but egress metered and pricier than R2 at scale. |

VPS routes cost **more money and add ops burden** (OS updates, nginx, TLS, disk
management, backups, monitoring) for a workload that is 100% static files. And you
**still can't legally put Cloudflare's free CDN in front for video** — so a spike
hits the VPS's own bandwidth/CPU. Only worth it if we want a general-purpose
server for other reasons. Hetzner Storage Box looks cheapest per-GB but **cannot
serve the player directly** — disqualified as an origin.

## Category 3 — Hybrid (recommended shape)

**Media on R2 + app on Cloudflare Pages.**
- Media (260 GB, the only thing that's big or spiky) → **R2**: ~$3.90/mo, $0 egress.
- Static app (HTML/JS/JSON, tiny) → **Cloudflare Pages** (free tier: unlimited
  static requests, global CDN) — or just keep serving it from the current tunnel /
  any cheap host. The app is small and cacheable; its hosting is nearly free anywhere.

This isolates the cost/risk (media egress) onto the one provider that makes it
free, and keeps the app deployment trivial.

---

## 🏆 Top recommendation: **Cloudflare R2** (media) + Cloudflare Pages (app)

**Why it wins for us specifically:**
1. **Zero egress, forever** — the single most important property given "bandwidth
   could spike if popular." A viral shiur costs us **$0** in transfer. Every
   metered option (S3/CloudFront, bunny, DO) turns popularity into a bill.
2. **Cost is trivial and predictable:** ~**$3.90/mo** at 260 GB; ~$15/mo if we
   ever hit 1 TB. Plus negligible operations ($0.36 per million GETs).
3. **No video TOS landmine** — R2 is Cloudflare's *sanctioned* way to serve video
   on non-Enterprise plans (the thing that disqualifies B2+Cloudflare-free).
4. **Range/seek works out of the box.**
5. **Zero migration code** — our `backfill_cloud.py` uploader and the
   `mediaBaseUrl` switch were built for exactly this. Going live is config, not code.
6. **Simple to operate** — no server to patch; reuses the already-installed `aws` CLI.

**Rough total:** **~$4/month** now (audio-only on R2), **~$8/month** with all
video (~260 GB), and it stays ~flat regardless of traffic.

## 🥈 Runner-up: **bunny.net** (storage zone + CDN)

If for any reason we don't want to consolidate on Cloudflare: bunny is purpose-
built for media, dead simple, ~**$2.60/mo storage** + **~$0.005–0.01/GB egress**
(no video restriction, Range supported). Total likely **~$5–10/mo** at modest
traffic. The only downside vs R2 is that **egress is metered** — cheap, but a real
spike still costs money where R2's wouldn't. Our S3-style uploader adapts with a
config change.

*(Skip as primary: AWS S3+CloudFront — egress risk; Wasabi — 1:1 egress cap is
hazardous for a public video site; VPS/Storage Box — more ops, no egress upside,
Storage Box can't even serve the player.)*

---

## Migration plan (when you say go) — R2 path

1. **Create** an R2 bucket (e.g. `shea-stern-media`) + an R2 API token (Object
   Read & Write), and enable the bucket's **Public Development URL** (`pub-<hash>.r2.dev`)
   or bind a custom domain.
2. **Configure** (git-ignored): `cp build/cloud.config.example build/cloud.config`
   and fill in endpoint / bucket / keys / `CDN_BASE_URL`. Then `python3 build/cloud.py check`.
3. **Upload** the local store: `python3 build/backfill_cloud.py --all`
   (mirrors `media/<id>.mp3|mp4` → bucket; idempotent, resumable). Audio is ready now (~37 GB).
4. **Flip the switch:** set `data/content.json` → `options.mediaBaseUrl` to the R2
   public base. **One line, no reprocessing.** Site now streams from R2.
5. **(Optional) App on Pages:** push the static files to Cloudflare Pages and point
   DNS; or keep the current serving for now.
6. **Video:** run `python3 build/backfill.py --all` on a machine with enough disk
   (or stream-to-bucket) to fetch+trim the ~221 GB of video, then
   `backfill_cloud.py --all` to push it. R2 storage for that is ~$3.30/mo extra.

The hourly `refresh.py` already auto-detects `cloud.config` and uploads new daily
shiurim to the same bucket going forward.

### Cost summary (R2, monthly)

| Stage | Storage | Egress | ~Total |
|---|---|---|---|
| Audio only (38 GB) | $0.57 | $0 | **~$1** |
| Audio + video (260 GB) | $3.90 | $0 | **~$4** |
| Grown to 1 TB | $15 | $0 | **~$15** |
| A viral month (+2 TB downloads) | unchanged | **$0** | unchanged |

---

*Sources: Cloudflare R2 pricing & video TOS, Backblaze B2, Wasabi, AWS S3/CloudFront,
bunny.net, Hetzner, Contabo (2026). Links in the commit message / chat.*
