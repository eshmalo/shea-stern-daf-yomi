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

## Scale note

The native daf text is the full Bavli (~65 MB, on-demand per masechta). Self-hosting the
**entire** audio/video library is ~60 GB+ — `selfhost_media.py` is the engine for it, but
the full set belongs on real storage (S3 / Backblaze B2 + CDN); a laptop can host a demo
subset. `options.preferSelfHosted` (content.json) controls local-vs-stream.

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
