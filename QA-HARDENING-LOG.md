# QA & Hardening Loop — Shea Stern Daf Yomi

Continuous, section-by-section review / QA / hardening of the full stack.
**Goal:** harden robustness, error-handling, security, accessibility, performance,
and edge-case correctness **without changing features or UI**.

## Rules
- Preserve functionality and visual/UX behavior. Hardening only — no redesigns, no new features.
- Verify every finding against the real code before fixing (no false-positive fixes).
- After any fix touching `app.js` / `styles.css` / a `.js`, bump the `index.html` cache-buster
  and verify in the preview (no console errors, key flows intact).
- Do **not** commit or push without the owner's explicit go-ahead. (Fixes go live via the
  cloudflared tunnel, which serves the working directory directly.)
- Reviewers run on cheap/fast models; fixes are applied + verified in the main thread.

## Section map (one full pass = every section reviewed once)
- **S1** Player & Media Session — media lifecycle, error fallback, MediaSession, leaks, races
- **S2** Boot, routing, history, data load & cache — localStorage, fetch, snapshot/live-fetch
- **S3** Daf rendering & reader — layout, hydrate, scroll memory, swipe, flip, viewport classes
- **S4** Calendar & RTL grid + `hebrewcal.js`
- **S5** Menu, search, editor, donate / Zelle QR
- **S6** `dafyomi.js` — daf calc engine + data integrity
- **S7** `styles.css` — robustness, RTL, accessibility, overflow
- **S8** `index.html` — security headers / CSP, meta, escaping / XSS surface

Severity: **H**igh / **M**edium / **L**ow.  Status: open / fixed / false-pos / deferred.

---

## Pass 1 — started 2026-06-23
| Section | Status | Real findings (H/M/L) | Fixed this pass |
|---|---|---|---|
| S1 | reviewed | 2H · 4M · 3L (3 reviewer claims retracted as non-bugs) | 1 (S1-2) |
| S2 | reviewed | 2H · 4M · 2L | 5 (S2-1,2,3,4,7) |
| S3 | reviewed | 2H · 3M (3 confirmed non-bugs / by-design) | 3 (S3-1,2,3·) |
| S4 | reviewed | 1M · 3L | 4 (S4-1,2,3,4) |
| S5 | reviewed | 4M · 3L | 3 (S5-1,3,4) |
| S6 | reviewed | 2L (engine math verified correct) | 2 (S6-1,2) |
| S7 | reviewed | 1H · 1M · 2L (2 "H" withdrawn — global :focus-visible already present) | 2 (S7-1,6) |
| S8 | reviewed | 1H · 2M · 1L | 2 (S8-2,3) |

Batch 1 (S1–S3) reviewed by 3 parallel Sonnet reviewers; every finding re-verified against
source in the main thread before fixing. 8 distinct fixes applied + verified in preview
(no console errors; daf 53→54 sync works, hydrate gen-guard increments). app.js?v=…**zg**.

### Findings ledger — Pass 1

**Fixed**
- **S3-1 (H)** app.js:765 — `updateFlipUI()` called but never defined → ReferenceError crashed
  `syncInpageRead` on reader close (in-page daf silently stuck). Removed the dead call. *(verified: no throw, 53→54)*
- **S3-2 (H)** app.js:507 — `hydrateDaf` had no stale-render guard; overlapping flips could leave the
  daf showing one amud while labeled another. Added a `_hydGen` generation token. *(verified incrementing)*
- **S2-1 (H)** app.js:80 — snapshot fetch skipped the `r.ok` check (a 200-but-wrong body could seed an
  empty catalog). Now throws on non-OK, matching the other fetches.
- **S2-2 / S3-3 (M, XSS)** app.js:976 — `toast(dataset.copy)` injected the Zelle email as raw innerHTML
  (editable via in-app editor → localStorage). Now `esc()`-wrapped.
- **S2-3 (M)** app.js:974 — `JSON.parse(dataset.p)` uncaught; `esc()` doesn't escape `'`, so an apostrophe
  in a breadcrumb param would break the attribute and crash the click handler. Wrapped in try/catch → `{}`.
- **S2-4 (M)** app.js:125 — boot's `refreshLive` called `rerender()` unconditionally, yanking the view out
  from under an open Reader / active daf read (scroll + column reset). Now guarded `!Reader.open && route!=="daf"`.
- **S2-7 (L)** app.js:88 — corrupted `content.json` cache wasn't cleared on parse failure → redundant network
  fetch every load. Now `removeItem` on the parse-error path.
- **S1-2 (H)** app.js:1104 — "Resumed from X:XX" toast fired even when the `currentTime` seek threw. Moved
  toast inside the `try`; `_resumeTo` still cleared either way.

**Deferred (open — re-evaluate next pass; lower severity or needs device testing)**
- S1-1 visible toast on remote/video load failure · S1-3 `watchVideo` doesn't save/pause a prior in-page
  video before replacing it · S1-4 resume could apply to wrong lec on a rapid double-tap (add `_resumeLecId`)
  · S1-6 `skip()` clamps to 1e9 before metadata loads · S1-8 cache `#pCur/#pDur/#pSeek` refs (per-tick perf)
  · S1-9/S1-11 clear `playbackState`/`this.media` on ended/hide · S1-12 bar() innerHTML tears out an
  in-drag seek slider on rapid switch.
- S2-5 editor-triggered `Player.mount()` loses in-progress position · S2-6 validate restored route name
  against a known set · S2-8 `setBarH()` reads `offsetHeight` pre-layout (rAF it).
- S3-4 double-rAF for post-paint scroll measure · S3-5 raise the 450/350 ms scroll-lock windows for iOS momentum.

**Retracted by reviewers as non-bugs / by-design:** S1-5, S1-7, S1-10, S3-6, S3-7, S3-8.

---

### Batch 2 (S4–S6) — 2026-06-23 · app.js?v=…**zh** · all verified in preview, no console errors

The daf engine (S6) and gematria (S4) were audited and found **mathematically correct** — anchor
2020-01-05=Berachos 2 live-matches the real schedule, cycle = 2711, 15/16 rule, hundreds, and all
masechta boundaries (incl. Kinnim/Tamid/Middos sub-volumes) verified. Findings were edge-case hardening.

