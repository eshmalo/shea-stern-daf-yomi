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
  learnedKey: "dy_learned_587", posKey: "dy_pos_587",
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
  speaker: null, all: [], content: {}, media: {}, dafIndex: {}, dafCache: {}, commCache: {},
  byDaf: new Map(), route: { name: "today" }, newIds: new Set(),
  sponsor: { kind: null }, _dafCol: "gemara",
};

/* ---------- utils ---------- */
const fmtDur = s => { s = Math.round(s || 0); if (!s) return ""; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m} min`; };
const clock = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const getStore = k => { try { const v = JSON.parse(localStorage.getItem(k)); return (v && typeof v === "object" && !Array.isArray(v)) ? v : {}; } catch { return {}; } };
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
const gregOf = dstr => calStrings(dstr).greg;   // compact, Gregorian-only (for dense list rows)

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
  buildIndex(); renderShell(); route("today", {}, { replace: true });
  setStatus("checking"); refreshLive(seed.lectures || [], !!cached);
}
async function loadContent() { let l = null; try { l = localStorage.getItem(CFG.contentLocalKey); } catch {} if (l) { try { return JSON.parse(l); } catch {} } return loadJson(CFG.contentUrl); }
async function loadJson(u) { try { return await fetch(u).then(r => r.ok ? r.json() : {}); } catch { return {}; } }

// Resolve a manifest media path. Paths are stored RELATIVE ("media/<id>.mp3")
// so the store is portable: leave options.mediaBaseUrl empty to serve from this
// site (local), or set it to a server/CDN base to go live — a one-line switch,
// no reprocessing. (An already-absolute URL in the manifest is used as-is.)
function mediaUrl(p) {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  const base = (State.content?.options?.mediaBaseUrl || "").replace(/\/+$/, "");
  return base ? base + "/" + p.replace(/^\/+/, "") : p;
}

function buildIndex() {
  const m = new Map();
  for (const lec of State.all) {
    const mm = State.media[String(lec.id)];
    if (mm) { lec.localAudio = mediaUrl(mm.audio); lec.localVideo = mediaUrl(mm.video); lec.introTrimmed = mm.intro_trimmed; }
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
  let last = null; try { last = localStorage.getItem(CFG.lastVisitKey); } catch {}
  State.newIds = new Set();
  if (last) for (const l of State.all) if ((l.posted || "") > last) State.newIds.add(l.id);
  try { localStorage.setItem(CFG.lastVisitKey, todayStr()); } catch {}
}
const favs = () => getStore(CFG.favKey);
const isFav = id => !!favs()[id];
function toggleFav(id) { const f = favs(); if (f[id]) delete f[id]; else f[id] = Date.now(); setStore(CFG.favKey, f); }
function noteProgress(id) { const p = getStore(CFG.progKey); p[id] = Date.now(); setStore(CFG.progKey, p); }

/* ---------- learned dapim (tracked per DAF, Shas-wide, in localStorage) ---------- */
const learnedAll = () => getStore(CFG.learnedKey);
const isLearned = (m, d) => !!learnedAll()[dafKey(m, d)];
function setLearned(m, d, on) {
  const L = learnedAll(), k = dafKey(m, d);
  if (on) L[k] = Date.now(); else delete L[k];
  setStore(CFG.learnedKey, L);
}
function toggleLearned(m, d) { const on = !isLearned(m, d); setLearned(m, d, on); return on; }
function markShiurLearned(lec) { const k = lec && lec._dk; if (k && k.daf) setLearned(k.masechta, k.daf, true); }
function learnedInMasechta(en) { const L = learnedAll(); let n = 0; for (const k in L) if (k.slice(0, en.length + 1) === en + "#") n++; return n; }
let _shasTotal = 0;
function shasTotal() { if (!_shasTotal) _shasTotal = DY.SHAS.reduce((n, m) => n + (m.lastDaf - m.firstDaf + 1), 0); return _shasTotal; }
function learnedTotal() { const L = learnedAll(); let n = 0; for (const k in L) if (DY.BYEN[k.split("#")[0]]) n++; return n; }
const shasPos = (m, d) => { const i = DY.SHAS.findIndex(x => x.en === m); return i < 0 ? -1 : i * 10000 + d; };
// The next daf the user hasn't marked learned, in Daf Yomi (Shas) order, starting
// just past the furthest daf they've learned. Falls back to today's daf when fresh;
// null once all of Shas is learned.
function nextUnlearnedDaf() {
  const L = learnedAll(), keys = Object.keys(L);
  if (!keys.length) { const t = DY.dafForDate(new Date()); return { masechta: t.masechta, daf: t.daf }; }
  let best = -1, bm = null, bd = 0;
  for (const k of keys) { const [m, ds] = k.split("#"); const p = shasPos(m, +ds); if (p > best) { best = p; bm = m; bd = +ds; } }
  // continue forward from the furthest-learned daf (the common, sequential case)
  let cur = { masechta: bm, daf: bd };
  for (let i = 0; i < 6000; i++) { const nx = dafStep(cur.masechta, cur.daf, 1); if (!nx) break; if (!L[dafKey(nx.masechta, nx.daf)]) return nx; cur = nx; }
  // reached the end of Shas — fall back to the first earlier gap before declaring "done"
  for (const mx of DY.SHAS) for (let d = mx.firstDaf; d <= mx.lastDaf; d++) if (!L[dafKey(mx.en, d)]) return { masechta: mx.en, daf: d };
  return null;  // genuinely finished all of Shas
}

/* ---------- resume positions (per shiur id; shared by audio & video) ---------- */
const posAll = () => getStore(CFG.posKey);
const getPos = id => posAll()[id] || null;
function savePos(id, t, d) { if (!id || !(t > 0)) return; const dd = (isFinite(d) && d > 0) ? Math.round(d) : 0; const P = posAll(); P[id] = { t: Math.round(t), d: dd, at: Date.now() }; setStore(CFG.posKey, P); }
function clearPos(id) { const P = posAll(); if (P[id]) { delete P[id]; setStore(CFG.posKey, P); } }
// A saved position worth resuming to (past the intro, not at the very end).
const resumePoint = id => { const p = getPos(id); return (p && p.t > 20 && (!p.d || p.t < p.d - 20)) ? p.t : 0; };
// The single most-recently-left-off shiur, for the home "Continue" card.
function lastInProgress() {
  const P = posAll(); let best = null;
  for (const id in P) { const p = P[id]; if (!p || !p.t) continue; if (p.d && p.t > p.d - 25) continue; if (!best || p.at > best.at) best = { id: +id, ...p }; }
  if (!best) return null; const lec = State.all.find(l => l.id === best.id); return lec ? { lec, pos: best } : null;
}

/* native daf text loader */
async function loadDafText(masechta) {
  const key = fileKey(masechta);
  if (State.dafCache[key]) return State.dafCache[key];
  const info = State.dafIndex[masechta]; if (!info) return null;
  try { const d = await fetch(`data/daf/${key}.json`).then(r => r.ok ? r.json() : null); if (!d) return null; State.dafCache[key] = d; return d; }
  catch { return null; }
}
/* Rashi + Tosafos for the "Daf" (Tzuras Hadaf) layout — loaded lazily per masechta */
async function loadDafComm(masechta) {
  const key = fileKey(masechta);
  if (State.commCache[key]) return State.commCache[key];
  try { const d = await fetch(`data/daf/${key}.comm.json`).then(r => r.ok ? r.json() : {}); State.commCache[key] = d; return d; }
  catch { return {}; }
}

/* =====================================================================
   SHELL
   ===================================================================== */
function renderShell() {
  const mh = State.content.masthead || {};
  document.body.innerHTML = `<div id="app">
    <header class="bar">
      <button class="ic-btn back" id="backBtn" aria-label="Back" hidden>‹</button>
      <button class="ic-btn" id="burger" aria-label="Menu" aria-haspopup="true" aria-expanded="false" aria-controls="menu">☰</button>
      <span class="wordmark" id="home" role="link" tabindex="0" title="Today's daf">${esc(mh.hebrew || "הדף היומי")}</span>
      <span class="live" id="live" title="updating from source"></span>
      <span class="spacer"></span>
      <button class="ic-btn" id="searchBtn" aria-label="Search">⌕</button>
    </header>
    <main id="view"></main>
    <footer>
      <span class="fhe">${esc(mh.hebrew || "שיעורי הדף היומי")}</span>
      ${esc(mh.english || State.speaker?.name || "Rabbi Shea Stern")} · ${esc(mh.subtitle || "Daf Yomi")}<br>
      Talmud — William Davidson Edition, Sefaria · the library updates automatically
    </footer>
    <div class="player hidden" id="player"></div>
  </div>
  <div class="mask" id="mask"></div>
  <aside class="menu" id="menu" role="dialog" aria-modal="true" aria-label="Site menu"></aside>
  <div class="toast-wrap" id="toasts" aria-live="polite" aria-atomic="false"></div>
  <div class="reader" id="reader" hidden aria-hidden="true"></div>`;

  $("#burger").onclick = openMenu; $("#mask").onclick = closeMenu;
  $("#searchBtn").onclick = () => route("search");
  $("#backBtn").onclick = goBack;
  const homeEl = $("#home"); homeEl.onclick = () => route("today"); homeEl.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); route("today"); } };
  Player.mount(); buildMenu(); setStatus(State._sk || "checking"); updateBackBtn();
}
function buildMenu() {
  const mh = State.content.masthead || {};
  $("#menu").innerHTML = `<div class="mtitle">${esc(mh.hebrew || "")}</div><div class="msub">${esc(mh.english || State.speaker?.name || "")} · ${esc(mh.subtitle || "")}</div>
    <nav>
      <button class="mi" data-route="today">Today's Daf</button>
      <button class="mi" data-route="browse">Browse Shas</button>
      <button class="mi" data-route="topics">Parsha &amp; Shiurim</button>
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
function openMenu() { $("#menu").classList.add("open"); $("#mask").classList.add("open"); $("#burger")?.setAttribute("aria-expanded", "true"); $("#app")?.setAttribute("inert", ""); setTimeout(() => $("#menu .mi")?.focus(), 0); }
function closeMenu() { const wasOpen = $("#menu")?.classList.contains("open"); $("#menu").classList.remove("open"); $("#mask").classList.remove("open"); $("#burger")?.setAttribute("aria-expanded", "false"); $("#app")?.removeAttribute("inert"); if (wasOpen) $("#burger")?.focus(); }

