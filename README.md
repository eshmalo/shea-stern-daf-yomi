# Rabbi Shea Stern · Daf Yomi — native concept

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

## Cloud storage + CDN (durable, full back-catalog)

The full self-hosted library (~60 GB+, incl. ~1,129 videos) lives in S3-compatible
object storage behind a CDN; the manifest stores absolute CDN URLs and the app
plays them directly (no app code change — it already reads `manifest.audio/video`
verbatim).

**Recommended provider: Cloudflare R2** — S3-compatible (reuses the installed
`aws` CLI), **zero egress fees**, and a built-in public URL (`pub-<hash>.r2.dev`)
so no separate domain/CDN wiring is needed. (Backblaze B2 + Cloudflare is the
budget alternative; AWS S3 + CloudFront works too but egress costs money.)

**Setup (one time):** copy `build/cloud.config.example` → `build/cloud.config`
(git-ignored) and fill in the bucket/keys/CDN base, then:

```bash
python3 build/cloud.py check                       # verify config + bucket reachable
python3 build/backfill_cloud.py --ids 1,2,3,4,5    # small proof batch
python3 build/backfill_cloud.py --all              # full back-catalog (resumable)
```

`backfill_cloud.py` is **resumable & idempotent**: it skips anything already
uploaded (manifest CDN URL; `--verify` HEAD-checks; `--force` redoes), writes the
manifest atomically after **each** item, and logs to `build/backfill.log`. It
uploads an existing local trimmed copy if present, else downloads → trims the
~7.5s intro → uploads. When `cloud.config` is present, the hourly `refresh.py`
automatically routes new shiurim to the bucket/CDN instead of local disk.

> Secrets live only in `build/cloud.config` or env vars — **never committed**
> (git-ignored). `aws` calls pass only these scoped keys and don't touch other
> AWS credentials on the machine.

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
