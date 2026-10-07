# Rabbi Shea Stern · Daf Yomi

**Live at <https://monseydafyomi.com>.** This is a daf-first Daf Yomi site for Rabbi Shea
Stern, in a clean "printed sefer" style (warm paper, black serif, maroon rubric). It is
**native and independent**: the daf text, the audio and the video are all served from our
own copies, and nothing opens an external site.

> **Current state (reconciled 2026-10-07).** Earlier versions of this README said cloud
> hosting was deferred and that the full audio library sat on this laptop. Neither is true
> any more:
>
> - **Hosting.** The site is served by **GitHub Pages** from `main` (legacy build, repo root)
>   of the public repo `eshmalo/shea-stern-daf-yomi`. The custom domain is set in `CNAME`
>   (`monseydafyomi.com`), HTTPS is enforced, and `.nojekyll` keeps `_index.json` visible.
> - **Media.** All self-hosted audio and video streams from a **Cloudflare R2** public bucket.
>   `data/content.json` → `options.mediaBaseUrl` = `https://pub-b220b8133d864a38af9b5ab5144ff375.r2.dev`.
>   The switch went live on 2026-06-21 (commit `8a1b92d`, "Native rebuild + R2 go-live").
> - **Local `media/`** now holds only `manifest.json`. No MP3/MP4 files are kept locally; the
>   trimmed copies exist on R2.
> - **Admin.** The Rov edits the site at <https://monseydafyomi.com/admin/> (live since
>   2026-08-09). There is a guide for him in [ADMIN-GUIDE.md](ADMIN-GUIDE.md), and the
>   backend architecture is in [admin-api/README.md](admin-api/README.md).
> - **Automation.** An hourly launchd job runs `build/update_all.py`. It picks up new
>   shiurim, processes them to R2, mirrors Sefaria once a day, and pushes the refreshed data
>   to GitHub, which redeploys the site. The receipts are listed below.

## Native & independent

- **The daf, in our own text.** "Read the daf" renders the gemara itself: the Hebrew/Aramaic
  William Davidson text and Steinsaltz's English, from `data/daf/<Masechta>.json`. Rashi and
  Tosafos come from `data/daf/<Masechta>.comm.json`, laid out in the classic tzuras hadaf. The
  Chumash (with Onkelos and Rashi) comes from `data/torah/<Sefer>.json`. All of it is
  generated from local Sefaria exports, so every daf of Shas can be read, including dapim the
  Rov has not given yet.
- **Our own media, intro and watermark removed.** TorahAnytime puts a ~7.5s intro at the
  start of every file and overlays a logo on its video. The pipeline cuts the intro, blurs
  the logo out of the video (with a delogo box chosen per video format), and uploads our copy
  to R2. Where the Rov's **original recording** of a daf exists, it is preferred over the
  TorahAnytime-sourced copy (`data/orig_audio.json`: 1,971 dafim across 35 masechtos, on R2
  under `media/orig/`). TorahAnytime's own file is only an inline fallback, never a new tab,
  and when it is used the intro is skipped client-side.
- **No external links.** There are no "open on TorahAnytime / HebrewBooks / Sefaria" links.
  One CC-BY-NC credit appears on the About page.

**Which audio plays.** The order is `app.js` `playId()`:
1. the Rov's admin replacement for the page,
2. his replacement for that shiur,
3. his original recording (`orig_audio.json`),
4. the pipeline's trimmed copy (`media/manifest.json`),
5. the TorahAnytime stream.

Video follows the same order without step 3. `options.preferSelfHosted` (in `content.json`)
can turn the self-hosted tiers off.

## What it does

- **Today's daf.** Shows yesterday, today and tomorrow from the worldwide Daf Yomi calendar.
- **Navigation.** A box drill-down goes seder → masechta → daf, plus Chumash → parsha and
  Yomim Tovim. A folio picker on the running head jumps anywhere in Shas without stopping the
  shiur.
- **Daf page.** Listen and Watch both drive one persistent bottom transport, which keeps
  playing while you read. The page also has Save, the native daf text (Hebrew / English /
  both), worksheets attached by the Rov, and a Sponsor prompt.
