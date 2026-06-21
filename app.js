/* =====================================================================
   Rabbi Shea Stern · Daf Yomi — app (LaTeX-classic, native & independent)
   - Native daf text (Hebrew + English) served from our own data/daf/*.json
   - Native audio/video player (our intro-trimmed files preferred)
   - Every daf is browsable; un-recorded dafs push sponsorship
   - No external links / new tabs
   ===================================================================== */

const CFG = {
  speakerId: 587,
  api: "https://api.torahanytime.com",
  snapshot: "data/library.json",
  contentUrl: "data/content.json",
  mediaManifest: "media/manifest.json",
  dafIndex: "data/daf/_index.json",
  cacheKey: "dy_lib_587_v3",
  lastVisitKey: "dy_lastVisit_587",
  favKey: "dy_favs_587", progKey: "dy_progress_587", notesKey: "dy_notes_587",
  contentLocalKey: "dy_content_587",
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const esc = s => (s ?? "").toString().replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
// English daf text carries intentional Steinsaltz markup (<b>/<i>); escape everything, then re-allow a safe set
const safeEn = s => esc(s).replace(/&lt;(\/?(?:b|strong|i|em|br|sup|sub))&gt;/gi, "<$1>");
const DY = window.DafYomi;

const State = {
  speaker: null, all: [], content: {}, media: {}, dafIndex: {}, dafCache: {},
  byDaf: new Map(), route: { name: "today" }, newIds: new Set(),
  sponsor: { kind: null },
};

/* ---------- utils ---------- */
const fmtDur = s => { s = Math.round(s || 0); if (!s) return ""; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m} min`; };
const clock = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const getStore = k => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
const setStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const dafKey = (m, d) => `${m}#${d}`;
const fileKey = m => m.replace(/ /g, "_");
const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const heDaf = n => "דף " + (window.HebCal ? window.HebCal.gematria(n) : n);

function calStrings(dstr) {
  if (!dstr) return { greg: "", heb: "" };
  const [y, m, d] = dstr.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const greg = isNaN(dt) ? dstr : dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const heb = (!isNaN(dt) && window.HebCal) ? window.HebCal.fromDate(dt).he : "";
  return { greg, heb };
}
function dateLine(dstr) {
  const c = calStrings(dstr); if (!c.greg && !c.heb) return "";
  const G = c.greg ? `<span dir="ltr">${esc(c.greg)}</span>` : "";
  const H = c.heb ? `<span dir="rtl" class="hdate">${esc(c.heb)}</span>` : "";
  return G && H ? `${G} <span class="datesep">·</span> ${H}` : (G || H);
}

function leanFromApi(x) {
  const cat = (x.categories || [])[0] || {}, sub = (x.subcategories || [])[0] || {};
  return {
    id: x.id, title: (x.title || "").trim(), recorded: x.date_recorded || null,
    posted: ((x.date_to_show || x.date_created || "") + "").slice(0, 10),
    duration: x.duration || 0, category: cat.name || "", series: sub.name || "",
    audio: x.mp3_url || x.audio_url || "", video: x.video_url || "",
  };
}

/* =====================================================================
   DATA
   ===================================================================== */
async function boot() {
  const cached = readCache();
  let seed = cached;
  if (!seed) {
    try { const s = await fetch(CFG.snapshot).then(r => r.json()); seed = { speaker: s.speaker, lectures: s.lectures }; }
    catch { seed = { speaker: { name: "Rabbi Shea Stern" }, lectures: [] }; }
  }
  State.speaker = seed.speaker; State.all = seed.lectures || [];
  [State.content, State.media, State.dafIndex] = await Promise.all([loadContent(), loadJson(CFG.mediaManifest), loadJson(CFG.dafIndex)]);
  buildIndex(); renderShell(); route("today");
  setStatus("checking"); refreshLive(seed.lectures || [], !!cached);
}
async function loadContent() { const l = localStorage.getItem(CFG.contentLocalKey); if (l) { try { return JSON.parse(l); } catch {} } return loadJson(CFG.contentUrl); }
async function loadJson(u) { try { return await fetch(u).then(r => r.ok ? r.json() : {}); } catch { return {}; } }

function buildIndex() {
  const m = new Map();
  for (const lec of State.all) {
    const mm = State.media[String(lec.id)];
    if (mm) { lec.localAudio = mm.audio || ""; lec.localVideo = mm.video || ""; lec.introTrimmed = mm.intro_trimmed; }
    const k = DY.shiurDaf(lec); lec._dk = k;
    if (k && k.daf) { const key = dafKey(k.masechta, k.daf); if (!m.has(key)) m.set(key, []); m.get(key).push(lec); }
  }
  State.byDaf = m;
}
function shiurFor(masechta, daf) { const a = State.byDaf.get(dafKey(masechta, daf)); return a ? a[0] : null; }

async function refreshLive(prev, fromCache) {
  try {
    const [spk, data] = await Promise.all([
      fetch(`${CFG.api}/speakers/${CFG.speakerId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${CFG.api}/speakers/${CFG.speakerId}/lectures?limit=2000&offset=0`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    ]);
    const fresh = (data.lecture || []).map(leanFromApi).sort((a, b) => (b.posted || "").localeCompare(a.posted || "") || b.id - a.id);
    if (!fresh.length && prev.length) throw new Error("empty");
    if (spk) State.speaker = { ...State.speaker, name: `${spk.title || ""} ${spk.name_first || ""} ${spk.name_last || ""}`.trim() || State.speaker.name };
    const prevIds = new Set(prev.map(l => l.id));
    const added = fresh.filter(l => !prevIds.has(l.id));
    State.all = fresh; buildIndex(); writeCache(); markNew(); rerender();
    if (added.length && fromCache) toast(`${added.length} new shiur${added.length > 1 ? "im" : ""} added`);
    setStatus("live");
  } catch { setStatus("err"); }
}
function readCache() { try { const c = JSON.parse(localStorage.getItem(CFG.cacheKey)); return c && Array.isArray(c.lectures) && c.lectures.length ? c : null; } catch { return null; } }
function writeCache() { setStore(CFG.cacheKey, { speaker: State.speaker, lectures: State.all }); }
function markNew() {
  const last = localStorage.getItem(CFG.lastVisitKey); State.newIds = new Set();
  if (last) for (const l of State.all) if ((l.posted || "") > last) State.newIds.add(l.id);
  localStorage.setItem(CFG.lastVisitKey, todayStr());
}
const favs = () => getStore(CFG.favKey);
const isFav = id => !!favs()[id];
function toggleFav(id) { const f = favs(); if (f[id]) delete f[id]; else f[id] = Date.now(); setStore(CFG.favKey, f); }
function noteProgress(id) { const p = getStore(CFG.progKey); p[id] = Date.now(); setStore(CFG.progKey, p); }

/* native daf text loader */
async function loadDafText(masechta) {
  const key = fileKey(masechta);
  if (State.dafCache[key]) return State.dafCache[key];
  const info = State.dafIndex[masechta]; if (!info) return null;
  try { const d = await fetch(`data/daf/${key}.json`).then(r => r.json()); State.dafCache[key] = d; return d; }
  catch { return null; }
}

/* =====================================================================
   SHELL
   ===================================================================== */
function renderShell() {
  const mh = State.content.masthead || {};
  document.body.innerHTML = `<div id="app">
    <header class="bar">
      <button class="ic-btn" id="burger" aria-label="Menu">☰</button>
      <span class="wordmark">${esc(mh.hebrew || "הדף היומי")}</span>
      <span class="live" id="live" title="updating from source"></span>
      <span class="spacer"></span>
      <button class="ic-btn" id="searchBtn" aria-label="Search">⌕</button>
    </header>
    <main id="view"></main>
    <div class="player hidden" id="player"></div>
  </div>
  <div class="mask" id="mask"></div>
  <aside class="menu" id="menu"></aside>
  <div class="toast-wrap" id="toasts"></div>`;

  $("#burger").onclick = openMenu; $("#mask").onclick = closeMenu;
  $("#searchBtn").onclick = () => route("search");
  Player.mount(); buildMenu(); setStatus(State._sk || "checking");
}
function buildMenu() {
  const mh = State.content.masthead || {};
  $("#menu").innerHTML = `<div class="mtitle">${esc(mh.hebrew || "")}</div><div class="msub">${esc(mh.english || State.speaker?.name || "")} · ${esc(mh.subtitle || "")}</div>
    <nav>
      <button class="mi" data-route="today">Today's Daf</button>
      <button class="mi" data-route="browse">Browse Shas</button>
      <button class="mi" data-route="search">Search</button>
      <button class="mi" data-route="mystuff">My Stuff</button>
      <button class="mi accent" data-route="sponsor">Sponsor a Daf</button>
      <button class="mi accent" data-route="donate">Donate</button>
      <button class="mi" data-route="about">About</button>
      <button class="mi" id="editorBtn" style="color:var(--ink-faint);font-size:13px">Editor mode</button>
    </nav>`;
  $$("#menu .mi[data-route]").forEach(b => b.onclick = () => { closeMenu(); route(b.dataset.route); });
  $("#editorBtn").onclick = openEditor;
}
function openMenu() { $("#menu").classList.add("open"); $("#mask").classList.add("open"); }
function closeMenu() { $("#menu").classList.remove("open"); $("#mask").classList.remove("open"); }

/* =====================================================================
   ROUTER
   ===================================================================== */
function route(name, params = {}) {
  State.route = { name, ...params };
  if (name === "sponsor" && params.pre) State.sponsor = { ...params.pre };
  rerender(); window.scrollTo(0, 0);
}
function rerender() {
  const v = $("#view"); if (!v) return;
  const r = State.route;
  const fn = { today: viewToday, browse: viewBrowse, seder: viewSeder, masechta: viewMasechta, daf: viewDaf, search: viewSearch, mystuff: viewMyStuff, sponsor: viewSponsor, about: viewAbout, donate: viewDonate }[r.name] || viewToday;
  v.innerHTML = `<div class="view">${fn(r)}</div>`;
  wireView(r);
  if (r.name === "daf") hydrateDaf(r);
}

/* =====================================================================
   VIEWS
   ===================================================================== */
function dafData(date) { const dy = DY.dafForDate(date); return dy ? { dy, shiur: shiurFor(dy.masechta, dy.daf) } : null; }

function viewToday() {
  const mh = State.content.masthead || {};
  const now = new Date();
  const t = dafData(now), y = dafData(new Date(now - 864e5)), tm = dafData(new Date(now - -864e5));
  const actions = t.shiur
    ? `<a class="btn solid" data-play="${t.shiur.id}">▶ Listen</a><a class="btn" data-daf="${esc(t.dy.masechta)}|${t.dy.daf}">Read the daf</a>`
    : `<a class="btn accent" data-sponsor-daf="${esc(t.dy.masechta)}|${t.dy.daf}">✦ Sponsor today's daf</a><a class="btn" data-daf="${esc(t.dy.masechta)}|${t.dy.daf}">Read the daf</a>`;
  return `
    <div class="titlepage">
      <div class="he">${esc(mh.hebrew || "שיעורי הדף היומי")}</div>
      <div class="by">given by <b>${esc(mh.english || State.speaker?.name || "")}</b></div>
      <div class="sub">${esc(mh.subtitle || "")}</div>
      <hr class="rule double">
    </div>
    <div class="today">
      <div class="eyebrow">Today's Daf</div>
      <div class="he">${esc(t.dy.he)} ${esc(heDaf(t.dy.daf))}</div>
      <div class="en">${esc(t.dy.masechta)} · Daf ${t.dy.daf}</div>
      <div class="date">${dateLine(todayStr())}</div>
      <div class="actions">${actions}</div>
      <div class="adjacent">
        <a data-daf="${esc(y.dy.masechta)}|${y.dy.daf}">‹ Yesterday · <span class="nm">${esc(y.dy.he)} ${esc(heDaf(y.dy.daf))}</span></a>
        <a data-daf="${esc(tm.dy.masechta)}|${tm.dy.daf}">Tomorrow · <span class="nm">${esc(tm.dy.he)} ${esc(heDaf(tm.dy.daf))}</span> ›</a>
      </div>
    </div>
    ${recentSection()}`;
}
function recentSection() {
  const recent = State.all.filter(l => l._dk && l._dk.daf).slice(0, 7);
  if (!recent.length) return "";
  return `<div class="section">Recently given</div><div class="rows">${recent.map(rowHtml).join("")}</div>
    <p class="center" style="margin-top:16px"><a class="textlink" data-route="browse">Browse all of Shas →</a></p>`;
}

function viewBrowse() {
  return `<div class="pagetitle">Browse Shas</div><p class="lead">Every daf of the Talmud — tap any daf to read it; the Rabbi's shiur appears where he's given it.</p>
    <div class="toc">${DY.SEDARIM.map(s => {
      const mas = DY.masechtosInSeder(s.en);
      const total = mas.reduce((n, m) => n + countMasechta(m.en), 0);
      return `<div class="seder">${esc(s.he)}<span class="ct">${total} shiurim</span></div>
        <div class="mas-list">${mas.map(m => { const n = countMasechta(m.en); return `<button class="mas ${n ? "" : "empty"}" data-masechta="${esc(m.en)}"><span class="nm">${esc(m.he)}</span><span class="ct">${n || "—"}</span></button>`; }).join("")}</div>`;
    }).join("")}</div>`;
}
function countMasechta(en) { let n = 0; for (const [k, a] of State.byDaf) if (k.startsWith(en + "#")) n += a.length; return n; }

function viewSeder(r) {
  const mas = DY.masechtosInSeder(r.seder);
  return crumbs([["Browse", "browse"]], DY.sederHe(r.seder)) +
    `<div class="mas-list" style="margin-top:14px">${mas.map(m => { const n = countMasechta(m.en); return `<button class="mas ${n ? "" : "empty"}" data-masechta="${esc(m.en)}"><span class="nm">${esc(m.he)}</span><span class="ct">${n || "—"}</span></button>`; }).join("")}</div>`;
}

function viewMasechta(r) {
  const m = DY.BYEN[r.masechta];
  let cells = "";
  for (let d = m.firstDaf; d <= m.lastDaf; d++) {
    const has = State.byDaf.has(dafKey(m.en, d));
    cells += `<button class="daf-cell ${has ? "has" : "future"}" data-daf="${esc(m.en)}|${d}"><span class="he">${esc(window.HebCal ? window.HebCal.gematria(d) : d)}</span><span class="n">${d}</span></button>`;
  }
  return crumbs([["Browse", "browse"], [DY.sederHe(m.seder), "seder", { seder: m.seder }]], m.he) +
    `<div class="center muted" style="font-size:13px;margin:8px 0 2px">${countMasechta(m.en)} of ${m.dapim} dapim given · tap any daf to read it</div>
     <div class="daf-grid">${cells}</div>`;
}

function viewDaf(r) {
  const [masechta, dafS] = r.id.split("|"); const daf = +dafS;
  const m = DY.BYEN[masechta], shiur = shiurFor(masechta, daf);
  const mode = r.mode || State._dafMode || "he";
  const heT = `${m ? m.he : masechta} ${heDaf(daf)}`;
  const media = shiur ? `
    <div class="daf-media">
      <a class="btn solid sm" data-play="${shiur.id}">▶ Listen${shiur.localAudio ? " ✓" : ""}</a>
      ${(shiur.localVideo || shiur.video) ? `<a class="btn sm" data-watch="${shiur.id}">▦ Watch</a>` : ""}
      <a class="btn sm" data-fav="${shiur.id}">${isFav(shiur.id) ? "★ Saved" : "☆ Save"}</a>
    </div>
    <div id="videoSlot"></div>` : "";
  const sponsor = shiur
    ? `<p class="center" style="margin:10px 0"><a class="textlink" data-sponsor-daf="${esc(masechta)}|${daf}">✦ Sponsor this daf</a></p>`
    : `<div class="sponsor-strip"><b>This daf hasn't been given yet.</b><div class="muted" style="font-size:14px;margin-top:4px">Sponsor it for a yahrtzeit or simcha — your dedication is learned by everyone.</div><a class="btn accent" data-sponsor-daf="${esc(masechta)}|${daf}">✦ Sponsor ${esc(masechta)} ${daf}</a></div>`;
  return crumbs([["Browse", "browse"], [m ? m.he : masechta, "masechta", { masechta }]], heDaf(daf)) +
    `<div class="daf-head"><div class="he">${esc(heT)}</div><div class="en">${esc(masechta)} · Daf ${daf}</div>
       ${shiur ? `<div class="meta">Given ${dateLine(shiur.recorded || shiur.posted)} · ${fmtDur(shiur.duration)}</div>` : ""}</div>
     ${media}${sponsor}
     <div class="daf-toolbar"><span class="ttl">The Daf</span>
       <span class="seg" id="dafMode">${["he", "en", "both"].map(x => `<button data-mode="${x}" class="${x === mode ? "on" : ""}">${({ he: "עברית", en: "English", both: "Both" })[x]}</button>`).join("")}</span></div>
     <div id="dafText" data-mas="${esc(masechta)}" data-daf="${daf}" data-mode="${mode}"><div class="daf-loading">Loading the daf…</div></div>`;
}

async function hydrateDaf(r) {
  const box = $("#dafText"); if (!box) return;
  const masechta = box.dataset.mas, daf = +box.dataset.daf, mode = box.dataset.mode;
  const data = await loadDafText(masechta);
  if (!data) {
    const reason = { Shekalim: "Shekalim is learned from the Talmud Yerushalmi, which isn't in the native reader yet.", Kinnim: "Kinnim is a Mishnah-only masechta — it has no Gemara text.", Middos: "Middos is a Mishnah-only masechta — it has no Gemara text." }[masechta] || "Native text for this masechta isn't available yet.";
    box.innerHTML = `<div class="empty-mini">${esc(reason)}</div>`; return;
  }
  let html = "";
  // Tamid's opening Mishnah sits on Vilna daf 25b; surface it on its first daf (26)
  if (masechta === "Tamid" && daf === 26 && data["25b"]) html += `<div class="amud"><div class="amud-label">${esc(window.HebCal ? window.HebCal.gematria(25) : 25)}·ב</div>${renderAmud(data["25b"], mode)}</div>`;
  for (const amud of [daf + "a", daf + "b"]) {
    const seg = data[amud]; if (!seg) continue;
    html += `<div class="amud"><div class="amud-label">${esc(window.HebCal ? window.HebCal.gematria(daf) : daf)}${amud.endsWith("a") ? "·א" : "·ב"}</div>${renderAmud(seg, mode)}</div>`;
  }
  box.innerHTML = (html || `<div class="empty-mini">This amud isn't available.</div>`) +
    `<div class="daf-src">Talmud text — William Davidson Edition, Sefaria (Hebrew public domain; English © Steinsaltz, CC-BY-NC)</div>`;
}
function renderAmud(seg, mode) {
  const he = (seg.he || "").split("\n").filter(Boolean), en = (seg.en || "").split("\n").filter(Boolean);
  if (mode === "he") return `<div class="daf-he">${he.map(esc).join("<br>")}</div>`;
  if (mode === "en") return `<div class="daf-en">${en.map(safeEn).join("<br>")}</div>`;
  // both: interleave by segment if counts align, else stacked blocks
  if (he.length === en.length && he.length) return he.map((h, i) => `<div class="seg-pair"><div class="daf-he">${esc(h)}</div><div class="daf-en">${safeEn(en[i])}</div></div>`).join("");
  return `<div class="daf-he">${he.map(esc).join("<br>")}</div><hr class="rule thin"><div class="daf-en">${en.map(safeEn).join("<br>")}</div>`;
}

function viewSearch() { return `<div class="pagetitle">Search</div><div class="searchbar"><input id="q" type="search" aria-label="Search" placeholder="search a daf, masechta, or topic…" autocomplete="off"></div><div id="results"></div>`; }
function runSearch(q) {
  const box = $("#results"); if (!box) return;
  q = (q || "").trim().toLowerCase();
  if (!q) { box.innerHTML = `<div class="empty-mini">Type to search ${State.all.length.toLocaleString()} shiurim.</div>`; return; }
  const res = State.all.filter(l => (l.title + " " + l.series).toLowerCase().includes(q)).slice(0, 60);
  box.innerHTML = res.length ? `<div class="rows">${res.map(rowHtml).join("")}</div>` : `<div class="empty-mini">No shiurim match “${esc(q)}”.</div>`;
  wireRows(box);
}
function viewMyStuff() {
  const f = favs(), p = getStore(CFG.progKey);
  const fav = State.all.filter(l => f[l.id]).sort((a, b) => f[b.id] - f[a.id]);
  const pr = State.all.filter(l => p[l.id]).sort((a, b) => p[b.id] - p[a.id]).slice(0, 12);
  const sec = (t, list, e) => `<div class="section">${t}</div>` + (list.length ? `<div class="rows">${list.map(rowHtml).join("")}</div>` : `<div class="empty-mini">${e}</div>`);
  return `<div class="pagetitle">My Stuff</div>` + sec("Continue", pr, "Play a shiur and it appears here.") + sec("Saved", fav, "Tap ☆ on a daf to save it.");
}

/* ---------- Sponsor ---------- */
function viewSponsor() {
  const s = State.content.sponsor || {}, amt = s.amounts || {}, sp = State.sponsor;
  const today = DY.dafForDate(new Date());
  const opt = (kind, t, sub, price, attr) => `<button class="sp-opt ${sp.kind === kind ? "on" : ""}" ${attr}><span><b>${t}</b><span>${sub}</span></span><span class="price">${price || ""}</span></button>`;
  const picker = `<div class="sp-opts">
      ${sp.kind === "daf" ? opt("daf", "This daf", `${esc(sp.masechta || "")} ${sp.daf || ""}`, amt.daf, `data-sp="daf"`) : ""}
      ${opt("today", "Today's daf", `${today.masechta} ${today.daf}`, amt.daf, `data-sp="today"`)}
      ${opt("future", "A future daf", "for a yahrtzeit or simcha", amt.daf, `data-sp="future"`)}
      ${opt("masechta", "A whole masechta", "dedicate an entire tractate", amt.masechta, `data-sp="masechta"`)}
    </div>
    ${sp.kind === "future" ? `<div class="field-label">Date</div><input type="date" id="spDate" value="${esc(sp.date || todayStr())}">${sp.date ? `<p class="center muted" style="font-size:14px">that day's daf: <b>${esc(sponsorFutureDaf().masechta)} ${sponsorFutureDaf().daf}</b></p>` : ""}` : ""}
    ${sp.kind === "masechta" ? `<div class="field-label">Masechta</div><select id="spMas">${DY.SHAS.map(m => `<option value="${esc(m.en)}" ${sp.masechta === m.en ? "selected" : ""}>${esc(m.en)} — ${esc(m.he)}</option>`).join("")}</select>` : ""}`;
  const form = sp.kind ? `<div class="sp-form">
      <div class="sp-target">Sponsoring: <b>${esc(sponsorTargetLabel())}</b></div>
      <div class="field-label">Dedication</div>
      <select id="spType">${(s.dedicationTypes || ["L'ilui nishmas", "In honor of"]).map(t => `<option>${esc(t)}</option>`).join("")}</select>
      <input id="spFor" aria-label="name" placeholder="…name">
      <div class="field-label">From</div>
      <input id="spFrom" aria-label="your name" placeholder="sponsored by">
      <input id="spEmail" type="email" aria-label="email" placeholder="your email">
      <button class="btn solid block" id="spSend">Send dedication</button>
      <button class="btn block" data-route="donate" style="margin-top:8px">Complete by Zelle →</button>
      ${s.note ? `<p class="muted" style="font-size:12.5px;margin-top:12px">${esc(s.note)}</p>` : ""}
    </div>` : "";
  return `<div class="pagetitle">${esc(s.heading || "Sponsor the Shiur")}</div><p class="lead">${esc(s.blurb || "")}</p>${picker}${form}`;
}
function sponsorFutureDaf() { return DY.dafForDate(State.sponsor.date ? new Date(State.sponsor.date + "T00:00:00") : new Date()); }
function sponsorTargetLabel() {
  const sp = State.sponsor;
  if (sp.kind === "today") { const t = DY.dafForDate(new Date()); return `${t.masechta} Daf ${t.daf} — today`; }
  if (sp.kind === "daf") return `${sp.masechta} Daf ${sp.daf}`;
  if (sp.kind === "future") { const t = sponsorFutureDaf(); return `${t.masechta} Daf ${t.daf} — ${calStrings(sp.date || todayStr()).greg}`; }
  if (sp.kind === "masechta") return `Masechta ${sp.masechta || DY.SHAS[0].en} (entire tractate)`;
  return "";
}
function sendSponsor() {
  const s = State.content.sponsor || {}, to = s.contactEmail || State.content.contact?.email || "";
  const body = `I would like to sponsor: ${sponsorTargetLabel()}\n\nDedication: ${$("#spType")?.value || ""} ${$("#spFor")?.value || ""}\nFrom: ${$("#spFrom")?.value || ""}\nEmail: ${$("#spEmail")?.value || ""}\n\n(I will complete the sponsorship by Zelle to ${State.content.donate?.zelle?.email || ""}.)`;
  location.href = `mailto:${to}?subject=${encodeURIComponent("Daf Yomi sponsorship — " + sponsorTargetLabel())}&body=${encodeURIComponent(body)}`;
}

function viewDonate() {
  const d = State.content.donate || {}, z = d.zelle || {};
  return `<div class="pagetitle">${esc(d.heading || "Donate")}</div><p class="lead">${esc(d.blurb || "")}</p>
    <div class="donate-box"><div class="qr-frame"><img src="${esc(z.qr || "")}" alt="Zelle QR for ${esc(z.name || "")}"></div>
      <div class="zelle-line">Pay <b>${esc(z.name || "")}</b> via <span class="zelle-brand">Zelle</span><span class="muted">${esc(z.email || "")}</span></div>
      <button class="btn sm copy-btn" data-copy="${esc(z.email || "")}">Copy email</button>
      ${d.dedicationNote ? `<p class="muted" style="font-size:13px;margin-top:14px">${esc(d.dedicationNote)}</p>` : ""}</div>`;
}
function viewAbout() {
  const a = State.content.about || {}, c = State.content.contact || {}, p = State.content.phone || {};
  return `<div class="pagetitle">${esc(a.heading || "About")}</div>
    <div class="prose">${(a.paragraphs || []).map(x => `<p>${esc(x)}</p>`).join("")}</div>
    ${a.tradition ? `<div class="section">${esc(a.tradition.heading)}</div><div class="prose"><p>${esc(a.tradition.body)}</p></div>` : ""}
    <div class="section">FAQ</div>${(State.content.faqs || []).map(x => `<details class="faq"><summary>${esc(x.q)}</summary><div class="a">${esc(x.a)}</div></details>`).join("")}
    <div class="section">Contact</div>
    <p class="prose"><a class="textlink" href="mailto:${esc(c.email || "")}">${esc(c.email || "")}</a>${p.number ? ` · Listen by phone: ${esc(p.number)} ext. ${esc(p.extension || "")}` : ""}</p>`;
}

/* shared */
function rowHtml(lec) {
  const k = lec._dk, sub = k && k.daf ? `${k.masechta} ${k.daf}` : (lec.series || "");
  return `<button class="row${State.newIds.has(lec.id) ? " is-new" : ""}" data-rowdaf="${k && k.daf ? esc(k.masechta) + "|" + k.daf : ""}" data-play="${lec.id}">
    <span class="rnum">${k && k.daf ? esc(heDaf(k.daf)) : "▸"}</span>
    <span class="rmain"><b>${esc(lec.title)}</b><span class="rmeta"> — ${esc(sub)} · ${fmtDur(lec.duration)} · ${dateLine(lec.recorded)}</span></span>
    <span class="rgo">▶</span></button>`;
}
function crumbs(parts, title) {
  return `<div class="crumbs" dir="ltr">${parts.map(([l, n, p]) => `<a data-go="${n}" data-p='${esc(JSON.stringify(p || {}))}'>${esc(l)}</a>`).join(" › ")} › <b>${esc(title)}</b></div>`;
}

/* =====================================================================
   wiring
   ===================================================================== */
function wireView(r) {
  const v = $("#view");
  v.querySelectorAll("[data-seder]").forEach(b => b.onclick = () => route("seder", { seder: b.dataset.seder }));
  v.querySelectorAll("[data-masechta]").forEach(b => b.onclick = () => route("masechta", { masechta: b.dataset.masechta }));
  v.querySelectorAll("[data-daf]").forEach(b => b.onclick = () => route("daf", { id: b.dataset.daf }));
  v.querySelectorAll("[data-go]").forEach(a => a.onclick = () => route(a.dataset.go, JSON.parse(a.dataset.p || "{}")));
  v.querySelectorAll("[data-route]").forEach(b => b.onclick = () => route(b.dataset.route));
  v.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast("Email copied"); });
  v.querySelectorAll("[data-sponsor-daf]").forEach(b => b.onclick = e => { e.stopPropagation(); const [m, d] = b.dataset.sponsorDaf.split("|"); route("sponsor", { pre: { kind: "daf", masechta: m, daf: +d } }); });
  v.querySelectorAll("[data-watch]").forEach(b => b.onclick = e => { e.stopPropagation(); watchVideo(+b.dataset.watch); });
  v.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
    const mode = b.dataset.mode; State._dafMode = mode;
    $$("#dafMode button").forEach(x => x.classList.toggle("on", x.dataset.mode === mode));
    const box = $("#dafText"); if (box) { box.dataset.mode = mode; hydrateDaf(State.route); } // re-render text only; leaves any playing video intact
  });
  wireRows(v);
  const q = $("#q"); if (q) { q.oninput = () => runSearch(q.value); q.focus(); runSearch(""); }
  v.querySelectorAll("[data-fav]").forEach(b => { if (!b.classList.contains("row")) b.onclick = e => { e.stopPropagation(); toggleFav(+b.dataset.fav); rerender(); }; });
  wireSponsor();
}
function wireSponsor() {
  $$("[data-sp]").forEach(b => b.onclick = () => { State.sponsor.kind = b.dataset.sp; if (b.dataset.sp === "masechta" && !State.sponsor.masechta) State.sponsor.masechta = DY.SHAS[0].en; rerender(); });
  const dt = $("#spDate"); if (dt) dt.onchange = () => { State.sponsor.date = dt.value; rerender(); };
  const ms = $("#spMas"); if (ms) ms.onchange = () => { State.sponsor.masechta = ms.value; };
  const send = $("#spSend"); if (send) send.onclick = sendSponsor;
}
function wireRows(scope) {
  // wires every play button in scope (recent rows, search results, and the daf-page / today Listen buttons)
  scope.querySelectorAll("[data-play]").forEach(b => b.onclick = e => { e.stopPropagation(); playId(+b.dataset.play); });
}
function playId(id) {
  const lec = State.all.find(l => l.id === id); if (!lec) return;
  const local = State.content.options?.preferSelfHosted !== false && lec.localAudio;
  Player.load(lec, true, local ? lec.localAudio : lec.audio, !!local); noteProgress(id);
}
function watchVideo(id) {
  const lec = State.all.find(l => l.id === id); if (!lec) return;
  const slot = $("#videoSlot"); if (!slot) return;
  const local = State.content.options?.preferSelfHosted !== false && lec.localVideo;
  const src = local ? lec.localVideo : lec.video; if (!src) return;
  slot.innerHTML = `<video class="daf-video" src="${esc(src)}" controls playsinline preload="metadata"></video>${local ? `<div class="daf-src">our copy · intro removed ✓</div>` : `<div class="daf-src">streaming from TorahAnytime · includes intro</div>`}`;
  slot.querySelector("video").play().catch(() => {});
  noteProgress(id);
}

