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
const safeEn = s => esc((s ?? "").toString().replace(/<\/?span[^>]*>/gi, "").replace(/<(b|strong)>([^<]*)<\1>/gi, "<$1>$2</$1>")).replace(/&lt;(\/?(?:b|strong|i|em|br|sup|sub))&gt;/gi, "<$1>");
// Hebrew daf text carries Sefaria/Vilna markup too — <big><strong> on Mishnah-opening words + <br>; same escape-then-allowlist
const safeHe = s => esc(s).replace(/&lt;(\/?(?:big|strong|b|i|em|br))&gt;/gi, "<$1>");
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
const setStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
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
  const H = c.heb ? `<span dir="rtl" class="hdate" lang="he">${esc(c.heb)}</span>` : "";
  return G && H ? `${G} <span class="datesep">·</span> ${H}` : (G || H);
}
const gregOf = dstr => esc(calStrings(dstr).greg);   // compact, Gregorian-only (for dense list rows); esc() guards an unparseable API date echoed back raw

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
    try { const s = await fetch(CFG.snapshot).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); seed = { speaker: s.speaker, lectures: s.lectures }; }
    catch { seed = { speaker: { name: "Rabbi Shea Stern" }, lectures: [] }; }
  }
  State.speaker = seed.speaker; State.all = seed.lectures || [];
  [State.content, State.media, State.dafIndex] = await Promise.all([loadContent(), loadJson(CFG.mediaManifest), loadJson(CFG.dafIndex)]);
  buildIndex(); renderShell(); restoreInitialRoute();
  setStatus("checking"); refreshLive(seed.lectures || [], !!cached);
}
async function loadContent() { let l = null; try { l = localStorage.getItem(CFG.contentLocalKey); } catch {} if (l) { try { const p = JSON.parse(l); if (p && typeof p === "object" && !Array.isArray(p)) return p; } catch { try { localStorage.removeItem(CFG.contentLocalKey); } catch {} } } return loadJson(CFG.contentUrl); }
async function loadJson(u) { try { return await fetch(u).then(r => r.ok ? r.json() : {}); } catch { return {}; } }

// Resolve a manifest media path. Paths are stored RELATIVE ("media/<id>.mp3")
// so the store is portable: leave options.mediaBaseUrl empty to serve from this
// site (local), or set it to a server/CDN base to go live — a one-line switch,
// no reprocessing. (An already-absolute URL in the manifest is used as-is.)
function mediaUrl(p) {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  const base = String(State.content?.options?.mediaBaseUrl || "").replace(/\/+$/, "");   // coerce — a non-string mediaBaseUrl must not crash buildIndex at boot
  return base ? base + "/" + p.replace(/^\/+/, "") : p;
}

