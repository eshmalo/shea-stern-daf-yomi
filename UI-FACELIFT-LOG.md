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
| 3 | Motion & effects — transitions, easing, reduced-motion parity | next |

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
