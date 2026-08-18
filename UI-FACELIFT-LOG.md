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
| 5 | Typography — one eyebrow scale; empty & loading states | done |
| 6 | Today page hierarchy — the primary action leads | done |
| 7 | Sharing & the home screen — OG cards, manifest, icons | done |
| 8 | Print, skip link, and a guaranteed 404 | done |

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

### Cycle 5 — one label, three sizes (2026-08-18)

The uppercase micro-label is the site's most repeated device, and it had been written
**20 times across 7 font sizes and 12 tracking values** — from .05em to .2em — with no
relationship between the two. That is the typographic version of the hardcoded column
counts: a value set locally each time, by hand, drifting.

Three tokens now, and they encode the actual rule — *tracking widens as size drops*,
because small caps need more air:

| token | size | tracking | used by |
|---|---|---|---|
| `--eyebrow-lg` | 11.5px | .13em | section heads, form labels, top-bar sections |
| `--eyebrow-md` | 11px | .15em | captions under a title, reader/toolbar labels |
| `--eyebrow-sm` | 9.5px | .17em | picker rows, tags, badges |

Colour and weight are deliberately **not** tokenised — accent vs ink-soft vs ink-faint
carries meaning, and flattening it would lose information. 15 rules moved onto the scale.
`.today .eyebrow` keeps its .2em: it is a display eyebrow, not a caption.

Empty and loading states were bare centred italic — the weakest moment in the UI, and
the daf one appears while a 2–3MB text file loads. They now carry the gold ❦ that
already closes an amud, and the loading one breathes gently (the global reduced-motion
reset stills it).

Widening tracking widens labels, so the clip sweep was re-run at 390 / 768 / 1280:
clean. It did surface a **false positive in my own check** first — `.bar::before` is an
absolutely-positioned 100vw scrim by design, which inflates `scrollWidth`. The sweep now
judges overflow on real in-flow children.

### Cycle 6 — the primary action leads (2026-08-18)

On a daf whose shiur has not been given yet, the Today page offered `✦ Sponsor today's
daf` in accent and **Read the daf** as a plain outline button. Reading the daf is what
the page is *for*; sponsorship was outranking it purely by styling.

Read the daf now leads and wears the solid treatment — the same slot `▶ Listen` occupies
when a shiur exists, so the two states of the page finally match. Sponsorship keeps its
accent colour and its ✦ and simply stops outranking the daf. Nothing was removed.

**Owner call:** this touches how prominently sponsorship is offered. It is a styling and
order change only — the button, its wording and its ornament are untouched — but say the
word and it goes back.

### Still open
- Dead CSS: `.editor` rules remain although the public editor was removed in admin v2
  (`class="editor` appears 0× in app.js). Left alone — a separate cleanup, not a facelift.
- The parsha rail is 62px against the daf rail's 53px, set by its 44px fullscreen button
  and the chapter select. Not a bug; noted so nobody re-measures it a third time.

### Cycle 7 — what a shared link looks like (2026-08-18)

The site has a Share button, and sharing is how a daf actually travels between people.
Until now a shared link previewed as a **bare URL** in WhatsApp, iMessage and Telegram:
no Open Graph tags at all. Added og:/twitter: cards using `assets/artwork-512.png` — the
same square the OS Now Playing card already uses, so nothing new was invented. Hash
routes are invisible to crawlers, so the card describes the site rather than the daf;
per-daf cards would need server-side rendering.

Also a **web app manifest** and an apple-touch-icon. This is a site opened every single
day, and added to a home screen it was a generic bookmark that opened inside browser
chrome. It now has its own icon, its own name (`הדף היומי`), and opens standalone.

### Cycle 8 — printing, keyboards, and a 404 on every visit

**Print.** There were no print styles at all, so printing a daf produced a screenshot of
an application: top bar, transport, toolbars and all. `@media print` now drops everything
that operates the site and keeps the paper — the sticky rail becomes a plain printed
running head, the wide-reading breakout collapses back to the page, rubric colour gives
way to weight, and `.dafpage` avoids breaking across sheets.