/* =====================================================================
   ROUTER
   ===================================================================== */
let _navDepth = 0;   // how deep into the app we are (0 = home/entry); drives the back button
function route(name, params = {}, opts = {}) {
  const next = { name, ...params };
  const same = JSON.stringify(next) === JSON.stringify(State.route);
  State.route = next;
  if (name === "sponsor" && params.pre) State.sponsor = { ...params.pre };
  const replace = opts.replace || same;        // identical route → replace, don't stack a dead history entry
  _navDepth = replace ? _navDepth : _navDepth + 1;
  const st = { route: State.route, sponsor: State.sponsor, depth: _navDepth };
  try { replace ? history.replaceState(st, "") : history.pushState(st, ""); } catch {}
  rerender(); window.scrollTo(0, 0); updateBackBtn();
}
function goBack() { if (_navDepth > 0) history.back(); else route("today", {}, { replace: true }); }
function updateBackBtn() { const b = $("#backBtn"); if (b) b.hidden = _navDepth <= 0; }
window.addEventListener("popstate", e => {
  if (Reader.open) { hideReader(); return; }   // Back closes the full-screen reader; #view is left untouched
  const st = e.state;
  if (st && st.route) { State.route = st.route; if (st.sponsor) State.sponsor = st.sponsor; _navDepth = st.depth || 0; }
  else { State.route = { name: "today" }; _navDepth = 0; }   // walked back past our entry → home
  closeMenu(); rerender(); window.scrollTo(0, 0); updateBackBtn();
});
function rerender() {
  const v = $("#view"); if (!v) return;
  $$("#view video").forEach(vid => { try { vid.pause(); vid.removeAttribute("src"); vid.load(); } catch {} });   // flush any in-page video before the view is replaced (no detached audio)
  const r = State.route;
  const fn = { today: viewToday, browse: viewBrowse, seder: viewSeder, masechta: viewMasechta, daf: viewDaf, topics: viewTopics, category: viewCategory, search: viewSearch, mystuff: viewMyStuff, sponsor: viewSponsor, about: viewAbout, donate: viewDonate }[r.name] || viewToday;
  v.innerHTML = `<div class="view">${fn(r)}</div>`;
  wireView(r);
  if (r.name === "daf") { hydrateDaf(); if (r.watch) { const [mm, dd] = (r.id || "").split("|"); const s = shiurFor(mm, +dd); if (s) watchVideo(s.id); } }
}

/* =====================================================================
   VIEWS
   ===================================================================== */
function dafData(date) { const dy = DY.dafForDate(date); return dy ? { dy, shiur: shiurFor(dy.masechta, dy.daf) } : null; }

