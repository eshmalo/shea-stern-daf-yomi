import test from "node:test";
import assert from "node:assert/strict";
import "../dafyomi.js";
import "../hebrewcal.js";
import "../jump-model.js";

const JM = globalThis.DafJumpModel;
const DY = globalThis.DafYomi;
const HC = globalThis.HebCal;

/* ---------- the physical page ---------- */

test("Tamid daf 26 is a three-amud page — its Mishnah opens on Vilna 25b", () => {
  assert.deepEqual(JM.amudKeysFor("Tamid", 26), ["25b", "26a", "26b"]);
  assert.deepEqual(JM.amudKeysFor("Tamid", 27), ["27a", "27b"]);
  assert.deepEqual(JM.amudKeysFor("Chullin", 102), ["102a", "102b"]);
});

test("a page list built for the picker never loses an amud", () => {
  // the grid is built from amudKeysFor, so every masechta's catalogue must be
  // exactly two per daf — except Tamid, which carries one more
  for (const m of DY.SHAS) {
    const expected = (m.lastDaf - m.firstDaf + 1) * 2 + (m.en === "Tamid" ? 1 : 0);
    assert.equal(JM.amudCatalog(m.en).length, expected, m.en);
  }
  assert.equal(JM.amudCatalog("Tamid")[0], "25b");
  assert.deepEqual(JM.amudCatalog("Middos").slice(0, 2), ["34a", "34b"]);
  assert.deepEqual(JM.amudCatalog("Nope"), []);
});

test("the walk through Shas crosses daf and masechta boundaries", () => {
  assert.deepEqual(JM.amudStep("Chullin", 102, "102a", 1), { masechta: "Chullin", daf: 102, amud: "102b" });
  assert.deepEqual(JM.amudStep("Chullin", 102, "102b", 1), { masechta: "Chullin", daf: 103, amud: "103a" });
  assert.deepEqual(JM.amudStep("Chullin", 142, "142b", 1), { masechta: "Bechoros", daf: 2, amud: "2a" });
  assert.deepEqual(JM.amudStep("Bechoros", 2, "2a", -1), { masechta: "Chullin", daf: 142, amud: "142b" });
  assert.deepEqual(JM.amudStep("Tamid", 26, "26a", -1), { masechta: "Tamid", daf: 26, amud: "25b" });
  assert.equal(JM.amudStep("Berachos", 2, "2a", -1), null);           // the very start of Shas
  assert.equal(JM.amudStep("Niddah", 73, "73b", 1), null);            // and the very end
});

test("only neighbours are adjacent — a jump across Shas must not animate as a page turn", () => {
  const at = (masechta, daf, amud) => ({ masechta, daf, amud });
  assert.equal(JM.isAdjacent(at("Chullin", 102, "102b"), at("Chullin", 103, "103a")), true);
  assert.equal(JM.isAdjacent(at("Chullin", 102, "102b"), at("Chullin", 102, "102a")), true);
  assert.equal(JM.isAdjacent(at("Chullin", 102, "102b"), at("Chullin", 104, "104a")), false);
  assert.equal(JM.isAdjacent(at("Chullin", 142, "142b"), at("Bechoros", 2, "2a")), true);
  assert.equal(JM.isAdjacent(at("Chullin", 102, "102b"), at("Berachos", 2, "2a")), false);
  assert.equal(JM.isAdjacent(null, at("Chullin", 2, "2a")), false);
});

test("validDaf holds each masechta to its own range", () => {
  assert.equal(JM.validDaf("Chullin", 142), true);
  assert.equal(JM.validDaf("Chullin", 143), false);
  assert.equal(JM.validDaf("Chullin", 1), false);
  assert.equal(JM.validDaf("Kinnim", 24), true);        // Kinnim starts at 23, inside the Meilah volume
  assert.equal(JM.validDaf("Kinnim", 2), false);
  assert.equal(JM.validDaf("Nope", 5), false);
});

/* ---------- typed references ---------- */

test("gematria parsing is the exact inverse of the renderer", () => {
  for (let n = 1; n <= 400; n++) assert.equal(JM.gematriaValue(HC.gematria(n)), n, String(n));
  assert.equal(JM.gematriaValue("ק״ב"), 102);           // gershayim as the site prints them
  assert.equal(JM.gematriaValue("ב׳"), 2);
  assert.equal(JM.gematriaValue(" קב "), 102);
  assert.equal(JM.gematriaValue("טו"), 15);             // never יה
  assert.equal(JM.gematriaValue("chullin"), null);
  assert.equal(JM.gematriaValue(""), null);
  assert.equal(JM.gematriaValue(null), null);
});

test("a masechta is found by name, alias, prefix, or Hebrew", () => {
  assert.equal(JM.findMasechta("chullin"), "Chullin");
  assert.equal(JM.findMasechta("Chulin"), "Chullin");           // the TorahAnytime spelling
  assert.equal(JM.findMasechta("ketubot"), "Kesubos");
  assert.equal(JM.findMasechta("chul"), "Chullin");             // prefix
  assert.equal(JM.findMasechta("חולין"), "Chullin");
  assert.equal(JM.findMasechta("בבא מציעא"), "Bava Metzia");
  assert.equal(JM.findMasechta("zz"), null);
});