**Skip link.** A keyboard user met the bar, four section buttons and search before any
daf. One link, invisible until focused. It was written `position: absolute` first, which
is the common form — but absolute is relative to `#app`, so focusing it mid-page revealed
it above the fold where nobody could see it. It is `position: fixed` now.

**A 404 on every visit to a text-less masechta.** `loadDafComm` fired a request for
commentary the index already said did not exist — a guaranteed 404 and a console error
for Shekalim, Kinnim and Middos. Guarded with the same check `loadDafText` already used.

### Verification note
The browser pane defers layout and cannot focus the document, so `:focus` never matches
and transform changes do not re-measure. The skip link's *reveal* is therefore verified
by inspection of the served rule, not by measurement — everything else in these two
cycles was measured. Worth knowing before trusting a future measurement of a `:focus` or
`:hover` state in this environment.

### Cycle 9 — the top bar was broken on every desktop page (2026-08-18)

Grounded in a six-lens audit (states, a11y, responsive, motion, dead code, bug hunt) with
every finding put to an adversarial verifier before it was allowed to count. 34 distinct
findings, 15 verified; the ones below are the ones I then re-measured myself.

**The top bar wrapped to two lines on every page except home.** Measured at 1280px: going
from Today to any other route grew `.bar` from 65px to **89.03px** — the site's own Hebrew
wordmark broke in half (34px → 68px) and the four nav labels split across two rows. Cause:
the back button appears on every non-home route and asks for ~54px the 720px shell doesn't
have, and nothing was protected against wrapping. Fixed with `white-space: nowrap` on the
wordmark and the nav labels, `gap` 10px → 6px (the value `html.is-phone .bar` already used),
and nav padding 9px → 6px. Now 65px and one row on every route, with 37.5px of slack left in
the spacer.

**And the sticky reading rail docked under it.** `--bar-h` was measured on load, on resize
and in phone-view — never on navigation. So the rail stuck at a stale 65px while the real
bar bottom sat at 89px: a 24px overlap band, on the rail that carries the daf title and the
page-turn arrows. `updateBackBtn()` now re-measures; it is the one function every navigation
path already calls. Verified: colhead `top` == bar bottom == 65px on the daf page.

**Correctness the audit turned up, each re-read before fixing**
- `announceAmud` pushed *"Reading position restored"* into the live region on **every** page
  turn and picker jump. On a forward turn to an amud you have never seen, `restoreColScroll`
  goes to the top — nothing is restored. It now announces what loaded.
- The folio picker declared `aria-modal="false"` while being modal in every other respect —
  full-viewport scrim, hard Tab trap, Escape to close — and never made `#app` inert, unlike
  the menu and the reader. Both fixed; `#app`'s inert is left alone if a dialog that outranks
  the picker is still up.
- Closing the picker by its scrim was the one close path of five that stranded focus.
- **The picker's "no match" state was invisible on every phone.** The message rendered into
  the masechta pane, which a narrow panel hides (`display: none`, measured). Typing a typo
  produced no feedback at all. It now also shows in the pane you are actually looking at,
  scrolled into view — the grid is parked at the current daf, so the message needed pinning.
- `pane.querySelectorAll(".jp-cell.jp-aim").forEach(n => n.classList.remove("aim"))` — the
  class is `jp-aim`, so the aim highlight was **never cleared** and stale highlights piled up
  across queries. Both call sites fixed. Verified: exactly one highlight after each query.
- Today was the only route with no level-1 heading, so the app's own `focusPrimaryHeading()`
  found nothing and silently did not move focus on the site's default page.
- The section nav had no "you are here" at all. `aria-current` now follows the *section* —
  a daf is still Shas, a parsha's shiurim are still Parsha — with a hairline under the label.
- Sponsor form: changing the masechta updated state and repainted nothing.
- Tamid took a **404 on every visit**: it has Gemara but no Rashi/Tosafos, and cycle 8's
  guard keyed on whether a masechta has *text*. `_index.json` now carries a `comm` flag,
  stamped from disk by `build/extract_commentary.py` (the script that actually knows). A
  missing flag still means "ask", so an unstamped index behaves exactly as before.

