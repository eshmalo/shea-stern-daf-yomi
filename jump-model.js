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

  // The amudim of one daf, in printed order. Tamid's opening Mishnah sits on
  // Vilna 25b, so daf 26 there is a THREE-amud page — never build a page list
  // as [d + "a", d + "b"] or that amud becomes unreachable.
  function amudKeysFor(masechta, daf) {
    const k = [daf + "a", daf + "b"];
    if (masechta === "Tamid" && +daf === 26) k.unshift("25b");
    return k;
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

  root.DafJumpModel = Object.freeze({
    amudKeysFor, dafStep, amudStep, amudCatalog, isAdjacent, validDaf,
    gematriaValue, findMasechta, parseJumpQuery, nowTarget, secondaryToday,
  });
})(typeof window !== "undefined" ? window : globalThis);
