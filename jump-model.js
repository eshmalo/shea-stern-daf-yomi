/* Pure Shas-navigation helpers shared by the folio picker, the page-flip
   arrows, and their regression tests. No DOM and no app state: everything here
   is a function of the Shas tables (dafyomi.js) and the gematria renderer
   (hebrewcal.js), so the arithmetic the reader turns on can be tested on its
   own. app.js aliases these the same way it aliases DafReaderModel. */
(function exposeDafJumpModel(root) {
  const DY = () => root.DafYomi;
  const HC = () => root.HebCal;
  const known = m => !!(DY() && DY().BYEN[m]);

  /* ---------- the physical page ---------- */

  // Daf Yomi names the DAF; the printed volume names the PAGE. For almost all of
  // Shas the two agree — a masechta opens on 2a and closes on the b side of its
  // last daf — so its page list is simply [Na, Nb].
  //
  // One volume breaks that. Meilah, Kinnim, Tamid and Middos are printed as a
  // single continuously-paginated unit of 36 dapim (SHAS `hb` 36), and their
  // masechtos begin and end MID-DAF. Their printed Vilna spans:
  //
  //     Meilah  2a – 22a        Kinnim  22a – 25a
  //     Tamid  25b – 33b        Middos  34a – 37b
  //
  // (Meilah's own hadran is printed on 22a and Tamid's opening Mishnah on 25b —
  // both visible in this repo's William Davidson text. Sefaria's index gives
  // Tamid's first chapter as "Tamid 25b:1-28b:7" and has no daf-addressed Kinnim
  // at all; Hebrew and English Wikipedia both give Kinnim as 22a–25a.)
  //
  // Daf Yomi still counts whole dapim — Meilah 2–22, Kinnim 23–25, Tamid 26–33,
  // Middos 34–37 — so 22b and 25b fall inside a daf named for the neighbour. The
  // rule, applied once here rather than as a special case per boundary: a page
  // belongs to the masechta whose text is printed on it, and the shared boundary
  // page 22a (which carries the end of Meilah AND the opening of Kinnim) stays
  // with Meilah, whose daf number it is. What follows are therefore the NAVIGABLE
  // spans, which partition the volume exactly: 72 amudim over 36 dapim, each
  // reachable under exactly one masechta. tests/jump-model.test.mjs asserts it.
  const SPANS = {
    Meilah: ["2a", "22a"], Kinnim: ["22b", "25a"], Tamid: ["25b", "33b"], Middos: ["34a", "37b"],
  };
  // one total order over a volume's pages, so a span is just a numeric range
  const amudRank = k => parseInt(k, 10) * 2 + (/b$/.test(String(k)) ? 1 : 0);
  const rankToAmud = r => (r >> 1) + ((r & 1) ? "b" : "a");

  function amudKeysFor(masechta, daf) {
    const span = SPANS[masechta], m = DY() && DY().BYEN[masechta];
    if (!span || !m) return [daf + "a", daf + "b"];
    const lo = amudRank(span[0]), hi = amudRank(span[1]);
    // the masechta's FIRST daf also carries whatever of its span is printed on the
    // daf before; its LAST daf stops where the masechta itself stops
    const from = +daf === m.firstDaf ? lo : amudRank(daf + "a");
    const to = +daf === m.lastDaf ? hi : amudRank(daf + "b");
    const out = [];
    for (let r = Math.max(from, lo); r <= Math.min(to, hi); r++) out.push(rankToAmud(r));
    return out;
  }

  // Which daf actually holds an amud. Almost always it is the number in the key —
  // but in the shared volume a masechta's first daf carries a page printed on the
  // daf before (Kinnim 23 opens on 22b, Tamid 26 on 25b), so a bare amud cannot be
  // parsed with parseInt alone. Only the neighbouring dapim can ever hold it.
  function dafForAmud(masechta, amud) {
    const n = parseInt(amud, 10);
    if (!Number.isFinite(n)) return null;
    const m = DY() && DY().BYEN[masechta];
    // amudKeysFor answers for any number it is handed, so the daf range has to be
    // checked here — Tamid 25 is not a daf, even though 25b is one of its pages.
    const holds = d => (!m || (d >= m.firstDaf && d <= m.lastDaf)) && amudKeysFor(masechta, d).includes(String(amud));
    if (holds(n)) return n;
    for (const d of [n + 1, n - 1]) if (holds(d)) return d;
    return n;
  }
  // Step to the previous / next daf, crossing masechta boundaries in Daf Yomi
  // (Shas) order. Returns {masechta, daf} or null at the very start/end of Shas.
  function dafStep(masechta, daf, dir) {
    const d = DY(); if (!d) return null;
    const m = d.BYEN[masechta]; if (!m) return null;
    const i = d.SHAS.findIndex(x => x.en === masechta);
    if (dir > 0) {
      if (daf < m.lastDaf) return { masechta, daf: daf + 1 };
      const nx = d.SHAS[i + 1]; return nx ? { masechta: nx.en, daf: nx.firstDaf } : null;
    }
    if (daf > m.firstDaf) return { masechta, daf: daf - 1 };
    const pv = d.SHAS[i - 1]; return pv ? { masechta: pv.en, daf: pv.lastDaf } : null;
  }
  // Step one amud, crossing daf and masechta boundaries in Shas order.
  function amudStep(masechta, daf, amud, dir) {
    const keys = amudKeysFor(masechta, daf), i = keys.indexOf(String(amud)), j = i + dir;
    if (i >= 0 && j >= 0 && j < keys.length) return { masechta, daf, amud: keys[j] };
    const nx = dafStep(masechta, daf, dir); if (!nx) return null;
    const nk = amudKeysFor(nx.masechta, nx.daf);
    return { masechta: nx.masechta, daf: nx.daf, amud: dir > 0 ? nk[0] : nk[nk.length - 1] };
  }
  // Every amud of a masechta, first to last — what the picker's grid is built from.
  function amudCatalog(masechta) {
    const m = DY() && DY().BYEN[masechta]; if (!m) return [];
    const out = [];
    for (let d = m.firstDaf; d <= m.lastDaf; d++) out.push(...amudKeysFor(masechta, d));
    return out;
  }
  // Is `to` one step from `from` in either direction? A jump that is NOT
  // adjacent must not be animated as a page turn: the leaves of a sefer only
  // turn between neighbours, and pretending otherwise asserts a contiguity the
  // reader does not have.
  function isAdjacent(from, to) {
    if (!from || !to) return false;
    return [1, -1].some(dir => {
      const s = amudStep(from.masechta, +from.daf, from.amud, dir);
      return !!s && s.masechta === to.masechta && +s.daf === +to.daf && s.amud === to.amud;
    });
  }
  function validDaf(masechta, daf) {
    const m = DY() && DY().BYEN[masechta];
    return !!(m && Number.isFinite(+daf) && +daf >= m.firstDaf && +daf <= m.lastDaf);
  }

  /* ---------- typed references ---------- */

  // Hebrew numeral -> number. HebCal.gematria already renders every number on
  // the site; invert that rather than writing a second parser which could
  // disagree with it. Built once, lazily, over the range Shas actually uses.
  let _rev = null;
  function gematriaValue(s) {
    const hc = HC(); if (!hc) return null;
    if (!_rev) {
      _rev = new Map();
      for (let n = 1; n <= 400; n++) { const g = hc.gematria(n); if (g && !_rev.has(g)) _rev.set(g, n); }
    }
    const k = String(s == null ? "" : s).replace(/[׳״'"`’]/g, "").trim();
    return k && _rev.has(k) ? _rev.get(k) : null;
  }

  // A masechta named in any form the picker's field is likely to receive:
  // a full or aliased Latin name, a Latin prefix, a Hebrew name, or a Hebrew
  // prefix. Returns the canonical English name, or null.
  function findMasechta(text) {
    const d = DY(); if (!d) return null;
    const t = String(text == null ? "" : text).trim();
    if (!t) return null;
    const exact = d.normalizeMasechta(t); if (exact) return exact;
    const he = d.SHAS.find(m => m.he === t)
      || d.SHAS.find(m => t.includes(m.he))
      || (t.length >= 2 ? d.SHAS.find(m => m.he.indexOf(t) === 0) : null);
    if (he) return he.en;
    const low = t.toLowerCase();
    if (low.length >= 3) {
      const p = d.SHAS.find(m => m.en.toLowerCase().indexOf(low) === 0); if (p) return p.en;
    }
    return null;
  }

  const A_MARK = { ".": "a", ":": "b", "׃": "b", "א": "a", "ב": "b", a: "a", b: "b" };

  // "chullin 102b" · "Chullin 102" · "חולין קב:" · "בבא מציעא 8" · "102" (inside
  // the masechta you are already in). Returns {masechta, daf, amud, name}, or
  // {masechta, name} when only a masechta was recognised, or null. `name` is
  // the part of the query that named the masechta, with the number and amud
  // taken out — the picker filters its list on that, so typing a full
  // reference narrows the list instead of emptying it.
  function parseJumpQuery(q, opts) {
    const d = DY(); if (!d) return null;
    let t = String(q == null ? "" : q).trim().replace(/\s+/g, " ");
    if (!t) return null;
    const current = opts && opts.masechta;

    let amud = null, m;
    if ((m = /[.:׃]\s*$/.exec(t))) { amud = A_MARK[m[0].trim()]; t = t.slice(0, m.index).trim(); }
    else if ((m = /(\d)\s*([ab])\s*$/i.exec(t))) { amud = A_MARK[m[2].toLowerCase()]; t = (t.slice(0, m.index) + m[1]).trim(); }
    else if ((m = /\s([אב])\s*$/.exec(t))) { amud = A_MARK[m[1]]; t = t.slice(0, m.index).trim(); }

    let daf = null, rest = t;
    if ((m = /(\d{1,3})(?!.*\d)/.exec(t))) { daf = +m[1]; rest = (t.slice(0, m.index) + t.slice(m.index + m[1].length)).trim(); }
    else {
      const parts = t.split(" ");
      for (let i = parts.length - 1; i >= 0; i--) {
        const v = gematriaValue(parts[i]);
        // a lone Hebrew token is far more likely to be a masechta than a number
        if (v && !(parts.length === 1 && findMasechta(parts[i]))) {
          daf = v; parts.splice(i, 1); rest = parts.join(" ").trim(); break;
        }
      }
    }

    const masechta = findMasechta(rest) || (daf != null ? current : null) || null;
    if (!masechta || !known(masechta)) return null;
    const name = rest.replace(/\s+/g, " ").trim();   // "daf 8 bava metzia" must not leave a double space
    if (daf == null) return { masechta, name };
    if (!validDaf(masechta, daf)) return { masechta, name };
    const keys = amudKeysFor(masechta, daf);
    const want = amud === "b" ? daf + "b" : keys[0];
    return { masechta, daf, amud: keys.indexOf(want) >= 0 ? want : keys[0], name };
  }

  /* ---------- the Chumash side ----------
     The picker serves the parsha rail too, so the same shapes are needed for
     Torah: a flat, searchable index of the parshiyos and the same
     what-should-the-button-point-at question. The Chumash tables live in
     app.js next to everything else that uses them, so they are handed in
     rather than duplicated here — that keeps this module pure and keeps one
     copy of the data. */

  // chumashim: [{ en, he, parshiyos: [[en, he], …] }]   display: { internalEn: yeshivishEn }
  function torahIndex(chumashim, display) {
    const list = [];
    (chumashim || []).forEach(s => (s.parshiyos || []).forEach(([en, he], i) => {
      list.push({ sefer: s.en, seferHe: s.he, parsha: en, he, display: (display && display[en]) || en, order: list.length, inSefer: i });
    }));
    const byParsha = Object.fromEntries(list.map(p => [p.parsha, p]));
    const norm = s => String(s == null ? "" : s).toLowerCase().replace(/['’`."]/g, "").replace(/\s+/g, " ").trim();
    // Every way someone might name a parsha: the internal key, the yeshivish
    // spelling the site shows, the Hebrew, or a prefix of any of them.
    function find(text) {
      const q = norm(text); if (!q) return null;
      const raw = String(text == null ? "" : text).trim();
      const exact = list.find(p => norm(p.parsha) === q || norm(p.display) === q || p.he === raw);
      if (exact) return exact;
      const he = raw.length >= 2 ? list.find(p => p.he.indexOf(raw) === 0) : null;
      if (he) return he;
      if (q.length >= 2) {
        const pre = list.find(p => norm(p.parsha).indexOf(q) === 0 || norm(p.display).indexOf(q) === 0);
        if (pre) return pre;
        const mid = list.find(p => norm(p.parsha).includes(q) || norm(p.display).includes(q));
        if (mid) return mid;
      }
      return null;
    }
    // A sefer named on its own selects it without picking a parsha.
    function findSefer(text) {
      const q = norm(text); if (!q || q.length < 2) return null;
      const raw = String(text == null ? "" : text).trim();
      const s = (chumashim || []).find(x => norm(x.en) === q || x.he === raw)
        || (chumashim || []).find(x => norm(x.en).indexOf(q) === 0 || x.he.indexOf(raw) === 0);
      return s ? s.en : null;
    }
    return { list, byParsha, find, findSefer };
  }

  /* ---------- the picker's one built-in button ---------- */

  // What the button at the head of the picker points at: the daf now loaded in
  // the player if there is one, otherwise today's daf. `alsoToday` collapses
  // the two when they coincide; `here` means the reader is already there.
  function nowTarget(input) {
    const i = input || {}, k = i.lecDaf, today = i.today;
    let t = null;
    if (i.playerUp && k && k.daf && known(k.masechta)) {
      t = { kind: "now", masechta: k.masechta, daf: +k.daf, video: !!i.video, paused: !!i.paused };
    } else if (today && known(today.masechta)) {
      t = { kind: "today", masechta: today.masechta, daf: +today.daf, video: false, paused: false };
    }
    if (!t) return null;
    t.alsoToday = !!(today && today.masechta === t.masechta && +today.daf === t.daf);
    t.here = !!(i.reading && i.reading.masechta === t.masechta && +i.reading.daf === t.daf);
    return t;
  }
  // Today's daf as a secondary target — shown only when something else is
  // playing, so today is never more than one tap away whatever is loaded.
  function secondaryToday(input, target) {
    const today = input && input.today;
    if (!target || target.kind !== "now" || target.alsoToday || !today || !known(today.masechta)) return null;
    return { kind: "today", masechta: today.masechta, daf: +today.daf };
  }

  // The Chumash answer to nowTarget. There is no "today's parsha" on this site:
  // computing the weekly sedra needs a real calendar (leap years, combined
  // parshiyos, Israel vs diaspora) that the site does not have, and guessing it
  // on a Rov's page is not worth the risk. So the honest fallback is the Rov's
  // own most recent parsha shiur — real data, labelled as what it is.
  function torahNowTarget(input) {
    const i = input || {};
    let t = null;
    if (i.playerUp && i.playing) t = { kind: "now", sefer: i.playing.sefer, parsha: i.playing.parsha, video: !!i.video, paused: !!i.paused };
    else if (i.latest) t = { kind: "latest", sefer: i.latest.sefer, parsha: i.latest.parsha, video: false, paused: false };
    if (!t) return null;
    t.alsoLatest = !!(i.latest && i.latest.parsha === t.parsha);
    t.here = !!(i.reading && i.reading.parsha === t.parsha);
    return t;
  }
  function secondaryLatest(input, target) {
    const latest = input && input.latest;
    if (!target || target.kind !== "now" || target.alsoLatest || !latest) return null;
    return { kind: "latest", sefer: latest.sefer, parsha: latest.parsha };
  }

  root.DafJumpModel = Object.freeze({
    amudKeysFor, dafForAmud, dafStep, amudStep, amudCatalog, isAdjacent, validDaf,
    gematriaValue, findMasechta, parseJumpQuery, nowTarget, secondaryToday,
    torahIndex, torahNowTarget, secondaryLatest,
  });
})(typeof window !== "undefined" ? window : globalThis);