**Fixed**
- **S4-1/S4-2 (M/L)** hebrewcal.js:66 — `gematria()` emitted `"undefinedundefined"` for negative input
  (reachable via a crafted `…|-1` URL) and an empty numeral for `0`. Added a `n<1`/non-finite guard.
  *(verified: -1/0/NaN→"", 15→טו, 16→טז, 176→קעו)*
- **S4-3 (L)** hebrewcal.js:73 — `gematriaP()` produced a lone gershayim `״` for empty input. Guarded. *(verified 0→"")*
- **S4-4 (L)** hebrewcal.js:85 — `fromDate()` propagated NaN through the calendar on an invalid Date.
  Now returns `null` (live call site already guards). *(verified invalid→null, valid→ח׳ תמוז תשפ״ו)*
- **S6-1 (L)** app.js:379 — today/yesterday/tomorrow used ±86400000 ms, which can collapse to the same daf
  across a DST transition. Switched to true calendar-day `setDate` offsets. *(verified 54/55/53 consecutive)*
- **S6-2 (L)** dafyomi.js:68 — `dafForDate()` only *accidentally* survived an Invalid Date. Added an explicit
  `Number.isFinite` guard. *(verified invalid→null)*
- **S5-1 (M)** app.js:907 — `mailto:` recipient interpolated unencoded → header-injection surface if a tampered
  `content.json` email holds `?bcc=…`. Wrapped in `encodeURIComponent`.
- **S5-3 (M)** app.js:918 — Zelle QR `btoa()` threw on a non-Latin name (Hebrew/accents) → QR silently dropped.
  Switched to UTF-8-safe `btoa(unescape(encodeURIComponent(…)))`. *(verified: old throws InvalidCharacterError, new ok)*
- **S5-4 (M)** app.js:997 — search filtered the full ~2000-lecture catalog + rebuilt rows on **every keystroke**.
  Added a 150 ms debounce (behavior unchanged, jank removed).

**Deferred (open)**
- S5-2 (M) editor save-failure is silent (admin-only editor; needs `setStore` to return success) · S5-5 (L)
  `#toasts` not `inert` behind the open menu (no current defect — only if a toast becomes interactive) ·
  S5-6 (L) `toast()` param naming/HTML-accepting hazard · S5-7 (L) strip newlines from sponsor `<select>`
  values before the mailto body.

---

### Batch 3 (S7–S8) — 2026-06-23 · v=…**zi** · verified in preview (screenshot: home unchanged, no console errors)

CSS/HTML hardening. Several reviewer "fixes" were **declined** because they'd change the visible look
(the standing rule is harden-without-changing-UI) — recorded below for an owner decision.

**Fixed**
- **S7-1 (a11y)** styles.css — no `prefers-reduced-motion` support; entrance/slide/collapse animations fired
  for users who asked the OS to reduce motion (WCAG 2.3.3). Added a reduce-motion block that collapses
  animation/transition durations (state still applies). *(verified: media rule parsed into CSSOM)*
- **S7-6** styles.css:65 — removed dead `.unbtn` rule (unreferenced anywhere). *(verified gone)*
- **S8-2 (privacy)** index.html — added `<meta name="referrer" content="strict-origin-when-cross-origin">`
  so the full daf-path URL no longer leaks to the R2 media host / TorahAnytime API (origin only). Chosen over
  `no-referrer` to avoid breaking any referrer-gated resource. *(verified present)*
- **S8-3** index.html — made the two font-preload `crossorigin` attrs explicit (`="anonymous"`). No behavior change.

**Declined — would change the visible UI (need owner sign-off)**
- **S7-4 (M)** `--ink-faint` (#8c8678 ≈ 3.47:1) fails WCAG AA on small informational text (player time, sub-labels,
  source line). The fix darkens those texts (→ `--ink-soft`) — a real **palette change**, so not auto-applied.
- **S7-2 / S7-3** reviewer wanted to strip `outline:none` from search/sponsor inputs — but a **global
  `:focus-visible` outline already exists** (styles.css:431) so keyboard focus is covered; the change would add
  mouse-focus outlines (visual change). Withdrawn.
- **S7-5 (M)** the `.daf-cell.has` availability dot sits at the trailing corner in the RTL grid; moving it to the
  start corner (as suggested) would **collide** with the daf number already there. Left as-is (deliberate opposite corners).

**Deferred — needs out-of-band work, not a one-line edit**
- **S8-1 (CSP)** — the flagship hardening, but an enforced `<meta>` CSP risks breaking media: audio/video plays
  from R2 **and falls back to TorahAnytime media URLs** (Player error handler), so `media-src` must include BOTH
  origins, and `<meta>` can't run Report-Only. Proposed policy + the open question (exact TA media host) recorded
  for a dedicated tunnel-header trial. Do NOT ship blind.
- **S8-4 (noindex)** — declined as a hardening step: the real site (monseydafyomi.com) must stay indexable, and a
  `noindex` left in at launch would be a silent SEO footgun. Revisit only as a launch-time toggle.

---

## Pass 2 — started 2026-06-23  (dig-deeper: XSS sinks + async lifecycle · branch-out: storage, history, reader)
| Section | Status | Real findings | Fixed |
|---|---|---|---|
| P2-A XSS / innerHTML sweep | reviewed | 3 real (M·M·L) + 1 interface-risk | 3 (P2A-1,2,5) |
| P2-B async lifecycle / leaks | reviewed | 2 real (1H·1L); 5 confirmed safe | 2 (P2B-2,7) |
| P2-C storage / data-integrity | reviewed | 4 real (M·M·L·L) | 4 (P2C-1,2,3,4) |
| P2-D history / back-stack | reviewed | 2 real (H·H); rest guarded/declined | 1 (P2D-2) |
| P2-E reader-overlay lifecycle | reviewed | 5 real (M·M·M·L·L); open/close confirmed symmetric | 5 (P2E-1..5) |

### Batch 1 (P2-A + P2-B) — v=…**zj** · verified in preview (no console errors; breadcrumb `data-p` round-trips, sponsor renders $54/$54/$540)

**Fixed**
- **P2B-2 (H · clears deferred S1-3)** app.js:1044 — `watchVideo` replaced `#videoSlot`'s innerHTML without pausing
  the video already there → the detached element kept decoding/playing audio while the transport bar went silent.
  Now pauses + clears the old `<video>` first (same pattern as `rerender`). *(verified)*
