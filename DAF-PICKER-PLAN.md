# Folio picker — tap the running head to go to any daf

**Status: BUILT and verified, 2026-08-18** — all five phases, including phase 3 (the
parsha rail), which shipped in a second pass together with the in-place parsha swap
this plan said it was waiting for. §12's caveat is therefore resolved, not accepted. Manual-QA record, and the five defects this
build's own QA found and fixed: `QA-HARDENING-LOG.md`, "Feature build — folio picker".
Everything below is the plan as written beforehand; where the build departed from it,
a **Built:** note says how.

**Surface:** the running head in the daf rail — `חולין קב·ב` in `.daf-colhead` (`app.js:1396`).
**Goal:** tapping it opens a quiet menu of every daf/amud in Shas; picking one moves the
reading page **without ever interrupting the shiur that is playing**. The menu carries one
built-in button that is *the daf now playing* when something is playing, and *today's daf*
when nothing is.

---

## 1. What you asked for, mapped onto this codebase

| Your words | What it is here |
|---|---|
| "the highlighted page title" | `.daf-flip-lbl` — the folio running head between the two ‹ › page-flip arrows. Today it is an inert `<span role="heading">`. (The tan highlight in your screenshot is `::selection`, `styles.css:77` — you selected the text to point at it. There is no styling on that element today.) |
| "the full menu of dapim or pages available" | All 2,711 dapim / 5,349 amudim of Shas, grouped seder → masechta → daf → amud. `DY.SHAS` in `dafyomi.js` already holds every masechta with `firstDaf`/`lastDaf`; `State.dafIndex` (`data/daf/_index.json`) says which of them have native text. |
| "a discreet menu that doesn't interrupt the video or audio" | Two separate requirements, both real — see §2 and §5. |
| "the daf of the current playing video … built-in button" | `Player.lec._dk = {masechta, daf}` is already set on every play (`app.js:2961`, `2977`). |
| "toggles to today's daf if nothing is playing" | `DY.dafForDate(new Date())`. |
| "design in the style of the website" | The "classic sefer" theme — warm ivory paper, EB Garamond + Frank Ruhl Libre, deep maroon `--accent: #74202c`, restrained gold `--gold: #9c7c3c`. The panel is built from `--leaf-paper` / `--leaf-edge` so it reads as a slip of paper pulled out from under the running head. |

---

## 2. The one fact that makes "doesn't interrupt" possible

This site already separates **the page you are on** from **the daf you are reading**.

In your screenshot the page header says `חולין דף קח` (Chullin 108 — the shiur playing) while
the folio head says `חולין קב·ב` (Chullin 102b — what you are actually reading). That is not a
bug; it is the design. The ‹ › arrows call `gemaraFlip()` (`app.js:1848`), which swaps the daf
**in place** and writes the new position into the URL via `commitDafReadState()` — it never
calls `route()`, so `#view` is never re-rendered and the `<video>` in `#videoSlot` is never
destroyed. The reader overlay says so in its own header comment (`app.js:1922`):

> Flips between dapim in place and never touches the underlying page — so the shiur
> (audio or video) keeps playing untouched while you read ahead or back.

**So the picker must ride that same rail.** Every jump goes through the flip commit path
(`dafBodyHtml` → `commitDafBodyHtml` → `patchDafColHead` → `restoreColScroll` →
`commitDafReadState`). It must never call `route()`. That is the whole of the "doesn't
interrupt the audio" requirement, and it costs nothing because the machinery exists.

The second half — "doesn't interrupt the **video**" — is about pixels: the panel must not
cover the picture and must not dim it. See §5.

---

## 3. The trigger

At rest it looks exactly like today. The only permanent addition is a 7px gold chevron at
the label's left edge (RTL: the trailing side) at 45% opacity — quiet enough to read as
printer's ornament, present enough that a first-time visitor knows the head is live.

### Markup (`dafColHead`, `app.js:1392–1401`)