/* ---------- progress UI (shared) ---------- */
function progressBar(done, total, opts = {}) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return `<div class="prog">
    <div class="prog-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(opts.label || "Progress")}" aria-valuetext="${done.toLocaleString()} of ${total.toLocaleString()} (${pct}%)"><div class="prog-fill" style="width:${pct}%"></div></div>
    ${opts.hideLabel ? "" : `<div class="prog-label"><span>${esc(opts.label || "Learned")}</span><span class="prog-n">${done.toLocaleString()} / ${total.toLocaleString()} · ${pct}%</span></div>`}
  </div>`;
}
// Home "Continue learning" block — resume the last shiur + jump to the next
// unlearned daf + overall Shas progress. Hidden entirely until there's progress.
function continueCard() {
  const lip = lastInProgress(), lt = learnedTotal();
  if (!lip && !lt) return "";
  let rows = "";
  if (lip) {
    const k = lip.lec._dk;
    const title = k && k.daf ? `${k.masechta} · Daf ${k.daf}` : lip.lec.title;
    rows += `<button class="cont-row" data-play="${lip.lec.id}"><span class="cont-ic">▶</span><span class="cont-main"><b>Resume ${esc(title)}</b><span class="cont-sub">picks up at ${clock(lip.pos.t)}</span></span></button>`;
  }
  const nx = nextUnlearnedDaf();
  if (nx) {
    const m = DY.BYEN[nx.masechta];
    rows += `<button class="cont-row" data-daf="${esc(nx.masechta)}|${nx.daf}"><span class="cont-ic ghost">↪</span><span class="cont-main"><b>Up next · ${esc(nx.masechta)} Daf ${nx.daf}</b><span class="cont-sub">${esc(m ? m.he : nx.masechta)} ${esc(heDaf(nx.daf))}</span></span></button>`;
  }
  return `<div class="section">Continue learning</div>
    <div class="continue">${rows}
      ${lt ? `<div class="cont-prog">${progressBar(lt, shasTotal(), { label: "Your Shas progress" })}</div>` : ""}
    </div>`;
}
function upNextLink() {
  const nx = nextUnlearnedDaf();
  if (!nx) return `<p class="center muted" style="font-size:13.5px;margin-top:10px">You've learned all of Shas — mazel tov! 🎉</p>`;
  return `<p class="center" style="margin-top:10px"><a class="textlink" data-daf="${esc(nx.masechta)}|${nx.daf}">Up next · ${esc(nx.masechta)} Daf ${nx.daf} →</a></p>`;
}

function viewToday() {
  const mh = State.content.masthead || {};
  const now = new Date();
  const t = dafData(now), y = dafData(new Date(now - 864e5)), tm = dafData(new Date(now - -864e5));
  const ref = `${esc(t.dy.masechta)}|${t.dy.daf}`;
  const hasVid = t.shiur && (t.shiur.localVideo || t.shiur.video);
  const actions = t.shiur
    ? `<a class="btn solid" data-play="${t.shiur.id}">▶ Listen</a>${hasVid ? `<a class="btn" data-watchdaf="${ref}">▦ Watch</a>` : ""}<a class="btn" data-daf="${ref}">Read the daf</a>`
    : `<a class="btn accent" data-sponsor-daf="${ref}">✦ Sponsor today's daf</a><a class="btn" data-daf="${ref}">Read the daf</a>`;
  return `
    <div class="titlepage">
      <div class="he">${esc(mh.hebrew || "שיעורי הדף היומי")}</div>
      <div class="by">given by <b>${esc(mh.english || State.speaker?.name || "")}</b></div>
      <div class="sub">${esc(mh.subtitle || "")}</div>
      <div class="flourish"><span>❖</span></div>
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
    ${continueCard()}
    ${recentSection()}
    ${moreSection()}`;
}
function recentSection() {
  const recent = State.all.filter(l => l._dk && l._dk.daf).slice(0, 7);
  if (!recent.length) return "";
  return `<div class="section">Recently given</div><div class="rows">${recent.map(rowHtml).join("")}</div>
    <p class="center" style="margin-top:16px"><a class="textlink" data-route="browse">Browse all of Shas →</a></p>`;
}

function viewBrowse() {
  return `<div class="pagetitle">Browse Shas</div><p class="lead">Every daf of the Talmud — tap any daf to read it; the Rabbi's shiur appears where he's given it.</p>
    ${learnedTotal() ? `<div class="browse-prog">${progressBar(learnedTotal(), shasTotal(), { label: "Your Shas progress" })}</div>` : ""}
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
  if (!m) return crumbs([["Browse", "browse"]], "—") + `<div class="empty-mini">That masechta isn't available.</div>`;
  let cells = "";
  for (let d = m.firstDaf; d <= m.lastDaf; d++) {
    const has = State.byDaf.has(dafKey(m.en, d)), lrn = isLearned(m.en, d);
    cells += `<button class="daf-cell ${has ? "has" : "future"}${lrn ? " learned" : ""}" data-daf="${esc(m.en)}|${d}"><span class="he">${esc(window.HebCal ? window.HebCal.gematria(d) : d)}</span><span class="n">${d}</span>${lrn ? '<span class="cell-chk" aria-label="learned">✓</span>' : ""}</button>`;
  }
  const ln = learnedInMasechta(m.en);
  return crumbs([["Browse", "browse"], [DY.sederHe(m.seder), "seder", { seder: m.seder }]], m.he) +
    `<div class="center muted" style="font-size:13px;margin:8px 0 2px">${countMasechta(m.en)} of ${m.dapim} dapim given · tap any daf to read it</div>
     ${ln ? `<div class="mas-prog">${progressBar(ln, m.dapim, { label: "Learned in " + m.en })}</div>` : ""}
     <div class="daf-grid">${cells}</div>`;
}