function buildIndex() {
  const m = new Map();
  for (const lec of State.all) {
    if (!lec || typeof lec !== "object") continue;   // tolerate a corrupt cache entry without breaking the whole index
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
    const fresh = (data.lecture || []).filter(x => x && typeof x === "object").map(leanFromApi).sort((a, b) => (b.posted || "").localeCompare(a.posted || "") || (+b.id || 0) - (+a.id || 0));
    if (!fresh.length && prev.length) throw new Error("empty");
    if (spk) State.speaker = { ...State.speaker, name: `${spk.title || ""} ${spk.name_first || ""} ${spk.name_last || ""}`.trim() || State.speaker.name };
    const prevIds = new Set(prev.map(l => l.id));
    const added = fresh.filter(l => !prevIds.has(l.id));
    State.all = fresh; buildIndex(); writeCache(); markNew();
    if (!Reader.open && State.route.name !== "daf") rerender();   // don't yank the view out from under an active read (daf text is catalog-independent)
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
      <span class="wordmark" id="home" role="link" tabindex="0" title="Today's daf" lang="he">${esc(mh.hebrew || "הדף היומי")}</span>
      <span class="spacer"></span>
      <button class="ic-btn" id="searchBtn" aria-label="Search">⌕</button>
    </header>
    <main id="view"></main>
    <footer>
      <span class="fhe" lang="he">${esc(mh.hebrew || "שיעורי הדף היומי")}</span>
      ${esc(mh.english || State.speaker?.name || "Rabbi Shea Stern")} · ${esc(mh.subtitle || "Daf Yomi")}<br>
      Talmud — William Davidson Edition, Sefaria · the library updates automatically
    </footer>
    <div class="player hidden" id="player"></div>
  </div>
  <div class="mask" id="mask"></div>
  <aside class="menu" id="menu" role="dialog" aria-modal="true" aria-label="Site menu"></aside>
  <div class="toast-wrap" id="toasts" aria-live="polite" aria-atomic="false"></div>
  <div class="reader" id="reader" role="dialog" aria-modal="true" aria-labelledby="rdTitle" hidden aria-hidden="true"></div>`;

  $("#burger").onclick = openMenu; $("#mask").onclick = closeMenu;
  $("#searchBtn").onclick = () => route("search");
  $("#backBtn").onclick = goBack;
  applyViewportClasses();
  const homeEl = $("#home"); homeEl.onclick = () => route("today"); homeEl.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); route("today"); } };
  Player.mount(); buildMenu(); setStatus(State._sk || "checking"); updateBackBtn(); setBarH();
}
// The sticky column bar pins just below the top bar — measure the bar so the offset
// stays exact across font sizes and the iPhone safe-area.
function setBarH() { const b = $(".bar"); if (b) document.documentElement.style.setProperty("--bar-h", b.offsetHeight + "px"); }
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
      <button class="mi phoneview-mi" id="phoneViewBtn">${_forcePhone ? "🖥️ Exit phone view" : "📱 Phone view"}</button>
      <button class="mi" id="editorBtn" style="color:var(--ink-faint);font-size:13px">Editor mode</button>
    </nav>`;
  $$("#menu .mi[data-route]").forEach(b => b.onclick = () => { closeMenu(); route(b.dataset.route); });
  $("#phoneViewBtn").onclick = togglePhoneView;
  $("#editorBtn").onclick = openEditor;
}
// Phone view: switches the ACTUAL desktop UI to the real phone layout (one column at
// a time, sticky column switcher, compact chrome) by forcing the is-phone/is-narrow
// classes that the phone CSS keys on — no device mock-up, the whole UI changes.
function applyViewportClasses() {
  const html = document.documentElement;
  const m680 = window.matchMedia("(max-width: 680px)").matches;
  const m560 = window.matchMedia("(max-width: 560px)").matches;
  html.classList.toggle("is-phone", m680 || _forcePhone);
  html.classList.toggle("is-narrow", m560 || _forcePhone);
  html.classList.toggle("force-phone", _forcePhone);
}
function togglePhoneView() {
  _forcePhone = !_forcePhone;
  try { localStorage.setItem("dy_force_phone", _forcePhone ? "1" : "0"); } catch {}
  applyViewportClasses(); setBarH();
  const b = $("#phoneViewBtn"); if (b) b.textContent = _forcePhone ? "🖥️ Exit phone view" : "📱 Phone view";
  closeMenu(); window.scrollTo(0, 0);
}
function openMenu() { $("#menu").classList.add("open"); $("#mask").classList.add("open"); $("#burger")?.setAttribute("aria-expanded", "true"); $("#app")?.setAttribute("inert", ""); setTimeout(() => $("#menu .mi")?.focus(), 0); }
function closeMenu() { const wasOpen = $("#menu")?.classList.contains("open"); $("#menu").classList.remove("open"); $("#mask").classList.remove("open"); $("#burger")?.setAttribute("aria-expanded", "false"); $("#app")?.removeAttribute("inert"); if (wasOpen) $("#burger")?.focus(); }

/* =====================================================================
   ROUTER
   ===================================================================== */
let _navDepth = 0;   // how deep into the app we are (0 = home/entry); drives the back button
const _embedded = (() => { try { return window.top !== window.self; } catch { return true; } })();   // true when embedded in another frame
let _forcePhone = false; try { _forcePhone = localStorage.getItem("dy_force_phone") === "1"; } catch {}   // desktop "phone view" toggle
function route(name, params = {}, opts = {}) {
  const next = { name, ...params };
  const same = JSON.stringify(next) === JSON.stringify(State.route);
  State.route = next;
  if (name === "sponsor" && params.pre) State.sponsor = { ...params.pre };
  const replace = opts.replace || same;        // identical route → replace, don't stack a dead history entry
  _navDepth = replace ? _navDepth : _navDepth + 1;
  const st = { route: State.route, sponsor: State.sponsor, depth: _navDepth };
  try { replace ? history.replaceState(st, "") : history.pushState(st, ""); } catch {}
  persistRoute();
  rerender(); window.scrollTo(0, 0); updateBackBtn();
}
function goBack() { if (_navDepth > 0) history.back(); else route("today", {}, { replace: true }); }
function updateBackBtn() { const b = $("#backBtn"); if (b) b.hidden = _navDepth <= 0; }
// Remember the current page so a refresh returns to it (not Today). history.state
// already survives reloads; sessionStorage is the fallback. Skipped inside the
// phone-view iframe so it can't clobber the parent tab's saved page.
function persistRoute() { if (_embedded) return; try { sessionStorage.setItem("dy_route", JSON.stringify({ route: State.route, sponsor: State.sponsor, depth: _navDepth })); } catch {} }
const KNOWN_ROUTES = new Set(["today", "browse", "seder", "masechta", "daf", "topics", "category", "search", "mystuff", "sponsor", "about", "donate"]);
// Validate a route restored from history.state / sessionStorage before trusting it — a forged or
// corrupt deep-link (bad route name, unknown masechta, out-of-range daf) falls back to Today instead.
function validRoute(r) {
  if (!r || !KNOWN_ROUTES.has(r.name)) return false;
  if (r.name === "daf") { const [m, d] = (r.id || "").split("|"); const mm = DY.BYEN[m], dn = +d; return !!(mm && dn >= mm.firstDaf && dn <= mm.lastDaf); }
  if (r.name === "masechta") return !!DY.BYEN[r.masechta];
  if (r.name === "seder") return DY.SEDARIM.some(s => s.en === r.seder);
  return true;
}
function restoreInitialRoute() {
  let st = history.state;
  if (!_embedded && !(st && st.route && st.route.name)) { try { st = JSON.parse(sessionStorage.getItem("dy_route") || "null"); } catch { st = null; } }
  if (st && st.route && validRoute(st.route)) {
    State.route = st.route;
    if (st.sponsor) State.sponsor = st.sponsor;
    _navDepth = typeof st.depth === "number" ? st.depth : 0;
    try { history.replaceState({ route: State.route, sponsor: State.sponsor, depth: _navDepth }, ""); } catch {}
    rerender(); window.scrollTo(0, 0); updateBackBtn();
  } else { route("today", {}, { replace: true }); }
}
window.addEventListener("popstate", e => {
  if (Reader.open) { hideReader(); return; }   // Back closes the full-screen reader; #view is left untouched
  const st = e.state;
  if (st && st.route) { State.route = st.route; if (st.sponsor) State.sponsor = st.sponsor; _navDepth = st.depth || 0; }
  else { State.route = { name: "today" }; _navDepth = 0; }   // walked back past our entry → home
  persistRoute();
  closeMenu(); rerender(); window.scrollTo(0, 0); updateBackBtn();
});
function rerender() {
  const v = $("#view"); if (!v) return;
  if (Player.isVideo) Player.hide();                         // an in-page video can't survive a view swap — save its spot and drop the bar
  $$("#view video").forEach(vid => { try { vid.pause(); vid.removeAttribute("src"); vid.load(); } catch {} });   // flush any in-page video before the view is replaced (no detached audio)
  resetReadMin();                                            // a fresh view starts with full top chrome
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
    rows += `<button class="cont-row" data-play="${lip.lec.id}"><span class="cont-ic" aria-hidden="true">▶</span><span class="cont-main"><b>Resume ${esc(title)}</b><span class="cont-sub">picks up at ${clock(lip.pos.t)}</span></span></button>`;
  }
  const nx = nextUnlearnedDaf();
  if (nx) {
    const m = DY.BYEN[nx.masechta];
    rows += `<button class="cont-row" data-daf="${esc(nx.masechta)}|${nx.daf}"><span class="cont-ic ghost" aria-hidden="true">↪</span><span class="cont-main"><b>Up next · ${esc(nx.masechta)} Daf ${nx.daf}</b><span class="cont-sub">${esc(m ? m.he : nx.masechta)} ${esc(heDaf(nx.daf))}</span></span></button>`;
  }
  return `<div class="section" role="heading" aria-level="2">Continue learning</div>
    <div class="continue">${rows}
      ${lt ? `<div class="cont-prog">${progressBar(lt, shasTotal(), { label: "Your Shas progress" })}</div>` : ""}
    </div>`;
}
function upNextLink() {
  const nx = nextUnlearnedDaf();
  if (!nx) return `<p class="center muted" style="font-size:13.5px;margin-top:10px">You've learned all of Shas — mazel tov! 🎉</p>`;
  return `<p class="center" style="margin-top:10px"><button class="textlink" data-daf="${esc(nx.masechta)}|${nx.daf}">Up next · ${esc(nx.masechta)} Daf ${nx.daf} →</button></p>`;
}