```html
<span class="daf-flip-lbl" lang="he" role="heading" aria-level="2" aria-label="חולין קב·ב">
  <button type="button" class="folio-jump" data-dafjump
          aria-haspopup="dialog" aria-expanded="false" aria-controls="dafJump"
          title="Go to another daf" aria-label="חולין קב·ב — go to another daf">
    <span class="folio-current">חולין קב·ב</span>
    <span class="folio-caret" aria-hidden="true"></span>
  </button>
</span>
```

The outer `<span>` keeps `role="heading" aria-level="2"` so the running head stays a heading
for screen readers. `.folio-current` stays where `patchDafColHead` and
`prepareFolioHeaderSwap` already look for it — nesting it one level deeper inside the button
does not break either, because both use `querySelector` (descendant), not a child selector.
The `.folio-swap-old` ghost is `position:absolute; inset:0; pointer-events:none`, so the
520 ms title cross-fade still plays over the button without swallowing clicks.

### CSS (new block, next to `.daf-flip-lbl` at `styles.css:458`)

```css
.folio-jump { -webkit-appearance: none; appearance: none; border: 0; background: none;
  color: inherit; font: inherit; display: inline-flex; align-items: center; gap: 6px;
  max-width: 100%; min-width: 0; min-height: 38px; padding: 2px 11px 3px;
  border-radius: 999px; cursor: pointer; transition: background .13s, color .13s; }
.folio-caret { flex: none; width: 7px; height: 7px; opacity: .45;
  border-right: 1.5px solid var(--gold); border-bottom: 1.5px solid var(--gold);
  transform: rotate(45deg) translateY(-2px);
  transition: opacity .13s, border-color .13s, transform .18s; }
.folio-jump:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent-2); }
.folio-jump:hover .folio-caret { opacity: .9; border-color: var(--accent-2); }
.folio-jump[aria-expanded="true"] { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.folio-jump[aria-expanded="true"] .folio-caret { transform: rotate(-135deg) translateY(1px); opacity: .9; }
```