- **P2A-1 (M)** app.js:967 — breadcrumb `data-p` used a **single-quoted** attribute, but `esc()` doesn't escape `'`,
  so a param containing an apostrophe could break out. Switched to a double-quoted attribute (esc already covers `"`).
  Belt-and-suspenders with the Pass-1 try/catch. *(verified: JSON.parse round-trips, crumb click navigates)*
- **P2A-2 (M)** app.js:873 — sponsor `opt()` helper interpolated `price` (from owner-editable `content.json`
  `sponsor.amounts`) raw into innerHTML. Wrapped in `esc()`. *(verified prices still render)*
- **P2A-5 (L)** app.js:61 — `gregOf` echoed `calStrings().greg` raw; on an **unparseable** API date that branch returns
  the raw API string, which reached `.rmeta` innerHTML unescaped. Wrapped in `esc()` (no-op for valid dates).
- **P2B-7 (L)** app.js:654 — `restoreColScroll`'s rAF read `Reader.open` a frame late; if the reader closed within
  that frame it could fire a spurious `window.scrollTo` on the revealed page. Captures `Reader.open` and bails if it changed.

**Declined after source-verification (verify-before-fix earned its keep)**
- **P2B-3 / deferred S1-4** — NON-BUG. The proposed `_resumeId` guard is tautological (`_resumeId` and `lec` are set
  together, so the check is always true), and the "wrong seek" can't actually happen: a late `loadedmetadata` applies
  the resume to the element's CURRENT src, which is the correct content. No change.
- **P2A-3** `toast()` is an intentional raw-HTML sink; no exploitable caller remains (the real toast XSS was the
  `dataset.copy` path fixed in Pass 1 / S2-2). Left as-is.
- **P2A-4** confirmed safe (API `title` is already `esc()`'d in `continueCard`).

**Confirmed SAFE by the audit (Pass-1 / earlier work holding up):** `fillReaderBody` stale guard, `attachDafSwipe`
once-binding, `popstate` single-bind, the new search-debounce null guard, and the `refreshLive` route guard.

### Batch 2 (P2-C + P2-D + P2-E) — v=…**zk** · verified in preview (no console errors; validRoute + reader a11y exercised)

**Fixed — storage / data-integrity (P2-C)**
- **P2C-1 (M)** app.js:88 — `loadContent` returned a non-object (`"null"`, array, string) straight from a corrupt
  `content` cache → every view `State.content.masthead` crashed. Now type-checks and falls back to the network copy.
- **P2C-2 (M · clears deferred S5-2)** `setStore` now returns a boolean; `applyEditor` toasts
  "storage full, changes won't persist" instead of a false "Preview updated" when a write fails (admin-only path).
- **P2C-3 (L)** app.js:104 — `buildIndex` now skips a null/non-object lecture (corrupt cache) instead of throwing on `lec.id`.
- **P2C-4 (L)** app.js:823–824 — My-Stuff sort comparators coerce timestamps numerically (`+v||0`) so a non-numeric
  stored value can't NaN-scramble the list order.

**Fixed — deep-link validation (P2-D · clears deferred S2-6)**
- **P2D-2 (H)** app.js — `restoreInitialRoute` now runs `validRoute()` on the restored route: unknown route name,
  unknown masechta, or an out-of-range/garbage daf id falls back to Today instead of rendering broken UI and
  writing a poisoned `learned` entry. *(verified: daf|999, Nonexistent|abc, hacker, bad-masechta all → false; valid → true)*

**Fixed — reader-overlay a11y / lifecycle (P2-E)**
- **P2E-1 (M)** app.js — open reader left the top bar (`#app > header`) keyboard-tabbable behind the overlay
  (only `#view` was inert). Now inerts the header too on open and restores on close; the player stays controllable. *(verified)*
- **P2E-2 (M)** app.js — `#reader` was a plain div; added `role="dialog" aria-modal="true" aria-labelledby="rdTitle"`
  (+ `id="rdTitle"` on the title) so screen readers announce it as a modal. *(verified)*
- **P2E-3 (M)** styles.css:266 — `.reader-body` gained `overscroll-behavior: contain` (CSS-only, no visual change)
  to stop iOS rubber-band bleed-through to the page behind the reader.
- **P2E-4 (L)** app.js — `openReader` re-entry guard (`if (Reader.open) return`) so a stray re-open can't stack a
  duplicate history entry. *(verified: second open ignored)*
- **P2E-5 (L)** app.js — `applyEditor` now closes an open reader before `renderShell()` rebuilds the DOM, so
  `Reader.open` can't be left true against a destroyed overlay (admin-only).

**Declined / held after source-verification**
- **P2D-1 (H, reader double-back race)** — analysis was speculative; the current "back closes reader, back-again
  navigates" is sound, and the proposed popstate change risked breaking the working reader history. No change.
- **P2D-6** `_navDepth` inflated if `pushState` throws — real only at the browser's 100-pushes/30s quota
  (unreachable at human nav rate). Deferred to backlog.
- **P2D-3/4/5, P2D-7/8/9** — confirmed guarded / graceful / intended by the audit.
- **S3-4 (double-rAF) and S3-5 (raise lock windows)** — **HELD** on the reviewer's own recommendation: `getBoundingClientRect`
  already forces a synchronous layout in the single rAF (double-rAF would add a flicker frame), and the 450/350 ms
  lock windows are well-tuned (raising them would make the header feel sluggish). The reading feel stays as tuned.

**Confirmed SAFE / symmetric by the audit:** reader open↔close is fully symmetric (every attr/class/inert/focus undone),
page scroll is preserved on close (no jump-to-top), the collapse-lock machinery can't get stuck (`resetReadMin` on both
ends + the `y<=60` near-top guard), and `getStore` already hardens 6 of the 9 persisted keys.

---

## Pass 3 — started 2026-06-23  (branch-out: daf-text pipeline + media/network → then a11y, perf, regression)
| Section | Status | Real findings | Fixed |
|---|---|---|---|
| P3-A daf-text rendering | reviewed | 3 (2M·1L); pipeline otherwise graceful | 2 (P3A-1,2) |
| P3-B media / network & API | reviewed | 4 (2M·2L); 7 confirmed safe | 3 (P3B-1,2,3) |
| P3-C a11y beyond reader | reviewed | 10 (3H·4M·3L); much already clean | 4 (P3C-1,2,3,4) |
| P3-D performance / memory | reviewed | 2 actionable; perf otherwise sound | 1 (P3D-1) |
| P3-E changed-surface regression | reviewed | **0 regressions** — all 41 prior fixes confirmed clean | 0 (clean) |