**Feel**
- `.reader-bar .rd-ic`, `.tsize button`, `.bar .ic-btn` and `.menu-close` were the last flat
  icon controls absent from the site's own press-state block — no tap feedback at all.
- `.jp-x` and `.menu-close` declared no `transition`, so they snapped while their immediate
  row-mates eased.
- `.menu`'s slide was the only panel transform left on the browser-default `ease`.
- `.prog-fill`'s `transition: width` could never fire — `[data-learn]` exists only on the daf
  page (app.js:876) and that page has no progress bar, so nothing ever changed a bar's width
  outside a full `innerHTML` swap. Replaced with a `@keyframes progGrow` entrance, which
  keeps the correct width in the HTML at all times: no JS, no frame callback that could leave
  the bar reading zero in a background tab.

**Dead CSS removed** (each proved dead against every source, not just `app.js`): the `.editor`
block (public editor removed in admin v2 — "editor" survives only in a comment), `.amud
.amud-label`, `.boxcol-top` (`boxcol` is only ever used bare), `.reader-bar .rd-seg` (not one
of the eight `rd-` classes app.js emits).

**Regression checks** — 39/39 tests; playback verified across a picker jump (same `<audio>`
node, still playing, clock 1.76s → 4.83s); the cycle-4 clipping sweep clean at 375/820/1280
across every route (only hit is `.sr-only`, clipped by design); Tamid 26 still opens on 25b
with all three amudim.

### Cycle 10 — the Kinnim/Tamid leaf, researched and settled (2026-08-18)

Cycle 9 left this open on the grounds that the fix direction depended on where
Kinnim's text actually ends in the Vilna Shas, and that guessing would encode a wrong
claim about Shas pagination into a Torah site. Researched; the answer is not close.

**Four independent sources agree.** Two are in this repo:
- `data/daf/Meilah.json` ends at **22a**, and its last line is Meilah's own hadran —
  `הדרן עלך השליח שעשה שליחותו וסליקא לה מסכת מעילה`. Meilah closes on 22a.
- `data/daf/Tamid.json` begins at **25b**, and that amud carries Tamid's opening
  Mishnah, `בשלשה מקומות הכהנים שומרים בבית המקדש`. Tamid opens on 25b.

Two are external:
- Sefaria's index API for Tamid gives its first chapter as `Tamid 25b:1-28b:7`.
- Wikipedia's Kinnim article states the tractate "occupies folios 22a-25a".

So the Meilah volume runs Meilah 2a–22a, **Kinnim 22a–25a**, Tamid 25b–33b, Middos
34a–37b. **Kinnim ends on 25a. Vilna 25b is Tamid's.** `amudKeysFor("Kinnim", 25)`
now returns `["25a"]`, and the duplicate stop is gone.

Walking the boundary one amud at a time was
`Kinnim 24b → Kinnim 25a → Kinnim 25b (blank) → Tamid 25b (the same page, with the
Mishnah) → Tamid 26a`. It is now
`Kinnim 24b → Kinnim 25a → Tamid 25b → Tamid 26a`. Measured in the app: from Kinnim
25a, **one** press of the forward arrow lands on Tamid 26 amud 25b with its text.

**22b deliberately left alone.** The mirror rule would be wrong. 22b is Kinnim's page,
it is already reachable exactly once (inside Meilah's daf 22, which is what Daf Yomi
calls that daf), and no second masechta claims it. Adding it to Kinnim 23 would create
a *new* duplicate; removing it from Meilah 22 would make the leaf unreachable. The
Tamid rule exists to expose real text that would otherwise be stranded, not to model
the volume's pagination exhaustively — that is now written into the function.

**A second bug the fix exposed.** With Kinnim 25b gone, the step across the boundary
became cross-masechta, and `samePhysicalLeaf` required `from.masechta === to.masechta`
— so the app animated a *shift* (facing pages across the fold) where 25a and 25b are
physically the front and back of one leaf. The guard was there for a good reason
(Chullin 25a and Berachos 25a are not the same paper), but the right test is the
printed **volume**, not the masechta: the four masechtos of this volume share an `hb`
id. `samePhysicalLeaf` now compares volumes, falling back to the masechta name when
the Shas table is not loaded — so `reader-model.js` keeps working standalone, which is
how its own test suite loads it. Verified: `Kinnim 25a → Tamid 25b` is a `turn`,
`Tamid 25b → Tamid 26a` is still a `shift`, `Chullin 25a → Berachos 25b` is still a
`shift`.