function viewToday() {
  const mh = State.content.masthead || {};
  const now = new Date();
  const yDate = new Date(now), tmDate = new Date(now); yDate.setDate(yDate.getDate() - 1); tmDate.setDate(tmDate.getDate() + 1);   // true calendar-day steps (DST-safe), not ±24h
  const t = dafData(now), y = dafData(yDate), tm = dafData(tmDate);
  const ref = `${esc(t.dy.masechta)}|${t.dy.daf}`;
  const hasVid = t.shiur && (t.shiur.localVideo || t.shiur.video);
  const actions = t.shiur
    ? `<button class="btn solid" data-play="${t.shiur.id}">▶ Listen</button>${hasVid ? `<button class="btn" data-watchdaf="${ref}">▦ Watch</button>` : ""}<button class="btn" data-daf="${ref}">Read the daf</button>`
    : `<button class="btn accent" data-sponsor-daf="${ref}">✦ Sponsor today's daf</button><button class="btn" data-daf="${ref}">Read the daf</button>`;
  return `
    <div class="titlepage">
      <div class="he" lang="he">${esc(mh.hebrew || "שיעורי הדף היומי")}</div>
      <div class="by">given by <b>${esc(mh.english || State.speaker?.name || "")}</b></div>
      <div class="sub">${esc(mh.subtitle || "")}</div>
      <div class="flourish"><span>❖</span></div>
    </div>
    <div class="today">
      <div class="eyebrow">Today's Daf</div>
      <div class="he" lang="he">${esc(t.dy.he)} ${esc(heDaf(t.dy.daf))}</div>
      <div class="en">${esc(t.dy.masechta)} · Daf ${t.dy.daf}</div>
      <div class="date">${dateLine(todayStr())}</div>
      <div class="actions">${actions}</div>
      <div class="adjacent">
        <button data-daf="${esc(tm.dy.masechta)}|${tm.dy.daf}" title="Tomorrow" aria-label="Tomorrow — ${esc(tm.dy.he)} ${esc(heDaf(tm.dy.daf))}"><span aria-hidden="true">‹ </span><span class="nm">${esc(tm.dy.he)} ${esc(heDaf(tm.dy.daf))}</span></button>
        <button data-daf="${esc(y.dy.masechta)}|${y.dy.daf}" title="Yesterday" aria-label="Yesterday — ${esc(y.dy.he)} ${esc(heDaf(y.dy.daf))}"><span class="nm">${esc(y.dy.he)} ${esc(heDaf(y.dy.daf))}</span><span aria-hidden="true"> ›</span></button>
      </div>
    </div>
    ${continueCard()}
    ${recentSection()}
    ${moreSection()}`;
}
function recentSection() {
  const recent = State.all.filter(l => l._dk && l._dk.daf).slice(0, 7);
  if (!recent.length) return "";
  return `<div class="section" role="heading" aria-level="2">Recently given</div><div class="rows">${recent.map(rowHtml).join("")}</div>
    <p class="center" style="margin-top:16px"><button class="textlink" data-route="browse">Browse all of Shas →</button></p>`;
}

function viewBrowse() {
  return `<div class="pagetitle" role="heading" aria-level="1">Browse Shas</div><p class="lead">Every daf of the Talmud — tap any daf to read it; the Rabbi's shiur appears where he's given it.</p>
    ${learnedTotal() ? `<div class="browse-prog">${progressBar(learnedTotal(), shasTotal(), { label: "Your Shas progress" })}</div>` : ""}
    <div class="toc">${DY.SEDARIM.map(s => {
      const mas = DY.masechtosInSeder(s.en);
      const total = mas.reduce((n, m) => n + countMasechta(m.en), 0);
      return `<div class="seder">${esc(s.he)}<span class="ct">${total} shiurim</span></div>
        <div class="mas-list">${mas.map(m => { const n = countMasechta(m.en); return `<button class="mas ${n ? "" : "empty"}" data-masechta="${esc(m.en)}"><span class="nm" lang="he">${esc(m.he)}</span><span class="ct">${n || "—"}</span></button>`; }).join("")}</div>`;
    }).join("")}</div>`;
}
function countMasechta(en) { let n = 0; for (const [k, a] of State.byDaf) if (k.startsWith(en + "#")) n += a.length; return n; }

function viewSeder(r) {
  const mas = DY.masechtosInSeder(r.seder);
  return crumbs([["Browse", "browse"]], DY.sederHe(r.seder)) +
    `<div class="mas-list" style="margin-top:14px">${mas.map(m => { const n = countMasechta(m.en); return `<button class="mas ${n ? "" : "empty"}" data-masechta="${esc(m.en)}"><span class="nm" lang="he">${esc(m.he)}</span><span class="ct">${n || "—"}</span></button>`; }).join("")}</div>`;
}