The hover pill deliberately reuses the exact `.pageflip:hover` recipe
(`color-mix(in srgb, var(--accent) 12%, transparent)`, `styles.css:306`) so the head and its
two arrows light up as one family. On phones `.daf-flip-lbl` is 21px and the whole rail row
is one grid column — the pill spans it comfortably (min-height 38 inside the rail's 53px).

---

## 4. The panel

A popover, not a drawer. The site's left drawer (`.menu`, `styles.css:545`) is modal, full
height, and comes with `#mask` — a 40 %-black blur over everything. That is the opposite of
what you asked for, and `openMenu()` refuses to open at all while the reader is up
(`app.js:400`). So this is its own element.

### Anatomy

```
┌─ anchored under the rail, same paper as the rail ──────────────┐
│  [ ♪ Now playing · חולין קח  Chullin 108 ]        [היום ✦] [✕] │  ← §6
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ⌕  chullin 102b · חולין קב · 102                          │  │  ← §7
│  └──────────────────────────────────────────────────────────┘  │
│  ┌── masechtos ──────────┬── dapim of חולין ─────────────────┐  │
│  │ ▸ זרעים               │  ב   ג   ד   ה   ו   ז          │  │
│  │    ברכות              │  ח   ט   י  י״א י״ב י״ג         │  │
│  │ ▸ מועד                │ …                                │  │
│  │    שבת                │  ק  ק״א [ק״ב] ק״ג ק״ד ק״ה       │  │
│  │    עירובין            │ …                                │  │
│  │ ▸ קדשים               │                                  │  │
│  │    זבחים              │                                  │  │
│  │    מנחות              │                                  │  │
│  │  ▸ חולין  ●           │                                  │  │
│  └───────────────────────┴──────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### Container

```html
<!-- renderShell(), after #reader (app.js:328) -->
<div class="jp-scrim" id="jpScrim" hidden></div>
<div class="jump-pop" id="dafJump" role="dialog" aria-modal="false"
     aria-label="Go to a daf" hidden></div>
```

```css
.jump-pop { position: fixed; z-index: 46; display: none; flex-direction: column;
  background: var(--leaf-paper); border: 1px solid var(--leaf-edge);
  border-top-color: var(--leaf-rule); border-radius: 0 0 3px 3px;
  box-shadow: 0 18px 40px -18px rgba(33,30,24,.55), inset 0 0 0 1px rgba(255,255,255,.5);
  width: min(520px, calc(100vw - 24px)); max-height: min(58vh, 460px); overflow: hidden;
  animation: jpIn .16s cubic-bezier(.4,0,.2,1); }
.jump-pop:not([hidden]) { display: flex; }
.jp-scrim { position: fixed; inset: 0; z-index: 45; background: transparent; }
@media (prefers-reduced-motion: reduce) { .jump-pop { animation: none; } }
```

- **z-index 46** puts it above `.reader` (44) so it works full-screen too, and below
  `.mask`/`.menu` (60/65) so the site menu still wins if it is somehow open.
- **`.jp-scrim` is transparent — no dim, no blur.** This is the single most important line
  in the whole feature. The `.mask` treatment would darken a playing video; a transparent
  click-catcher gives dismiss-on-outside-tap with zero visual interference.

### Anchoring

`position: fixed`, computed from the live rail rect so it tracks the sticky head:

```js
function positionJump() {
  const rail = jumpAnchorRail();               // the .daf-colhead the trigger lives in
  const pop  = $("#dafJump");
  if (!rail || !pop || pop.hidden) return;
  const r = rail.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) { closeJump(); return; }   // rail scrolled away
  const label = rail.querySelector(".daf-flip-lbl").getBoundingClientRect();
  const w = pop.offsetWidth, pad = 10;
  const left = Math.min(Math.max(pad, label.left + label.width / 2 - w / 2), innerWidth - w - pad);
  pop.style.top  = Math.round(r.bottom - 1) + "px";   // overlaps the rail's bottom hairline
  pop.style.left = Math.round(left) + "px";
  pop.style.maxHeight = Math.max(220, innerHeight - r.bottom - 16) + "px";
}
```

**Built — scroll and resize turned out not to be enough.** The rail also moves when the
page reflows *under* it: a video settling its metadata, a webfont landing, the chrome
collapsing. None of those fire an event the panel could listen for, and the panel visibly
detached from the rail once the video finished loading. It now re-anchors on a `rAF` watch
loop while open — one rect read per frame, and the style write is skipped unless the anchor
actually moved. Two further corrections from QA: the inline `max-height` was overriding the
stylesheet's cap and turning the panel into a full-height wall on tall windows, so the JS
now reports available room as `--jp-room` and the cap stays in CSS; and that room subtracts
the transport bar, so the panel and the player never overlap.

**It always opens downward, over the daf text — never upward over the video.** That is
guaranteed by construction: the top edge is pinned to the rail's bottom.

### Panes

- **Desktop:** two panes side by side inside the popover — masechtos 44 %, dapim 56 %, a
  1px `--hair` divider between. Both scroll independently. **Built:** the width also clamps
  to `--app`, the way the player bar does, so the desktop "Phone view" preview keeps the
  panel inside the simulated phone.
- **Phone (`html.is-phone`):** `width: calc(100vw - 20px)`, `max-height: min(64vh, 520px)`,
  one pane at a time. Choosing a masechta slides to the daf grid; a `‹` in the pane head
  goes back. It opens directly on the daf grid of the masechta you are currently reading, so
  the common case ("another daf in this masechta") is one tap deep, not two.

### Masechta list

Grouped by seder, seder heads sticky within the pane, Hebrew names in `--serif-he` at 17px,
Latin transliteration at 11px `--sans` uppercase letter-spaced (`.navbox .nb-sub`'s
treatment, `styles.css:209`). The masechta you are reading gets `aria-current="true"`, an
`--accent` left border and a `●` dot. The masechta of today's daf gets a `היום` tag in the
same `.nb-tag` style `viewBrowse` already uses (`app.js:781`).

Shekalim, Kinnim and Middos are listed but styled like `.navbox.empty` with a one-line note
in the daf pane ("Kinnim is a Mishnah-only masechta — it has no Gemara text"). `dafBodyHtml`
already produces exactly those sentences (`app.js:903`) and still renders a working rail, so
jumping there degrades gracefully rather than failing.

### Daf grid

The grid is dapim, not amudim — 176 cells for Bava Basra rather than 352, which is the
difference between scannable and not. Cell:

```
┌──────────┬──┐
│   ק״ב    │ב │   ← 62 × 46: tap the number for amud א, the strip for amud ב
└──────────┴──┘
```

- Number: `--serif-he`, 19px, gematria via `HebCal.gematria` (the same call `viewMasechta`
  uses at `app.js:816`).
- The `ב` strip is 26px wide (34px on phone, where the grid drops to 4 columns), separated by
  a `--hair` hairline, `--ink-faint` at rest, `--accent` on hover.
- 6 columns desktop / 4 phone, `gap: 4px`.
- Pane head carries one quiet line: *tap the daf for* `א` *· tap the edge for* `ב`.

Marks — deliberately capped at three so the grid stays quiet:

| State | Mark | Source |
|---|---|---|
| currently reading | filled `--accent`, ivory text, `aria-current="page"` | `box.dataset` |
| learned | `✓` in `--ok` (bottom-right, 9px) | `isLearned()` (`app.js:228`) |
| today's daf | 1px `--gold` ring | `DY.dafForDate()` |

Dapim with no shiur yet render at `--ink-faint` rather than `--ink` — the same weight cue
`.drow.future` already uses (`styles.css:235`) — so "which dapim has the Rov given" is
readable at a glance without another glyph.

**Trap:** Tamid. `amudKeysFor("Tamid", 26)` returns `["25b", "26a", "26b"]` — Tamid's opening
Mishnah sits on Vilna 25b (`app.js:1043`). The daf-26 cell must offer three targets, not
two, or that amud becomes unreachable from the picker. This is the one place the grid cannot
assume two amudim per daf; build cells from `amudKeysFor`, never from `[d+"a", d+"b"]`.

---

## 5. Why it does not interrupt anything

| Risk | How it is prevented |
|---|---|
| Re-render destroys the playing `<video>` | The picker never calls `route()`. It goes through the same in-place commit the ‹ › arrows use. |
| A modal scrim dims the video | `.jp-scrim` is fully transparent. `#mask` is never used. |
| The panel covers the picture | It is pinned to the rail's *bottom* edge and only ever grows downward, over the daf text. |
| Body-scroll lock jars the page | No scroll lock. The panel re-anchors on scroll instead. |
| A queued arrow flip lands after the jump | Bump the epoch (`resetGemaraFlipTransactions()` / `Reader._flipEpoch++`) before dispatching a jump, exactly as the existing guards do. |
| Audio pauses on navigation | `Player.audio` is a persistent `<audio>` outside `#view` and is untouched either way. |

