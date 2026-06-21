# Rabbi Shea Stern · Daf Yomi — native concept

> ## 📌 TODO (deferred): go live on Cloudflare R2 + Pages
> Deploy the full self-hosted library live on **Cloudflare R2 + Pages**. Audio (all
> 1,389 shiurim, ~37 GB) is already trimmed and local; the ~221 GB video goes
> straight to R2. **Blocked on:** user creating the Cloudflare account / R2 bucket
> + API token + public URL and entering payment. **When ready:** fill
> `build/cloud.config`, run `backfill_cloud.py --all` (audio) + the video backfill
> to R2, set `mediaBaseUrl`, optionally move the app to Cloudflare Pages. Migration
> steps are in **[HOSTING-OPTIONS.md](HOSTING-OPTIONS.md)**.
> *(Until then, the local-first store + hourly auto-update keep running as-is.)*

A daf-first Daf Yomi app for Rabbi Shea Stern, in a **clean "LaTeX-classic"** style
(white paper, black serif, restrained). It is built to be **native and independent** —
the daf, the audio, and the video are all served from our own files; nothing opens an
external site.

## Native & independent

- **The daf, in our own text.** "Read the daf" renders the actual gemara — Hebrew
  (William Davidson Aramaic) + English (Steinsaltz) — from `data/daf/<Masechta>.json`,
  which we generate from a local Sefaria library. Toggle עברית / English / **Both**
  (Both interleaves each segment with its translation). Every daf of Shas is readable,
  even ones the Rabbi hasn't given yet.
- **Our own media, intro removed.** TorahAnytime prepends a ~7.5s intro to every file;
  `build/selfhost_media.py` downloads the audio/video, **cuts the intro** (ffmpeg), and
  serves our copy (`media/`), marked "intro removed ✓". Where we haven't self-hosted yet,
  it falls back to streaming TorahAnytime's file *inline* (never a new tab).
- **No external links.** No "open on TorahAnytime / HebrewBooks / Sefaria." (HebrewBooks
  can't be embedded anyway — it blocks framing and bot fetches — which is exactly why we
  render the text ourselves.) Sources are credited under each daf.

## What it does

- **Today's Daf** — yesterday / today / tomorrow, from the worldwide Daf Yomi calendar.
- **Browse Shas** — every masechta, every daf, all tappable. Dapim the Rabbi has given
  are marked; tap any daf to read it.
- **Daf page** — Listen (native player), Watch (native video), Save, the native daf text,
  and a **Sponsor** prompt — prominent on un-given dafs, subtle where a shiur exists.
- **Sponsor** — dedicate today's daf, a future daf (date → that day's daf), or a whole
  masechta; composes a dedication email + Zelle handoff.
- **Hebrew / Gregorian** date toggle (default Gregorian); search; My Stuff; Donate (Zelle).
- **Auto-updating** — the shiur list refreshes from TorahAnytime's public API with a
  committed snapshot fallback.

## Build / data pipelines

```bash
# native daf text (Hebrew + English) for all 37 Bavli masechtos -> data/daf/*.json
python3 build/extract_daf_text.py --khk "/path/to/Sefaria/library"

# self-host media with the intro cut -> media/ + media/manifest.json
python3 build/selfhost_media.py --limit 8                 # newest 8, audio
python3 build/selfhost_media.py --ids 457569 --kind video # video (also +faststart)

# refresh the committed library snapshot
python3 build/fetch_library.py --speaker 587
```

## Run / serve

Use the **Range-capable** static server so audio/video seek properly:

```bash
python3 ../stern-demo/serve_range.py 4322 .
```

(Plain `python3 -m http.server` works for everything except media seeking.)

## Auto-update (hourly, end-to-end)

`build/refresh.py` is the one-command pipeline: **pull his TA page → detect newly
posted shiurim → self-host them with the intro cut → update `manifest.json` +
`library.json`**. It only processes shiurim that are *new since the last snapshot*
and not already in the manifest, so a normal run trims just the latest daf and
disk use stays bounded.

```bash
python3 build/refresh.py                 # snapshot + self-host any new shiurim (audio+video)
python3 build/refresh.py --snapshot-only # refresh the catalog only
python3 build/refresh.py --backfill 25   # ALSO host 25 of the oldest not-yet-hosted (opt-in)
```