- **Playback care.** Playback resumes where you left off and reports your position to the
  lock screen and watch through the Media Session API. Finishing a shiur marks the daf
  learned and offers the next one. A stream that **stalls** mid-shiur reconnects by itself
  (see below).
- **Other features.** Sponsor/dedicate (composes an email and hands off to Zelle), a Hebrew
  or Gregorian date toggle, search, My Learning, and Donate.
- **Self-updating catalog.** The browser refreshes the shiur list from TorahAnytime's public
  API and falls back to the committed `data/library.json` snapshot.

## The hourly pipeline (what actually runs)

The job is installed via launchd as `~/Library/LaunchAgents/com.sheastern.dafyomi.refresh.plist`,
with a reference copy at `build/com.sheastern.dafyomi.refresh.plist`. It runs
`build/update_all.py` with `StartInterval = 3600` and `RunAtLoad = true`. A lock file
(`build/.update_all.lock`) ensures only one run at a time.

Each run does three things, in order:

1. **Lectures, every run.** `build/refresh.py` pulls the catalog (`fetch_library.py` →
   `data/library.json`) and diffs it against the previous snapshot. If R2 is configured in
   `build/cloud.config` (it is), each new shiur goes through `build/stream_to_cloud.py`:
   download → cut the intro → de-watermark the video → upload to R2 → update
   `media/manifest.json` with relative paths. Only one temp file is on disk at a time.
2. **Sefaria texts, at most once per UTC day.** `build/fetch_sefaria.py --prefixes json/,schemas/`
   mirrors into `~/Desktop/AI Workspace/Sefaria-Export`. A successful mirror does **not**
   rebuild `data/daf/*.json`; that is still a manual `extract_daf_text.py` run (an open item).
3. **Publish.** It stages and commits **only** `data/library.json`, `data/orig_audio.json`
   and `media/manifest.json` as `auto: refresh library + media manifest`, fetches, runs
   `git pull --rebase --autostash`, and pushes `origin main`. GitHub Pages redeploys on that
   push. If an earlier push failed, the next run retries it even when no new data arrived
   (fixed 2026-10-07; before that, a stranded commit waited for the next data change.
   TorahAnytime rotates the tokenized audio/video URLs in `library.json` about every three
   hours, so that was usually within three hours, not until the next new shiur).
   - **Push protection.** If GitHub push protection rejects the push (as it did 09-11 → 09-17,
     see the receipts), retrying cannot help, because every later push still carries the
     flagged commit. So when every unpushed commit is an `auto:` data commit, the job runs
     `git reset --soft origin/main`, recommits the *current* data files as one fresh `auto:`
     commit, and pushes once. If that is rejected too (the current URLs still match), it logs
     "rejected the fresh commit too … Stopping (no loop)" and the next run squashes again
     with newer data. Added 2026-10-07; tested in `tests/test_update_all_publish.py`.
   - **Only its own commits.** It pushes only when every unpushed commit is an `auto:` data
     commit. Otherwise it logs "unpushed non-data commits; not pushing" and leaves them
     alone (no rebase, no squash) until someone pushes or removes them by hand.

**Hand edits in the live checkout** (`~/dev/shea-stern-daf-yomi`) are never staged by the
job, but its rebase runs in that checkout, and a hand *commit* there stops publishing (see
above). Make code changes in a separate clone or worktree, push them, and let the job's
`pull --rebase` bring them in.

```bash
launchctl list | grep sheastern                                         # loaded? (PID "-" between runs is normal)
launchctl kickstart -k gui/$(id -u)/com.sheastern.dafyomi.refresh       # run now
tail -20 build/update_all.log; tail -20 build/refresh.log               # receipts
python3 build/update_all.py --no-media                                  # catalog + texts only
```

### Receipts (from the git-ignored local logs)