---

## 6. The built-in Now / Today button

State machine, pure and unit-testable:

```js
function jumpNowTarget() {
  const bar = $("#player");
  const up  = bar && !bar.classList.contains("hidden");        // a shiur is loaded in the transport
  const k   = Player.lec && Player.lec._dk;
  const t   = DY.dafForDate(new Date());
  if (up && k && k.daf && DY.BYEN[k.masechta]) {
    const live = Player.media && !Player.media.paused && !Player.media.ended;
    const same = t && t.masechta === k.masechta && t.daf === k.daf;
    return { kind: "now", masechta: k.masechta, daf: k.daf,
             video: Player.isVideo, live, alsoToday: !!same };
  }
  return t ? { kind: "today", masechta: t.masechta, daf: t.daf } : null;
}
```

Rendering:

| State | Button |
|---|---|
| video playing | `▦ Now playing` · `חולין קח` · `Chullin 108` |
| audio playing | `♪ Now playing` · … |
| loaded but paused | `♪ Paused at` · … |
| playing daf **is** today's daf | `♪ Now playing · today's daf` (one button, not two) |
| nothing loaded | `✦ היום — Today's daf` · `חולין קח` · `Chullin 108` |
| target is what you are already reading | `✓ You're reading this` — the action closes the panel and scrolls to `dafTopScroll()` instead of re-committing |