### Batch 1 (P3-A + P3-B) — v=…**zl** · verified in preview (SCREENSHOT confirmed; no console errors)

**Fixed**
- **P3A-1 (M — VISIBLE BUG FIX, owner FYI)** app.js:28,564,725,728,729 — Hebrew daf text carries Sefaria/Vilna
  markup (`<big><strong>…</strong></big>` on Mishnah-opening words + `<br>`) in **2,413 amudim across 20 masechtos**,
  but the renderer used `esc()` so users SAW the literal tags (e.g. Bava Basra 2 opened with the raw text
  `<big><strong>השותפין</strong></big>`). Added a `safeHe` (mirrors the existing `safeEn` escape-then-allowlist;
  allows only `big/strong/b/i/em/br` — XSS-safe). *(verified + screenshot: השותפין now renders enlarged-bold, no literal tags)*
  — this IS a visible change, but corrective: it fixes a real rendering defect on the core reading surface.
- **P3A-2 (M)** app.js:573 — Tamid's opening Mishnah (Vilna 25b) was shown in he/en/both modes but **missing in the
  default "daf" (Tzuras-hadaf) mode** because that branch returned before the 25b injection. Added the same 25b page to
  `renderDafLayout`. *(verified: Tamid 26 now renders 3 pages — 25b/26a/26b)*
- **P3B-1 (M)** app.js:1132 — the local→remote audio fallback assigned `lec.audio` even when empty, making the player
  try to decode the HTML page as audio. Now bails (leaves the bar visible, stopped) if there's no remote URL.