**Tests.** 39 → 41. One asserts no physical leaf in Shas answers to two masechtos,
grouped by `hb` so "same leaf" means the same printed page (`hb: 36` is the only
shared-pagination volume). An existing test — "equal folio numbers in different
masechtos are never the same leaf" — was asserting `Kinnim 25b` vs `Tamid 25b`, a
state that can no longer exist; it now tests Chullin vs Berachos, which is the case it
was really guarding. Both new assertions were negative-tested by reverting each fix in
turn (2 failures and 1 failure respectively, 0 with them restored), so neither is
vacuous. Stale `Kinnim|25|25b` bookmarks fall back to 25a — `normalizeReadSnapshot`
already validated the amud against `amudKeysFor`.

### Deliberately not changed
The sticky `.daf-colhead` animates `top` rather than `transform`, which the motion lens
flagged as inconsistent with the bar. That is how it tracks `--bar-h` while staying
`position: sticky`; converting it to a transform risks the dock the previous item just fixed.

### Cycle 11 — pick a standard, don't special-case (2026-08-18)

Cycle 10 got the ownership call right and the method wrong. Asked to look at the actual
text, review what Sefaria does, and pick a standard, three things came out.

**1. I had cited a source that contradicted my own data and not noticed.** Cycle 10 quoted
Wikipedia's "Kinnim occupies folios 22a-25a" while also asserting Meilah ends on 22a —
both can be true (22a carries the end of Meilah *and* the opening of Kinnim, which is
ordinary in the Vilna), but I never reconciled them. Reconciled now, and it is what makes
the rest fall out.

**2. What Sefaria actually does.** There is no daf-addressed Kinnim on Sefaria at all —
`/api/v2/index/Kinnim` returns *"No book named 'Kinnim'."* Only `Mishnah Kinnim` exists,
addressed by Chapter:Mishnah with no folio mapping. So Sefaria's Talmud simply *skips*
22b–25a, and its Daf Yomi calendar labels those days by Mishnah chapter — while labelling
the Meilah handover day precisely `Meilah 22a`, the amud, not the daf. Sefaria does
address 25b, and it addresses it as **Tamid 25b**. That settles ownership independently of
Wikipedia.

*(Checking that calendar also cleared a scare: a first pass suggested the site's Daf Yomi
was a day behind Sefaria. That was my own bug — I built UTC dates against a site that
works in local time. Corrected, the two agree exactly, today and across the whole volume.)*

**3. The standard.** Cycle 10 fixed one boundary with an `if` and left the mirror image
broken: **Meilah 22b showed "This amud isn't available."** — but 22b is not unavailable,
it is where Kinnim begins. A third special case would have been the wrong answer to that.

So the rule is now declared once, as data, and everything derives from it:

```
Meilah 2a–22a  ·  Kinnim 22a–25a  ·  Tamid 25b–33b  ·  Middos 34a–37b
```

*Daf Yomi names the daf; the printed volume names the page. A page belongs to the masechta
whose text is printed on it, and a shared boundary page stays with the masechta whose daf
number it is.* That last clause resolves 22a (Meilah's end and Kinnim's opening share it)
to Meilah, which makes the navigable spans partition the volume exactly. `amudKeysFor` is
now a range intersection over those spans instead of two hand-written exceptions.

What changed on the page, beyond cycle 10: `Meilah 22 → ["22a"]` and
`Kinnim 23 → ["22b","23a","23b"]`, so 22b is reachable under the masechta that is actually
printed on it and says so.

**A bug this shook out.** The short `read=Masechta|Amud` link form infers the daf from the
amud with `parseInt`, which is wrong for exactly the pages this is about. It carried a
hardcoded `masechta === "Tamid" && amud === "25b" ? 26` — which would have silently
mis-resolved `Kinnim|22b`. Replaced with `JM.dafForAmud`, which asks the model. My first
version of that helper was itself wrong (`amudKeysFor` answers for any number it is handed,
so `Tamid 25` returned `["25b"]` and the lookup resolved 25b to daf 25); the daf range has
to be checked. A test now covers every page in Shas resolving back to its own daf.