/* =====================================================================
   PLAYER (native audio)
   ===================================================================== */
const Player = {
  audio: null, lec: null, speed: 1, local: false,
  mount() {
    if (this.audio) { this.audio.pause(); this.audio.src = ""; }
    this.audio = new Audio(); this.audio.preload = "metadata";
    this.audio.ontimeupdate = () => this.tick(); this.audio.onloadedmetadata = () => this.tick();
    this.audio.onplay = () => this.ctrls(); this.audio.onpause = () => this.ctrls(); this.audio.onended = () => this.ctrls();
    this.audio.onerror = () => { if (this.lec && this.local) { this.local = false; this.audio.src = this.lec.audio; this.audio.play().catch(() => {}); this.bar(); } };
  },
  load(lec, autoplay, url, local) { this.lec = lec; this.local = !!local; this.audio.src = url || lec.audio; this.audio.playbackRate = this.speed; $("#player").classList.remove("hidden"); $("#app")?.classList.add("player-active"); this.bar(); if (autoplay) this.audio.play().catch(() => {}); },
  toggle() { this.audio.paused ? this.audio.play().catch(() => {}) : this.audio.pause(); },
  skip(s) { this.audio.currentTime = Math.max(0, Math.min(this.audio.duration || 1e9, this.audio.currentTime + s)); },
  setSpeed() { const o = [1, 1.25, 1.5, 1.75, 2, 0.75]; this.speed = o[(o.indexOf(this.speed) + 1) % o.length]; this.audio.playbackRate = this.speed; this.ctrls(); },
  hide() { $("#player").classList.add("hidden"); $("#app")?.classList.remove("player-active"); this.audio.pause(); },
  bar() {
    const k = this.lec._dk, label = k && k.daf ? `${k.masechta} ${k.daf}` : "";
    $("#player").innerHTML = `<button class="x" id="pX" aria-label="Close">✕</button>
      <div class="now"><b>${esc(label || this.lec.title)}</b>${this.local ? `<span class="tag">intro removed ✓</span>` : (this.lec.audio ? `<span class="tag muted">streaming · incl. intro</span>` : "")}</div>
      <div class="scrub"><span class="t" id="pCur">0:00</span><input type="range" id="pSeek" min="0" max="1000" value="0" aria-label="Seek"><span class="t r" id="pDur">--:--</span></div>
      <div class="ctrls" id="pCtrls"></div>`;
    $("#pX").onclick = () => this.hide();
    $("#pSeek").oninput = e => { if (this.audio.duration) this.audio.currentTime = (e.target.value / 1000) * this.audio.duration; };
    this.ctrls(); this.tick();
  },
  ctrls() {
    const c = $("#pCtrls"); if (!c) return; const playing = !this.audio.paused && !this.audio.ended;
    c.innerHTML = `<button id="pB" aria-label="Back 10s">↺10</button><button class="pp" id="pP" aria-label="${playing ? "Pause" : "Play"}">${playing ? "❚❚" : "▶"}</button><button id="pF" aria-label="Forward 10s">10↻</button><button class="pill" id="pS" aria-label="Speed">${this.speed}×</button>`;
    $("#pP").onclick = () => this.toggle(); $("#pB").onclick = () => this.skip(-10); $("#pF").onclick = () => this.skip(10); $("#pS").onclick = () => this.setSpeed();
  },
  tick() { const cur = this.audio.currentTime || 0, dur = this.audio.duration || 0, c = $("#pCur"), d = $("#pDur"), s = $("#pSeek"); if (c) c.textContent = clock(cur); if (d) d.textContent = dur ? clock(dur) : "--:--"; if (s && dur) { s.value = (cur / dur) * 1000; s.style.backgroundSize = (cur / dur) * 100 + "% 100%"; } },
};