- **P3B-2 (M)** app.js:121 — a single `null`/non-object row in the API response threw inside `.map(leanFromApi)`,
  aborting the whole refresh and discarding ALL fresh rows. Now filters non-objects first (one bad row can't wipe the catalog).
- **P3B-3 (L)** app.js:121 — the catalog sort tie-break `b.id - a.id` went `NaN` on a missing/non-numeric id; now coerced (`+id||0`).

**Deferred**
- **P3A-3 (L)** one amud (Berachos 54a EN) has a `<span class>` that shows as literal text — best fixed in the
  corpus build (strip), not by widening the live allowlist to attributed tags. Logged for a build-pipeline pass.
- **P3B-4 (L)** `savePos` could store `d=0` if duration were unknown → `resumePoint` over-resumes — but BOTH callers
  (`tick`, `hide`) already gate on `dur>0`, so it can't fire today. Belt-and-suspenders only; left in backlog.

**Confirmed SAFE by the audits (no change needed):** daf pipeline degrades gracefully on null/`{}`/missing-amud/empty-
column data (explicit guards at every stage); all daf+commentary text is escaped before innerHTML (no XSS); commentary
has NO markup tags (so `commCol`'s `esc` is correct). Media layer: `refreshLive` try/catch + empty-guard, `mediaUrl`
slash/empty handling, audio-only entries (`video:""` gated), the error-fallback no-retry-loop, and `_resumeTo`/`_skipPending`
priority were all confirmed sound.

---

### Batch 2 (P3-C + P3-D + P3-E) — v=…**zm** · verified in preview (DOM attrs + player tick exercised; no console errors)

**Fixed — accessibility (P3-C)**
- **P3C-1 (H)** app.js:452 — daf-grid cells conveyed has-shiur/learned state by color only. Added an `aria-label`
  ("Chullin Daf 2 — shiur available, learned") and `aria-hidden` on the now-redundant inner glyph spans. *(verified)*
- **P3C-2 (H)** app.js — the sponsor `<select>`s (`#spType`, `#spMas`) and date input had no accessible name.
  Added `aria-label` (chosen over a div→`<label>` swap, which would change block→inline layout). *(verified)*
- **P3C-3 (H)** app.js — no heading semantics anywhere (`.pagetitle`/`.section` were plain divs). Added
  `role="heading" aria-level="1|2"` (CSS already sets explicit margin+font, so zero visual change). *(verified)*
- **P3C-4 (M)** app.js:891 — sponsor option buttons didn't expose selected state; added `aria-pressed`. *(verified [false,false,true])*

**Fixed — performance (P3-D)**
- **P3D-1 (clears deferred S1-8)** app.js — `tick()` re-queried `#pCur/#pDur/#pSeek` on every `timeupdate` (~4Hz,
  ~14k/hr). Now cached in `bar()` and nulled in `hide()`. *(verified: cached, tick runs, nulled after hide)*

**No regressions (P3-E)** — re-read all 41 prior fixes; **all confirmed clean**. Specifically validated: `safeHe`'s
allowlist can't be tricked by attributes (`<big onload=x>` stays escaped), every real `route()` name is in
`KNOWN_ROUTES` (no legit deep-link rejected), `#app > header` inert is always removed (incl. popstate/editor paths),
`watchVideo`/`_hydGen`/`refreshLive` guards don't break happy paths, the gematria/date guards preserve valid output,
and no escaping change double-escapes normal values.

**Deferred (logged)**
- P3-C tail: **lang="he"** on Hebrew text (broad, ~many sites — SR pronunciation), keyboard-operability of the
  `<a data-fav>` Save toggle (it's an `<a>` w/o href → needs role=button+tabindex+keydown), focus-loss on
  `rerender()` after a fav toggle, decorative-glyph `aria-hidden` tail (continueCard ▶/↪, rowHtml ▸, daynav ‹›),
  and a menu close-button (P3C-7, would add a visible control — owner-decision). P3A-3 span (build-side).
- P3-D: P3D-2 (`savePos` re-parses the pos store every 4s — marginal; caching risks consistency with `clearPos`),
  P3D-6 (`State.all.find` O(n) lookup — user-action only, negligible). Both confirmed non-critical.

**Confirmed already-clean by P3-C:** burger/back/search/close all aria-labeled; menu focus-trap + Esc + focus-return
correct; column tabs `role=tablist`/`aria-selected`; mode buttons `aria-pressed`; progressbar fully labeled; toasts
`aria-live=polite` (no dup); QR `role=img`; wordmark `role=link`+keydown; `:focus-visible` global outline.

---

## Pass 4 — started 2026-06-23  (branch-out: build/corpus + a11y completion → then resilience, config)
| Section | Status | Real findings | Fixed |
|---|---|---|---|
| P4-A build pipeline & corpus | reviewed | 8 (2H·3M·3L) — most BUILD-SIDE | 1 app-side (covers P4A-1,2) |
| P4-B a11y completion | reviewed | 14 + the keyboard sweep | 7 + **12 CTAs made keyboard-accessible** |
| P4-C cold-start / offline / network | reviewed | resilience mostly clean; SW = owner-decision | 1 (offline message) |
| P4-D config / schema / integration | reviewed | 5 (config-tamper); 21/26 accesses already guarded | 4 (P4D-2,3,4,5) |

### Batch 1 (P4-A + P4-B) — v=…**zn** · verified in preview (Berachos en clean, Save=button, screenshot daf intact, no console errors)

**Fixed (app-side)**
- **P4A-1 + P4A-2 (H)** app.js:28 — the **English** corpus leaked markup the renderer didn't handle: a
  `<span class="gemarra-regular">` (1 amud, Berachos 54a) showed as literal text, and 6 amudim had **unclosed**
  `<b>`/`<strong>` tags causing runaway bold. Hardened `safeEn`: pre-strip `<span…>` (presentation noise) and
  balance the simple `<b>x<b>`→`<b>x</b>` pattern before escape+allowlist. *(verified: no escaped span/bold literals, 9.2KB en renders)*
- **P4B-Save (M, clears deferred P3C-5p1)** app.js:476 — the `<a data-fav>` "Save" toggle had no `href` → not
  keyboard-focusable. Changed to `<button>` (`.btn` CSS is class-based → no visual change) + `aria-pressed`. *(verified BUTTON, "☆ Save", screenshot identical)*
- **P4B lang="he" (M)** — added `lang="he"` to the highest-value repeated Hebrew SR containers: the daf body
  (`.daf-he` ×3 render paths), the column headers (`.col-h` רש"י/גמרא/תוספות), and the Hebrew date (`.hdate`).
  Pure attribute, zero visual change (only affects SR pronunciation). *(verified lang="he" present)*
- **P4B glyphs (L)** — `aria-hidden` on decorative glyphs already inside labeled controls: continueCard ▶/↪
  (`.cont-ic`) and the non-daf row bullet ▸ (`.rnum.sym`).

**⚠️ FLAGGED — high-value, needs a dedicated careful batch (NOT auto-applied here):**
- **Keyboard access to ALL primary CTAs (WCAG 2.1.1 / A).** Listen, Watch, Read-the-daf, Sponsor, the adjacent
  Tomorrow/Yesterday links, textlinks, and breadcrumb `data-go` links are ALL `<a>` **without href** → not
  focusable, Enter doesn't fire. Keyboard/SR users cannot use the main actions. The fix is mechanical
  (`<a class="btn|textlink" data-*>` → `<button>`; CSS confirmed safe) but touches ~13 sites with paired open/close
  tags — deserves its own batch with full tab-through testing. *(Save toggle done as the pilot; the rest pending.)*

**Deferred — BUILD-SIDE (do NOT auto-regenerate the corpus; recommend for a manual build pass)**
- P4A-1/2 root cause: add the same `<span>`-strip + unclosed-tag normalization to `build/extract_daf_text.py` so
  future rebuilds are clean at source (the app-side `safeEn` guard now covers it regardless).
- P4A-3 build inconsistency (text vs commentary stripping) · P4A-4 corpus rebuild not automated in `update_all.py`
  (stale-data risk) · P4A-5 `errors="replace"` silent encoding corruption (→ strict) · P4A-7 empty-file-on-missing-source
  guard. P4A-6 Nazir 33b gap = Vilna source artifact (app degrades gracefully — no action).

**Deferred — a11y tail:** remaining `lang="he"` (titles/wordmark/masthead/footer/browse names), P4B-13/14 bare-glyph
wrapping on the adjacent day links.

### Batch 2 (keyboard-CTA sweep + P4-C resilience) — v=…**zo** · verified in preview (2 screenshots pixel-identical; tab + click confirmed; no console errors)

**Fixed — keyboard accessibility (the flagged WCAG 2.1.1 item, now done)**
- **Converted all 12 `<a … data-*>` CTAs (no href → unfocusable) to `<button>`** so keyboard/SR users can reach them:
  Listen, Watch, Read-the-daf, Sponsor (×4 placements), the "Up next / Browse Shas / All shiurim / Sponsor this daf"
  textlinks, the adjacent Tomorrow/Yesterday pills, and the breadcrumb links. The mailto link (real `href`) stayed `<a>`.
  `.btn` already overrode all button chrome (zero CSS change); for `.textlink`, `.adjacent`, and `.crumbs` I updated the
  CSS to reset button chrome (`appearance/background/border/padding/font`) so buttons render **identically** to the old
  links — and added `button` to those selectors. Also wrapped the adjacent ‹ › glyphs in `aria-hidden` spans + gave the
  pills `aria-label`. *(verified: BUTTON + focusable + click-navigates for adjacent & breadcrumb; 0 anchor-CTAs left; home & daf screenshots identical)*

**Fixed — resilience (P4-C)**
- **P4C-1/4 (M)** app.js:505 — when a daf failed to load **offline**, the reader showed "this masechta isn't available
  yet" (blames the masechta). Now, for non-special masechtos, shows "You're offline — reconnect to load this daf's text"
  when `navigator.onLine === false`. Special masechtos (Shekalim/Kinnim/Middos) keep their accurate message.

**Declined after source-verification**
- **P4C-6** (fillReaderBody race) — NON-ISSUE. The identity guard (`m/d/mode` match) + the fact that `dafBodyHtml(m,d,mode)`
  is deterministic means any double-paint renders **identical** HTML (a harmless redundant repaint, not a stale render). No change.

**P4-C confirmed mostly resilient:** cold-start inline "Opening the daf…" shell covers the boot awaits; `refreshLive`
try/catch + empty-guard preserve `State.all` offline; the navigation-during-refresh race guard holds; media error-fallback
has no retry loop. **Deferred/owner:** P4C-2 surfacing errors visibly (the status dot was intentionally removed by the owner —
re-adding a visible signal is an owner call), P4C-7 `loadJson` boot timeout, P4C-10 media-stall timeout.

**⚠️ Owner-decision — SERVICE WORKER (reviewer leans YES):** a daily-use Torah app with a subway/offline use-case + a fully
static corpus is a strong fit for a minimal offline shell (precache app + lazy-cache `data/`). High value, but has
cache-versioning pitfalls (must align with the `?v=` buster + version the SW cache + give `data/` files cache headers).
Recommend as a dedicated, owner-approved enhancement — NOT auto-implemented.

### Batch 3 (P4-D config/schema) — v=…**zp** · verified in preview (normal + tampered-config render; no console errors)

The config layer is robust — **21 of 26 `State.content.*` accesses already guarded** (`?.` / `|| {}` / `|| ""` / `esc(undefined)→""`).
Fixed the 5 that could crash on a partial/tampered `content.json`:
- **P4D-5 (boot-critical)** app.js:100 — `options.mediaBaseUrl` of a non-string truthy type (e.g. a number) made
  `mediaUrl().replace()` throw inside `buildIndex()` → **boot crash**. Now `String(...)`-coerced. *(verified: buildIndex survives mediaBaseUrl=42)*
- **P4D-2/3 (M)** app.js:965,967 — `about.paragraphs` / `faqs` of a non-array truthy type made `.map()` throw → blank About page.
  Now `Array.isArray(...) ? ... : []`. *(verified: About renders with faqs=null + paragraphs="not-array")*
- **P4D-4 (L)** app.js:904 — same `.map` pattern on `sponsor.dedicationTypes` → Sponsor crash. Now `Array.isArray`-guarded. *(verified)*
- **Declined P4D-1** (`about.tradition` non-object) — degrades to a silent blank section via `esc(undefined)→""`, not a crash. Low value.

**Note:** no `version`/`schema` field exists in any data file — a future build renaming a field (e.g. `sponsor.amounts`)
would silently empty a slot (no crash, thanks to the guards). A schema-version stamp is a build-side nicety, logged for later.

---

## Pass 5 — 2026-06-23 · LIGHT CONSOLIDATING FINALE · v=…**zq**
- **P5-A — a11y tail finished:** added the remaining `lang="he"` to the title `.he` divs (today/daf/masthead), the reader
  title span, the `.wordmark`, the footer `.fhe`, and the Browse `.nm` masechta names (7→15 `lang="he"` total). Pure
  semantic, zero visual change. The adjacent ‹ › bare-glyph wraps were already done in the keyboard sweep.
- **P5-B — full end-to-end smoke test: 24/24 flows PASS, 0 console errors.** Drove today → daf → all 4 mode toggles
  (Daf/עברית/English/Both) → reader open/flip/column-switch/close → menu → browse → seder → masechta → search(+results)
  → sponsor (all 4 kinds) → donate (QR renders) → my-stuff → back button. Two final proof screenshots (today + daf): pixel-identical.

**RESULT: the app works end-to-end after ~60 hardening changes, with no regressions. The loop is COMPLETE.**

---

## Meta-reviews (between full passes)

### Pass 5 → DONE — 2026-06-23 · **LOOP PAUSED (converged)**
Pass 5 added no new defects to fix — it finished the a11y tail and verified the whole app green (24/24 flows). Convergence
from Pass 4 holds. **Per the plan, the autonomous loop is paused here.** Five passes hardened the in-app code across
robustness, XSS, async races, persistence, navigation, full a11y (incl. keyboard + lang), perf, offline resilience,
build-data quality, and config tolerance — ~60 fixes, 0 regressions, all preview/screenshot-verified, **all unpushed**.

**Handed back to the owner (the remaining high-value work is yours, not more autonomous review):**
1. **`git` checkpoint** the ~60 verified fixes (live only via tunnel today).
2. **Decision queue:** (a) faint-text **contrast** (palette/WCAG AA), (b) real **CSP** (tunnel Report-Only trial + the
   TorahAnytime media-fallback origin), (c) launch **noindex**, (d) **service worker** for offline (subway use-case),
   (e) **build-side corpus normalization** in `extract_daf_text.py` (app-side `safeHe`/`safeEn` already cover it live).
3. To resume autonomous hardening later, the per-finding **deferred backlog** above is the re-entry point.

### Pass 4 → (Pass 5) — 2026-06-23 · **STRONG CONVERGENCE**
**Pass 4 result:** P4-A…P4-D all reviewed; **~14 fixes** this pass (build-side English-markup app guard, the
keyboard-CTA sweep making all 12 primary actions focusable, the offline message, and 4 config-tamper guards).
**Cumulative ≈ 60 fixes across 4 full passes, 0 regressions.**

**Convergence assessment — the loop has hardened the in-app code deeply across every dimension it set out to cover:**
robustness/null-guards, XSS/innerHTML, async races, persistence, navigation, accessibility (labels → focus-trap →
keyboard operability → lang → headings), performance/memory, cold-start/offline resilience, build/corpus data quality,
and config/schema tolerance. Pass 3's regression sweep found **0 regressions**; Pass 4 found mostly **build-side** items
(owner-gated) and **edge-case** config guards. Reviewer yield is clearly diminishing, and what remains highest-value is
no longer "more autonomous review" — it's **owner decisions** and **out-of-band work**:

**→ Recommendation to owner (the real next steps):**
1. **Take the git checkpoint.** ~60 verified, preview/screenshot-checked fixes are unpushed (live only via tunnel).
2. **Owner-decision queue** (each needs your judgment, not more review): (a) **faint-text contrast** — a palette tweak
   for WCAG AA; (b) a real **Content-Security-Policy** — needs a tunnel-header Report-Only trial + the TorahAnytime
   media-fallback origin; (c) **noindex** for launch SEO; (d) a **service worker** for true offline (subway use-case);
   (e) **build-side corpus normalization** (`extract_daf_text.py`: strip `<span>` + balance bold, `errors="strict"`,
   automate the rebuild) so future rebuilds are clean at source (the app-side `safeHe`/`safeEn` guards already cover it live).

**Pass 5 plan — a single LIGHT consolidating finale, then pause for owner input:**
- **P5-A — finish the a11y tail** (cheap, started-but-incomplete): remaining `lang="he"` (titles/wordmark/masthead/footer),
  P4B-13/14 bare-glyph wraps — pure semantic adds, no visual change.
- **P5-B — full end-to-end smoke test**: drive every major flow (today→daf→reader→flip→column→listen/watch→menu→browse→
  search→sponsor→donate→mystuff) in the preview, assert no console errors and each renders — a final "it all still works
  together after ~60 changes" verification.
- After P5: **recommend pausing the autonomous loop** pending owner action on the decision queue — continuing past P5 is
  low-yield until those owner-gated items are addressed.

### Pass 1 → Pass 2 — 2026-06-23
**Pass 1 result:** all 8 sections reviewed; **21 fixes** applied + verified, 0 regressions, nothing committed
(live via tunnel, awaiting owner OK). The daf-calc engine and gematria were proven correct; no logic/data bugs.

**Recurring themes (what the bugs had in common):**
1. **Missing input guards on pure functions** — gematria/fromDate/dafForDate/JSON.parse all blew up or emitted
   garbage on junk input (negative daf, NaN date, malformed cache). Defensive-guard gaps, not logic errors.
2. **innerHTML sinks fed owner-editable data** — the only real XSS surface (toast email, breadcrumb param) traces
   to `content.json` fields flowing editor → localStorage → `innerHTML` without `esc()`. The code mostly escapes,
   but a few sinks slipped — so coverage, not approach, is the risk.
3. **Async render races / lifecycle** — the only true crashers were here: `updateFlipUI` ReferenceError, the
   `hydrateDaf` stale-render race, and `refreshLive` clobbering an active read. Awaited DOM writes lack guards.
4. **Timezone & locale edges** — ±24h date math (DST), `btoa` on Unicode names.
5. **Fetch consistency** — one of several fetches skipped the `r.ok` check the others had.

**Decision: dig deeper on themes 2 & 3 (highest real-bug yield), branch out to 3 untouched subsystems.**

**Pass 2 plan (adjusted sections):**
- **P2-A — Exhaustive XSS / innerHTML sink sweep** (dig deeper on theme 2): enumerate EVERY `innerHTML =` and
  template interpolation across app.js, cross-check each dynamic value against `esc()`/`safeEn()` coverage; treat
  any owner/API-sourced string reaching the DOM unescaped as a finding.
- **P2-B — Async lifecycle & listener-leak audit** (dig deeper on theme 3): every `await`-then-DOM-write needs a
  stale guard; every `addEventListener` without a matching remove; every `State` mutation during an in-flight op.
  Pull in deferred **S1-3** (watchVideo doesn't save/pause a prior video) and **S1-4** (resume → wrong lec on rapid tap).
- **P2-C — Storage & data-integrity subsystem** (branch out, NEW): `getStore/setStore/favs/progress/learned/markNew/
  writeCache/readCache` under corruption, quota-exceeded, and disabled-storage; pull in deferred **S5-2** (silent editor save-fail).
- **P2-D — History / navigation / back-stack & deep-linking** (branch out, NEW): `updateBackBtn`, route `depth`,
  `popstate` to unknown/deep routes, refresh-restore correctness; pull in deferred **S2-6** (validate restored route name).
- **P2-E — Reader overlay lifecycle** (dig deeper on S3): open/close, focus-trap, scroll-restore, body-scroll-lock,
  the `_minLockUntil` windows; pull in deferred **S3-4/S3-5**.

**Owner-decision queue (surfaced, not auto-fixed):** S7-4 faint-text contrast (palette), S8-1 CSP (needs tunnel
Report-Only trial + TA media-fallback origin), S8-4 noindex (launch SEO).

### Pass 3 → Pass 4 — 2026-06-23
**Pass 3 result:** P3-A…P3-E all reviewed; **10 fixes** (cumulative **46**), **0 regressions** (P3-E cleared all prior
work). Branch-out found 2 real *visible* rendering bugs (Hebrew markup shown as literal tags; Tamid's opening Mishnah
missing in daf mode) + catalog-ingestion robustness gaps + an a11y attribute layer. Perf got a clean bill of health.

**Recurring themes (Pass 3):**
1. **Latent rendering bugs hiding in plain sight** — the daf pipeline rendered raw `<big><strong>` tags to users for
   2,413 amudim. The defect lived at the build/escaping boundary, not in logic. → the **build/corpus side is unaudited**.
2. **a11y has a long but shallow tail** — the interactive bones are good (labels, focus-trap, roles), but lang tagging,
   keyboard-operability of `<a>`-as-button, and focus-on-rerender remain.
3. **The core JS is converging** — perf clean, zero regressions, the five original themes well-covered. Re-running
   in-app reviewers yields diminishing returns.

**Assessment:** in-app app.js is well-hardened (46 fixes, 0 regressions). The highest-remaining-value work is in areas
the loop hasn't touched: the **build pipeline/corpus** (where the rendering bug originated), **resilience on a cold/
offline/slow device**, and **finishing the a11y tail**. Branch out accordingly.

**Pass 4 plan:**
- **P4-A — Build pipeline & corpus quality** (NEW): review `build/extract_daf_text.py`, `extract_commentary.py`, and
  the data contract — markup normalization (the P3-A root cause), text/commentary completeness + gaps per masechta,
  encoding, the `_index.json`/manifest shape the app depends on. *(Python + data review; no live-app change unless a
  data-driven app guard is needed.)*
- **P4-B — a11y completion** (dig deeper on the P3-C tail): `lang="he"` on Hebrew containers, keyboard-operability of
  the `<a data-fav>` toggle (role=button+tabindex+keydown), decorative-glyph `aria-hidden` tail. (Pure semantic adds.)
- **P4-C — Cold-start / offline / slow-network resilience** (NEW): first visit with no cache, offline reload, slow/
  failing API+media, loading/empty/error states, and whether a minimal offline story (cache the shell) is worth it.
- **P4-D — Config / schema / integration robustness** (NEW): `content.json` + media-manifest schema expectations,
  the build→data→app contract, missing/partial config tolerance.

**Note for owner:** the loop is converging on in-app code; the biggest remaining wins are now either **build-side**
(Pass 4) or **owner decisions** (contrast palette, a real CSP via tunnel headers, launch noindex). Recommend taking a
**git checkpoint of Passes 1–3 (46 verified fixes, all live via tunnel, currently unpushed)** before Pass 4.

### Pass 2 → Pass 3 — 2026-06-23
**Pass 2 result:** P2-A…P2-E all reviewed; **15 fixes** applied + verified, 0 regressions, nothing committed.
Cumulative since the loop began: **36 fixes**. Verify-before-fix declined 1 reviewer "fix" as a no-op (S1-4) and 1 as
risky-speculative (P2D-1), and **held** the two reader-feel items (S3-4/S3-5) on the reviewer's own advice.

**Recurring themes (Pass 2):**
1. **Corrupt / forged persisted state** — the branch-out into storage (P2-C) and deep-links (P2-D) confirmed the
   Pass-1 "missing input-guard" theme extends to everything restored from localStorage/sessionStorage/history.state:
   readers trusted shape. Now guarded at the boundaries (loadContent, buildIndex, validRoute).
2. **Overlay a11y depth** — the reader lacked dialog semantics + a focus trap (P2-E). New theme: a11y beyond labels.
3. **innerHTML sink completeness** — P2-A's exhaustive sweep closed the last un-escaped sinks; the XSS surface is
   now essentially fully covered (every sink either esc()'d, numeric, or static).
4. **Async/lifecycle is largely settled** — only `watchVideo` remained; most paths were confirmed safe by the audit.

**Assessment:** the original five themes (input-guards, XSS sinks, async races, persistence, navigation) are now
well-covered and converging — diminishing returns on re-running them. **Decision: branch out to the subsystems that
have NOT had a dedicated pass, plus a regression sweep of our own ~36 changes.**

**Pass 3 plan:**
- **P3-A — Daf-text rendering pipeline** (NEW): `renderAmud`/`safeEn`/`dafBodyHtml`/`getDaf`/`getComm`, the
  Tzuras-hadaf column layout + RTL/segment correctness, empty/missing-segment handling, the Tamid/Kinnim specials.
- **P3-B — Media/network & API mapping** (NEW): `leanFromApi` field robustness, `mediaUrl`, the R2↔TorahAnytime
  fallback chain, intro-trim logic, and every network error path (malformed API row, missing media).
- **P3-C — Accessibility sweep beyond the reader** (NEW): menu focus-trap parity, icon-button labels, daf-grid /
  calendar keyboard + SR semantics, `aria-live` correctness, tab order.
- **P3-D — Performance & memory over a long session** (NEW): DOM size of a full daf, layout-thrash, per-`timeupdate`
  cost, cache growth, listener/timer accumulation across many flips.
- **P3-E — Changed-surface regression review**: re-review all Pass-1/Pass-2 fixes specifically for regressions any
  fix may have introduced (the changed-surface pattern that previously caught self-inflicted regressions).
- Continue to NOT auto-fix the owner-decision queue (S7-4, S8-1, S8-4).

---

## Feature build — folio picker (2026-08-18)

Not a hardening pass. Recorded here because the manual-QA checklist belongs with the
rest of the QA record. Plan and rationale: `DAF-PICKER-PLAN.md`.

**What shipped.** Tapping the folio running head (`חולין קב·ב`) opens a popover listing
every masechta and daf. Choosing one moves the *reading* surface through the same
in-place commit the ‹ › arrows use, so a shiur — audio or video — is never interrupted.
The panel carries one built-in button: the daf now loaded in the player, or today's daf
when nothing is loaded.

**Files:** `jump-model.js` (new, pure), `tests/jump-model.test.mjs` (new, 17 tests),
`app.js`, `styles.css`, `index.html` (cache-buster → `20260818a`).

**Refactor first (no behaviour change).** `gemaraFlipOnce` / `readerFlipOnce` were split
into "choose the destination" + `gemaraGoTo` / `readerGoTo` ("commit the destination"),
so a jump inherits every epoch, pager-intent and scroll guard the flip path already
carries. `amudKeysFor` / `amudStep` / `dafStep` moved to `jump-model.js` — same bodies,
now unit-tested, and Tamid's three-amud daf 26 is encoded once for every caller.

**Automated:** `node --test tests/*.test.mjs` → 31 pass (17 new + 14 pre-existing).

**Manual QA — all verified in the browser against the real data:**
1. Video playing → open the picker → jump to another masechta. The **same** `<video>` node
   survives (identity-checked), still connected, player bar still up. ✔
2. Same with audio, and from inside the full-screen reader with the page video still running. ✔
3. Panel z-index 46 sits above the reader's 44; the reader's own rail carries the trigger. ✔
4. Arrow after a jump steps from the **new** position (`ברכות ב·ב` → `ברכות ג·א`). ✔
5. Sequential run — arrow +1/−1, long jump, adjacent jump, arrow, Tamid 25b, Tamid 26a,
   Shekalim — every step correct, `_gemaraFlipBusy` released each time, no orphaned `.pflip`. ✔
6. Long jump uses the quiet cross-fade; an adjacent jump uses the real page-turn. ✔
7. Hash carries the jumped-to amud (`&read=Berachos|2|2a`); the page route is untouched. ✔
8. Tamid daf 26 offers three targets (25b / 26a / 26b). Shekalim, Kinnim, Middos show the
   explanatory line with a working rail. ✔
9. Typed references: `bava metzia 8b`, `daf 8 bava metzia`, `חולין קב:`, `102`, `bava`, `zzz`. ✔
10. Grid keyboard: →/↓/Home/End move focus, the daf underneath never flips; Esc closes and
    returns focus to the trigger; the site menu and any route change close the panel. ✔
11. Desktop two-pane / phone single-pane with the back chevron; both stay inside the app shell,
    including the desktop "Phone view" preview. ✔
12. Panel is pinned to the rail's bottom edge, never covers the video, clears the player bar,
    and its dismiss layer is fully transparent (never `#mask`). ✔

**Defects found and fixed during the build (all by this QA):**
- A fully typed reference (`bava metzia 8b`) emptied the masechta list. `parseJumpQuery` now
  returns `name` — the masechta-naming part of the query — and the list filters on that, with
  a fallback to the full list when the reference was understood but matches no name.
- The inline `max-height` overrode the stylesheet's cap, turning the panel into a full-height
  wall on tall windows. The JS now reports available room as `--jp-room`; the cap stays in CSS.
- The panel could run under the transport bar. Its height now subtracts the player.
- The panel did not re-anchor when the page reflowed under it (a video settling its metadata
  moved the rail without firing scroll or resize). It now re-anchors on a rAF watch loop while
  open, writing styles only when the anchor actually moved.
- In the desktop "Phone view" the panel spilled past the simulated phone. Width now clamps
  to `--app` as the player bar already does.

**Known limits:** the parsha rail (`parshaColHead`) does not carry the picker — see
`DAF-PICKER-PLAN.md` §12 phase 3, which is deliberately not built: there is no in-place
parsha swap, so a parsha jump would route and restart an in-page video.