The `♪` / `▦` glyphs are `Player.bar()`'s own `ptype` marks (`app.js:3130`) and `svgVideo`
(`app.js:2720`), so the button reads as the same object as the bottom transport.

**When something is playing and it is *not* today's daf, a second quiet chip appears beside
it: `היום ✦`.** Your sentence reads most naturally as "the button's identity toggles with
playback state", which is what the table above does — but it can also be read as a manual
two-way toggle. The secondary chip satisfies both readings for the cost of ~30px, and means
today's daf is never more than one tap away regardless of what is playing. Flag if you want
it dropped.

**Live update.** Playback can start or stop while the panel is open (you can start a shiur
from the reader's `#rdPlay`). Add `syncJumpNow()` — a one-button re-render, no-op when the
panel is closed — called from `Player.bar()`, `Player.ctrls()` and `Player.hide()`. Three
one-line call sites.

---

## 7. Search / filter

The input accepts what people actually type. Grammar, evaluated in this order:

- masechta token — `DY.normalizeMasechta()` (`dafyomi.js`, already handles ~90 spellings)
  or a Hebrew name substring against `m.he`;
- number — Arabic `\d{1,3}` **or** a gematria token;
- amud — trailing `a` / `b` / `.` / `:` / `׃` / `א` / `ב`.

`"chullin 102b"`, `"חולין קב:"`, `"בבא מציעא 8"`, `"102"` (within the masechta already
selected) all resolve. A resolved reference aims the grid at that daf — a soft accent ring on the cell, scrolled
into view; <kbd>Enter</kbd> jumps. A masechta-only match selects that masechta's pane.

**Built — one thing the plan got wrong.** Filtering the masechta list on the whole query
emptied it the moment you finished typing a reference: `"bava metzia 8b"` matches no
masechta by substring. `parseJumpQuery` now also returns `name` — the part of the query
that named the masechta, with the number and amud removed — and the list filters on that.
When even `name` matches nothing but the reference *was* understood (`"daf 8 bava metzia"`),
the list stays full rather than going blank; when nothing was understood at all (`"zzz"`),
the honest empty state stands.

Gematria parsing does not exist yet in either direction we need. Don't write a parser —
invert the one that already works:

```js
let _gemRev = null;
function gematriaValue(s) {
  if (!_gemRev) { _gemRev = new Map();
    for (let n = 1; n <= 400; n++) { const g = window.HebCal?.gematria(n); if (g) _gemRev.set(g, n); } }
  return _gemRev.get(String(s).replace(/[׳״'"]/g, "").trim()) ?? null;
}
```

One pass, 400 entries, built lazily on first use. It is correct by construction because it is
the inverse of the function that renders every number on the site.

---

## 8. Keyboard and accessibility

- Trigger: `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls="dafJump"`. Enter/Space
  opens; focus moves to the search input (desktop) or the daf grid's current cell (phone).
- The global `keydown` listener (`app.js:3188`) gets a new **first** branch:

```js
const pop = $("#dafJump");
if (pop && !pop.hidden) {
  if (e.key === "Escape") { e.preventDefault(); closeJump({ restoreFocus: true }); return; }
  if (trapDialogTab(e, pop)) return;      // existing helper, app.js:3180
  if (jumpGridKey(e)) return;             // ↑↓←→ Home End PageUp PageDown inside the grid
  return;                                  // arrows must never fall through to a daf flip
}
```

  It must come before the `Reader.open` and `route.name === "daf"` branches, or arrow keys
  inside the panel would flip the daf underneath it.
- Grid arrows move by ±1 cell horizontally and ±(columns) vertically, wrapping into the
  previous/next masechta at the ends; Home/End go to the first/last daf of the masechta.
- Closing returns focus to the trigger. Because `patchDafColHead` preserves the rail's DOM
  identity across flips (`app.js:956`), the trigger survives a flip with focus intact — the
  same property the arrows already rely on.
- Every jump announces through the existing `announceAmud()` live region (`app.js:1843`).
- Targets: pill 38px inside a 53px rail; grid cells 46px tall; the `ב` strip is 26px wide
  (34px on phone) — under the 44px ideal, which is the one deliberate compromise in this
  design and the first thing to revisit if QA finds it fiddly. Fallback if it does: switch
  the grid to `.drow`-style rows (`דף ק״ב  [א] [ב]`, 44px each) and accept the longer scroll.

---

## 9. Jump mechanics — the refactor that makes this small

`gemaraFlipOnce` (`app.js:1870`) and `readerFlipOnce` (`app.js:2066`) each do the same
careful ~40-line sequence: prepare the destination while the old page is still live, capture
the outgoing frame, hold the pager intent, swap `dataset`, commit, restore scroll, announce,
settle. The **only** thing a jump changes is how the destination is chosen.

**Phase 0 — pure refactor, no behaviour change:**

```js
// before:  async function gemaraFlipOnce(dir, intent, epoch) { … const nx = amudStep(…); …40 lines… }
// after:
async function gemaraFlipOnce(dir, intent, epoch = _gemaraFlipEpoch) {
  const box = $("#dafText"); if (!box) return;
  const cur = box.dataset.amud || amudKeysFor(box.dataset.mas, +box.dataset.daf)[0];
  const nx  = amudStep(box.dataset.mas, +box.dataset.daf, cur, dir); if (!nx) return;
  return gemaraGoTo(nx, intent, epoch, dir);
}
async function gemaraGoTo(nx, intent, epoch = _gemaraFlipEpoch, dir = null) { …the 40 lines… }
```

Same split for `readerFlipOnce` → `readerGoTo`. Ship and verify the arrows are untouched
**before** any picker code lands. The picker then calls `gemaraGoTo` / `readerGoTo` with an
arbitrary destination and inherits every guard for free.

**Transition choice.** `RM.transitionFor()` (`reader-model.js`) models a physical sefer:
same leaf → page turn, adjacent → spine shift. A jump from Chullin 102b to Berachos 2a is
neither; animating it as a spine shift would claim a contiguity that isn't there. So:

```js
const adjacent = (from, to) =>
  ["1","-1"].some(d => { const s = amudStep(from.masechta, from.daf, from.amud, +d);
                         return s && s.masechta === to.masechta && s.daf === to.daf && s.amud === to.amud; });
```

Adjacent jump → the normal flip motion, identical to pressing the arrow. Long jump → no
`beginPageFlip`; commit and run `restartAnim(box, "col-switched")`, the soft fade the column
switcher already uses (`app.js:1443`). Cheaper, safer, and honest about what happened.

**Where the page route stands after a jump.** Nowhere — deliberately. You jump to Berachos 2
and the page header still says `חולין דף קח` with the Chullin 108 shiur playing, exactly as
it already does when you press ‹ enough times. To give the route an escape hatch without
cluttering the grid, a long jump raises the site's existing toast:

> Reading **Berachos ב** · [Open its shiur page]

`toast()` already takes HTML (`app.js:3173`) but returns nothing, so it needs a one-line
change to return the node for wiring. That action *does* call `route()` and will restart an
in-page video at its saved spot — which is the documented existing behaviour of `#pNow`
(`app.js:3143`), and it is opt-in, so the "never interrupt" contract holds.

---

## 10. Files touched

| File | Change |
|---|---|
| `app.js` | `dafColHead()` — trigger markup. `patchDafColHead()` — sync the trigger's `aria-label`/`title` alongside `.folio-current` (**not** `aria-expanded`; the live button owns that). `renderShell()` — mount `#dafJump` + `#jpScrim`. `wireView()` `dr.onclick` and `renderDafReader()` `body.onclick` — a `[data-dafjump]` branch; add `[data-dafjump]` to both `rememberControlIntent` selectors so a jump preserves the rail's viewport position exactly like an arrow; do **not** add it to the `onmousedown` `preventDefault` list (the trigger must keep focus). `gemaraFlipOnce`/`readerFlipOnce` — the §9 split. Global `keydown` — the new first branch. `Player.bar/ctrls/hide` — `syncJumpNow()`. `toast()` — return the node. New section: `openJump/closeJump/positionJump/renderJump/jumpToAmud/jumpNowTarget/syncJumpNow`. |
| `styles.css` | `.folio-jump`, `.folio-caret`; `.jump-pop`, `.jp-scrim`, `.jp-head`, `.jp-now`, `.jp-find`, `.jp-panes`, `.jp-mas`, `.jp-daf`, `.jp-cell`; `html.is-phone` overrides; a `prefers-reduced-motion` entry beside the existing one at `styles.css:1047`. |
| `jump-model.js` *(new)* | Pure, DOM-free: `amudCatalog`, `parseJumpQuery`, `gematriaValue`, `isAdjacent`, `nowTarget`. Loaded from `index.html` next to `reader-model.js`. **Built:** also took `amudKeysFor` / `amudStep` / `dafStep` out of `app.js` — same bodies, now unit-tested, and Tamid's three-amud page encoded once for every caller. `parseJumpQuery` also returns `name`. |
| `index.html` | One `<script>` tag; bump the `?v=` cache-buster on all five assets (the site versions them together — `index.html:15`). |
| `tests/jump-model.test.mjs` *(new)* | See §11. |
| `QA-HARDENING-LOG.md` | Manual-QA entry, per repo convention. |

Nothing in `data/`, `build/`, `admin/` or `admin-api/` is touched.

---

## 11. Tests

The repo's convention is `node --test tests/` over pure modules with no DOM
(`tests/reader-model.test.mjs`). `jump-model.js` is written to fit that, importing
`hebrewcal.js` the way the existing test imports `reader-model.js`.

**Built:** 17 unit tests, passing alongside the 14 pre-existing ones —
`node --test tests/*.test.mjs` → 31/31.

**Unit (`tests/jump-model.test.mjs`):**
- `amudCatalog("Tamid")` starts `25b, 26a, 26b` and `amudCatalog("Chullin")` is 282 entries
  (2a–142b) — the Tamid trap, locked down.
- Every masechta in `DY.SHAS` yields `(lastDaf − firstDaf + 1) × 2` amudim except Tamid (+1).
- `gematriaValue` round-trips `HebCal.gematria(n)` for n = 1…400, and tolerates `׳`/`״`.
- `parseJumpQuery`: `"chullin 102b"`, `"Chullin 102"`, `"חולין קב:"`, `"בבא מציעא 8"`,
  `"102"` with a current masechta, `"berachos 999"` (out of range → masechta only),
  `""` → null.
- `isAdjacent`: 102b↔103a true; 102b↔102a true; 102b↔104a false; last daf of Chullin ↔ first
  of Bechoros true (crosses masechtos in Shas order).
- `nowTarget`: video playing → `now`; audio paused but bar up → `now` + paused; bar hidden →
  `today`; playing daf === today's daf → `alsoToday`; no `_dk` (a non-daf shiur, e.g. a
  parsha or hesped) → `today`.