**Tests: 41 → 44.** The spot-checks became properties: the volume partitions exactly (72
amudim over 36 dapim, contiguous, no page claimed twice), every page resolves back to the
daf that holds it, and no leaf in Shas answers to two masechtos. All three were
negative-tested by reverting each fix in turn. Verified in the browser by walking the whole
volume one amud at a time: 72 pages, 72 unique, zero gaps, Meilah 2a → Middos 37b, and the
reverse walk retraces the forward walk exactly.

### Cycle 12 — the eight that were left (2026-08-18)

No new audit this cycle: the six-lens sweep from cycle 9 produced 34 findings and cycles
9–11 implemented about twenty of them. These are the remainder, each re-verified against
the code before being touched — and one of them turned out not to be real.

**A shiur that failed to load played forever in silence.** `Player._bind`'s `error`
listener only did anything when `this.local && !this.isVideo` — a local file falling back
to the hosted audio. Every other failure produced nothing at all: no retry, no message,
and a player bar still sitting there with the shiur's title on it. A remote object that
404s, a video that won't decode, or the fallback itself failing all looked identical to
the site being broken. The listener now keeps the one silent retry, then says so and
clears the bar.

The care here is in *not* firing it wrongly. Teardown looks exactly like a failure:
`rerender()` strips `src` and calls `load()` on in-page video, and an aborted load reports
`MEDIA_ERR_ABORTED`. Both are now ignored, along with an element that has no source at
all. Verified both directions: playing a shiur and navigating across four routes produces
no failure toast (only the legitimate "Resumed from 1:42"), while a genuinely dead source
with nothing to fall back to produces the message and dismisses the bar.

**The rest**
- The burger declared `aria-haspopup="true"`, which per the ARIA spec means *menu* — but
  it opens `#menu`, which is `role="dialog"`. The folio triggers beside it already said
  `dialog`. Now they agree.
- The home wordmark is `role="link"` but fired on Space as well as Enter. Space is the
  page-scroll key, so a keyboard user who happened to be focused there got navigated
  instead of scrolled. Enter only now — verified Space leaves the route untouched.
- The toast entered on a CSS `fade` (opacity plus a 4px settle) and left via inline
  `style.transition = "opacity .4s"` — different property set, different duration, written
  from JS. It now leaves by a `.toast.out` class that reverses the entrance exactly.
- `Reader._restoreScroll` was assigned in eight places and read in none. It reads exactly
  like a guard, which is what makes it worth deleting rather than leaving to mislead the
  next person. Removed; `Reader._restoreAnchor`, which looks similar, *is* live and was
  left alone. (The regex that removed it merged one statement onto the line above — caught
  by checking the diff rather than trusting "parses OK", and unmerged.)
- **A cold flip now shows that it is working.** Flipping into a masechta this session
  hasn't fetched waits on the network before it can paint, and nothing on screen said so —
  the rail just looked dead. Every flip path already sets `aria-busy`, so the cue costs no
  JS: `cursor: progress` and the rail at 60%, on a 0.28s delay so a cached flip (which
  lands within a frame) never flashes it.

### Refuted — measured, not fixed
The audit claimed the jump-to-daf placeholder clips on the ~15 masechtos with three-digit
dapim, reasoning that an 80px input with 12px padding leaves "roughly 36px" for text. It
leaves 54px. Measured the real ink of `2–176` against the real content box at both 1280px
and 375px: **45.7px and 43.2px against 54px** — 8px of headroom, no clipping, no row
overflow, no document overflow. Left alone. Two vendor-prefix fallbacks
(`-webkit-sticky`, `-webkit-overflow-scrolling`) were also flagged as inert; they are, but
they cost nothing and removing them only risks old iOS, so they stay.

### Cycle 13 — the Pass-2 hardening audits that were planned and never run (2026-08-18)

`QA-HARDENING-LOG.md` contained a five-section Pass-2 plan written after Pass 1 and never
executed. Ran all five as independent lenses, each finding put to an adversarial verifier,
then re-read by me before anything was touched. **5 confirmed, 0 refuted.**