test("parseJumpQuery reads a reference the way a person types one", () => {
  const p = (q, o) => JM.parseJumpQuery(q, o);
  const ref = (masechta, daf, amud, name) => ({ masechta, daf, amud, name });
  assert.deepEqual(p("chullin 102b"), ref("Chullin", 102, "102b", "chullin"));
  assert.deepEqual(p("Chullin 102"), ref("Chullin", 102, "102a", "Chullin"));
  assert.deepEqual(p("daf 8 bava metzia"), ref("Bava Metzia", 8, "8a", "daf bava metzia"));
  assert.deepEqual(p("חולין קב"), ref("Chullin", 102, "102a", "חולין"));
  assert.deepEqual(p("חולין קב:"), ref("Chullin", 102, "102b", "חולין"));
  assert.deepEqual(p("חולין קב."), ref("Chullin", 102, "102a", "חולין"));
  assert.deepEqual(p("בבא מציעא 8"), ref("Bava Metzia", 8, "8a", "בבא מציעא"));
  // a bare number belongs to the masechta you are already in
  assert.deepEqual(p("102", { masechta: "Chullin" }), ref("Chullin", 102, "102a", ""));
  assert.deepEqual(p("102b", { masechta: "Chullin" }), ref("Chullin", 102, "102b", ""));
  assert.equal(p("102"), null);                                  // …and nowhere without one
  // a masechta on its own selects it; an impossible daf falls back to the same
  assert.deepEqual(p("chullin"), { masechta: "Chullin", name: "chullin" });
  assert.deepEqual(p("חולין"), { masechta: "Chullin", name: "חולין" });
  assert.deepEqual(p("chullin 999"), { masechta: "Chullin", name: "chullin" });
  assert.equal(p(""), null);
  assert.equal(p("   "), null);
  assert.equal(p("nonsense"), null);
});

// The picker filters its masechta list on `name`, never on the whole query —
// a fully typed reference must narrow the list, not empty it.
test("parseJumpQuery hands back the masechta-naming part of the query", () => {
  assert.equal(JM.parseJumpQuery("bava metzia 8b").name, "bava metzia");
  assert.equal(JM.parseJumpQuery("bava").name, "bava");
  assert.equal(JM.parseJumpQuery("8", { masechta: "Chullin" }).name, "");
  assert.equal(JM.parseJumpQuery("חולין קב:").name, "חולין");
});

test("parseJumpQuery honours Tamid's opening amud", () => {
  assert.deepEqual(JM.parseJumpQuery("tamid 26"), { masechta: "Tamid", daf: 26, amud: "25b", name: "tamid" });
  assert.deepEqual(JM.parseJumpQuery("tamid 26b"), { masechta: "Tamid", daf: 26, amud: "26b", name: "tamid" });
});

/* ---------- the picker's one built-in button ---------- */

const today = { masechta: "Chullin", daf: 110 };
const playing = { masechta: "Chullin", daf: 108 };

test("the button is the playing daf when something is playing", () => {
  const t = JM.nowTarget({ playerUp: true, lecDaf: playing, video: true, paused: false, today, reading: null });
  assert.equal(t.kind, "now");
  assert.equal(t.daf, 108);
  assert.equal(t.video, true);
  assert.equal(t.alsoToday, false);
  assert.equal(t.here, false);
});

test("the button toggles to today's daf when nothing is playing", () => {
  const t = JM.nowTarget({ playerUp: false, lecDaf: playing, today, reading: null });
  assert.equal(t.kind, "today");
  assert.equal(t.daf, 110);
  assert.equal(t.alsoToday, true);
});

test("playing today's daf collapses the two into one button", () => {
  const input = { playerUp: true, lecDaf: today, paused: true, today, reading: null };
  const t = JM.nowTarget(input);
  assert.equal(t.kind, "now");
  assert.equal(t.alsoToday, true);
  assert.equal(t.paused, true);
  assert.equal(JM.secondaryToday(input, t), null);    // no chip — there is nothing else to offer
});

test("today stays one tap away whenever something else is playing", () => {
  const input = { playerUp: true, lecDaf: playing, today, reading: null };
  const second = JM.secondaryToday(input, JM.nowTarget(input));
  assert.deepEqual(second, { kind: "today", masechta: "Chullin", daf: 110 });
});

test("the button knows when you are already there", () => {
  const t = JM.nowTarget({ playerUp: true, lecDaf: playing, today, reading: { masechta: "Chullin", daf: 108, amud: "108b" } });
  assert.equal(t.here, true);
});

test("a shiur with no daf — a parsha or a hesped — falls through to today", () => {
  const t = JM.nowTarget({ playerUp: true, lecDaf: null, today, reading: null });
  assert.equal(t.kind, "today");
});

test("no player and no today's daf yields nothing to point at", () => {
  assert.equal(JM.nowTarget({ playerUp: false, today: null }), null);
  assert.equal(JM.nowTarget({ playerUp: true, lecDaf: { masechta: "Nope", daf: 4 }, today: null }), null);
});

