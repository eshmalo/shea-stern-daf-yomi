# UI facelift — working log

Owner asked (2026-08-18) for several cycles of iteration on the UI: perfect what's
there, add the missing details and niceties, keep it minimal, work on look, feel and
effects, test and review everything, fix what surfaces.

**This file is the durable state.** If the session is compacted, start here: the
cycle table says what is done, what is open, and what was deliberately rejected.

## Rules for this work
- Minimal. The site's character is a printed sefer: warm ivory, deep maroon rubric,
  restrained gold. Nothing added should read as "app chrome".
- No feature creep. Polish, consistency, and correctness only.
- Every cycle: audit → fix → verify in the browser → record here.
- Bump `index.html`'s cache-buster on every shipped cycle.
- Tests must stay green (`node --test tests/*.test.mjs`).

## Cycles

| # | Theme | Status |
|---|---|---|
| 1 | Audit sweep — gather real defects across every surface | done |
| 2 | Touch feel: press states, tap highlight, hit areas, scrollbars | done |
| 3 | Make the picker native; motion audit | done |
| 4 | Sizing systems — content-driven grid, the grid min-width trap | done |
| 5 | Typography & rhythm — eyebrows, empty/loading states | next |
| 6 | Surface pass — cards, rules, ornament, the Today page hierarchy | planned |

## Findings

### Cycle 1 — audit (2026-08-18)

Swept all 15 routes plus the reader and both rails, at 320 / 390 / 744 / 1280 and
844×390 landscape. Measured rather than eyeballed.

**Confirmed — and the biggest one is invisible on a desktop:**

1. **Press feedback is missing almost everywhere.** `:active` is declared on five
   selectors in the whole stylesheet (`.navbox`, `.boxback`, `.daynav`, `.pageflip`,
   `.ng`). Everything else — `.btn`, `.seg button`, `.drow-main`, `.row-main`,
   `.mi`, `.fs-btn`, `.learn-toggle`, `.textlink`, `.sp-opt`, the picker's own
   controls — has a hover state and nothing else. On a touch screen hover never
   fires, so most of the site acknowledges a tap only when the screen changes.
2. **`-webkit-tap-highlight-color` is unset**, so iOS paints its default grey box
   over these warm-paper surfaces.
3. **Scrollbars are unstyled** — a stock grey/blue bar inside the picker's panes and
   the reader body, against ivory.
4. **`accent-color` unset** — the player's scrub range renders in browser blue.
5. **`-webkit-text-size-adjust` unset** — iOS Safari can inflate text in landscape.
6. Touch targets under 44px: `.bar-nav button` (54×34, on every page), `.row-fav`
   (38), `.row-play` (40), `.folio-jump` (38), the chapter `select` (38).

**Already good, left alone:** `:focus-visible` coverage is thorough and per-shape;
`::selection` is themed; three `prefers-reduced-motion` blocks; `overscroll-behavior`
is set where it matters. The view fade is catchable in a screenshot but correct.

**False positive:** the parsha page's `.row-main` buttons looked unnamed to the
sweep — they sit inside a closed `<details>`, so `innerText` was empty. Verified
named when open.

### Cycle 2 — touch feel (2026-08-18)

One press convention across the whole site, in three shapes: **raised** controls sink
1px, **flat** ones deepen their wash, **filled** ones deepen their fill. Applied to
every control that previously had hover and nothing else. Nothing changes at rest.

Also: `-webkit-tap-highlight-color: transparent` (iOS was painting a grey box over
warm paper), `accent-color` set to the maroon so the player's scrub stops rendering
in browser blue, `text-size-adjust: 100%` against iOS landscape inflation, and
hairline scrollbars in the picker panes, reader body, menu and daf list.

Hit areas: `.bar-nav button` 34px → 44px of target, and the round row buttons and the
folio trigger likewise, all via an `::after` overlay so nothing moves. Verified a click
3px above a bar-nav button lands on it, and that neighbouring overlays meet cleanly in
the gap rather than stealing each other's taps.

**Measured, then reverted — two changes that cost more than they bought:**
- Raising the chapter `<select>` to 44px grew the sticky parsha rail from 51 to 62px.
  Permanent reading space for a secondary control: not worth it, left at 38px.
- Shortening the parsha rail's trigger to claw that back. Measurement showed the rail
  is 62px whatever the trigger does — its 44px fullscreen button and the select set the
  height — so the trigger stays 38px and matches the daf rail.

### Cycle 3 — the picker becomes native, and a motion audit that mostly said "leave it" (2026-08-18)

**Motion audit — no mass rewrite.** 96 transitions cluster at .12/.13/.14s: three
spellings of one duration. Unifying them into tokens would be a large mechanical diff
for something nobody can see, so it was left. No `transition: all` anywhere. Fifteen
keyframes, all reachable. Reduced-motion is already complete — a global
`*, *::before, *::after` reset at `styles.css:1343` covers everything.

**Removed my own cycle-2 rule.** I had cancelled the 1px press for reduced-motion
users. That was wrong: a press is tactile feedback, not vestibular motion, the global
reset already makes it instant, and cancelling it left those users with no feedback at
all on raised controls. Reverted.

**Made the picker native.** The site's two list idioms (`.row`, `.drow`) are already
identical and good — a 2px accent rule that scales in on hover. The picker's own rows
were the inconsistent ones, so they now use the same device, and the current row's
duplicate left border was dropped in favour of it. Sponsor cards gained the same lift
`.navbox` has, since they are the same kind of selectable card.

### Still open
- Cycle 4: typography rhythm — the type scale is consistent but eyebrow labels,
  empty states and the "Loading the daf…" line are plainer than the rest.
- Cycle 5: the Today page's two primary buttons read at the same weight, so the
  hierarchy between "Sponsor today's daf" and "Read the daf" is ambiguous.
- Not a bug, worth knowing: the parsha rail is 62px against the daf rail's 53px,
  set by its 44px fullscreen button and the chapter select.

### Cycle 4 — sizing that works itself out (2026-08-18)

Owner spotted daf numbers and the ב strip being hidden for lack of room, and asked
for a system rather than more hand-tuning. Both bugs found were the same shape: a
size decided somewhere that had no idea how wide the content was.

**1. The daf grid was told its column count.** `jp-narrow`/`jp-wide` set 3, 4, 6 or 7
columns from the *panel's* width — but the grid lives in the 56%-wide pane, so a 600px
panel produced 42px cells: 26px of amud strip and **16px left for a label needing 29px**.

Replaced every hardcoded column count with one rule that has no breakpoints:

```css
.jp-grid { grid-template-columns: repeat(auto-fill, minmax(var(--jp-cell-min), 1fr)); }
```

`--jp-cell-min` (68px) is the widest gematria in Shas — three Hebrew glyphs, ~29px —
plus the strip plus air. The strip is a token beside it, so a coarse pointer widens
both together and they can never drift apart. Same panel now: 4 columns of 76px,
**50px for that 29px label**. At 320px it settles to 3 columns of 90px by itself.

**2. The Today page scrolled sideways at 320px** — 387px of content in a 320px window,
on the site's most-visited page. `.cont-row` is a grid item, so `min-width: auto` refused
to shrink below its content and `width: 100%` could not override it; the ellipsis already
on `.cont-main b` never got the chance to fire. One `min-width: 0` fixes it.

**The conformity check.** `scrollWidth` does not catch this class of bug — centered text
overflows its box and reports no scroll. The sweep now measures each leaf's actual text
ink with a Range against its content box, and runs over all 15 routes. Result at 320px
and 375px: clean, no clipping and no horizontal overflow anywhere.