**Manual QA checklist** (logged in `QA-HARDENING-LOG.md`):
1. Start a **video** on a daf page, scroll to the rail, open the picker, jump to another
   masechta — the video must still be playing, at the same timestamp, un-dimmed and unhidden.
2. Same with **audio**, and with the bottom transport mid-shiur.
3. Same from inside the **full-screen reader**, with the video playing on the page behind.
4. Jump, then press ‹ — the arrow steps from the *new* position.
5. Rapid: open, jump, immediately jump again, then arrow — no stale frame, no orphaned
   `.pflip` clone.
6. Reload after a jump — the URL's `&read=` restores the jumped-to amud (within the one-hour
   `POS_TTL` window).
7. Phone view (`📱 Phone view` in the site menu), iPhone safe area, and `dy-min` collapsed
   chrome — the panel stays anchored to the rail as the header retracts.
8. Keyboard only: Tab to the head, Enter, type `chullin 102b`, Enter, Esc — focus lands back
   on the head.
9. VoiceOver: the head still reads as a level-2 heading; the button announces "go to another
   daf"; the jump is announced through `#readStatus`.
10. Shekalim / Kinnim / Middos — jumping shows the existing explanatory line with a working
    rail, not an error.

---

## 12. Phasing

| Phase | Scope | Ships |
|---|---|---|
| **0** | The `gemaraGoTo` / `readerGoTo` split. No user-visible change. | Verify arrows are byte-identical in behaviour before anything else lands. |
| **1** | Trigger, panel, masechta list, daf grid, Now/Today button, in-place jump, toast escape hatch. | The feature you asked for. |
| **2** | Search/filter + gematria parsing + grid keyboard navigation. | Power-user path. Can merge into 1 if you'd rather ship once. |
| **3** | Same picker on the **parsha** rail (`parshaColHead`, `app.js:2485` — it renders a `.daf-flip-lbl` too, so people *will* tap it once they learn the daf one is live): Chumash → parsha. | See the caveat below. |
| **4** | Reduced-motion pass, `dy-min` interaction polish, QA log entry. | |