/* ---------- the Chumash side ---------- */

// The same shape app.js hands in, trimmed to two seforim for the test.
const CHUMASHIM = [
  { en: "Bamidbar", he: "במדבר", parshiyos: [["Bamidbar", "במדבר"], ["Naso", "נשא"], ["Be'halot'cha", "בהעלותך"], ["Chukat", "חקת"], ["Matot", "מטות"], ["Masay", "מסעי"]] },
  { en: "Devarim", he: "דברים", parshiyos: [["Devarim", "דברים"], ["V'etchanan", "ואתחנן"], ["Ekev", "עקב"], ["Re'eh", "ראה"], ["Shoftim", "שופטים"], ["Ki Tetzei", "כי תצא"], ["V'Zot Haberacha", "וזאת הברכה"]] },
];
const DISPLAY = { "Be'halot'cha": "Beha'aloscha", Chukat: "Chukas", Matot: "Matos", Masay: "Masei",
  "V'etchanan": "Va'eschanan", Ekev: "Eikev", "Ki Tetzei": "Ki Seitzei", "V'Zot Haberacha": "V'Zos Habracha" };
const T = JM.torahIndex(CHUMASHIM, DISPLAY);

test("the Chumash index is flat, ordered, and carries both spellings", () => {
  assert.equal(T.list.length, 13);
  assert.equal(T.list[0].parsha, "Bamidbar");
  assert.equal(T.byParsha["Ekev"].sefer, "Devarim");
  assert.equal(T.byParsha["Ekev"].display, "Eikev");
  assert.equal(T.byParsha["Ekev"].he, "עקב");
  assert.equal(T.byParsha["Naso"].display, "Naso");     // no override means the key stands
});

test("a parsha is found by either spelling, by Hebrew, or by prefix", () => {
  const p = s => T.find(s)?.parsha;
  assert.equal(p("Shoftim"), "Shoftim");
  assert.equal(p("shof"), "Shoftim");
  assert.equal(p("שופטים"), "Shoftim");
  assert.equal(p("שופ"), "Shoftim");
  assert.equal(p("Eikev"), "Ekev");                     // the site's yeshivish spelling
  assert.equal(p("Ekev"), "Ekev");                      // the library's internal key
  assert.equal(p("Beha'aloscha"), "Be'halot'cha");
  assert.equal(p("behalot"), "Be'halot'cha");           // punctuation is ignored
  assert.equal(p("Ki Seitzei"), "Ki Tetzei");
  assert.equal(p("V'Zos Habracha"), "V'Zot Haberacha");
  assert.equal(T.find("zzz"), null);
  assert.equal(T.find(""), null);
});

test("a sefer named on its own selects it without picking a parsha", () => {
  assert.equal(T.findSefer("Devarim"), "Devarim");
  assert.equal(T.findSefer("דברים"), "Devarim");
  assert.equal(T.findSefer("bamid"), "Bamidbar");
  assert.equal(T.findSefer("z"), null);                 // one letter is not a name
  // "Devarim" is both a sefer and a parsha; the parsha lookup still resolves it
  assert.equal(T.find("Devarim").parsha, "Devarim");
});

const latest = { sefer: "Devarim", parsha: "Shoftim" };
const playingP = { sefer: "Devarim", parsha: "Ekev" };

test("the Chumash button is the playing parsha, else the Rov's latest shiur", () => {
  const a = JM.torahNowTarget({ playerUp: true, playing: playingP, latest, video: true });
  assert.equal(a.kind, "now");
  assert.equal(a.parsha, "Ekev");
  assert.equal(a.video, true);
  assert.equal(a.alsoLatest, false);

  const b = JM.torahNowTarget({ playerUp: false, playing: playingP, latest });
  assert.equal(b.kind, "latest");
  assert.equal(b.parsha, "Shoftim");
  assert.equal(b.alsoLatest, true);
});

test("playing the latest parsha shiur collapses the two into one button", () => {
  const input = { playerUp: true, playing: latest, latest, paused: true };
  const t = JM.torahNowTarget(input);
  assert.equal(t.alsoLatest, true);
  assert.equal(t.paused, true);
  assert.equal(JM.secondaryLatest(input, t), null);
});

test("the latest shiur stays one tap away while something else plays", () => {
  const input = { playerUp: true, playing: playingP, latest };
  assert.deepEqual(JM.secondaryLatest(input, JM.torahNowTarget(input)), { kind: "latest", sefer: "Devarim", parsha: "Shoftim" });
});

test("the Chumash button knows when you are already there", () => {
  const t = JM.torahNowTarget({ playerUp: true, playing: playingP, latest, reading: { kind: "torah", sefer: "Devarim", parsha: "Ekev" } });
  assert.equal(t.here, true);
});

test("a shiur that names no parsha falls through to the latest", () => {
  assert.equal(JM.torahNowTarget({ playerUp: true, playing: null, latest }).kind, "latest");
  assert.equal(JM.torahNowTarget({ playerUp: false, latest: null }), null);
});
