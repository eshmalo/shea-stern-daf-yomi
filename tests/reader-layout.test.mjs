import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = async name => JSON.parse(await readFile(path.join(root, "data/daf", name), "utf8"));

test("Chullin 94 openings retain the traditional source order", async () => {
  const text = await json("Chullin.json");
  const comm = await json("Chullin.comm.json");

  assert.ok(text["94a"].he.startsWith("חתוכה"));
  assert.ok(comm["94a"].r[0].startsWith("חתוכה נמי לישדר"));
  assert.ok(comm["94a"].t[0].startsWith("חיתוכא דעובד כוכבים"));
  assert.ok(text["94b"].he.startsWith("אחד"));
  assert.ok(comm["94b"].r[0].startsWith("אחד מפני האנסים"));
  assert.ok(comm["94b"].t[0].startsWith("אמר אביי"));
});

test("Bava Basra hands the inner margin from Rashi to Rashbam", async () => {
  const comm = await json("Bava_Basra.comm.json");
  const attributed = Object.entries(comm).filter(([, page]) => page.rl?.includes("רשב״ם"));

  assert.equal(attributed.length, 296);
  assert.equal(comm["29a"].rl, "רש״י · רשב״ם");
  const transition = comm["29a"].r.findIndex(text => text.startsWith("[עד כאן פירוש רש״י"));
  assert.equal(transition, 5);
  assert.ok(comm["29a"].r[transition + 1].startsWith("אלמה אמר רב נחמן"));
  assert.equal(comm["29b"].rl, "רשב״ם");
  assert.ok(comm["29b"].r[0].startsWith("הכי גרסינן ומודה מר זוטרא"));
  assert.equal(comm["176b"].rl, "רשב״ם");
  assert.ok(comm["176b"].r.length > 0);
});

test("Pesachim preserves its transition page and then attributes Rashbam", async () => {
  const comm = await json("Pesachim.comm.json");

  assert.equal(comm["99b"].rl, "רש״י · רשב״ם");
  const transition = comm["99b"].r.indexOf("פירוש רבינו שמואל הרשב״ם ז״ל");
  assert.equal(transition, 9);
  assert.ok(comm["99b"].r[transition + 1].startsWith("ערבי פסחים סמוך למנחה"));
  assert.equal(comm["100a"].rl, "רשב״ם");
  assert.ok(comm["100a"].r[0].startsWith("דילמא משבשתא היא"));
  assert.equal(comm["121a"].rl, "רשב״ם");
});