function viewMasechta(r) {
  const m = DY.BYEN[r.masechta];
  if (!m) return crumbs([["Browse", "browse"]], "—") + `<div class="empty-mini">That masechta isn't available.</div>`;
  let cells = "";
  for (let d = m.firstDaf; d <= m.lastDaf; d++) {
    const has = State.byDaf.has(dafKey(m.en, d)), lrn = isLearned(m.en, d);
    cells += `<button class="daf-cell ${has ? "has" : "future"}${lrn ? " learned" : ""}" data-daf="${esc(m.en)}|${d}" aria-label="${esc(m.en)} Daf ${d}${has ? " — shiur available" : ""}${lrn ? ", learned" : ""}"><span class="he" aria-hidden="true">${esc(window.HebCal ? window.HebCal.gematria(d) : d)}</span><span class="n" aria-hidden="true">${d}</span>${lrn ? '<span class="cell-chk" aria-hidden="true">✓</span>' : ""}</button>`;
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
      <button class="btn solid sm" data-play="${shiur.id}">▶ Listen</button>
      ${(shiur.localVideo || shiur.video) ? `<button class="btn sm" data-watch="${shiur.id}">▦ Watch</button>` : ""}
      <button class="btn sm" data-fav="${shiur.id}" aria-pressed="${isFav(shiur.id)}">${isFav(shiur.id) ? "★ Saved" : "☆ Save"}</button>
    </div>
    <div id="videoSlot"></div>` : "";
  const sponsor = shiur
    ? `<p class="center" style="margin:10px 0"><button class="textlink" data-sponsor-daf="${esc(masechta)}|${daf}">✦ Sponsor this daf</button></p>`
    : `<div class="sponsor-strip"><b>This daf hasn't been given yet.</b><div class="muted" style="font-size:14px;margin-top:4px">Sponsor it for a yahrtzeit or simcha — your dedication is learned by everyone.</div><button class="btn accent" data-sponsor-daf="${esc(masechta)}|${daf}">✦ Sponsor ${esc(masechta)} ${daf}</button></div>`;
  return crumbs([["Browse", "browse"], [m ? m.he : masechta, "masechta", { masechta }]], heDaf(daf)) +
    `<div class="daf-head">
       <div class="daf-daynav">
         <button class="daynav next" data-daynav="1" aria-label="Next daf — whole page" title="Next daf (whole page)"${dafStep(masechta, daf, 1) ? "" : " disabled"}>‹</button>
         <div class="daf-head-titles"><div class="he" lang="he">${esc(heT)}</div><div class="en">${esc(masechta)} · Daf ${daf}</div></div>
         <button class="daynav prev" data-daynav="-1" aria-label="Previous daf — whole page" title="Previous daf (whole page)"${dafStep(masechta, daf, -1) ? "" : " disabled"}>›</button>
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
    const special = { Shekalim: "Shekalim is learned from the Talmud Yerushalmi, which isn't in the native reader yet.", Kinnim: "Kinnim is a Mishnah-only masechta — it has no Gemara text.", Middos: "Middos is a Mishnah-only masechta — it has no Gemara text." }[masechta];
    const reason = special || ((typeof navigator !== "undefined" && navigator.onLine === false) ? "You're offline — reconnect to load this daf's text." : "Native text for this masechta isn't available yet.");   // don't blame the masechta when it's really a connection drop
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
  const gen = (box._hydGen = (box._hydGen || 0) + 1);          // serialize overlapping hydrates
  const html = await dafBodyHtml(box.dataset.mas, +box.dataset.daf, box.dataset.mode);
  if (!box.isConnected || box._hydGen !== gen) return;          // a newer flip superseded this one — drop the stale render
  box.innerHTML = html;
  applyDafCol(box); attachDafSwipe(box);
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
    + `<button class="pageflip next" data-gemflip="1" aria-label="Next daf" title="Next daf"${dis(1)}>‹</button>`
    + `<span class="lbl-t">${innerHtml}</span>`
    + `<button class="pageflip prev" data-gemflip="-1" aria-label="Previous daf" title="Previous daf"${dis(-1)}>›</button>`
    + `</div>`;
}
function dafPage(daf, amud, seg, c, labelHtml) {
  const gem = (seg.he || "").split("\n").filter(Boolean).map(safeHe).join("<br>");
  return `<div class="dafpage">
    ${labelHtml}
    <div class="dafpage-grid">
      <div class="col side rashi"><div class="col-h" lang="he">רש"י</div>${commCol(c && c.r)}</div>
      <div class="col gemara"><div class="col-h" lang="he">גמרא</div><div class="gem">${gem || '<div class="col-empty">—</div>'}</div></div>
      <div class="col side tosafos"><div class="col-h" lang="he">תוספות</div>${commCol(c && c.t)}</div>
    </div></div>`;
}
function renderDafLayout(masechta, daf, data, comm) {
  comm = comm || {};
  let html = "";
  if (masechta === "Tamid" && daf === 26 && data["25b"])   // opening Mishnah sits on Vilna 25b — surface it in daf mode too (the he/en path already does)
    html += dafPage(daf, "25b", data["25b"], comm["25b"], flipLabel("dafpage-label", esc(heAmud(25, "25b")), masechta, daf));
  for (const amud of [daf + "a", daf + "b"]) {
    const seg = data[amud]; if (!seg) continue;
    html += dafPage(daf, amud, seg, comm[amud], flipLabel("dafpage-label", esc(heAmud(daf, amud)), masechta, daf));   // per-page daf-flip arrows on each amud (restored)
  }
  if (!html) return `<div class="empty-mini">This amud isn't available.</div>`;
  return dafColHead(masechta, daf) + html + `<div class="daf-src">Talmud, Rashi &amp; Tosafos — Vilna Edition (public domain) · English Steinsaltz, CC-BY-NC · via Sefaria</div>`;
}
/* Phone-mode column selector for the Tzuras-Hadaf view: instead of scrolling
   through stacked גמרא / רש"י / תוספות, show ONE full-width column at a time.
   Order matches the printed daf: תוספות (left) · גמרא (center) · רש"י (right). */
// Tzuras-Hadaf columns in spatial (left→right) order: Tosafos (outer-left),
// Gemara (center), Rashi (inner-right). One shows at a time on phones.
const DAF_COLS = [["tosafos", "תוספות"], ["gemara", "גמרא"], ["rashi", 'רש"י']];
const dafColIndex = k => DAF_COLS.findIndex(c => c[0] === k);
// Unified column title bar: the current column's name in the center (the title of
// what you're reading) flanked by the two columns you can switch to — all in the
// same serif as the page titles. It sticks to the top while you scroll; you can
// also swipe the daf left/right. Hidden on desktop, where all three show at once.
// The column-switcher row: all three names in their fixed printed-page order
// (תוספות · גמרא · רש"י) — they never move; only the highlight does. Selecting a
// column just lights it up, so the names stay put exactly where you tapped.
function dafColsInner() {
  const cur = State._dafCol || "gemara";
  return DAF_COLS.map(([key, name]) => {
    const on = key === cur;
    return `<button data-dcol="${key}" role="tab" aria-selected="${on}" class="col-tab${on ? " on" : ""}">${name}</button>`;
  }).join("");
}
function dafColHead(masechta, daf) {
  const dis = d => dafStep(masechta, daf, d) ? "" : " disabled";
  const dafLbl = `${DY.BYEN[masechta] ? DY.BYEN[masechta].he : masechta} ${window.HebCal ? window.HebCal.gematria(daf) : daf}`;
  return `<div class="daf-colhead">
    <div class="daf-flip-row">
      <button class="pageflip next" data-gemflip="1" aria-label="Next daf" title="Next daf"${dis(1)}>‹</button>
      <span class="daf-flip-lbl">${esc(dafLbl)}</span>
      <button class="pageflip prev" data-gemflip="-1" aria-label="Previous daf" title="Previous daf"${dis(-1)}>›</button>
    </div>
    <div class="daf-cols-row" role="tablist" aria-label="Daf column — tap a name or swipe">${dafColsInner()}</div>
  </div>`;
}
function applyDafCol(box) {        // reflect the chosen column as a class on the daf container
  const col = State._dafCol || "gemara";
  ["gemara", "rashi", "tosafos"].forEach(c => box.classList.toggle("col-" + c, c === col));
}
function selectDafCol(col) {
  if (col === State._dafCol) return;
  saveColScroll(State._dafCol);                       // remember where we were in the column we're leaving
  State._dafCol = col;
  const apply = box => {
    if (!box) return;
    applyDafCol(box);
    const row = box.querySelector(".daf-cols-row");   // names stay fixed — just move the highlight to the selected one
    if (row) row.querySelectorAll(".col-tab").forEach(t => {
      const on = t.dataset.dcol === State._dafCol;
      t.classList.toggle("on", on); t.setAttribute("aria-selected", on ? "true" : "false");
    });
    restartAnim(box, "col-switched");                 // gentle fade-in of the new column's text
  };
  apply($("#dafText"));
  if (Reader.open) apply($("#rdBody"));
  restoreColScroll(col);                              // restore a remembered spot, or stay put on a column's first view
}
function restartAnim(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
// Per-column scroll memory so switching back and forth keeps your place in each
// column. Keyed by view + daf + column, so a different daf starts fresh.
function dafScrollEl() { return Reader.open ? $("#rdBody") : null; }   // null → the window scrolls
function curDafScroll() { const el = dafScrollEl(); return el ? el.scrollTop : (window.scrollY || 0); }
function setDafScroll(y) { const el = dafScrollEl(); if (el) el.scrollTop = y; else window.scrollTo(0, y); }
function colScrollKey(col) {
  if (Reader.open) return `r:${Reader.masechta}:${Reader.daf}:${col}`;
  const b = $("#dafText"); return `p:${b ? b.dataset.mas : ""}:${b ? b.dataset.daf : ""}:${col}`;
}
function saveColScroll(col) { if (!col) return; State._colScroll = State._colScroll || {}; State._colScroll[colScrollKey(col)] = curDafScroll(); }
// "The top of this daf" for the active scroller: the reader body scrolls to 0;
// the in-page view scrolls so the daf reading region sits just under the bar.
function dafTopScroll() {
  if (Reader.open) return 0;
  const box = $("#dafText"); if (!box) return 0;
  // collapsed chrome → the bar is hidden and the colhead pins at the very top, so the
  // "ceiling" sits a bar-height higher; measure accordingly
  const min = document.documentElement.classList.contains("dy-min");
  const barH = min ? 0 : (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 0);
  return Math.max(0, (window.scrollY || 0) + box.getBoundingClientRect().top - barH - 4);
}
// Restore a remembered spot for this daf+column. On a plain column switch we stay
// put when the column hasn't been seen; on a page flip (toTopIfUnseen) an unseen
// daf starts at its top instead of inheriting the previous page's scroll.
function restoreColScroll(col, toTopIfUnseen) {
  const saved = (State._colScroll || {})[colScrollKey(col)];
  const wasReaderOpen = Reader.open;
  requestAnimationFrame(() => {
    if (Reader.open !== wasReaderOpen) return;                 // reader opened/closed within the frame — this scroll target is no longer the right surface
    const ceil = dafTopScroll();                               // the sticky-header "ceiling" (column top, header pinned)
    let target = null;
    if (saved != null) target = Math.max(saved, ceil);        // restore a remembered spot — but never above the ceiling
    else if (toTopIfUnseen) target = ceil;                    // page-flip into an unseen daf → its top
    else if (curDafScroll() < ceil) target = ceil;            // column switch, first view → snap down, never above the ceiling
    if (target != null) { setDafScroll(target); lockReadMin(target); }   // this programmatic scroll must NOT flip the header open/closed
  });
}

/* ---------- phone: collapse the top chrome while reading the daf ----------
   Scrolling DOWN hides the app bar + the daf-flip row (leaving just the thin
   column switcher); scrolling UP — or returning to the top — brings them back.
   Only on phones, and only on the daf view / reader. */
let _lastReadY = 0, _minLockUntil = 0;
function resetReadMin() { document.documentElement.classList.remove("dy-min"); _lastReadY = 0; _minLockUntil = 0; }
// Pin the collapse state across a programmatic scroll (page flip / column switch) so
// pagination never slides the app bar open or closed — that toggle is the user's
// own scrolling only.
function lockReadMin(y) { _minLockUntil = Date.now() + 450; if (typeof y === "number") _lastReadY = y; }
function onReadScroll() {
  const html = document.documentElement;
  const onDaf = Reader.open || (State.route && State.route.name === "daf");
  if (!onDaf || !html.classList.contains("is-phone")) { html.classList.remove("dy-min"); _lastReadY = 0; return; }
  const y = Reader.open ? ($("#rdBody") ? $("#rdBody").scrollTop : 0) : (window.scrollY || 0);
  const now = Date.now(), min = html.classList.contains("dy-min");
  if (now < _minLockUntil) { _lastReadY = y; return; }       // brief settle window after a toggle — avoids reflow-induced flapping
  let changed = false;
  if (y <= 60) { if (min) { html.classList.remove("dy-min"); changed = true; } }                  // near the top → full chrome
  else if (y > _lastReadY + 6) { if (!min) { html.classList.add("dy-min"); changed = true; } }     // moving down → minimize
  else if (y < _lastReadY - 6) { if (min) { html.classList.remove("dy-min"); changed = true; } }   // moving up → restore
  if (changed) _minLockUntil = now + 350;
  _lastReadY = y;
}
// Switch columns by swiping the daf: swipe content left → reveal the column to the
// right, and vice-versa. Clamped to the three columns; only the single-column
// phone layout is affected (desktop shows all three side-by-side).
function swipeDafCol(dir) {
  const ci = dafColIndex(State._dafCol || "gemara");
  const ni = Math.max(0, Math.min(DAF_COLS.length - 1, ci + dir));
  if (ni !== ci) selectDafCol(DAF_COLS[ni][0]);
}
function attachDafSwipe(box) {
  if (!box || box._dafSwipe) return; box._dafSwipe = true;
  let x0 = 0, y0 = 0, t0 = 0;
  box.addEventListener("touchstart", e => { const t = e.changedTouches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
  box.addEventListener("touchend", e => {
    if (!document.documentElement.classList.contains("is-phone")) return;     // one column shows only in the phone layout
    if (!box.querySelector(".dafpage-grid")) return;                  // only in the Tzuras-Hadaf "Daf" layout
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4 || Date.now() - t0 > 700) return;   // deliberate horizontal flick
    swipeDafCol(dx < 0 ? 1 : -1);
  }, { passive: true });
  if (box.id === "rdBody") box.addEventListener("scroll", onReadScroll, { passive: true });   // the reader body scrolls itself
}

function renderAmud(seg, mode) {
  const he = (seg.he || "").split("\n").filter(Boolean), en = (seg.en || "").split("\n").filter(Boolean);
  if (mode === "he") return `<div class="daf-he" lang="he">${he.map(safeHe).join("<br>")}</div>`;
  if (mode === "en") return `<div class="daf-en">${en.map(safeEn).join("<br>")}</div>`;
  // both: interleave by segment if counts align, else stacked blocks
  if (he.length === en.length && he.length) return he.map((h, i) => `<div class="seg-pair"><div class="daf-he" lang="he">${safeHe(h)}</div><div class="daf-en">${safeEn(en[i])}</div></div>`).join("");
  return `<div class="daf-he" lang="he">${he.map(safeHe).join("<br>")}</div><hr class="rule thin"><div class="daf-en">${en.map(safeEn).join("<br>")}</div>`;
}

/* ---------- two flip controls on the daf page ----------
   1. Corner arrows (inside the daf) flip ONLY the daf/gemara reading region in
      place — the top of the page (the shiur you're hearing) stays put.
   2. Top arrows (in the head) turn the WHOLE page to the previous / next daf —
      a different day's full lecture page. */
async function gemaraFlip(dir) {                 // label arrows — daf text only, in place
  const box = $("#dafText"); if (!box) return;
  const nx = dafStep(box.dataset.mas, +box.dataset.daf, dir); if (!nx) return;
  saveColScroll(State._dafCol);                  // remember our place on the daf we're leaving
  box.dataset.mas = nx.masechta; box.dataset.daf = nx.daf;
  await hydrateDaf();                            // re-renders the daf incl. the flanking arrows (fresh boundary state)
  restoreColScroll(State._dafCol, true);         // the new daf+column: restore its own place, or start at the top if unseen
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
  if (Reader.open) return;   // already open — don't stack a second history entry or clobber the opener
  Reader.masechta = masechta; Reader.daf = +daf; Reader.mode = mode || State._dafMode || "daf"; Reader.open = true;
  const r = $("#reader"); if (!r) return;
  _readerOpener = document.activeElement;
  r.hidden = false; r.setAttribute("aria-hidden", "false");
  document.documentElement.classList.add("reader-open");
  renderReader();
  $("#view")?.setAttribute("inert", ""); $("#app > header")?.setAttribute("inert", "");   // background + top bar inert (trap focus in the overlay); the player (z-index above the reader) stays controllable
  resetReadMin();                                       // reader opens at the top with full chrome
  setTimeout(() => $("#rdClose")?.focus(), 0);           // move focus into the overlay
  try { history.pushState({ ...history.state, reader: true }, ""); } catch {}  // Back / Esc closes the reader first
}
function closeReader() { if (Reader.open && !_readerClosing) { _readerClosing = true; try { history.back(); } catch { hideReader(); } } }  // routed through popstate so #view is left intact
function hideReader() {
  Reader.open = false; _readerClosing = false;
  const r = $("#reader"); if (r) { r.hidden = true; r.setAttribute("aria-hidden", "true"); }
  document.documentElement.classList.remove("reader-open");
  $("#view")?.removeAttribute("inert"); $("#app > header")?.removeAttribute("inert");
  resetReadMin();
  try { _readerOpener && _readerOpener.focus(); } catch {}   // restore focus to whatever opened the reader
  syncInpageRead(Reader.masechta, Reader.daf);   // leave the in-page reader where we stopped
}
function syncInpageRead(masechta, daf) {
  const box = $("#dafText"); if (!box) return;
  if (box.dataset.mas === masechta && +box.dataset.daf === daf) return;
  box.dataset.mas = masechta; box.dataset.daf = daf;
  hydrateDaf();   // re-renders #dafText incl. the flip arrows; no separate UI step needed
}
function readerFlip(dir) {
  const nx = dafStep(Reader.masechta, Reader.daf, dir); if (!nx) return;
  saveColScroll(State._dafCol);                  // remember our place on the daf we're leaving (keyed by reader daf+column)
  Reader.masechta = nx.masechta; Reader.daf = nx.daf; Reader._restoreScroll = true; renderReader();
}
function renderReader() {
  const r = $("#reader"); if (!r) return;
  const m = Reader.masechta, d = Reader.daf, mode = Reader.mode;
  const shiur = shiurFor(m, d);
  r.innerHTML = `
    <div class="reader-bar">
      <div class="rd-side rd-left"><button class="rd-ic close" id="rdClose" aria-label="Close full screen">✕</button></div>
      <div class="rd-title" id="rdTitle"><span class="he" lang="he">${esc(dafTitleHe(m, d))}</span><span class="en">${esc(m)} · Daf ${d}</span></div>
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
    body.innerHTML = html; applyDafCol(body); attachDafSwipe(body);
    if (Reader._restoreScroll) { Reader._restoreScroll = false; restoreColScroll(State._dafCol, true); }  // flip → restore this daf+column's place, or its top
    else body.scrollTop = 0;                                         // initial open / mode change → top
    body.onclick = e => {                                            // delegated so the re-rendered column tabs stay live
      const g = e.target.closest("[data-gemflip]"); if (g) { readerFlip(+g.dataset.gemflip); return; }   // ‹ נד·א › flips the reader
      const c = e.target.closest("[data-dcol]"); if (c) selectDafCol(c.dataset.dcol);                     // phone-mode column switch
    };
  }
}

function viewSearch() { return `<div class="pagetitle" role="heading" aria-level="1">Search</div><div class="searchbar"><input id="q" type="search" aria-label="Search" placeholder="search a daf, masechta, or topic…" autocomplete="off"></div><div id="results"></div>`; }
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
  const fav = State.all.filter(l => f[l.id]).sort((a, b) => (+f[b.id] || 0) - (+f[a.id] || 0));
  const pr = State.all.filter(l => p[l.id]).sort((a, b) => (+p[b.id] || 0) - (+p[a.id] || 0)).slice(0, 12);
  const sec = (t, list, e) => `<div class="section" role="heading" aria-level="2">${t}</div>` + (list.length ? `<div class="rows">${list.map(rowHtml).join("")}</div>` : `<div class="empty-mini">${e}</div>`);
  const head = (lt || lastInProgress())
    ? `<div class="mystuff-top">${progressBar(lt, shasTotal(), { label: "Your Shas progress" })}${upNextLink()}</div>`
    : `<p class="lead">Your progress lives on this device — mark dapim as learned and your spot is saved automatically.</p>`;
  return `<div class="pagetitle" role="heading" aria-level="1">My Stuff</div>` + head
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
  if (!cats.length) return `<div class="pagetitle" role="heading" aria-level="1">Shiurim</div><div class="empty-mini">No shiurim found yet.</div>`;
  return `<div class="pagetitle" role="heading" aria-level="1">Shiurim</div><p class="lead">Beyond the daily daf — parsha, holidays, and more.</p>
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
  return back + `<div class="pagetitle" role="heading" aria-level="1" style="margin-top:6px">${esc(pretty)}</div>${body}`;
}
function moreSection() {
  const nondaf = State.all.filter(l => !isDafShiur(l)).slice(0, 4);
  if (!nondaf.length) return "";
  return `<div class="section" role="heading" aria-level="2">Parsha &amp; more</div><div class="rows">${nondaf.map(rowHtml).join("")}</div>
    <p class="center" style="margin-top:14px"><button class="textlink" data-route="topics">All shiurim →</button></p>`;
}

/* ---------- Sponsor ---------- */
function viewSponsor() {
  const s = State.content.sponsor || {}, amt = s.amounts || {}, sp = State.sponsor;
  const today = DY.dafForDate(new Date());
  const opt = (kind, t, sub, price, attr) => `<button class="sp-opt ${sp.kind === kind ? "on" : ""}" ${attr} aria-pressed="${sp.kind === kind ? "true" : "false"}"><span><b>${t}</b><span>${sub}</span></span><span class="price">${esc(price || "")}</span></button>`;
  const picker = `<div class="sp-opts">
      ${sp.kind === "daf" ? opt("daf", "This daf", `${esc(sp.masechta || "")} ${sp.daf || ""}`, amt.daf, `data-sp="daf"`) : ""}
      ${opt("today", "Today's daf", `${today.masechta} ${today.daf}`, amt.daf, `data-sp="today"`)}
      ${opt("future", "A future daf", "for a yahrtzeit or simcha", amt.daf, `data-sp="future"`)}
      ${opt("masechta", "A whole masechta", "dedicate an entire tractate", amt.masechta, `data-sp="masechta"`)}
    </div>
    ${sp.kind === "future" ? `<div class="field-label">Date</div><input type="date" id="spDate" aria-label="Date" value="${esc(sp.date || todayStr())}">${sp.date ? `<p class="center muted" style="font-size:14px">that day's daf: <b>${esc(sponsorFutureDaf().masechta)} ${sponsorFutureDaf().daf}</b></p>` : ""}` : ""}
    ${sp.kind === "masechta" ? `<div class="field-label">Masechta</div><select id="spMas" aria-label="Masechta">${DY.SHAS.map(m => `<option value="${esc(m.en)}" ${sp.masechta === m.en ? "selected" : ""}>${esc(m.en)} — ${esc(m.he)}</option>`).join("")}</select>` : ""}`;
  const form = sp.kind ? `<div class="sp-form">
      <div class="sp-target">Sponsoring: <b>${esc(sponsorTargetLabel())}</b></div>
      <div class="field-label">Dedication</div>
      <select id="spType" aria-label="Dedication">${(Array.isArray(s.dedicationTypes) ? s.dedicationTypes : ["L'ilui nishmas", "In honor of"]).map(t => `<option>${esc(t)}</option>`).join("")}</select>
      <input id="spFor" aria-label="name" placeholder="…name">
      <div class="field-label">From</div>
      <input id="spFrom" aria-label="your name" placeholder="sponsored by">
      <input id="spEmail" type="email" aria-label="email" placeholder="your email">
      <button class="btn solid block" id="spSend">Send dedication</button>
      <button class="btn block" data-route="donate" style="margin-top:8px">Complete by Zelle →</button>
      ${s.note ? `<p class="muted" style="font-size:12.5px;margin-top:12px">${esc(s.note)}</p>` : ""}
    </div>` : "";
  return `<div class="pagetitle" role="heading" aria-level="1">${esc(s.heading || "Sponsor the Shiur")}</div><p class="lead">${esc(s.blurb || "")}</p>${picker}${form}`;
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
  location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent("Daf Yomi sponsorship — " + sponsorTargetLabel())}&body=${encodeURIComponent(body)}`;
}

// Our own Zelle QR — generated as crisp SVG (no image file). The exact payload
// is content.donate.zelle.qrData; if absent we rebuild the standard Zelle URL
// from the name + email, so it stays correct if those are edited.
function zelleQrData() {
  const z = State.content?.donate?.zelle || {};
  if (z.qrData) return z.qrData;
  if (!z.email) return "";
  const first = (z.name || "").trim().split(/\s+/)[0] || (z.name || "");
  try { return "https://enroll.zellepay.com/qr-codes?data=" + btoa(unescape(encodeURIComponent(JSON.stringify({ name: first, token: z.email, action: "payment" })))); }
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
  return `<div class="pagetitle" role="heading" aria-level="1">${esc(d.heading || "Donate")}</div><p class="lead">${esc(d.blurb || "")}</p>
    <div class="donate-box"><div class="qr-frame">${qr}<div class="qr-cap">Scan with your bank app to pay by <span class="zelle-brand">Zelle</span></div></div>
      <div class="zelle-line">Pay <b>${esc(z.name || "")}</b> via <span class="zelle-brand">Zelle</span><span class="muted">${esc(z.email || "")}</span></div>
      <button class="btn sm copy-btn" data-copy="${esc(z.email || "")}">Copy email</button>
      ${d.dedicationNote ? `<p class="muted" style="font-size:13px;margin-top:14px">${esc(d.dedicationNote)}</p>` : ""}</div>`;
}
function viewAbout() {
  const a = State.content.about || {}, c = State.content.contact || {}, p = State.content.phone || {};
  return `<div class="pagetitle" role="heading" aria-level="1">${esc(a.heading || "About")}</div>
    <div class="prose">${(Array.isArray(a.paragraphs) ? a.paragraphs : []).map(x => `<p>${esc(x)}</p>`).join("")}</div>
    ${a.tradition ? `<div class="section" role="heading" aria-level="2">${esc(a.tradition.heading)}</div><div class="prose"><p>${esc(a.tradition.body)}</p></div>` : ""}
    <div class="section" role="heading" aria-level="2">FAQ</div>${(Array.isArray(State.content.faqs) ? State.content.faqs : []).map(x => `<details class="faq"><summary>${esc(x.q)}</summary><div class="a">${esc(x.a)}</div></details>`).join("")}
    <div class="section" role="heading" aria-level="2">Contact</div>
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
    <span class="rnum${isDaf ? "" : " sym"}"${isDaf ? "" : ' aria-hidden="true"'}>${num}</span>
    <span class="rmain"><b>${title}</b><span class="rmeta">${meta}</span></span>
    <span class="rgo" aria-hidden="true">▶</span></button>`;
}
function crumbs(parts, title) {
  return `<div class="crumbs" dir="ltr">${parts.map(([l, n, p]) => `<button data-go="${n}" data-p="${esc(JSON.stringify(p || {}))}">${esc(l)}</button>`).join(" › ")} › <b>${esc(title)}</b></div>`;
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
  v.querySelectorAll("[data-go]").forEach(a => a.onclick = () => { let p = {}; try { p = JSON.parse(a.dataset.p || "{}"); } catch {} route(a.dataset.go, p); });
  v.querySelectorAll("[data-route]").forEach(b => b.onclick = () => route(b.dataset.route));
  v.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => { const p = navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy); if (p && p.then) p.then(() => toast("Email copied")).catch(() => toast(esc(b.dataset.copy))); else toast(esc(b.dataset.copy)); });
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
  const q = $("#q"); if (q) { let _sd; q.oninput = () => { clearTimeout(_sd); _sd = setTimeout(() => runSearch(q.value), 150); }; q.focus(); runSearch(""); }
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
  Player.playAudio(lec, url, !!local); noteProgress(id);
}
// The TorahAnytime source carries a ~7.5s logo intro. Our self-hosted copies are
// already trimmed; for any not-yet-self-hosted shiur we fall back to TA and skip
// the intro client-side, so the intro is never shown either way.
const INTRO_SEC = 7.5;
// Single-active-media: only one source makes sound at a time. Pause the player's
// persistent <audio> AND every in-page <video> except the one passed in.
function pauseAllExcept(except) {
  try { if (Player.audio && Player.audio !== except) Player.audio.pause(); } catch {}
  $$("video").forEach(v => { if (v !== except) { try { v.pause(); } catch {} } });
}
// Watch a shiur's video: the picture plays in-page, but the SAME compact bottom
// transport that drives "Listen" is bound to it — so play / pause / seek / speed
// stay pinned at the bottom while you scroll down to read. One player, both modes.
function watchVideo(id) {
  const lec = State.all.find(l => l.id === id); if (!lec) return;
  const slot = $("#videoSlot"); if (!slot) return;
  const local = State.content.options?.preferSelfHosted !== false && lec.localVideo;
  const src = local ? lec.localVideo : lec.video; if (!src) return;
  const old = slot.querySelector("video"); if (old) { try { old.pause(); old.removeAttribute("src"); old.load(); } catch {} }   // stop a video already playing in this slot before swapping it out (else it keeps decoding, detached)
  slot.innerHTML = `<video class="daf-video" controls playsinline preload="metadata"></video>`;
  Player.playVideo(slot.querySelector("video"), lec, src, !!local);
  noteProgress(id);
}

/* =====================================================================
   PLAYER — one compact transport for BOTH audio and video.
   `media` is whichever element is live: a persistent <audio> for "Listen",
   or an in-page <video> for "Watch". Same bar, same controls, either way —
   so a video watcher keeps play/seek/speed at the bottom while reading.
   ===================================================================== */
const Player = {
  audio: null, media: null, lec: null, speed: 1, local: false, isVideo: false,
  mount() {
    if (this.audio) { try { this.audio.pause(); this.audio.src = ""; } catch {} }
    this.audio = new Audio(); this.audio.preload = "metadata";
    this._bind(this.audio);
    this._session();
  },
  // Wire the OS "Now Playing" surface once: play/pause/skip/seek from the
  // lock screen, headphones, car, and a paired Apple Watch / Wear OS watch.
  _session() {
    if (this._sessSet || !("mediaSession" in navigator)) return;
    this._sessSet = true;
    const ms = navigator.mediaSession, set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch {} };
    set("play",  () => { const m = this.media; if (m) m.play().catch(() => {}); });
    set("pause", () => { const m = this.media; if (m) m.pause(); });
    set("stop",  () => this.hide());
    set("seekbackward", e => this.skip(-(e && e.seekOffset || 10)));
    set("seekforward",  e => this.skip(  e && e.seekOffset || 10));
    set("seekto", e => { const m = this.media; if (!m || !e) return; try { if (e.fastSeek && "fastSeek" in m) m.fastSeek(e.seekTime); else m.currentTime = e.seekTime; } catch {} });
    set("previoustrack", null); set("nexttrack", null);   // one long shiur — no track-skip buttons on the watch
  },
  // Push the current daf's title/artwork to the OS card.
  _meta() {
    if (!("mediaSession" in navigator) || !this.lec) return;
    const k = this.lec._dk, mh = (State.content && State.content.masthead) || {};
    const heTitle = k && k.daf ? dafTitleHe(k.masechta, k.daf) : (this.lec.title || "שיעור");
    const enLine  = k && k.daf ? `${k.masechta} ${k.daf}` : "";
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: heTitle,
        artist: (enLine ? enLine + " · " : "") + (mh.english || "Rabbi Shea Stern"),
        album: mh.hebrew || "שיעורי הדף היומי",
        artwork: [
          { src: "assets/artwork-192.png", sizes: "192x192", type: "image/png" },
          { src: "assets/artwork-512.png", sizes: "512x512", type: "image/png" },
        ],
      });
    } catch {}
  },
  // Keep the OS scrubber (lock screen / watch) in step with playback.
  _pos() {
    const ms = navigator.mediaSession; if (!ms || !ms.setPositionState) return;
    const m = this.media; if (!m) return;
    const dur = m.duration || 0; if (!dur || !isFinite(dur)) return;
    try { ms.setPositionState({ duration: dur, playbackRate: m.playbackRate || 1, position: Math.min(m.currentTime || 0, dur) }); } catch {}
  },
  // Wire one media element's events to the player. Guarded so each element binds
  // once; every handler no-ops unless that element is the active `media`.
  _bind(m) {
    if (m._pbound) return; m._pbound = true;
    m.addEventListener("timeupdate", () => { if (this.media === m) this.tick(); });
    m.addEventListener("loadedmetadata", () => {
      if (this.media !== m) return;
      if (this._resumeTo) { try { m.currentTime = this._resumeTo; toast(`Resumed from ${clock(this._resumeTo)}`); } catch {} this._resumeTo = 0; }
      else if (this._skipPending && !this.local) { try { m.currentTime = this.lec?.introTrimmed || INTRO_SEC; } catch {} }   // TA fallback still carries the intro
      this._skipPending = false; this.tick();
    });
    m.addEventListener("play", () => { if (this.media === m) { pauseAllExcept(m); this.ctrls(); } });
    m.addEventListener("pause", () => { if (this.media === m) this.ctrls(); });
    m.addEventListener("ratechange", () => { if (this.media === m && this.speed !== m.playbackRate) { this.speed = m.playbackRate; this.ctrls(); } });   // keep the bar's speed in sync with the native video menu (and vice-versa)
    m.addEventListener("ended", () => { if (this.media === m && this.lec) { clearPos(this.lec.id); markShiurLearned(this.lec); this.ctrls(); } });
    m.addEventListener("error", () => { if (this.media === m && this.lec && this.local && !this.isVideo) { this.local = false; if (!this.lec.audio) { this.bar(); return; } this._skipPending = true; this.audio.src = this.lec.audio; this.audio.play().catch(() => {}); this.bar(); } });
  },
  playAudio(lec, url, local) {
    this.lec = lec; this.local = !!local; this.isVideo = false; this.media = this.audio;
    this._skipPending = !local; this._resumeTo = resumePoint(lec.id); this._lastSave = 0;
    pauseAllExcept(this.audio);
    this.audio.src = url || lec.audio; this.audio.playbackRate = this.speed;
    this.show(); this.bar(); this.audio.play().catch(() => {});
  },
  playVideo(v, lec, url, local) {
    this.lec = lec; this.local = !!local; this.isVideo = true; this.media = v;
    this._skipPending = !local; this._resumeTo = resumePoint(lec.id); this._lastSave = 0;
    this._bind(v); pauseAllExcept(v);
    v.playbackRate = this.speed; v.src = url;
    this.show(); this.bar(); v.play().catch(() => {});
  },
  show() { $("#player").classList.remove("hidden"); $("#app")?.classList.add("player-active"); document.documentElement.classList.add("player-on"); },
  toggle() { const m = this.media; if (!m) return; m.paused ? m.play().catch(() => {}) : m.pause(); },
  skip(s) { const m = this.media; if (!m) return; m.currentTime = Math.max(0, Math.min(m.duration || 1e9, m.currentTime + s)); },
  setSpeed() { const o = [1, 1.25, 1.5, 1.75, 2, 0.75]; this.speed = o[(o.indexOf(this.speed) + 1) % o.length]; if (this.media) this.media.playbackRate = this.speed; this.ctrls(); },
  hide() {
    const m = this.media;
    if (m && this.lec) { const cur = m.currentTime || 0, dur = m.duration || 0; if (dur && cur > 8 && cur < dur - 8) savePos(this.lec.id, cur, dur); }
    $("#player").classList.add("hidden"); $("#app")?.classList.remove("player-active"); document.documentElement.classList.remove("player-on");
    try { m && m.pause(); } catch {}
    if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = "none"; navigator.mediaSession.metadata = null; } catch {} }
    this._elCur = this._elDur = this._elSeek = null;
    this.isVideo = false;
  },
  bar() {
    if (!this.lec) return;
    const k = this.lec._dk, label = k && k.daf ? `${k.masechta} ${k.daf}` : (this.lec.title || "");
    $("#player").innerHTML = `<div class="scrub"><input type="range" id="pSeek" min="0" max="1000" value="0" aria-label="Seek"></div>
      <div class="prow">
        <div class="pnow"><span class="ptype" aria-hidden="true">${this.isVideo ? "▦" : "♪"}</span><span class="ptxt"><b id="pTitle">${esc(label)}</b><span class="ptime"><span id="pCur">0:00</span> / <span id="pDur">--:--</span></span></span></div>
        <div class="ctrls" id="pCtrls"></div>
        <button class="x" id="pX" aria-label="Close player">✕</button>
      </div>`;
    $("#pX").onclick = () => this.hide();
    $("#pSeek").oninput = e => { const m = this.media; if (m && m.duration) m.currentTime = (e.target.value / 1000) * m.duration; };
    this._elCur = $("#pCur"); this._elDur = $("#pDur"); this._elSeek = $("#pSeek");   // cache the stable bar refs — tick() runs ~4Hz, no need to re-query each fire
    this._meta(); this.ctrls(); this.tick();
  },
  ctrls() {
    const c = $("#pCtrls"); if (!c) return; const m = this.media, playing = m && !m.paused && !m.ended;
    if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = playing ? "playing" : "paused"; } catch {} }
    c.innerHTML = `<button id="pB" aria-label="Back 10 seconds">↺<span class="d">10</span></button><button class="pp" id="pP" aria-label="${playing ? "Pause" : "Play"}">${playing ? "❚❚" : "▶"}</button><button id="pF" aria-label="Forward 10 seconds"><span class="d">10</span>↻</button><button class="pill" id="pS" aria-label="Playback speed">${this.speed}×</button>`;
    $("#pP").onclick = () => this.toggle(); $("#pB").onclick = () => this.skip(-10); $("#pF").onclick = () => this.skip(10); $("#pS").onclick = () => this.setSpeed();
  },
  tick() {
    const m = this.media, cur = m ? m.currentTime || 0 : 0, dur = m ? m.duration || 0 : 0, c = this._elCur, d = this._elDur, s = this._elSeek;
    if (c) c.textContent = clock(cur); if (d) d.textContent = dur ? clock(dur) : "--:--";
    if (s && dur) { s.value = (cur / dur) * 1000; s.style.backgroundSize = (cur / dur) * 100 + "% 100%"; s.setAttribute("aria-valuetext", clock(cur) + " of " + clock(dur)); }
    this._pos();
    if (this.lec && dur && cur > 8 && cur < dur - 8 && m && !m.paused) { const now = Date.now(); if (now - (this._lastSave || 0) > 4000) { this._lastSave = now; savePos(this.lec.id, cur, dur); } }
  },
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
function applyEditor() { State.content = gatherEditor(); const ok = setStore(CFG.contentLocalKey, State.content); if (Reader.open) hideReader(); renderShell(); route(State.route.name, State.route); closeMenu(); toast(ok ? "Preview updated" : "Preview updated — storage full, changes won't persist"); }

window.addEventListener("keydown", e => {
  if (Reader.open) {
    if (e.key === "Escape") { e.preventDefault(); closeReader(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); readerFlip(1); }      // RTL: ← advances to the next daf
    else if (e.key === "ArrowRight") { e.preventDefault(); readerFlip(-1); }    // RTL: → goes back to the previous daf
    return;
  }
  if (e.key === "Escape") closeMenu();
});
window.addEventListener("resize", () => { applyViewportClasses(); setBarH(); });
try { window.matchMedia("(max-width: 680px)").addEventListener("change", applyViewportClasses); } catch {}
try { window.matchMedia("(max-width: 560px)").addEventListener("change", applyViewportClasses); } catch {}
window.addEventListener("scroll", onReadScroll, { passive: true });
boot();