function viewDaf(r) {
  if (!r.id || r.id.indexOf("|") < 0) return `<div class="empty-mini">Select a daf to read.</div>`;
  const [masechta, dafS] = r.id.split("|"); const daf = +dafS;
  const m = DY.BYEN[masechta], shiur = shiurFor(masechta, daf);
  const mode = r.mode || State._dafMode || "daf";
  const heT = `${m ? m.he : masechta} ${heDaf(daf)}`;
  const lrn = isLearned(masechta, daf);
  const learnCtl = `<div class="daf-progress">
       <button class="learn-toggle ${lrn ? "on" : ""}" data-learn="${esc(masechta)}|${daf}" aria-pressed="${lrn}">${lrn ? "✓ Learned" : "Mark as learned"}</button>
       <span class="learn-meta">${esc(masechta)}: ${learnedInMasechta(masechta)} / ${m ? m.dapim : "?"} dapim learned</span>
     </div>`;
  const media = shiur ? `
    <div class="daf-media">
      <a class="btn solid sm" data-play="${shiur.id}">▶ Listen</a>
      ${(shiur.localVideo || shiur.video) ? `<a class="btn sm" data-watch="${shiur.id}">▦ Watch</a>` : ""}
      <a class="btn sm" data-fav="${shiur.id}">${isFav(shiur.id) ? "★ Saved" : "☆ Save"}</a>
    </div>
    <div id="videoSlot"></div>` : "";
  const sponsor = shiur
    ? `<p class="center" style="margin:10px 0"><a class="textlink" data-sponsor-daf="${esc(masechta)}|${daf}">✦ Sponsor this daf</a></p>`
    : `<div class="sponsor-strip"><b>This daf hasn't been given yet.</b><div class="muted" style="font-size:14px;margin-top:4px">Sponsor it for a yahrtzeit or simcha — your dedication is learned by everyone.</div><a class="btn accent" data-sponsor-daf="${esc(masechta)}|${daf}">✦ Sponsor ${esc(masechta)} ${daf}</a></div>`;
  return crumbs([["Browse", "browse"], [m ? m.he : masechta, "masechta", { masechta }]], heDaf(daf)) +
    `<div class="daf-head">
       <div class="daf-daynav">
         <button class="daynav prev" data-daynav="-1" aria-label="Previous daf — whole page" title="Previous daf (whole page)"${dafStep(masechta, daf, -1) ? "" : " disabled"}>‹</button>
         <div class="daf-head-titles"><div class="he">${esc(heT)}</div><div class="en">${esc(masechta)} · Daf ${daf}</div></div>
         <button class="daynav next" data-daynav="1" aria-label="Next daf — whole page" title="Next daf (whole page)"${dafStep(masechta, daf, 1) ? "" : " disabled"}>›</button>
       </div>
       ${shiur ? `<div class="meta">Given ${dateLine(shiur.recorded || shiur.posted)} · ${fmtDur(shiur.duration)}</div>` : ""}</div>
     ${learnCtl}
     ${media}${sponsor}
     <div class="daf-toolbar">
       <span class="ttl">The Daf</span>
       <span class="seg" id="dafMode" role="group" aria-label="Daf display mode">${["daf", "he", "en", "both"].map(x => `<button data-mode="${x}" class="${x === mode ? "on" : ""}" aria-pressed="${x === mode}"${x === "daf" ? ' title="The full page — Gemara, Rashi &amp; Tosafos, as printed"' : ""}>${({ daf: "Daf", he: "עברית", en: "English", both: "Both" })[x]}</button>`).join("")}</span>
       <button class="fs-btn" id="dafFsBtn" aria-label="Read full screen" title="Read full screen">⛶</button>
     </div>
     <div class="daf-read">
       <div id="dafText" data-mas="${esc(masechta)}" data-daf="${daf}" data-mode="${mode}"><div class="daf-loading">Loading the daf…</div></div>
     </div>`;
}

// Build the inner HTML for one daf in a given mode — shared by the in-page
// reading region (#dafText) and the full-screen reader overlay.
async function dafBodyHtml(masechta, daf, mode) {
  const data = await loadDafText(masechta);
  if (!data) {
    const reason = { Shekalim: "Shekalim is learned from the Talmud Yerushalmi, which isn't in the native reader yet.", Kinnim: "Kinnim is a Mishnah-only masechta — it has no Gemara text.", Middos: "Middos is a Mishnah-only masechta — it has no Gemara text." }[masechta] || "Native text for this masechta isn't available yet.";
    return `<div class="empty-mini">${esc(reason)}</div>`;
  }
  if (mode === "daf") { const comm = await loadDafComm(masechta); return renderDafLayout(masechta, daf, data, comm); }
  let html = "", first = true;
  const amLabel = (txt) => { const l = first ? flipLabel("amud-label", txt, masechta, daf) : `<div class="amud-label">${txt}</div>`; first = false; return l; };
  // Tamid's opening Mishnah sits on Vilna daf 25b; surface it on its first daf (26)
  if (masechta === "Tamid" && daf === 26 && data["25b"]) html += `<div class="amud">${amLabel(esc(window.HebCal ? window.HebCal.gematria(25) : 25) + "·ב")}${renderAmud(data["25b"], mode)}</div>`;
  for (const amud of [daf + "a", daf + "b"]) {
    const seg = data[amud]; if (!seg) continue;
    html += `<div class="amud">${amLabel(esc(window.HebCal ? window.HebCal.gematria(daf) : daf) + (amud.endsWith("a") ? "·א" : "·ב"))}${renderAmud(seg, mode)}</div>`;
  }
  return (html || `<div class="empty-mini">This amud isn't available.</div>`) +
    `<div class="daf-src">Talmud text — William Davidson Edition, Sefaria (Hebrew public domain; English © Steinsaltz, CC-BY-NC)</div>`;
}
async function hydrateDaf() {
  const box = $("#dafText"); if (!box) return;
  box.innerHTML = await dafBodyHtml(box.dataset.mas, +box.dataset.daf, box.dataset.mode);
  applyDafCol(box);
}
// Step to the previous / next daf, crossing masechta boundaries in Daf Yomi
// (Shas) order. Returns {masechta, daf} or null at the very start/end of Shas.
function dafStep(masechta, daf, dir) {
  const m = DY.BYEN[masechta]; if (!m) return null;
  const i = DY.SHAS.findIndex(x => x.en === masechta);
  if (dir > 0) {
    if (daf < m.lastDaf) return { masechta, daf: daf + 1 };
    const nx = DY.SHAS[i + 1]; return nx ? { masechta: nx.en, daf: nx.firstDaf } : null;
  }
  if (daf > m.firstDaf) return { masechta, daf: daf - 1 };
  const pv = DY.SHAS[i - 1]; return pv ? { masechta: pv.en, daf: pv.lastDaf } : null;
}
const dafTitleHe = (masechta, daf) => `${DY.BYEN[masechta] ? DY.BYEN[masechta].he : masechta} ${heDaf(daf)}`;
/* ---------- "Daf" layout — the page as it appears in print (Tzuras Hadaf):
   Gemara in the center, Rashi on the inner margin, Tosafos on the outer.
   Built entirely from our own Sefaria text — fully self-hosted. ---------- */