**Phase 3 caveat, stated plainly:** there is no in-place parsha swap in this codebase — the
parsha page's own navigation calls `route("parshaS", …)` (`app.js:2880`). So a parsha jump
re-renders the view and restarts an in-page video at its saved spot. That is not a
regression (its existing arrows already do exactly this), but it does mean the daf picker's
"never interrupts" guarantee does not extend to the parsha rail until an in-place parsha
swap exists. Phase 3 should ship with that difference visible in the UI (the panel routes,
and says so), or wait for a `parshaGoTo` sibling to `gemaraGoTo`. My recommendation: ship
Phases 0–2 first, then decide.

---

## 13. Decisions made, and what was rejected

| Decision | Why | Rejected alternative |
|---|---|---|
| Popover anchored to the rail | Discreet; opens downward over text, never over the video | The left drawer (`.menu`) — modal, full height, dims everything with `#mask`, and refuses to open over the reader |
| Transparent dismiss layer | The whole point of "doesn't interrupt" | `#mask` at 40 % black + blur |
| Never call `route()` on a jump | The only way a playing `<video>` survives | Routing to the daf page, which is what tapping a daf anywhere else on the site does |
| Grid of **dapim** with a `ב` edge strip | 176 scannable cells for Bava Basra instead of 352 | A flat amud grid (double the cells); `.drow`-style rows (44px targets but ~7,700px of scroll for Bava Basra) — kept as the documented fallback |
| Extract `gemaraGoTo` rather than write a new jump path | Inherits every epoch/intent/scroll guard already hardened in this file | A fresh commit path, which would re-litigate every bug the flip path already fixed |
| Fade for long jumps, flip for adjacent | A page-turn animation asserts contiguity that a jump across Shas doesn't have | Always flip |
| Invert `HebCal.gematria` for parsing | Correct by construction | Hand-writing a gematria parser |
| Secondary `היום` chip when playback ≠ today | Covers both readings of your sentence for ~30px | Picking one reading and being wrong |

---

## 14. Open questions

1. **The `היום` chip** (§6) — keep it, or make the button strictly one-or-the-other?
2. **Phase 3 (parsha rail)** — ship it knowing it routes and interrupts, or hold until an
   in-place parsha swap exists?
3. **The toast escape hatch** (§9) — worth it, or should a long jump be silent?
4. **Marks in the grid** — I capped it at three (reading / learned / today) plus a weight cue
   for "shiur exists". Is "which dapim has the Rov given" important enough to earn its own
   glyph?