**The XSS sweep (P2-A) found nothing** — every `innerHTML` sink and template interpolation
traced back to `esc()`/`safeEn()` or a provably safe source. That is a real result, not an
empty one: owner-editable content, third-party TorahAnytime titles, admin upload filenames
and URL parameters all reach the DOM escaped.

**Progress that silently never saved (high).** `setStore` has always returned a success
boolean — the in-app editor used it — but every user-facing writer threw it away.
`toggleFav`, `setLearned` and `noteProgress` ignored it, and the click handlers then fired
an unconditional success toast. In Safari private mode, or on a device whose quota is full,
every tap of *Mark as learned* flipped the button, showed "Marked Chullin 110 as learned ✓",
and wrote nothing — for a whole session, with the progress bar and My Learning agreeing all
the way, until the next visit when it was all gone. The boolean now propagates and the toast
branches. Measured with `Storage.prototype.setItem` forced to throw: it now says *"Couldn't
save — your browser's storage is full or blocked."* while still flipping the button, since
the in-memory state is correct for the rest of the session.

**A corrupted backup could poison the Home page (medium).** `importProgress` validated only
the top-level buckets, never the individual entries, so a hand-edited or truncated backup
with `{t:"abc"}` sailed in and the Continue card rendered **"NaN:NaN"** — `clock("abc")`
returns exactly that, verified by running it. An out-of-range learned key like
`Berachos#99999` was likewise counted, inflating Shas progress past its own total. Entries
are now shape-checked per store, and the toast reports what it skipped: *"Progress restored
✓ (2 new items · 2 unreadable entries skipped)"*.

**The catalog refresh could yank the parsha out from under a reader (medium).** `refreshLive`
guarded only `name !== "daf"`, though every other reading-surface check in the file tests
`"daf" || "parshaS"` (lines 617, 645, 691, 1752…). A user who opened a parsha in the first
second or two after load could have it replaced by a loading placeholder, and an open picker
slammed shut mid-query.

**The reader could strand you on the wrong parsha (high).** Jumping to another parsha from
inside the full-screen reader updates `Reader.parsha` but deliberately leaves the base route
and hash alone. The torah restore branch required `State.route.parsha === saved.parsha`,
which that jump makes false — so a reload reopened nothing and showed the *original* parsha,
silently. The daf branch never had that clause. Removed, making the two symmetric.

**A dismissed player stayed in the reader's Tab trap (medium).** `.player.hidden` slides the
bar away with `transform`, so it keeps its layout box and `getClientRects()` stays non-empty
— and the player is reparented inside `#reader` while the reader is open. Tabbing could land
on the off-screen ✕ of a bar the user had already closed. Fixed at the source: a hidden
player is now `inert`. That alone was not enough — `dialogFocusables` still *listed* those
controls, so the trap would compute a `last` element the browser then refuses to focus, so it
now skips `[inert]` subtrees too. Deliberately not a viewport check, which would have dropped
legitimately scrolled-out-of-view controls inside the reader.

**No fetch had a deadline.** Ten call sites, no `AbortController` anywhere: a hung request
left the boot shell, the daf, or "Downloading…" waiting forever. All now route through one
`fetchT` helper. The naive version of this fix would have been worse than the bug — the
corpus files run to 3.7MB — so it is tiered: 15s for the small boot/API JSON where a hang is
fatal, 60s for corpus and downloads, to end a dead connection without punishing a slow but
working one on a phone. Every call site already handled rejection, so aborts introduce no
unhandled failures.

**Verification note.** The reader-restore fix is confirmed by invoking
`restoreReaderFromSnapshot` directly — it returns `true` and reopens on Noach with its 64,649
characters, where the old clause returned `false`. The *automatic* boot path could not be
exercised: this browser pane runs pages with `visibilityState: "hidden"`, where
`requestAnimationFrame` never fires, and that restore is scheduled inside a rAF callback. On
a real foreground reload it runs immediately; a tab restored hidden simply reopens it when
the user looks. Same class of caveat as the cycle-8 skip link.