const heAmud = (daf, amud) => `${window.HebCal ? window.HebCal.gematria(daf) : daf}${amud.endsWith("a") ? "·א" : "·ב"}`;
function commCol(arr) {
  if (!arr || !arr.length) return `<div class="col-empty">—</div>`;
  return arr.map(c => {
    const m = c.match(/^(.{1,60}?)\s[-–]\s([\s\S]+)$/);   // dibur hamatchil — explanation
    return m ? `<p class="comm"><b>${esc(m[1])}</b> ${esc(m[2])}</p>` : `<p class="comm">${esc(c)}</p>`;
  }).join("");
}
// A daf/amud label (נב·א) flanked by the gemara-flip arrows, on both sides of the
// page number. Rendered INTO the daf so it sits identically in every mode and
// re-renders with the right boundary state on each flip. Clicks are delegated.
function flipLabel(cls, innerHtml, mas, daf) {
  const dis = d => dafStep(mas, daf, d) ? "" : " disabled";
  return `<div class="${cls} flip-label">`
    + `<button class="pageflip prev" data-gemflip="-1" aria-label="Previous daf" title="Previous daf"${dis(-1)}>‹</button>`
    + `<span class="lbl-t">${innerHtml}</span>`
    + `<button class="pageflip next" data-gemflip="1" aria-label="Next daf" title="Next daf"${dis(1)}>›</button>`
    + `</div>`;
}
function dafPage(daf, amud, seg, c, labelHtml) {
  const gem = (seg.he || "").split("\n").filter(Boolean).map(esc).join("<br>");
  return `<div class="dafpage">
    ${labelHtml}
    <div class="dafpage-grid">
      <div class="col side rashi"><div class="col-h">רש"י</div>${commCol(c && c.r)}</div>
      <div class="col gemara"><div class="col-h">גמרא</div><div class="gem">${gem || '<div class="col-empty">—</div>'}</div></div>
      <div class="col side tosafos"><div class="col-h">תוספות</div>${commCol(c && c.t)}</div>
    </div></div>`;
}
function renderDafLayout(masechta, daf, data, comm) {
  comm = comm || {};
  let html = "", first = true;
  for (const amud of [daf + "a", daf + "b"]) {
    const seg = data[amud]; if (!seg) continue;
    const txt = esc(heAmud(daf, amud));
    html += dafPage(daf, amud, seg, comm[amud], first ? flipLabel("dafpage-label", txt, masechta, daf) : `<div class="dafpage-label">${txt}</div>`);
    first = false;
  }
  if (!html) return `<div class="empty-mini">This amud isn't available.</div>`;
  return dafColTabs() + html + `<div class="daf-src">Talmud, Rashi &amp; Tosafos — Vilna Edition (public domain) · English Steinsaltz, CC-BY-NC · via Sefaria</div>`;
}
/* Phone-mode column selector for the Tzuras-Hadaf view: instead of scrolling
   through stacked גמרא / רש"י / תוספות, show ONE full-width column at a time.
   Order matches the printed daf: תוספות (left) · גמרא (center) · רש"י (right). */