| When (UTC) | Log | What it records |
|---|---|---|
| 2026-07-30 18:54 | `build/refresh.log` | First run in this log, already on the cloud path: "cloud configured -> uploading new shiurim to bucket/CDN (intro-trim + de-watermark)" |
| 2026-09-11 09:35 → 09-17 10:45 | `build/update_all.log`, `launchd.err.log` | 96 runs logged "push failed": **GitHub push protection** rejected every push because a TorahAnytime stream URL in `data/library.json` (commit `d5a11af`) matched the "VolcEngine Access Key ID" pattern. It is a false positive (the match sits inside a `proxier.torahanytime.com` URL). Publishing was stuck for six days. The commit got through at 09-17 11:45 and left secret-scanning alert #1 open. |
| 2026-09-22 20:07, 23:07, 09-23 02:08 | `build/update_all.log`, `launchd.err.log` | 3 more "push failed": git could not get GitHub credentials from the keychain ("failed to get: -25293", "could not read Username … Device not configured"). None since. |
| 2026-10-06 16:25–16:26 | `build/refresh.log` | 1 new shiur (481847, Bechoros 18) → "cloud pass exit (audio 0, video 0)" → "manifest now holds 1477 self-hosted shiurim". The R2 object answered HTTP 200 (49.3 MB) on 2026-10-07. |
| 2026-10-07 00:29:05 | `build/update_all.log` | Sefaria mirror `exit 0` |
| 2026-10-07 01:29:10 | `build/update_all.log` | "publish: pushed data refresh (the live site redeploys)" (commit `0ff3918`) |
| 2026-10-07 03:29:12 | `build/update_all.log` | lectures 0, sefaria skipped (already ran today), "no data changes" |
| 2026-10-07 04:29:23 | `build/update_all.log` | "publish: pushed data refresh" (commit `e26708d`, the parent of `402df5d`) |

**Snapshot on 2026-10-07:**
- `data/library.json` lists **1,506** lectures (`generated_at` 2026-10-07; it is rewritten on every refresh).
- `media/manifest.json` has **1,477** entries: 1,476 with audio and 1,196 with video, every
  video with a delogo box.
- 29 catalog lectures have no manifest entry.

These numbers are manifest metadata, not a fresh audit of every R2 object.

## Stall recovery (P4C-10, 2026-10-07)

Every fetch has had a deadline since August (`fetchT`). A media stream fails differently: it
connects, plays, and then the bytes stop. When that happens the element just waits, with no
`error` and a frozen clock. `stall-model.js` (pure, tested in `tests/stall-model.test.mjs`)
watches for this. `Player` in `app.js` feeds it the media events and acts on what it decides:

- **When it fires.** It waits **20s** with playback wanted, the playhead not moving, and no
  bytes arriving. A slow link that is still downloading pushes the deadline out. A `stalled`
  event that fires while playback continues from the buffer is ignored (`readyState` check).
- **Reconnect.** It reconnects **twice** at the same spot (`load()`, then seek back), keeping
  the playback speed.
- **Fall back.** If our copy still won't play, it switches to the hosted TorahAnytime audio
  at the same point, offset by the intro that copy still carries. This is audio only, the
  same rule the hard-error path uses. That path now also keeps your place instead of
  restarting the shiur.
- **Give up.** If nothing works, it pauses and says so: "The shiur stopped loading … Press ▶
  to try again". The bar and your place stay, and ▶ reconnects immediately.

**Manual check (reproducible).** A test server served a stream that hangs mid-file, and it was
driven in a browser on 2026-10-07. Without the watchdog the clock froze at 18.87s for 25s
after the network came back. With it, playback resumed at 18.94s exactly 20.0s after
stalling. The fallback picked up the hosted copy at 26.37s (18.87 + 7.5). The video give-up
showed the message, and ▶ resumed at 16.34s. Normal playback, seeks, and a 25s pause raised
no false alarms.

## Build / data pipelines (manual)