**Installed hourly via launchd** (macOS): `~/Library/LaunchAgents/com.sheastern.dafyomi.refresh.plist`
(reference copy committed at `build/com.sheastern.dafyomi.refresh.plist`),
`StartInterval = 3600`, `RunAtLoad = true`. Logs: `build/refresh.log` (per-run)
and `build/launchd.{out,err}.log` (all `*.log` git-ignored).

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sheastern.dafyomi.refresh.plist  # install
launchctl list | grep sheastern                                                              # verify loaded
launchctl kickstart -k gui/$(id -u)/com.sheastern.dafyomi.refresh                            # run now
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.sheastern.dafyomi.refresh.plist    # uninstall
```

> Note: the hourly job keeps the catalog 100% current and self-hosts shiurim
> **going forward**. It does **not** backfill the full back-catalog by default —
> self-hosting all ~1,389 shiurim is ~60 GB+ and belongs on S3/B2+CDN (see below),
> not the laptop. Use `--backfill N` to chip away at the backlog deliberately.

## Local-first media store (current) + one-line go-live switch

Everything we need to operate is stored **locally** under `media/`, intro-trimmed,
and the design is built so flipping to a real server later is **config-only — no
reprocessing, no code changes.**

**Portable manifest.** `media/manifest.json` stores **relative** paths
(`media/<id>.mp3`). The app resolves each through `options.mediaBaseUrl`
(`data/content.json`):

- `mediaBaseUrl: ""` → serve the self-hosted files from **this site** (local). ← current
- `mediaBaseUrl: "https://media.example.com"` → serve the **same files** from a
  server/CDN. That single line is the entire go-live change.

**Full local backfill** — `build/backfill.py` downloads + trims the whole
back-catalog into `media/`:

```bash
python3 build/backfill.py --all --no-video        # all audio (~38 GB)  ← running
python3 build/backfill.py --all                   # audio + video (~260 GB total — needs a big disk)
python3 build/backfill.py --limit 20              # newest 20 not-yet-done
```

It is **resumable & idempotent** (skips ids already trimmed locally + recorded),
writes the manifest **atomically after each item**, logs to `build/backfill.log`,
and has a **disk-floor guard** (`--min-free-gb`, default 15) that stops gracefully
before filling the drive — just re-run to continue. The hourly `refresh.py` uses
the same engine for new shiurim.

> **Size reality (measured):** audio ≈ 96 kbps → **~38 GB** for all 1,389; video
> ≈ 651 kbps → **~221 GB**. Audio fits a laptop comfortably; the full video set
> needs a dedicated disk or cloud (below).

### Going live later (the dormant cloud uploader)

The S3-compatible uploader is committed and **inert until configured**:

```bash
cp build/cloud.config.example build/cloud.config   # fill in bucket/keys/CDN (git-ignored)
python3 build/cloud.py check                        # verify bucket reachable
python3 build/backfill_cloud.py --all              # mirror local media/ -> bucket (keys: media/<id>.<ext>)
# then set data/content.json options.mediaBaseUrl = "https://<your-cdn-base>"   # one line, done
```

**Recommended provider: Cloudflare R2** — S3-compatible (reuses the installed
`aws` CLI), **zero egress**, built-in public URL (`pub-<hash>.r2.dev`, no domain
needed). B2+Cloudflare or AWS S3+CloudFront also work (same code, different
config). See **[HOSTING-OPTIONS.md](HOSTING-OPTIONS.md)** for the full 2026
pricing comparison + recommendation. `backfill_cloud.py` only *uploads files* (skips objects already present);
it does **not** rewrite the manifest — paths stay relative, so the flip is purely
`mediaBaseUrl`. Secrets live only in `build/cloud.config`/env, **never committed**.

## Scale note

The native daf text is the full Bavli (~65 MB, on-demand per masechta). Self-hosting the
**entire** audio/video library is ~60 GB+ — `selfhost_media.py` is the engine for it, but
the full set belongs on real storage (S3 / Backblaze B2 + CDN); a laptop can host a demo
subset. `options.preferSelfHosted` (content.json) controls local-vs-stream.

## Source control / backup

This project is a git repo, backed up to a **private** GitHub remote:
**https://github.com/eshmalo/shea-stern-daf-yomi** (`origin/main`).

The heavy self-hosted media (`media/*.mp3|mp4`, ~554 MB locally / ~60 GB+ at full
scale) is **excluded by `.gitignore`** and regenerated with `build/selfhost_media.py`;
only `media/manifest.json` is tracked. Everything else — the app source, the full
native daf text (`data/daf/*.json`, ~65 MB), the `data/library.json` catalog
fallback, `data/content.json`, and the build pipelines — is committed so the
content is fully preserved.

```bash
git add -A && git commit -m "..." && git push      # back up changes
```

## Files

```
index.html · styles.css (LaTeX-classic)
dafyomi.js     Shas engine (40 masechtos, Sefaria-verified)
hebrewcal.js   exact Hebrew calendar + gematria
app.js         data, router, native daf, player, video, sponsor
data/library.json   snapshot      data/content.json   editable content
data/daf/*.json     native daf text (+ _index.json)
media/*.mp3|mp4 + manifest.json    our intro-trimmed media
build/extract_daf_text.py · selfhost_media.py · fetch_library.py
```

*Talmud text: William Davidson Edition, Sefaria — Hebrew public domain; English ©
Rabbi Adin Even-Israel Steinsaltz, CC-BY-NC. Shiur audio/video © the speaker / TorahAnytime.*