function dafColTabs() {
  const cur = State._dafCol || "gemara";
  return `<div class="daf-col-tabs" role="tablist" aria-label="Daf column">` +
    [["tosafos", "תוספות"], ["gemara", "גמרא"], ["rashi", 'רש"י']].map(([k, l]) =>
      `<button data-dcol="${k}" role="tab" aria-selected="${k === cur}" class="${k === cur ? "on" : ""}">${l}</button>`).join("") +
    `</div>`;
}
function applyDafCol(box) {        // reflect the chosen column as a class on the daf container
  const col = State._dafCol || "gemara";
  ["gemara", "rashi", "tosafos"].forEach(c => box.classList.toggle("col-" + c, c === col));
}
function selectDafCol(col) {
  State._dafCol = col;
  [$("#dafText"), $("#rdBody")].forEach(b => b && applyDafCol(b));   // covers the in-page daf and the full-screen reader
  $$("[data-dcol]").forEach(b => { const on = b.dataset.dcol === col; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
}

function renderAmud(seg, mode) {
  const he = (seg.he || "").split("\n").filter(Boolean), en = (seg.en || "").split("\n").filter(Boolean);
  if (mode === "he") return `<div class="daf-he">${he.map(esc).join("<br>")}</div>`;
  if (mode === "en") return `<div class="daf-en">${en.map(safeEn).join("<br>")}</div>`;
  // both: interleave by segment if counts align, else stacked blocks
  if (he.length === en.length && he.length) return he.map((h, i) => `<div class="seg-pair"><div class="daf-he">${esc(h)}</div><div class="daf-en">${safeEn(en[i])}</div></div>`).join("");
  return `<div class="daf-he">${he.map(esc).join("<br>")}</div><hr class="rule thin"><div class="daf-en">${en.map(safeEn).join("<br>")}</div>`;
}

/* ---------- two flip controls on the daf page ----------
   1. Corner arrows (inside the daf) flip ONLY the daf/gemara reading region in
      place — the top of the page (the shiur you're hearing) stays put.
   2. Top arrows (in the head) turn the WHOLE page to the previous / next daf —
      a different day's full lecture page. */
function gemaraFlip(dir) {                       // label arrows — daf text only, in place
  const box = $("#dafText"); if (!box) return;
  const nx = dafStep(box.dataset.mas, +box.dataset.daf, dir); if (!nx) return;
  box.dataset.mas = nx.masechta; box.dataset.daf = nx.daf;
  hydrateDaf();                                  // re-renders the daf incl. the flanking arrows (fresh boundary state)
}
function dayNav(dir) {                           // top arrows — whole lecture page
  const [m, d] = (State.route.id || "").split("|");
  const nx = dafStep(m, +d, dir); if (!nx) return;
  route("daf", { id: `${nx.masechta}|${nx.daf}` });
}

/* ---------- full-screen Daf reader (overlay) ----------
   The full daf, full-bleed, with a minimal bar. Flips between dapim in place
   and never touches the underlying page — so the shiur (audio or video) keeps
   playing untouched while you read ahead or back. */
const Reader = { masechta: null, daf: null, mode: "daf", open: false };
let _readerClosing = false, _readerOpener = null;
function openReader(masechta, daf, mode) {
  Reader.masechta = masechta; Reader.daf = +daf; Reader.mode = mode || State._dafMode || "daf"; Reader.open = true;
  const r = $("#reader"); if (!r) return;
  _readerOpener = document.activeElement;
  r.hidden = false; r.setAttribute("aria-hidden", "false");
  document.documentElement.classList.add("reader-open");
  renderReader();
  $("#view")?.setAttribute("inert", "");                // background content is inert; the player (z-index above the reader) stays controllable
  setTimeout(() => $("#rdClose")?.focus(), 0);           // move focus into the overlay
  try { history.pushState({ ...history.state, reader: true }, ""); } catch {}  // Back / Esc closes the reader first
}
function closeReader() { if (Reader.open && !_readerClosing) { _readerClosing = true; try { history.back(); } catch { hideReader(); } } }  // routed through popstate so #view is left intact
function hideReader() {
  Reader.open = false; _readerClosing = false;
  const r = $("#reader"); if (r) { r.hidden = true; r.setAttribute("aria-hidden", "true"); }
  document.documentElement.classList.remove("reader-open");
  $("#view")?.removeAttribute("inert");
  try { _readerOpener && _readerOpener.focus(); } catch {}   // restore focus to whatever opened the reader
  syncInpageRead(Reader.masechta, Reader.daf);   // leave the in-page reader where we stopped
}
function syncInpageRead(masechta, daf) {
  const box = $("#dafText"); if (!box) return;
  if (box.dataset.mas === masechta && +box.dataset.daf === daf) return;
  box.dataset.mas = masechta; box.dataset.daf = daf;
  updateFlipUI(); hydrateDaf();
}
function readerFlip(dir) {
  const nx = dafStep(Reader.masechta, Reader.daf, dir); if (!nx) return;
  Reader.masechta = nx.masechta; Reader.daf = nx.daf; renderReader();
}
function renderReader() {
  const r = $("#reader"); if (!r) return;
  const m = Reader.masechta, d = Reader.daf, mode = Reader.mode;
  const shiur = shiurFor(m, d);
  r.innerHTML = `
    <div class="reader-bar">
      <div class="rd-side rd-left"><button class="rd-ic close" id="rdClose" aria-label="Close full screen">✕</button></div>
      <div class="rd-title"><span class="he">${esc(dafTitleHe(m, d))}</span><span class="en">${esc(m)} · Daf ${d}</span></div>
      <div class="rd-side rd-right">
        <span class="seg rd-seg" id="rdMode" role="group" aria-label="Daf display mode">${["daf", "he", "en", "both"].map(x => `<button data-rmode="${x}" class="${x === mode ? "on" : ""}" aria-pressed="${x === mode}">${({ daf: "Daf", he: "עברית", en: "English", both: "Both" })[x]}</button>`).join("")}</span>
        ${shiur ? `<button class="rd-ic play" id="rdPlay" aria-label="Play this shiur" title="Play this daf's shiur">▶</button>` : ""}
      </div>
    </div>
    <div class="reader-body" id="rdBody"><div class="daf-loading">Loading the daf…</div></div>`;
  $("#rdClose").onclick = closeReader;
  $$("#rdMode button").forEach(b => b.onclick = () => { Reader.mode = b.dataset.rmode; State._dafMode = Reader.mode; renderReader(); });
  if (shiur) $("#rdPlay").onclick = () => { playId(shiur.id); toast("Playing — keep reading"); };
  fillReaderBody(m, d, mode);
}
async function fillReaderBody(m, d, mode) {
  const html = await dafBodyHtml(m, d, mode);
  const body = $("#rdBody");                                       // ignore if the user flipped again while loading
  if (body && Reader.open && Reader.masechta === m && Reader.daf === d && Reader.mode === mode) {
    body.innerHTML = html; body.scrollTop = 0; applyDafCol(body);
    body.querySelectorAll("[data-gemflip]").forEach(b => b.onclick = () => readerFlip(+b.dataset.gemflip));   // the ‹ נד·א › arrows flip the reader
    body.querySelectorAll("[data-dcol]").forEach(b => b.onclick = () => selectDafCol(b.dataset.dcol));         // phone-mode column selector
  }
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
  const f = favs(), p = getStore(CFG.progKey), lt = learnedTotal();
  const fav = State.all.filter(l => f[l.id]).sort((a, b) => f[b.id] - f[a.id]);
  const pr = State.all.filter(l => p[l.id]).sort((a, b) => p[b.id] - p[a.id]).slice(0, 12);
  const sec = (t, list, e) => `<div class="section">${t}</div>` + (list.length ? `<div class="rows">${list.map(rowHtml).join("")}</div>` : `<div class="empty-mini">${e}</div>`);
  const head = (lt || lastInProgress())
    ? `<div class="mystuff-top">${progressBar(lt, shasTotal(), { label: "Your Shas progress" })}${upNextLink()}</div>`
    : `<p class="lead">Your progress lives on this device — mark dapim as learned and your spot is saved automatically.</p>`;
  return `<div class="pagetitle">My Stuff</div>` + head
    + sec("Continue", pr, "Play a shiur and it appears here.")
    + sec("Saved", fav, "Tap ☆ Save on a daf to keep it here.");
}

/* ---------- Shiurim (non-daf: parsha, holidays, machshava, …) ---------- */
const isDafShiur = l => (l._dk && l._dk.daf) || /daf yomi|daily talmud/i.test(l.category || "");
function prettyCat(c) { return ({ "Parasha/Torah Portion": "Parsha", "Daf Yomi/Daily Talmud": "Daf Yomi", "Eulogies/Hespedim": "Hespedim", "Jewish Understanding": "Machshava", "Teshuvah/Repentance": "Teshuvah" })[c] || c; }
function nonDafCats() {
  const m = new Map();
  for (const l of State.all) { if (isDafShiur(l)) continue; const c = l.category || "Other"; m.set(c, (m.get(c) || 0) + 1); }
  return [...m.entries()].map(([name, count]) => ({ name, pretty: prettyCat(name), count })).sort((a, b) => b.count - a.count);
}
function viewTopics() {
  const cats = nonDafCats();
  if (!cats.length) return `<div class="pagetitle">Shiurim</div><div class="empty-mini">No shiurim found yet.</div>`;
  return `<div class="pagetitle">Shiurim</div><p class="lead">Beyond the daily daf — parsha, holidays, and more.</p>
    <div class="cat-list">${cats.map(c => `<button class="cat-row" data-cat="${esc(c.name)}"><span class="nm">${esc(c.pretty)}</span><span class="ct">${c.count} shiurim ›</span></button>`).join("")}</div>`;
}
function viewCategory(r) {
  const cat = r.cat, pretty = prettyCat(cat);
  const list = State.all.filter(l => l.category === cat && !isDafShiur(l)).sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
  const back = crumbs([["Shiurim", "topics"]], pretty);
  if (!list.length) return back + `<div class="empty-mini">No shiurim in this category yet.</div>`;
  let body;
  if (/paras|holiday/i.test(cat)) {                 // group by parsha / yom tov (the series)
    const groups = {};
    for (const l of list) { const gk = l.series || "—"; (groups[gk] || (groups[gk] = [])).push(l); }
    const names = Object.keys(groups).sort((a, b) => Math.max(...groups[b].map(x => Date.parse(x.posted || 0) || 0)) - Math.max(...groups[a].map(x => Date.parse(x.posted || 0) || 0)));
    body = names.map(nm => `<div class="topic-group">${esc(nm)}</div><div class="rows">${groups[nm].map(rowHtml).join("")}</div>`).join("");
  } else {
    body = `<div class="rows">${list.map(rowHtml).join("")}</div>`;
  }
  return back + `<div class="pagetitle" style="margin-top:6px">${esc(pretty)}</div>${body}`;
}
function moreSection() {
  const nondaf = State.all.filter(l => !isDafShiur(l)).slice(0, 4);
  if (!nondaf.length) return "";
  return `<div class="section">Parsha &amp; more</div><div class="rows">${nondaf.map(rowHtml).join("")}</div>
    <p class="center" style="margin-top:14px"><a class="textlink" data-route="topics">All shiurim →</a></p>`;
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

// Our own Zelle QR — generated as crisp SVG (no image file). The exact payload
// is content.donate.zelle.qrData; if absent we rebuild the standard Zelle URL
// from the name + email, so it stays correct if those are edited.
function zelleQrData() {
  const z = State.content?.donate?.zelle || {};
  if (z.qrData) return z.qrData;
  if (!z.email) return "";
  const first = (z.name || "").trim().split(/\s+/)[0] || (z.name || "");
  try { return "https://enroll.zellepay.com/qr-codes?data=" + btoa(JSON.stringify({ name: first, token: z.email, action: "payment" })); }
  catch { return ""; }
}
function renderQR(text, { px = 230, label = "QR code" } = {}) {
  if (!text || typeof qrcode === "undefined") return "";
  try {
    const qr = qrcode(0, "M"); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), q = 4, size = n + q * 2;
    let path = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + q} ${r + q}h1v1h-1z`;
    return `<svg class="qr" viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#16140f"/></svg>`;
  } catch { return ""; }
}

function viewDonate() {
  const d = State.content.donate || {}, z = d.zelle || {};
  const qr = renderQR(zelleQrData(), { px: 230, label: `Zelle QR — pay ${z.name || ""}` })
    || (z.qr ? `<img src="${esc(z.qr)}" alt="Zelle QR for ${esc(z.name || "")}">` : "");
  return `<div class="pagetitle">${esc(d.heading || "Donate")}</div><p class="lead">${esc(d.blurb || "")}</p>
    <div class="donate-box"><div class="qr-frame">${qr}<div class="qr-cap">Scan with your bank app to pay by <span class="zelle-brand">Zelle</span></div></div>
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
  const k = lec._dk, isDaf = k && k.daf;
  // For a daf shiur the title ("Daf 52 Chullin") just repeats the reference, so
  // show a clean "Masechta · Daf N" instead; keep the real title for everything else.
  const num = isDaf ? esc(window.HebCal ? window.HebCal.gematria(k.daf) : k.daf) : "▸";
  const title = isDaf ? `${esc(k.masechta)} · Daf ${k.daf}` : esc(lec.title);
  const meta = [fmtDur(lec.duration), gregOf(lec.recorded || lec.posted)].filter(Boolean).join(" · ");
  return `<button class="row${State.newIds.has(lec.id) ? " is-new" : ""}" data-rowdaf="${isDaf ? esc(k.masechta) + "|" + k.daf : ""}" data-play="${lec.id}">
    <span class="rnum${isDaf ? "" : " sym"}">${num}</span>
    <span class="rmain"><b>${title}</b><span class="rmeta">${meta}</span></span>
    <span class="rgo" aria-hidden="true">▶</span></button>`;
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
  v.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => route("category", { cat: b.dataset.cat }));
  v.querySelectorAll("[data-daf]").forEach(b => b.onclick = () => route("daf", { id: b.dataset.daf }));
  v.querySelectorAll("[data-go]").forEach(a => a.onclick = () => route(a.dataset.go, JSON.parse(a.dataset.p || "{}")));
  v.querySelectorAll("[data-route]").forEach(b => b.onclick = () => route(b.dataset.route));
  v.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => { const p = navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy); if (p && p.then) p.then(() => toast("Email copied")).catch(() => toast(b.dataset.copy)); else toast(b.dataset.copy); });
  v.querySelectorAll("[data-sponsor-daf]").forEach(b => b.onclick = e => { e.stopPropagation(); const [m, d] = b.dataset.sponsorDaf.split("|"); route("sponsor", { pre: { kind: "daf", masechta: m, daf: +d } }); });
  v.querySelectorAll("[data-watch]").forEach(b => b.onclick = e => { e.stopPropagation(); watchVideo(+b.dataset.watch); });
  v.querySelectorAll("[data-watchdaf]").forEach(b => b.onclick = () => route("daf", { id: b.dataset.watchdaf, watch: true }));
  v.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
    const mode = b.dataset.mode; State._dafMode = mode;
    $$("#dafMode button").forEach(x => { const on = x.dataset.mode === mode; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
    const box = $("#dafText"); if (box) { box.dataset.mode = mode; hydrateDaf(); } // re-render text only; leaves any playing video intact
  });
  const dr = $(".daf-read");   // these controls are re-rendered inside #dafText each flip → delegate
  if (dr) dr.onclick = e => {
    const g = e.target.closest("[data-gemflip]"); if (g) { e.preventDefault(); gemaraFlip(+g.dataset.gemflip); return; }
    const c = e.target.closest("[data-dcol]"); if (c) selectDafCol(c.dataset.dcol);
  };
  v.querySelectorAll("[data-daynav]").forEach(b => b.onclick = () => dayNav(+b.dataset.daynav));
  if ($("#dafFsBtn")) $("#dafFsBtn").onclick = () => { const box = $("#dafText"); if (box) openReader(box.dataset.mas, +box.dataset.daf, box.dataset.mode); };
  wireRows(v);
  const q = $("#q"); if (q) { q.oninput = () => runSearch(q.value); q.focus(); runSearch(""); }
  v.querySelectorAll("[data-fav]").forEach(b => { if (!b.classList.contains("row")) b.onclick = e => { e.stopPropagation(); toggleFav(+b.dataset.fav); rerender(); }; });
  v.querySelectorAll("[data-learn]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    const [m, ds] = b.dataset.learn.split("|"), d = +ds, on = toggleLearned(m, d);
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.textContent = on ? "✓ Learned" : "Mark as learned";
    const meta = b.parentElement.querySelector(".learn-meta"); if (meta) { const mm = DY.BYEN[m]; meta.textContent = `${m}: ${learnedInMasechta(m)} / ${mm ? mm.dapim : "?"} dapim learned`; }
    toast(on ? `Marked ${esc(m)} ${d} as learned ✓` : `Unmarked ${esc(m)} ${d}`);
  });
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
  const url = local ? lec.localAudio : lec.audio;
  if (!url) { toast("This shiur isn't available to play yet."); return; }
  Player.load(lec, true, url, !!local); noteProgress(id);
}
// The TorahAnytime source carries a ~7.5s logo intro. Our self-hosted copies are
// already trimmed; for any not-yet-self-hosted shiur we fall back to TA and skip
// the intro client-side, so the intro is never shown either way.
const INTRO_SEC = 7.5;
function skipIntroOnce(media, seconds) {
  let done = false;
  const seek = () => {
    if (done || !isFinite(media.duration)) return;
    done = true;
    if (media.currentTime < seconds - 0.3) { try { media.currentTime = seconds; } catch {} }
  };
  media.addEventListener("loadedmetadata", seek, { once: true });
  media.addEventListener("canplay", seek, { once: true });
}
// Single-active-media: pause every <video> (optionally except one). The bottom
// audio player and an in-page video must never sound at the same time.
function pauseVideos(except) { $$("video").forEach(v => { if (v !== except) { try { v.pause(); } catch {} } }); }
function watchVideo(id) {
  const lec = State.all.find(l => l.id === id); if (!lec) return;
  const slot = $("#videoSlot"); if (!slot) return;
  const local = State.content.options?.preferSelfHosted !== false && lec.localVideo;
  const src = local ? lec.localVideo : lec.video; if (!src) return;
  slot.innerHTML = `<video class="daf-video" src="${esc(src)}" controls playsinline preload="metadata" autoplay></video>`;
  const v = slot.querySelector("video");
  v.addEventListener("play", () => { try { Player.audio?.pause(); } catch {} pauseVideos(v); });  // video wins → silence the audio player
  const resumeTo = resumePoint(id);
  if (resumeTo) v.addEventListener("loadedmetadata", () => { try { v.currentTime = resumeTo; } catch {} toast(`Resumed from ${clock(resumeTo)}`); }, { once: true });
  else if (!local) skipIntroOnce(v, lec.introTrimmed || INTRO_SEC);   // TA fallback still has the intro
  let lastSave = 0;
  v.addEventListener("timeupdate", () => { const cur = v.currentTime || 0, dur = v.duration || 0; if (dur && cur > 8 && cur < dur - 8 && Date.now() - lastSave > 4000) { lastSave = Date.now(); savePos(id, cur, dur); } });
  v.addEventListener("ended", () => { clearPos(id); markShiurLearned(lec); });
  v.play().catch(() => {});
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
    this.audio.ontimeupdate = () => this.tick();
    this.audio.onloadedmetadata = () => {
      if (this._resumeTo) { try { this.audio.currentTime = this._resumeTo; } catch {} toast(`Resumed from ${clock(this._resumeTo)}`); this._resumeTo = 0; this._skipPending = false; }
      else if (this._skipPending && !this.local) { try { this.audio.currentTime = this.lec?.introTrimmed || INTRO_SEC; } catch {} }
      this._skipPending = false; this.tick();
    };
    this.audio.onplay = () => { pauseVideos(); this.ctrls(); }; this.audio.onpause = () => this.ctrls();
    this.audio.onended = () => { if (this.lec) { clearPos(this.lec.id); markShiurLearned(this.lec); } this.ctrls(); };
    this.audio.onerror = () => { if (this.lec && this.local) { this.local = false; this._skipPending = true; this.audio.src = this.lec.audio; this.audio.play().catch(() => {}); this.bar(); } };
  },
  load(lec, autoplay, url, local) { this.lec = lec; this.local = !!local; this._skipPending = !local; this._resumeTo = resumePoint(lec.id); this._lastSave = 0; this.audio.src = url || lec.audio; this.audio.playbackRate = this.speed; $("#player").classList.remove("hidden"); $("#app")?.classList.add("player-active"); document.documentElement.classList.add("player-on"); this.bar(); if (autoplay) this.audio.play().catch(() => {}); },
  toggle() { this.audio.paused ? this.audio.play().catch(() => {}) : this.audio.pause(); },
  skip(s) { this.audio.currentTime = Math.max(0, Math.min(this.audio.duration || 1e9, this.audio.currentTime + s)); },
  setSpeed() { const o = [1, 1.25, 1.5, 1.75, 2, 0.75]; this.speed = o[(o.indexOf(this.speed) + 1) % o.length]; this.audio.playbackRate = this.speed; this.ctrls(); },
  hide() { if (this.lec) { const cur = this.audio.currentTime || 0, dur = this.audio.duration || 0; if (dur && cur > 8 && cur < dur - 8) savePos(this.lec.id, cur, dur); } $("#player").classList.add("hidden"); $("#app")?.classList.remove("player-active"); document.documentElement.classList.remove("player-on"); this.audio.pause(); },
  bar() {
    const k = this.lec._dk, label = k && k.daf ? `${k.masechta} ${k.daf}` : "";
    $("#player").innerHTML = `<button class="x" id="pX" aria-label="Close">✕</button>
      <div class="now"><b>${esc(label || this.lec.title)}</b></div>
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
  tick() { const cur = this.audio.currentTime || 0, dur = this.audio.duration || 0, c = $("#pCur"), d = $("#pDur"), s = $("#pSeek"); if (c) c.textContent = clock(cur); if (d) d.textContent = dur ? clock(dur) : "--:--"; if (s && dur) { s.value = (cur / dur) * 1000; s.style.backgroundSize = (cur / dur) * 100 + "% 100%"; s.setAttribute("aria-valuetext", clock(cur) + " of " + clock(dur)); } if (this.lec && dur && cur > 8 && cur < dur - 8 && !this.audio.paused) { const now = Date.now(); if (now - (this._lastSave || 0) > 4000) { this._lastSave = now; savePos(this.lec.id, cur, dur); } } },
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
  $("#e_reset").onclick = () => { try { localStorage.removeItem(CFG.contentLocalKey); } catch {} location.reload(); };
}
function gatherEditor() {
  const c = JSON.parse(JSON.stringify(State.content));
  c.masthead = c.masthead || {}; c.masthead.hebrew = $("#e_he").value; c.masthead.english = $("#e_en").value; c.masthead.subtitle = $("#e_sub").value;
  c.donate = c.donate || {}; c.donate.blurb = $("#e_blurb").value; c.donate.zelle = c.donate.zelle || {}; c.donate.zelle.name = $("#e_zname").value; c.donate.zelle.email = $("#e_zemail").value;
  return c;
}
function applyEditor() { State.content = gatherEditor(); setStore(CFG.contentLocalKey, State.content); renderShell(); route(State.route.name, State.route); closeMenu(); toast("Preview updated"); }

window.addEventListener("keydown", e => {
  if (Reader.open) {
    if (e.key === "Escape") { e.preventDefault(); closeReader(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); readerFlip(-1); }    // ‹ previous daf
    else if (e.key === "ArrowRight") { e.preventDefault(); readerFlip(1); }     // next daf ›
    return;
  }
  if (e.key === "Escape") closeMenu();
});
boot();