```bash
# native daf text (Hebrew + English) for all Bavli masechtos -> data/daf/*.json
python3 build/extract_daf_text.py --khk "/Users/elazarshmalo/Desktop/KHK"
python3 build/extract_commentary.py --khk "/Users/elazarshmalo/Desktop/KHK"   # Rashi + Tosafos -> *.comm.json
python3 build/merge_rashbam.py --bava-rashbam <KHK merged.txt> --pesachim-rashbam <KHK merged.txt>   # Rashbam's inner margin
python3 build/extract_torah.py --export "/Users/elazarshmalo/Desktop/AI Workspace/Sefaria-Export/json"

# media (cloud path; reads build/cloud.config — git-ignored, never commit it)
python3 build/cloud.py check                                   # config + bucket reachable
python3 build/stream_to_cloud.py --kind audio --ids 481847      # one shiur -> R2 (trim)
python3 build/stream_to_cloud.py --kind video --ids 481847      # (+ de-watermark)
python3 build/logo_audit.py scan                               # which videos the delogo box misses

# the Rov's original recordings (one-time imports, already done 2026-06-25)
python3 build/upload_originals.py --all; python3 build/archive_to_r2.py; python3 build/verify_hosted.py
```

`backfill.py`, `backfill_cloud.py` and `selfhost_media.py` belong to the **local-first era**
(trim to `media/` on disk, then mirror to a bucket). They still work, but the live pipeline
no longer uses them. [HOSTING-OPTIONS.md](HOSTING-OPTIONS.md) is the June 2026 provider
comparison that led to R2, kept for the record.

## Run locally / tests

```bash
python3 -m http.server 4322          # then open http://localhost:4322
node --test tests/*.test.mjs         # reader, jump/picker, stall watchdog (59 tests)
python3 admin-api/test_lambda_function.py   # admin API, S3 faked in-memory (53 tests)
python3 tests/test_update_all_publish.py    # updater publish(): local bare repo + fake GH013 hook (13 tests)
```

Media streams from R2, which supports Range requests, so seeking works on a plain static
server. The R2 bucket's CORS allows only `https://monseydafyomi.com`, so admin overrides and
worksheets (`site/admin-data.json`) do **not** load on localhost. That is expected.

**Bump the `?v=` cache-buster in `index.html` on every shipped change** to the app's JS or CSS.

## Source control & secrets

- Everything is committed and public: app source, `data/daf/*.json` (~65 MB of native text),
  the `data/library.json` fallback, `data/content.json`, `media/manifest.json`, and the build
  scripts.
- Never committed (`.gitignore`): `build/cloud.config` (R2 keys), `admin-api/.secrets*`,
  `*.log`, media binaries, and caches.
- GitHub secret scanning and push protection are on. One alert is open: #1, "VolcEngine
  Access Key ID" in `data/library.json` (2026-09-17). It is a false positive on a TorahAnytime
  stream URL (see the receipts) and should be dismissed as such.
- The public repo, and therefore the site, also serves `build/*.py` and the Markdown work
  logs. That is cosmetic and contains no secrets. See the open items.

## Where the history and open work live

- [UI-FACELIFT-LOG.md](UI-FACELIFT-LOG.md): the **authoritative open-items list** ("Open
  items — verified status").
- [QA-HARDENING-LOG.md](QA-HARDENING-LOG.md): QA and hardening passes.
- [DAF-PICKER-PLAN.md](DAF-PICKER-PLAN.md): the folio-picker design.

## Files

```
index.html · styles.css · manifest.webmanifest · CNAME · .nojekyll
app.js           data, router, native daf/Chumash readers, player, admin overlays
dafyomi.js       Shas engine          hebrewcal.js   Hebrew calendar + gematria
reader-model.js  reader layout model  jump-model.js  folio-picker / navigation model
stall-model.js   media stall watchdog (pure)
data/library.json  catalog snapshot   data/content.json   editable content + mediaBaseUrl
data/orig_audio.json  per-daf original recordings   data/daf/*.json  data/torah/*.json  native text
media/manifest.json   our trimmed copies (relative paths, resolved against mediaBaseUrl)
admin/ · admin-api/   the Rov's editor + its Lambda backend
build/                pipelines, launchd plist, local logs (git-ignored)
tests/                node --test suites; test_update_all_publish.py (the updater's publish)
```

*Talmud text: William Davidson Edition, via Sefaria. The Hebrew is public domain; the
English is © Rabbi Adin Even-Israel Steinsaltz, CC-BY-NC. Shiur audio/video © the speaker /
TorahAnytime.*