/* =====================================================================
   status / toast / editor
   ===================================================================== */
function setStatus(kind) { State._sk = kind; const d = $("#live"); if (d) d.className = "live" + (kind === "err" ? " err" : kind === "checking" ? " warn" : ""); }
function toast(html, ms = 4000) { const w = $("#toasts"); if (!w) return; const n = el("div", "toast", html); w.appendChild(n); setTimeout(() => { n.style.transition = "opacity .4s"; n.style.opacity = "0"; setTimeout(() => n.remove(), 400); }, ms); }

function openEditor() {
  const c = State.content, mh = c.masthead || {}, d = c.donate || {}, z = d.zelle || {};
  $("#menu").innerHTML = `<div class="mtitle">Editor</div><div class="msub">edit & download content.json</div><div class="editor">
    <label>Hebrew title</label><input id="e_he" value="${esc(mh.hebrew || "")}">
    <label>English name</label><input id="e_en" value="${esc(mh.english || "")}">
    <label>Subtitle</label><input id="e_sub" value="${esc(mh.subtitle || "")}">
    <label>Donate blurb</label><textarea id="e_blurb">${esc(d.blurb || "")}</textarea>
    <label>Zelle name</label><input id="e_zname" value="${esc(z.name || "")}">
    <label>Zelle email</label><input id="e_zemail" value="${esc(z.email || "")}">
    <button class="btn solid block" id="e_apply" style="margin-top:14px">Preview</button>
    <button class="btn block" id="e_dl" style="margin-top:8px">Download content.json</button>
    <button class="btn block" id="e_reset" style="margin-top:8px">Reset</button></div>`;
  openMenu();
  $("#e_apply").onclick = applyEditor;
  $("#e_dl").onclick = () => { const c2 = gatherEditor(); const b = new Blob([JSON.stringify(c2, null, 2)], { type: "application/json" }); const a = el("a"); a.href = URL.createObjectURL(b); a.download = "content.json"; a.click(); };
  $("#e_reset").onclick = () => { localStorage.removeItem(CFG.contentLocalKey); location.reload(); };
}
function gatherEditor() {
  const c = JSON.parse(JSON.stringify(State.content));
  c.masthead = c.masthead || {}; c.masthead.hebrew = $("#e_he").value; c.masthead.english = $("#e_en").value; c.masthead.subtitle = $("#e_sub").value;
  c.donate = c.donate || {}; c.donate.blurb = $("#e_blurb").value; c.donate.zelle = c.donate.zelle || {}; c.donate.zelle.name = $("#e_zname").value; c.donate.zelle.email = $("#e_zemail").value;
  return c;
}
function applyEditor() { State.content = gatherEditor(); setStore(CFG.contentLocalKey, State.content); renderShell(); route(State.route.name, State.route); closeMenu(); toast("Preview updated"); }

window.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
boot();