test("operating controls are outside the paper and never scale", async () => {
  const app = await readFile(path.join(root, "app.js"), "utf8");
  const css = await readFile(path.join(root, "styles.css"), "utf8");

  assert.match(app, /return `<nav class="daf-colhead"/);
  assert.doesNotMatch(app, /function flipLabel[\s\S]*?data-gemflip[\s\S]*?function dafPage/);
  assert.match(css, /\.pageflip:hover \{[^}]*background:[^}]*\}/);
  assert.doesNotMatch(css, /\.pageflip:(?:hover|active) \{[^}]*transform:/);
  assert.doesNotMatch(css, /\.daynav:(?:hover|active) \{[^}]*transform:/);
  assert.doesNotMatch(css, /--dc-head:\s*calc\(/);
  assert.match(css, /side-right[^\n]*\.rashi \.cv,[\s\S]*?float: right/);
  assert.match(css, /side-right[^\n]*\.tosafos \.cv,[\s\S]*?float: left/);
});

test("the reading canvas stays fixed while only its paper or spine animates", async () => {
  const app = await readFile(path.join(root, "app.js"), "utf8");
  const css = await readFile(path.join(root, "styles.css"), "utf8");

  assert.match(app, /kind === "turn" \? book\.querySelector\(":scope > \.dafpage"\) : book\.querySelector\(":scope > \.leaf-gutter"\)/);
  assert.match(css, /:is\(\.leaf-book, \.pf-inner\) > \.dafpage \{[\s\S]*?width: 100%; min-width: 0/);
  assert.match(css, /\.side-left > \.leaf-gutter \{ left: auto; right: calc\(var\(--leaf-spine-overlap\) \* -1\); \}/);
  assert.match(css, /\.side-right > \.leaf-gutter \{ left: calc\(var\(--leaf-spine-overlap\) \* -1\); right: auto; \}/);
  assert.match(css, /\.pflip\.spine-shift \.leaf-gutter/);
  assert.match(app, /const chromeFloor = railRect\?\.bottom > 0 \? railRect\.bottom/);
  assert.doesNotMatch(app, /readAheadNote|data-openread|data-backread/);
});

test("the classic leaf has a clear print edge without boxing its text streams", async () => {
  const css = await readFile(path.join(root, "styles.css"), "utf8");

  assert.match(css, /--leaf-edge:\s*#aaa18d/);
  const overlap = Number(css.match(/--leaf-spine-overlap:\s*(\d+)px/)?.[1]);
  const textInset = Number(css.match(/--leaf-text-inset:\s*(\d+)px/)?.[1]);
  assert.ok(textInset >= overlap + 2, "live type must retain glyph clearance beyond the opaque fold at both spine edges");
  assert.match(css, /:is\(\.leaf-book, \.pf-inner\) > \.dafpage \{[\s\S]*?padding-inline: var\(--leaf-text-inset\)/);
  assert.match(css, /\.dafpage \{[\s\S]*?border-radius: 2px/);
  assert.match(css, /\.leaf-gutter \.leaf-fold::after/);
  assert.match(css, /\.dafpage-grid\.classic \.col\.side,[\s\S]*?border: 0/);
});

test("Torah Rashi fills lines with tab separation and conservative headings", async () => {
  const app = await readFile(path.join(root, "app.js"), "utf8");
  const css = await readFile(path.join(root, "styles.css"), "utf8");

  assert.match(app, /parsed && \[\.\.\.parsed\[1\]\]\.length <= 80/);
  assert.doesNotMatch(app, /torahRashiHtml[\s\S]*?<p class="comm"/);
  assert.match(css, /\.rashi-comment \+ \.rashi-comment::before \{ content: "\\2003"/);
  assert.match(css, /\.rashi-explain-lead \{ white-space: nowrap/);
});

test("the focused Rashi reader flows continuously and omits empty verses", async () => {
  const css = await readFile(path.join(root, "styles.css"), "utf8");

  assert.match(css, /\.reader-torah-body\.col-tosafos \.torah-verse,[\s\S]*?display: inline/);
  assert.match(css, /\.reader-torah-body\.col-tosafos \.col-empty \{ display: none; min-height: 0/);
});

test("reading state is linkable and unrelated links outrank saved readers", async () => {
  const app = await readFile(path.join(root, "app.js"), "utf8");

  assert.match(app, /"&pmode=" \+ enc\(torah\.mode\) \+ "&psource=" \+ enc\(torah\.source\)/);
  assert.match(app, /params\.get\("pmode"\), source: params\.get\("psource"\)/);
  assert.match(app, /deep\.id !== savedRoute\.id/);
  assert.match(app, /if \(saved\.kind === "torah"\) return false/);
  assert.match(app, /Reader\.source = inlineMode === "he" \? "gemara" : \(State\._parCol \|\| "gemara"\)/);
  assert.match(app, /if \(Reader\._sourceChanged\) State\._parCol = torahSource/);
  assert.match(app, /Reader\.inlineMode === "he" && torahSource === "gemara" \? "he" : "daf"/);
  assert.match(app, /setDafScroll\(target\); lockReadMin\(target\); commitRestoredReadingState\(\)/);
});

test("long Torah comments preserve progress and stale scroll frames are rejected", async () => {
  const app = await readFile(path.join(root, "app.js"), "utf8");

  assert.doesNotMatch(app, /Math\.max\(-300, Math\.min\(300/);
  assert.match(app, /progress: rect\.height > 0 \? Math\.max\(0, Math\.min\(1, -offset \/ rect\.height\)\)/);
  assert.match(app, /surface\._scrollRestoreGen === restoreGen && identity\(\) === expectedIdentity/);
});
