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
  origAudio: "data/orig_audio.json",
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
const RM = window.DafReaderModel;

const State = {
  speaker: null, all: [], content: {}, media: {}, admin: {}, dafIndex: {}, dafCache: {}, commCache: {}, dafPending: {}, commPending: {},
  byDaf: new Map(), route: { name: "today" }, newIds: new Set(),
  sponsor: { kind: null }, _dafCol: "gemara", _dafMode: "daf", _parCol: "gemara", _parMode: "daf",
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
  [State.content, State.media, State.dafIndex, State.origAudio] = await Promise.all([
    loadContent().then(async c => { State.content = c; State.admin = await loadAdminData(); return applyContentOverrides(c, State.admin); }),   // admin data needs options.mediaBaseUrl, so it chains off content
    loadJson(CFG.mediaManifest), loadJson(CFG.dafIndex), loadJson(CFG.origAudio)]);
  buildIndex(); renderShell(); restoreInitialRoute();
  setStatus("checking"); refreshLive(seed.lectures || [], !!cached);
}
// Site text comes from data/content.json, with the Rov's edits (made in /admin/)
// layered on top. The old device-local "Editor mode" preview is gone — a stale
// copy of it used to silently mask real content updates, so we clear it here.
async function loadContent() { try { localStorage.removeItem(CFG.contentLocalKey); } catch {} return loadJson(CFG.contentUrl); }
async function loadJson(u) { try { return await fetch(u).then(r => r.ok ? r.json() : {}); } catch { return {}; } }

// Admin-managed media overrides + worksheet attachments (uploaded by the Rov via
// /admin/) live in site/admin-data.json on the media CDN. Minute-stamped query
// param + no-store so an edit is visible on the next load, not next week.
async function loadAdminData() {
  const base = String(State.content?.options?.mediaBaseUrl || "").replace(/\/+$/, "");
  if (!base) return {};
  try {
    const r = await fetch(`${base}/site/admin-data.json?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
    if (!r.ok) return {};
    const d = await r.json();
    return (d && typeof d === "object" && !Array.isArray(d)) ? d : {};
  } catch { return {}; }
}
// Site text the Rov edits in /admin/, as dotted paths into content.json. We walk
// OUR list — never the remote object's keys — so an unlisted path (__proto__,
// options.mediaBaseUrl, …) can't be written no matter what the file contains.
// Keep in sync with CONTENT_FIELDS in admin-api/lambda_function.py.
const ADMIN_TEXT_FIELDS = [
  "masthead.hebrew", "masthead.english", "masthead.subtitle",
  "donate.heading", "donate.blurb", "donate.dedicationNote",
  "donate.zelle.name", "donate.zelle.email",
  "contact.email", "contact.phone", "contact.whatsapp",
  "phone.label", "phone.number", "phone.extension", "phone.note",
  "sponsor.heading", "sponsor.blurb", "sponsor.contactEmail",
  "sponsor.amounts.daf", "sponsor.amounts.week", "sponsor.amounts.masechta",
  "about.heading",
];
function applyContentOverrides(base, admin) {
  const ov = admin && admin.content;
  if (!base || !ov || typeof ov !== "object" || Array.isArray(ov)) return base;
  const z0 = (base.donate && base.donate.zelle) || {};
  const wasName = z0.name || "", wasEmail = z0.email || "";
  for (const path of ADMIN_TEXT_FIELDS) {
    const v = ov[path];
    if (typeof v !== "string" || !v) continue;
    const parts = path.split(".");
    let node = base;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (!node[k] || typeof node[k] !== "object" || Array.isArray(node[k])) node[k] = {};
      node = node[k];
    }
    node[parts[parts.length - 1]] = v.slice(0, 1600);
  }
  // content.json carries an exact hand-made Zelle QR payload that outranks
  // name/email. If the Rov changed either, that payload would still point at the
  // OLD account — drop it so the QR is rebuilt from the new details.
  // z.qr is the hand-made QR IMAGE for the old account and viewDonate falls back
  // to it whenever the generator is unavailable — drop it with the payload.
  const z = (base.donate && base.donate.zelle) || null;
  if (z && ((z.name || "") !== wasName || (z.email || "") !== wasEmail)) { delete z.qrData; delete z.qr; }
  return base;
}

// Admin refs are RELATIVE R2 keys under a small allowlist; anything else is
// ignored (admin-data.json is remote content — never let it inject arbitrary URLs).
const ADMIN_KEY_RE = /^(site\/uploads\/(audio|video|worksheet)\/|media\/|archive\/)/;
function adminMediaUrl(k) { k = String(k || ""); return (ADMIN_KEY_RE.test(k) && !k.includes("..")) ? encodeURI(mediaUrl(k)) : ""; }
function adminPageMedia(pk) { const e = State.admin?.media?.pages?.[pk]; return (e && typeof e === "object" && !Array.isArray(e)) ? e : null; }
function adminAttachments(pk) { const l = State.admin?.attachments?.pages?.[pk]; return Array.isArray(l) ? l : []; }

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
    lec.ovAudio = lec.ovVideo = undefined;                       // clear first — cached lecture objects may carry a since-removed override
    const ov = State.admin?.media?.lectures?.[String(lec.id)];   // admin replacement beats every tier; applied here so refreshLive re-applies it
    if (ov && typeof ov === "object") {
      const oa = ov.audio && adminMediaUrl(ov.audio.key), ovi = ov.video && adminMediaUrl(ov.video.key);
      if (oa) lec.ovAudio = oa;
      if (ovi) lec.ovVideo = ovi;
    }
    const k = DY.shiurDaf(lec); lec._dk = k;
    if (k && k.masechta && k.daf != null) {   // prefer the Rabbi's ORIGINAL recording (no TA intro/watermark) when we have one for this daf
      const o = State.origAudio && State.origAudio[k.masechta] && State.origAudio[k.masechta][String(k.daf)];
      if (o) lec.origAudio = mediaUrl(o);
    }
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
  for (const id in P) {
    const p = P[id]; if (!p || !p.t) continue; if (p.d && p.t > p.d - 25) continue;
    const lec = State.all.find(l => l.id === +id); if (!lec || isHiddenShiur(lec)) continue;   // a retired category never resurfaces via saved progress
    if (!best || p.at > best.at) best = { id: +id, ...p, lec };
  }
  return best ? { lec: best.lec, pos: best } : null;
}

/* native daf text loader */
async function loadDafText(masechta) {
  const key = fileKey(masechta);
  if (State.dafCache[key]) return State.dafCache[key];
  if (State.dafPending[key]) return State.dafPending[key];
  const info = State.dafIndex[masechta]; if (!info) return null;
  State.dafPending[key] = fetch(`data/daf/${key}.json`).then(r => r.ok ? r.json() : null)
    .then(d => { if (d) State.dafCache[key] = d; return d; }).catch(() => null)
    .finally(() => { delete State.dafPending[key]; });
  return State.dafPending[key];
}
/* Rashi + Tosafos for the "Daf" (Tzuras Hadaf) layout — loaded lazily per masechta */
async function loadDafComm(masechta) {
  const key = fileKey(masechta);
  if (State.commCache[key]) return State.commCache[key];
  if (State.commPending[key]) return State.commPending[key];
  State.commPending[key] = fetch(`data/daf/${key}.comm.json`).then(r => r.ok ? r.json() : {})
    .then(d => { State.commCache[key] = d || {}; return State.commCache[key]; }).catch(() => ({}))
    .finally(() => { delete State.commPending[key]; });
  return State.commPending[key];
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
      <nav class="bar-nav" aria-label="Sections">
        <button data-route="browse">Shas</button>
        <button data-route="parsha">Parsha</button>
        <button data-route="holidays">Yomim Tovim</button>
        <button data-route="mystuff">My Learning</button>
      </nav>
      <button class="ic-btn" id="searchBtn" aria-label="Search">⌕</button>
    </header>
    <main id="view"></main>
    <footer>
      <span class="fhe" lang="he">${esc(mh.hebrew || "שיעורי הדף היומי")}</span>
      ${esc(mh.english || State.speaker?.name || "Rabbi Shea Stern")} · ${esc(mh.subtitle || "Daf Yomi")}
    </footer>
    <div class="player hidden" id="player"></div>
  </div>
  <div class="mask" id="mask"></div>
  <aside class="menu" id="menu" role="dialog" aria-modal="true" aria-label="Site menu" inert aria-hidden="true"></aside>
  <div class="toast-wrap" id="toasts" aria-live="polite" aria-atomic="false"></div>
  <div class="sr-only" id="readStatus" role="status" aria-live="polite" aria-atomic="true"></div>
  <div class="reader" id="reader" role="dialog" aria-modal="true" aria-labelledby="rdTitle" hidden aria-hidden="true"></div>`;

  $("#burger").onclick = openMenu; $("#mask").onclick = closeMenu;
  $("#searchBtn").onclick = () => route("search");
  $$(".bar-nav button").forEach(b => b.onclick = () => route(b.dataset.route));
  $("#backBtn").onclick = goBack;
  applyViewportClasses(); applyDafScale();
  const homeEl = $("#home"); homeEl.onclick = () => route("today"); homeEl.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); route("today"); } };
  Player.mount(); buildMenu(); setStatus(State._sk || "checking"); updateBackBtn(); setBarH();
}
// The sticky column bar pins just below the top bar — measure the bar so the offset
// stays exact across font sizes and the iPhone safe-area.
function setBarH() { const b = $(".bar"); if (b) document.documentElement.style.setProperty("--bar-h", b.offsetHeight + "px"); }
function buildMenu() {
  const mh = State.content.masthead || {};
  $("#menu").innerHTML = `<button class="menu-close" id="menuClose" aria-label="Close menu">✕</button><div class="mtitle">${esc(mh.hebrew || "")}</div><div class="msub">${esc(mh.english || State.speaker?.name || "")} · ${esc(mh.subtitle || "")}</div>
    <nav>
      <button class="mi" data-route="today">Today's Daf</button>
      <button class="mi" data-route="browse">Browse Shas</button>
      <button class="mi" data-route="parsha">Chumash &amp; Parsha</button>
      <button class="mi" data-route="holidays">Yomim Tovim</button>
      <button class="mi" data-route="topics">More Shiurim</button>
      <button class="mi" data-route="search">Search</button>
      <button class="mi" data-route="mystuff">My Learning</button>
      <button class="mi accent" data-route="sponsor">Sponsor a Daf</button>
      <button class="mi accent" data-route="donate">Donate</button>
      <button class="mi" data-route="about">About</button>
      <button class="mi phoneview-mi" id="phoneViewBtn">${_forcePhone ? "🖥️ Exit phone view" : "📱 Phone view"}</button>
      <a class="mi" href="admin/" style="color:var(--ink-faint);font-size:13px">Site admin</a>
    </nav>`;
  $$("#menu .mi[data-route]").forEach(b => b.onclick = () => { closeMenu(); route(b.dataset.route); });
  $("#menuClose").onclick = closeMenu;
  $("#phoneViewBtn").onclick = togglePhoneView;
}
// Phone view: switches the ACTUAL desktop UI to the real phone layout (one column at
// a time, sticky column switcher, compact chrome) by forcing the is-phone/is-narrow
// classes that the phone CSS keys on — no device mock-up, the whole UI changes.
function applyViewportClasses() {
  const html = document.documentElement;
  const mCompact = window.matchMedia("(max-width: 960px)").matches;
  const m560 = window.matchMedia("(max-width: 560px)").matches;
  const w1000 = window.matchMedia("(min-width: 1000px)").matches;
  html.classList.toggle("is-phone", mCompact || _forcePhone);
  html.classList.toggle("is-narrow", m560 || _forcePhone);
  html.classList.toggle("force-phone", _forcePhone);
  html.classList.toggle("is-wide", w1000 && !_forcePhone);   // wide desktop → roomier reader chrome
}
/* ---------- reading text size (א− / א+), persisted ---------- */
let _dafScale = 1;
try { const s = parseFloat(localStorage.getItem("dy_dafscale")); if (s >= 0.8 && s <= 1.6) _dafScale = s; } catch {}
function applyDafScale() { document.documentElement.style.setProperty("--daf-scale", String(_dafScale)); }
function bumpDafScale(dir) {
  clearPageMotions();                                        // scale changes reflow paper; cancel any geometry snapshot first
  _dafScale = Math.round(Math.min(1.6, Math.max(0.8, _dafScale + dir * 0.1)) * 10) / 10;
  try { localStorage.setItem("dy_dafscale", String(_dafScale)); } catch {}
  applyDafScale();
  updateTextSizeControls(document);
  requestAnimationFrame(() => sizeDafCarves());   // the gemara reflows at the new scale — refit the carves to it
}
const tsizeHtml = () => `<span class="tsize" role="group" aria-label="Text size"><button data-tsize="-1" aria-label="Smaller text"${_dafScale <= .8 ? " disabled" : ""}>א−</button><span class="sr-only tsize-output" aria-live="polite">${Math.round(_dafScale * 100)}%</span><button data-tsize="1" aria-label="Larger text"${_dafScale >= 1.6 ? " disabled" : ""}>א+</button></span>`;
function updateTextSizeControls(scope) {
  (scope || document).querySelectorAll("[data-tsize]").forEach(b => { b.disabled = +b.dataset.tsize < 0 ? _dafScale <= .8 : _dafScale >= 1.6; });
  (scope || document).querySelectorAll(".tsize-output").forEach(n => { n.textContent = `${Math.round(_dafScale * 100)}%`; });
}
function togglePhoneView() {
  clearPageMotions();
  _forcePhone = !_forcePhone;
  try { localStorage.setItem("dy_force_phone", _forcePhone ? "1" : "0"); } catch {}
  applyViewportClasses(); setBarH();
  const b = $("#phoneViewBtn"); if (b) b.textContent = _forcePhone ? "🖥️ Exit phone view" : "📱 Phone view";
  closeMenu(); window.scrollTo(0, 0);
  requestAnimationFrame(() => sizeDafCarves());
}
function openMenu() {
  const menu = $("#menu"); if (!menu || Reader.open) return;
  menu.removeAttribute("inert"); menu.setAttribute("aria-hidden", "false"); menu.classList.add("open");
  $("#mask").classList.add("open"); $("#burger")?.setAttribute("aria-expanded", "true"); $("#app")?.setAttribute("inert", "");
  setTimeout(() => $("#menuClose")?.focus(), 0);
}
function closeMenu() {
  const menu = $("#menu"), wasOpen = menu?.classList.contains("open");
  menu?.classList.remove("open"); menu?.setAttribute("inert", ""); menu?.setAttribute("aria-hidden", "true");
  $("#mask")?.classList.remove("open"); $("#burger")?.setAttribute("aria-expanded", "false");
  if (!Reader.open) $("#app")?.removeAttribute("inert");
  if (wasOpen) $("#burger")?.focus();
}

/* =====================================================================
   ROUTER
   ===================================================================== */
let _navDepth = 0;   // how deep into the app we are (0 = home/entry); drives the back button
const _embedded = (() => { try { return window.top !== window.self; } catch { return true; } })();   // true when embedded in another frame
let _forcePhone = false; try { _forcePhone = localStorage.getItem("dy_force_phone") === "1"; } catch {}   // desktop "phone view" toggle
// The address bar always names the page (share a daf by copying the URL — the
// universal WhatsApp gesture); routeFromHash() below accepts every form we emit.
const DAF_MODE_KEYS = new Set(["daf", "he", "en", "both"]), DAF_SOURCE_KEYS = new Set(["gemara", "rashi", "tosafos"]);
function normalizeReadSnapshot(read) {
  if (!read || typeof read !== "object") return null;
  const masechta = String(read.masechta || ""), daf = +read.daf, amud = String(read.amud || "");
  const mm = DY.BYEN[masechta];
  if (!mm || !Number.isInteger(daf) || daf < mm.firstDaf || daf > mm.lastDaf || !amudKeysFor(masechta, daf).includes(amud)) return null;
  const mode = DAF_MODE_KEYS.has(read.mode) ? read.mode : "daf";
  const source = DAF_SOURCE_KEYS.has(read.source) ? read.source : "gemara";
  const out = { masechta, daf, amud, mode, source };
  if (Number.isFinite(+read.y) && +read.y >= 0) out.y = +read.y;
  return out;
}
function normalizeTorahSnapshot(read) {
  if (!read || typeof read !== "object") return null;
  const mode = read.mode === "he" ? "he" : "daf", source = DAF_SOURCE_KEYS.has(read.source) ? read.source : "gemara";
  const out = { mode, source };
  if (Number.isFinite(+read.y) && +read.y >= 0) out.y = +read.y;
  if (read.anchor && /^\d+-\d+$/.test(String(read.anchor.ref || ""))) {
    out.anchor = { ref: String(read.anchor.ref), offset: Number.isFinite(+read.anchor.offset) ? +read.anchor.offset : 0 };
    if (Number.isFinite(+read.anchor.progress)) out.anchor.progress = Math.max(0, Math.min(1, +read.anchor.progress));
  }
  return out;
}
function hashFor(r) {
  const enc = encodeURIComponent;
  switch (r.name) {
    case "daf": {
      let hash = "#daf=" + enc(r.id || ""), read = normalizeReadSnapshot(r.read);
      if (read) hash += "&read=" + enc(`${read.masechta}|${read.daf}|${read.amud}`) + "&mode=" + enc(read.mode) + "&source=" + enc(read.source);
      return hash;
    }
    case "masechta": return "#masechta=" + enc(r.masechta || "");
    case "seder": return "#seder=" + enc(r.seder || "");
    case "browse": return "#browse";
    case "parsha": return "#chumash";
    case "sefer": return "#sefer=" + enc(r.sefer || "");
    case "parshaS": {
      let hash = "#parsha=" + enc(r.parsha || ""), torah = normalizeTorahSnapshot(r.torah);
      if (torah) hash += "&pmode=" + enc(torah.mode) + "&psource=" + enc(torah.source);
      return hash;
    }
    case "holidays": return "#yomtov";
    case "holiday": return "#holiday=" + enc(r.series || "");
    case "topics": return "#shiurim";
    case "category": return "#cat=" + enc(r.cat || "");
    case "search": return "#search";
    case "mystuff": return "#my";
    case "sponsor": return "#sponsor";
    case "donate": return "#donate";
    case "about": return "#about";
    default: return "";   // today → clean URL
  }
}
const urlFor = r => location.pathname + location.search + hashFor(r);
function route(name, params = {}, opts = {}) {
  saveActiveReadingPosition();
  clearTimeout(_readPersistTimer); _readPersistTimer = 0;
  const next = { name, ...params };
  const same = JSON.stringify(next) === JSON.stringify(State.route);
  if (name === "sponsor" && params.pre) State.sponsor = { ...params.pre, pre: { ...params.pre } };
  const replace = opts.replace || same;        // identical route → replace, don't stack a dead history entry
  if (!replace) { try { history.replaceState({ ...(history.state || {}), y: window.scrollY || 0 }, ""); } catch {} }   // remember our spot for Back
  State.route = next;
  _navDepth = replace ? _navDepth : _navDepth + 1;
  _pendingY = null;                              // a forward navigation cancels any Back-restore scroll still in flight
  const st = { route: State.route, sponsor: State.sponsor, depth: _navDepth };
  try { replace ? history.replaceState(st, "", urlFor(next)) : history.pushState(st, "", urlFor(next)); } catch {}
  persistRoute();
  rerender({ skipSave: true }); window.scrollTo(0, 0); updateBackBtn();
  if (name !== "search") requestAnimationFrame(focusPrimaryHeading);
}
// Header back: chronological when there is history; on a fresh deep link (depth 0,
// e.g. a shared #daf= URL) it climbs to the page's natural parent instead of hiding.
function parentRoute(r) {
  switch (r.name) {
    case "daf": { const m = (r.id || "").split("|")[0]; return DY.BYEN[m] ? ["masechta", { masechta: m }] : ["browse", {}]; }
    case "masechta": { const mm = DY.BYEN[r.masechta]; return mm ? ["seder", { seder: mm.seder }] : ["browse", {}]; }
    case "seder": return ["browse", {}];
    case "sefer": return ["parsha", {}];
    case "parshaS": { for (const s of CHUMASHIM) if (s.parshiyos.some(([en]) => en === r.parsha)) return ["sefer", { sefer: s.en }]; return ["parsha", {}]; }
    case "holiday": return ["holidays", {}];
    case "category": return ["topics", {}];
    default: return ["today", {}];
  }
}
function goBack() {
  if (_navDepth > 0) { history.back(); return; }
  const [n, p] = parentRoute(State.route);
  route(n, p, { replace: true });
}
function updateBackBtn() { const b = $("#backBtn"); if (b) b.hidden = _navDepth <= 0 && State.route.name === "today"; }
// Remember the current page so a refresh returns to it (not Today). history.state
// already survives reloads; sessionStorage is the fallback. Skipped inside the
// phone-view iframe so it can't clobber the parent tab's saved page.
function persistRoute() {
  if (_embedded) return;
  try { sessionStorage.setItem("dy_route", JSON.stringify({ route: State.route, sponsor: State.sponsor, depth: _navDepth, y: window.scrollY || 0, reader: readerHistorySnapshot() })); } catch {}
}
const KNOWN_ROUTES = new Set(["today", "browse", "seder", "masechta", "daf", "topics", "parsha", "sefer", "parshaS", "holidays", "holiday", "category", "search", "mystuff", "sponsor", "about", "donate"]);
// Validate a route restored from history.state / sessionStorage before trusting it — a forged or
// corrupt deep-link (bad route name, unknown masechta, out-of-range daf) falls back to Today instead.
function validRoute(r) {
  if (!r || !KNOWN_ROUTES.has(r.name)) return false;
  if (r.name === "daf") { const [m, d] = (r.id || "").split("|"); const mm = DY.BYEN[m], dn = +d; return !!(mm && dn >= mm.firstDaf && dn <= mm.lastDaf); }
  if (r.name === "masechta") return !!DY.BYEN[r.masechta];
  if (r.name === "seder") return DY.SEDARIM.some(s => s.en === r.seder);
  if (r.name === "sefer") return !!CHUMASH_BY_EN[r.sefer];
  if (r.name === "parshaS") return CHUMASHIM.some(s => s.parshiyos.some(([en]) => en === r.parsha));
  if (r.name === "holiday") return typeof r.series === "string" && r.series.length > 0 && r.series.length < 80;
  return true;
}
// Deep link: #daf=Chullin|100 · #parsha=Re'eh · #holiday=Pesach%2FPassover — opens
// straight to that page (the admin's "Open the site" button links this way, and it
// makes any page shareable). Routes still pass validRoute(). On load, saved state
// for the SAME page outranks the hash (a refresh keeps depth/sponsor); the hash
// only re-routes when it names a different page than the one we saved.
function routeFromHash() {
  const raw = String(location.hash || "").replace(/^#/, "");
  if (!raw) return null;
  const bare = { browse: "browse", chumash: "parsha", yomtov: "holidays", shiurim: "topics", search: "search", my: "mystuff", sponsor: "sponsor", donate: "donate", about: "about" };
  if (!raw.includes("=")) return bare[raw] ? { name: bare[raw] } : null;
  let params; try { params = new URLSearchParams(raw); } catch { return null; }
  const kind = [...params.keys()][0], val = params.get(kind) || "";
  if (kind === "daf") {
    const out = { name: "daf", id: val }, bits = String(params.get("read") || "").split("|");
    if (bits.length >= 2) {
      const masechta = bits[0], amud = bits[bits.length - 1];
      const daf = bits.length >= 3 ? +bits[1] : (masechta === "Tamid" && amud === "25b" ? 26 : parseInt(amud, 10));
      const read = normalizeReadSnapshot({ masechta, daf, amud, mode: params.get("mode"), source: params.get("source") });
      if (read) out.read = read;
    }
    return out;
  }
  if (kind === "masechta") return { name: "masechta", masechta: val };
  if (kind === "seder") return { name: "seder", seder: val };
  if (kind === "sefer") return { name: "sefer", sefer: val };
  if (kind === "parsha") {
    const out = { name: "parshaS", parsha: val };
    const torah = normalizeTorahSnapshot({ mode: params.get("pmode"), source: params.get("psource") });
    if (params.has("pmode") || params.has("psource")) out.torah = torah;
    return out;
  }
  if (kind === "holiday") return { name: "holiday", series: val };
  if (kind === "cat") return { name: "category", cat: val.slice(0, 80) };
  return null;
}
function readerSnapshotMatchesDeepLink(snapshot, deep, savedRoute) {
  const saved = normalizeReaderSnapshot(snapshot);
  if (!saved || !deep || !savedRoute) return false;
  if (saved.kind === "torah") return false;  // Torah readers do not rewrite the hash; ordinary route equality is sufficient
  if (deep.name !== "daf" || savedRoute.name !== "daf" || deep.id !== savedRoute.id) return false;
  const read = normalizeReadSnapshot(deep.read), expected = saved.read;
  return !!read && read.masechta === expected.masechta && read.daf === expected.daf && read.amud === expected.amud
    && read.mode === expected.mode && read.source === expected.source;
}
function restoreInitialRoute() {
  const deep = routeFromHash();
  let st = history.state, fromSession = false;
  if (!_embedded && !(st && st.route && st.route.name)) { try { st = JSON.parse(sessionStorage.getItem("dy_route") || "null"); fromSession = !!st; } catch { st = null; } }
  const stValid = !!(st && st.route && validRoute(st.route));
  const sameSavedSurface = !!deep && stValid && (hashFor(st.route) === hashFor(deep) || readerSnapshotMatchesDeepLink(st.reader, deep, st.route));
  if (deep && validRoute(deep) && !sameSavedSurface) {
    route(deep.name, deep, { replace: true });   // the hash stays — the URL is the share link
    return;
  }
  if (stValid) {
    const savedReader = normalizeReaderSnapshot(st.reader);
    State.route = st.route;
    if (st.sponsor) State.sponsor = st.sponsor;
    _navDepth = typeof st.depth === "number" ? st.depth : 0;
    _pendingY = typeof st.y === "number" ? st.y : (normalizeReadSnapshot(st.route.read)?.y ?? normalizeTorahSnapshot(st.route.torah)?.y ?? null);
    try { history.replaceState({ route: State.route, sponsor: State.sponsor, depth: _navDepth, y: _pendingY ?? 0, ...(!fromSession && savedReader ? { reader: savedReader } : {}) }, "", urlFor(State.route)); } catch {}
    rerender({ skipSave: true }); window.scrollTo(0, 0); updateBackBtn();
    if (_pendingY != null && State.route.name !== "daf" && State.route.name !== "parshaS") consumePendingY();
    if (savedReader) requestAnimationFrame(() => restoreReaderFromSnapshot(savedReader, { push: fromSession }));
  } else { route("today", {}, { replace: true }); }
}
let _pendingY = null;   // Back-restore scroll target; async views (daf/parsha) re-apply it after their text hydrates
window.addEventListener("popstate", e => {
  const st = e.state, savedReader = normalizeReaderSnapshot(st?.reader);
  if (Reader.open) {   // Back closes the full-screen reader; if the pop went PAST the reader's own entry (multi-entry jump), fall through and apply it
    hideReader();
    if (st && st.route && st.depth === _navDepth && JSON.stringify(st.route) === JSON.stringify(State.route)) return;
  }
  // In-session State.sponsor is always at least as fresh as any history clone — never overwrite it here
  // (reload restoration is restoreInitialRoute's job); restoring a stale clone wiped the typed form.
  if (st && st.route && validRoute(st.route)) { State.route = st.route; _navDepth = st.depth || 0; }
  else {
    const deep = routeFromHash();   // a hand-edited #hash arrives as a null-state pop — honor it instead of falling home
    State.route = (deep && validRoute(deep)) ? deep : { name: "today" };
    _navDepth = 0;
    try { history.replaceState({ route: State.route, sponsor: State.sponsor, depth: 0 }, "", urlFor(State.route)); } catch {}   // stamp real state onto the bare entry
  }
  persistRoute();
  closeMenu();
  _pendingY = (st && typeof st.y === "number") ? st.y : 0;
  rerender({ skipSave: true });
  window.scrollTo(0, _pendingY);   // Back returns to the spot you left, not the top (async views re-apply after hydrate)
  updateBackBtn();
  if (savedReader) requestAnimationFrame(() => restoreReaderFromSnapshot(savedReader));
  else if (State.route.name !== "search") requestAnimationFrame(focusPrimaryHeading);
});
function focusPrimaryHeading() {
  const h = $("#view [role=heading][aria-level='1'], #view h1");
  if (!h) return;
  h.setAttribute("tabindex", "-1");
  try { h.focus({ preventScroll: true }); } catch { h.focus(); }
}
function pageTitle(r) {
  if (r.name === "daf") { const [m, d] = String(r.id || "").split("|"); return `${m || "Daf Yomi"} · Daf ${d || ""} · Rabbi Shea Stern`; }
  if (r.name === "parshaS") return `${pDisp(r.parsha)} · Chumash · Rabbi Shea Stern`;
  if (r.name === "masechta") return `${r.masechta} · Rabbi Shea Stern`;
  return "Rabbi Shea Stern · Daf Yomi";
}
function rerender({ skipSave = false } = {}) {
  const v = $("#view"); if (!v) return;
  resetGemaraFlipTransactions();                            // an old cold-load flip cannot own the newly routed reading surface
  clearPageMotions();                                        // a route/history swap always outranks decorative paper motion
  if (!skipSave) saveActiveReadingPosition();
  if (Player.isVideo) Player.hide();                         // an in-page video can't survive a view swap — save its spot and drop the bar
  $$("#view video").forEach(vid => { try { vid.pause(); vid.removeAttribute("src"); vid.load(); } catch {} });   // flush any in-page video before the view is replaced (no detached audio)
  resetReadMin();                                            // a fresh view starts with full top chrome
  const r = State.route;
  document.documentElement.classList.toggle("reading-view", r.name === "daf" || r.name === "parshaS");
  document.title = pageTitle(r);
  const fn = { today: viewToday, browse: viewBrowse, seder: viewSeder, masechta: viewMasechta, daf: viewDaf, topics: viewTopics, parsha: viewParsha, sefer: viewSefer, parshaS: viewParshaShiurim, holidays: viewHolidays, holiday: viewHoliday, category: viewCategory, search: viewSearch, mystuff: viewMyStuff, sponsor: viewSponsor, about: viewAbout, donate: viewDonate }[r.name] || viewToday;
  v.innerHTML = `<div class="view">${fn(r)}</div>`;
  wireView(r);
  if (r.name === "daf") {
    hydrateDaf();
    if (r.watch) {   // one-shot: start the video, then scrub the flag from route + history so Back/Forward can't re-trigger it
      const [mm, dd] = (r.id || "").split("|"); const pk = `daf:${mm}:${+dd}`, ov = adminPageMedia(pk);
      if (ov && ov.video) playOverride(pk, "video"); else { const s = shiurFor(mm, +dd); if (s) watchVideo(s.id); }
      delete State.route.watch;
      try { history.replaceState({ ...(history.state || {}), route: State.route }, "", urlFor(State.route)); } catch {}
      persistRoute();
    }
  }
  if (r.name === "parshaS") hydrateParsha();
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
    rows += `<button class="cont-row" data-play="${esc(lip.lec.id)}"><span class="cont-ic" aria-hidden="true">${svgPlay(13)}</span><span class="cont-main"><b>Resume ${esc(title)}</b><span class="cont-sub">picks up at ${clock(lip.pos.t)}</span></span></button>`;
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
  const tpk = `daf:${t.dy.masechta}:${t.dy.daf}`, tov = adminPageMedia(tpk);
  const tovA = tov && tov.audio ? adminMediaUrl(tov.audio.key) : "", tovV = tov && tov.video ? adminMediaUrl(tov.video.key) : "";
  const hasVid = tovV || (t.shiur && (t.shiur.ovVideo || t.shiur.localVideo || t.shiur.video));
  const listenBtn = tovA ? `<button class="btn solid" data-oplay="${esc(tpk)}">▶ Listen</button>` : (t.shiur ? `<button class="btn solid" data-play="${esc(t.shiur.id)}">▶ Listen</button>` : "");
  const actions = (listenBtn || hasVid)
    ? `${listenBtn}${hasVid ? `<button class="btn" data-watchdaf="${ref}"><span class="vic" aria-hidden="true">${svgVideo(15)}</span>Watch</button>` : ""}<button class="btn" data-daf="${ref}">Read the daf</button>`
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
        <button data-daf="${esc(tm.dy.masechta)}|${tm.dy.daf}" aria-label="Tomorrow — ${esc(tm.dy.he)} ${esc(heDaf(tm.dy.daf))}"><span class="adj-cap">Tomorrow</span><span class="adj-row"><span aria-hidden="true">‹ </span><span class="nm">${esc(tm.dy.he)} ${esc(heDaf(tm.dy.daf))}</span></span></button>
        <button data-daf="${esc(y.dy.masechta)}|${y.dy.daf}" aria-label="Yesterday — ${esc(y.dy.he)} ${esc(heDaf(y.dy.daf))}"><span class="adj-cap">Yesterday</span><span class="adj-row"><span class="nm">${esc(y.dy.he)} ${esc(heDaf(y.dy.daf))}</span><span aria-hidden="true"> ›</span></span></button>
      </div>
    </div>
    <nav class="navgrid" aria-label="Browse the library">
      <button class="ng" data-route="browse"><span class="ng-he" lang="he">גמרא</span><span class="ng-en">Browse Shas</span></button>
      <button class="ng" data-route="parsha"><span class="ng-he" lang="he">חומש</span><span class="ng-en">Parsha</span></button>
      <button class="ng" data-route="holidays"><span class="ng-he" lang="he">ימים טובים</span><span class="ng-en">Yomim Tovim</span></button>
      <button class="ng" data-route="topics"><span class="ng-he" lang="he">שיעורים</span><span class="ng-en">More Shiurim</span></button>
    </nav>
    ${continueCard()}
    ${recentSection()}
    ${moreSection()}
    <p class="center" style="margin:22px 0 6px"><button class="textlink" data-route="sponsor">✦ Sponsor a daf</button> <span class="muted" style="margin:0 8px">·</span> <button class="textlink" data-route="donate">Donate</button></p>`;
}
function recentSection() {
  const recent = State.all.filter(l => l._dk && l._dk.daf).slice(0, 5);
  if (!recent.length) return "";
  return `<div class="section" role="heading" aria-level="2">Recently given</div><div class="rows">${recent.map(l => rowHtml(l)).join("")}</div>
    <p class="center" style="margin-top:16px"><button class="textlink" data-route="browse">Browse all of Shas →</button></p>`;
}

/* ---------- single-column box navigation (drill-down: tap a box, the next
   level opens — one column on every screen, per the Rabbi's requested flow) ---------- */
// The round ‹ climbs one level of the hierarchy (browse → seder → masechta …),
// not browser history — pass the parent route as `up`; default stays chronological.
function boxHead(title, sub, latin, up) {
  const upAttr = up ? `data-goup="${esc(up[0])}" data-p="${esc(JSON.stringify(up[1] || {}))}"` : "data-goback";
  return `<div class="boxhead">
    <button class="boxback" ${upAttr} aria-label="Back">‹</button>
    <div class="boxhead-t"><div class="he${latin ? " latin" : ""}"${latin ? "" : ' lang="he"'} role="heading" aria-level="1">${title}</div>${sub ? `<div class="en">${esc(sub)}</div>` : ""}</div>
  </div>`;
}
const navBox = (attr, label, sub, cls = "") => {
  const latin = /\blatin\b/.test(cls);
  return `<button class="navbox${cls ? " " + cls : ""}" ${attr}><span class="nb-he"${latin ? "" : ' lang="he"'}>${label}</span>${sub ? `<span class="nb-sub">${sub}</span>` : ""}</button>`;
};

function viewBrowse() {
  const t = DY.dafForDate(new Date());
  return boxHead("ש״ס", "Browse Shas · one masechta at a time", false, ["today", {}]) +
    `<div class="boxcol">${DY.SEDARIM.map(s => {
    const mas = DY.masechtosInSeder(s.en);
    const total = mas.reduce((n, m) => n + countMasechta(m.en), 0);
    const isCur = t && mas.some(m => m.en === t.masechta);
    const sub = (isCur ? `<span class="nb-tag"><span lang="he">היום</span> · ${esc(t.masechta)} ${t.daf}</span> · ` : "") + (total ? `${total} shiurim` : "");
    return navBox(`data-seder="${esc(s.en)}"`, esc(s.he), sub);
  }).join("")}</div>`;
}
function countMasechta(en) { let n = 0; for (const [k, a] of State.byDaf) if (k.startsWith(en + "#")) n += a.length; return n; }
function countDafim(en) { let n = 0; for (const k of State.byDaf.keys()) if (k.startsWith(en + "#")) n++; return n; }   // distinct dafim given (a daf can have several shiurim)

function viewSeder(r) {
  const mas = DY.masechtosInSeder(r.seder);
  const t = DY.dafForDate(new Date());
  return crumbs([["Browse", "browse"]], esc(DY.sederHe(r.seder))) + boxHead(esc(DY.sederHe(r.seder)), "", false, ["browse", {}]) +
    `<div class="boxcol">${mas.map(m => {
      const n = countMasechta(m.en);
      const isCur = t && t.masechta === m.en;
      const sub = (isCur ? `<span class="nb-tag" lang="he">היום · דף ${t.daf}</span> · ` : "") + (n ? `${n} shiurim` : "");
      return navBox(`data-masechta="${esc(m.en)}"`, esc(m.he), sub, (n || isCur) ? "" : "empty");
    }).join("")}</div>`;
}

function viewMasechta(r) {
  const m = DY.BYEN[r.masechta];
  if (!m) return boxHead("—") + `<div class="empty-mini">That masechta isn't available.</div>`;
  const t = DY.dafForDate(new Date());
  const todayHere = t && t.masechta === m.en ? t.daf : 0;
  let rows = "";
  for (let d = m.firstDaf; d <= m.lastDaf; d++) {
    const shiur = shiurFor(m.en, d), lrn = isLearned(m.en, d);
    const pk = `daf:${m.en}:${d}`, ovm = adminPageMedia(pk);   // an admin page override outranks the catalog shiur, same as the daf page
    const ovA = ovm && ovm.audio ? adminMediaUrl(ovm.audio.key) : "";
    const meta = shiur ? [fmtDur(shiur.duration), gregOf(shiur.recorded || shiur.posted)].filter(Boolean).join(" · ")
      : ovA ? "the Rov's recording" : "read the daf";
    rows += `<div class="drow${shiur || ovA ? "" : " future"}${d === todayHere ? " is-today" : ""}" ${d === todayHere ? 'id="drow-today"' : ""}>
      <button class="drow-main" data-daf="${esc(m.en)}|${d}" aria-label="${esc(m.en)} Daf ${d}${shiur || ovA ? " — shiur available" : ""}${lrn ? ", learned" : ""}${d === todayHere ? ", today's daf" : ""}">
        <span class="rnum" aria-hidden="true">${esc(window.HebCal ? window.HebCal.gematria(d) : d)}</span>
        <span class="rmain"><b><span lang="he">דף ${esc(window.HebCal ? window.HebCal.gematria(d) : d)}</span> · Daf ${d}</b><span class="rmeta">${meta}</span></span>
        ${d === todayHere ? '<span class="drow-today">Today</span>' : ""}
        ${lrn ? '<span class="drow-chk" aria-hidden="true">✓</span>' : ""}
      </button>
      ${ovA ? `<button class="drow-play" data-oplay="${esc(pk)}" aria-label="Play ${esc(m.en)} Daf ${d}">${svgPlay(13)}</button>`
        : shiur ? `<button class="drow-play" data-play="${esc(shiur.id)}" aria-label="Play ${esc(m.en)} Daf ${d}">${svgPlay(13)}</button>`
        : `<span class="drow-read" aria-hidden="true">¶</span>`}
    </div>`;
  }
  const lrnN = learnedInMasechta(m.en);
  const tools = `<div class="mas-tools">
      ${todayHere ? `<button class="learn-toggle" data-scrolltoday><span lang="he">היום</span> — Daf ${todayHere}</button>` : ""}
      <span class="jump"><label for="jumpDaf">Jump to daf</label><input id="jumpDaf" type="number" inputmode="numeric" min="${m.firstDaf}" max="${m.lastDaf}" placeholder="${m.firstDaf}–${m.lastDaf}"><button class="btn sm" id="jumpGo">Go</button></span>
    </div>
    ${lrnN ? `<div class="mas-prog">${progressBar(lrnN, m.dapim, { label: "Learned in " + m.en })}</div>` : ""}`;
  return crumbs([["Browse", "browse"], [DY.sederHe(m.seder), "seder", { seder: m.seder }]], esc(m.he)) +
    boxHead(esc(m.he), `${m.en} · ${countDafim(m.en)} of ${m.dapim} dafim given`, false, ["seder", { seder: m.seder }]) +
    tools + `<div class="drows">${rows}</div>`;
}

// Display-mode labels, named by what they show (a first-time reader can't guess
// what "Daf" vs "עברית" means) — shared by the page toolbar and the reader bar.
const DAF_MODES = [["daf", '<span class="seg-he" lang="he">צורת הדף</span>'], ["he", '<span class="seg-he" lang="he">גמרא</span>'], ["en", "English"], ["both", '<span class="seg-he" lang="he">גמרא</span>·English']];
const modeSegHtml = (id, mode, attr) => `<span class="seg" id="${id}" role="group" aria-label="Daf display mode">${DAF_MODES.map(([x, lbl]) => `<button data-${attr}="${x}" class="${x === mode ? "on" : ""}" aria-pressed="${x === mode}"${x === "daf" ? ' title="The full printed page — Gemara with Rashi &amp; Tosafos"' : ""}>${lbl}</button>`).join("")}</span>`;
const dnLbl = (masechta, daf, dir) => { const nx = dafStep(masechta, daf, dir); return nx ? esc(window.HebCal ? window.HebCal.gematria(nx.daf) : nx.daf) : ""; };
function viewDaf(r) {
  if (!r.id || r.id.indexOf("|") < 0) return `<div class="empty-mini">Select a daf to read.</div>`;
  const [masechta, dafS] = r.id.split("|"); const daf = +dafS;
  const m = DY.BYEN[masechta], shiur = shiurFor(masechta, daf);
  const read = normalizeReadSnapshot(r.read), mode = read?.mode || r.mode || State._dafMode || "daf";
  const readMas = read?.masechta || masechta, readDaf = read?.daf || daf, readAmud = read?.amud || amudKeysFor(readMas, readDaf)[0];
  State._dafMode = mode; State._dafCol = read?.source || State._dafCol || "gemara";
  const heT = `${m ? m.he : masechta} ${heDaf(daf)}`;
  const lrn = isLearned(masechta, daf);
  const learnCtl = `<div class="daf-progress">
       <button class="learn-toggle ${lrn ? "on" : ""}" data-learn="${esc(masechta)}|${daf}" aria-pressed="${lrn}">${lrn ? "✓ Learned" : "Mark as learned"}</button>
       <span class="learn-meta">${esc(masechta)}: ${learnedInMasechta(masechta)} / ${m ? m.dapim : "?"} dapim learned</span>
     </div>`;
  const pk = `daf:${masechta}:${daf}`, ovm = adminPageMedia(pk);
  const ovA = ovm && ovm.audio ? adminMediaUrl(ovm.audio.key) : "", ovV = ovm && ovm.video ? adminMediaUrl(ovm.video.key) : "";
  const listenBtn = ovA ? `<button class="btn solid sm" data-oplay="${esc(pk)}">▶ Listen</button>`
    : (shiur ? `<button class="btn solid sm" data-play="${esc(shiur.id)}">▶ Listen</button>` : "");
  const watchBtn = ovV ? `<button class="btn sm" data-owatch="${esc(pk)}"><span class="vic" aria-hidden="true">${svgVideo(15)}</span>Watch</button>`
    : (shiur && (shiur.ovVideo || shiur.localVideo || shiur.video) ? `<button class="btn sm" data-watch="${esc(shiur.id)}"><span class="vic" aria-hidden="true">${svgVideo(15)}</span>Watch</button>` : "");
  const media = (listenBtn || watchBtn) ? `
    <div class="daf-media">
      ${listenBtn}${watchBtn}
      ${shiur ? `<button class="btn sm" id="dafFav" data-fav="${esc(shiur.id)}" aria-pressed="${isFav(shiur.id)}">${isFav(shiur.id) ? "★ Saved" : "☆ Save"}</button>` : ""}
    </div>
    <div id="videoSlot"></div>` : "";
  // A daf with no shiur yet: the daf itself leads; the sponsorship pitch is one quiet line.
  const ungivenNote = (shiur || ovA || ovV) ? "" :
    `<p class="center muted" style="font-size:14.5px;margin:10px 0 0">The shiur for this daf hasn't been given yet — the daf itself is below. <button class="textlink" data-sponsor-daf="${esc(masechta)}|${daf}">✦ Sponsor it</button></p>`;
  const sponsorLine = (shiur || ovA || ovV)
    ? `<p class="center" style="margin:16px 0 10px"><button class="textlink" data-sponsor-daf="${esc(masechta)}|${daf}">✦ Sponsor this daf</button> <span class="muted" style="margin:0 8px">·</span> <button class="textlink" data-share="${esc(masechta)}|${daf}">Share this daf</button></p>`
    : `<div class="sponsor-strip"><b>This daf is open for sponsorship.</b><div class="muted" style="font-size:14px;margin-top:4px">Dedicate it for a yahrtzeit or simcha — your dedication is learned by everyone.</div><button class="btn accent" data-sponsor-daf="${esc(masechta)}|${daf}">✦ Sponsor ${esc(masechta)} ${daf}</button></div>`;
  return crumbs([["Browse", "browse"], [DY.sederHe(m ? m.seder : ""), "seder", { seder: m ? m.seder : "" }], [m ? m.he : masechta, "masechta", { masechta }]], heDaf(daf)) +
    `<div class="daf-head">
       <div class="daf-daynav">
         <button class="daynav next" data-daynav="1" aria-label="Next daf — whole page" title="Next daf (whole page)"${dafStep(masechta, daf, 1) ? "" : " disabled"}>‹<span class="dn-t" lang="he">${dnLbl(masechta, daf, 1)}</span></button>
         <div class="daf-head-titles"><div class="he" lang="he" role="heading" aria-level="1">${esc(heT)}</div><div class="en">${esc(masechta)} · Daf ${daf}</div></div>
         <button class="daynav prev" data-daynav="-1" aria-label="Previous daf — whole page" title="Previous daf (whole page)"${dafStep(masechta, daf, -1) ? "" : " disabled"}><span class="dn-t" lang="he">${dnLbl(masechta, daf, -1)}</span>›</button>
       </div>
       ${shiur ? `<div class="meta">Given ${dateLine(shiur.recorded || shiur.posted)} · ${fmtDur(shiur.duration)}</div>` : ""}</div>
     ${media}${ungivenNote}
     <div class="daf-toolbar">
       ${modeSegHtml("dafMode", mode, "mode")}
       ${tsizeHtml()}
       <button class="fs-btn" id="dafFsBtn" aria-label="Read full screen" title="Read full screen — the daf fills the screen while the shiur keeps playing">${svgExpand(14)}<span class="fs-lbl">Full screen</span></button>
     </div>
     <div class="daf-read">
       <div id="dafText" role="region" aria-label="Daf text" aria-busy="true" aria-keyshortcuts="ArrowLeft ArrowRight" data-mas="${esc(readMas)}" data-daf="${readDaf}" data-amud="${esc(readAmud)}" data-mode="${mode}"><div class="daf-loading">Loading the daf…</div></div>
     </div>
     ${worksheetsHtml(pk)}${learnCtl}${sponsorLine}`;
}

// Build the inner HTML for one daf in a given mode — shared by the in-page
// reading region (#dafText) and the full-screen reader overlay.
async function dafBodyHtml(masechta, daf, mode, amud) {
  const keys = amudKeysFor(masechta, daf);
  const key = keys.indexOf(String(amud)) >= 0 ? String(amud) : keys[0];
  const textPromise = loadDafText(masechta);
  const commPromise = mode === "daf" ? loadDafComm(masechta) : Promise.resolve({});
  const data = await textPromise;
  if (!data) {
    const special = { Shekalim: "Shekalim is learned from the Talmud Yerushalmi, which isn't in the native reader yet.", Kinnim: "Kinnim is a Mishnah-only masechta — it has no Gemara text.", Middos: "Middos is a Mishnah-only masechta — it has no Gemara text." }[masechta];
    const reason = special || ((typeof navigator !== "undefined" && navigator.onLine === false) ? "You're offline — reconnect to load this daf's text." : "Native text for this masechta isn't available yet.");   // don't blame the masechta when it's really a connection drop
    return dafColHead(masechta, daf, key, { showSources: false }) + `<div class="empty-mini">${esc(reason)}</div>` + dafEndNav(masechta, daf, key);   // a text-less masechta still has the stable navigation rail
  }
  if (mode === "daf") {
    const facing = amudStep(masechta, daf, key, amudSide(key) === "left" ? -1 : 1);
    const [comm, facingData] = await Promise.all([
      commPromise,
      facing && facing.masechta !== masechta ? loadDafText(facing.masechta) : Promise.resolve(data),
    ]);
    return renderDafLayout(masechta, daf, key, data, comm, facingData) + dafEndNav(masechta, daf, key);
  }
  const seg = data[key];   // one amud at a time in every mode — the flip controls step leaf by leaf
  const html = seg ? `<div class="amud">${renderAmud(seg, mode)}</div>` : "";
  return dafColHead(masechta, daf, key, { showSources: false }) + (html || `<div class="empty-mini">This amud isn't available.</div>`) + dafEndNav(masechta, daf, key);
}
// A quiet catchword closes the paper. Navigation lives only in the stable rail
// above, so a repeated flip never chases a button to a new page height.
function dafEndNav(masechta, daf, amud) {
  return `<div class="daf-endmark" aria-hidden="true"><span>❦</span></div>`;
}
function syncControlState(current, next) {
  if (!current || !next) return;
  current.className = next.className;
  current.textContent = next.textContent;
  current.disabled = next.disabled;
  ["aria-label", "aria-pressed", "title"].forEach(name => {
    const value = next.getAttribute(name);
    if (value == null) current.removeAttribute(name); else current.setAttribute(name, value);
  });
}
function patchDafColHead(current, next) {
  if (!current || !next) return;
  current.className = next.className;
  current.setAttribute("aria-label", next.getAttribute("aria-label") || "Amud navigation");
  ["1", "-1"].forEach(dir => syncControlState(current.querySelector(`[data-gemflip="${dir}"]`), next.querySelector(`[data-gemflip="${dir}"]`)));
  [".daf-flip-lbl", ".folio-source-left", ".folio-source-right"].forEach(selector => {
    const a = current.querySelector(selector), b = next.querySelector(selector);
    if (!a || !b) return;
    const value = b.querySelector(".folio-current")?.textContent || "";
    const live = a.querySelector(".folio-current"); if (live) live.textContent = value;
    const aria = b.getAttribute("aria-label");
    if (aria == null) a.removeAttribute("aria-label"); else a.setAttribute("aria-label", aria);
  });
  const currentSources = current.querySelector(":scope > .daf-cols-row"), nextSources = next.querySelector(":scope > .daf-cols-row");
  if (currentSources && nextSources) {
    currentSources.setAttribute("aria-label", nextSources.getAttribute("aria-label") || "Daf column");
    DAF_COLS.forEach(([key]) => syncControlState(currentSources.querySelector(`[data-dcol="${key}"]`), nextSources.querySelector(`[data-dcol="${key}"]`)));
  } else if (!currentSources && nextSources) current.appendChild(nextSources);
  else if (currentSources && !nextSources) currentSources.remove();
}
// Keep the pager itself mounted while replacing the paper beneath it. This is
// more than visual stability: the activated button retains its DOM identity,
// focus, hit box, and keyboard relationship throughout every page transaction.
function commitDafBodyHtml(box, html) {
  const template = document.createElement("template"); template.innerHTML = html;
  const nextRail = [...template.content.children].find(node => node.matches(".daf-colhead")) || null;
  const currentRail = box.querySelector(":scope > .daf-colhead");
  if (!currentRail || !nextRail) { box.replaceChildren(template.content); return; }
  patchDafColHead(currentRail, nextRail);
  nextRail.remove();
  [...box.childNodes].forEach(node => { if (node !== currentRail) node.remove(); });
  box.append(template.content);
}
async function hydrateDaf(preparedHtml) {
  const box = $("#dafText"); if (!box) return false;
  const gen = (box._hydGen = (box._hydGen || 0) + 1);          // serialize overlapping hydrates
  box.setAttribute("aria-busy", "true");
  const html = preparedHtml == null ? await dafBodyHtml(box.dataset.mas, +box.dataset.daf, box.dataset.mode, box.dataset.amud) : preparedHtml;
  if (!box.isConnected || box._hydGen !== gen) return false;    // a newer flip superseded this one — drop the stale render
  commitDafBodyHtml(box, html);
  box.setAttribute("aria-busy", "false");
  box._renderedMas = box.dataset.mas; box._renderedDaf = box.dataset.daf; box._renderedAmud = box.dataset.amud; box._renderedMode = box.dataset.mode;   // committed screen identity (guards scroll/state saves during rapid flips)
  const dr = box.closest(".daf-read"); if (dr) dr.classList.toggle("has-spread", box.dataset.mode === "daf");   // wide breakout only for the printed-page layout
  sizeDafCarves(box); applyDafCol(box); attachDafSwipe(box);
  const hadPendingY = _pendingY != null;
  consumePendingY();
  if (hadPendingY) requestAnimationFrame(commitDafReadState); else commitDafReadState();
  return true;
}
// The interlocking engine. Every stream (gemara included) lives in a full-width
// container; the carve floats reserve exactly the regions where ANOTHER stream's
// text is still alive. Region rules at any height: three alive → column | gemara |
// column; a flank dies → the gemara widens into it; the gemara dies → the two
// commentaries split the page down the middle; one stream left → the full page.
// The "death" positions depend on each other (wider lines end sooner), so they're
// resolved as ordered events: the earliest text-end is exact under the current
// layout, so fix it, re-lay, and repeat — three passes, never a guess. Re-run on
// text scale, resize, and font load; a no-op on phones (carves display:none).
function sizeDafCarves(scope) {
  if (document.documentElement.classList.contains("is-phone")) return;
  (scope || document).querySelectorAll(".dafpage-grid.classic").forEach(g => {
    const cols = { gm: g.querySelector(".col.gemara"), ra: g.querySelector(".col.side.rashi"), to: g.querySelector(".col.side.tosafos") };
    if (!cols.gm || !cols.ra || !cols.to) return;
    const headH = parseFloat(getComputedStyle(cols.gm).marginTop) || 0;   // the header band (--dc-head, resolved)
    const BIG = 100000;
    const setH = (el, sel, h) => { const n = el.querySelector(sel); if (n) n.style.height = Math.max(0, Math.round(h)) + "px"; };
    const gTop = () => g.getBoundingClientRect().top;
    const endOf = el => {   // true text end: bottom of the last in-flow (non-carve) child
      let last = null;
      for (const ch of el.children) if (!/(^| )cv/.test(ch.className)) last = ch;
      return last ? last.getBoundingClientRect().bottom - gTop() : 0;
    };
    const D = { gm: BIG, ra: BIG, to: BIG };   // page-y where each stream's text dies
    const apply = () => {
      const sideRight = !!g.closest(".leaf-book.side-right");
      const right = sideRight ? "to" : "ra", left = sideRight ? "ra" : "to";
      setH(cols.gm, ".cvg.r", Math.min(D[right], D.gm) - headH);
      setH(cols.gm, ".cvg.l", Math.min(D[left], D.gm) - headH);
      setH(cols.ra, ".cv", Math.min(D.gm, D.ra) - headH);      // narrow column while the gemara lives
      setH(cols.to, ".cv", Math.min(D.gm, D.to) - headH);
      setH(cols.ra, ".cv2", Math.min(D.to, D.ra) - Math.min(D.gm, D.ra));   // half page while the other side lives on
      setH(cols.to, ".cv2", Math.min(D.ra, D.to) - Math.min(D.gm, D.to));
    };
    apply();                                                   // pass 1: all immortal → pure three-column
    const ends = { gm: endOf(cols.gm), ra: endOf(cols.ra), to: endOf(cols.to) };
    const first = ["gm", "ra", "to"].sort((a, b) => ends[a] - ends[b])[0];
    D[first] = ends[first];                                    // exact — nothing above it moved
    apply();                                                   // pass 2: the survivors widen below it
    const rest = ["gm", "ra", "to"].filter(k => k !== first);
    rest.forEach(k => { ends[k] = endOf(cols[k]); });
    rest.sort((a, b) => ends[a] - ends[b]);
    D[rest[0]] = ends[rest[0]];
    apply();                                                   // pass 3: the last survivor takes the rest
    D[rest[1]] = endOf(cols[rest[1]]);
    apply();                                                   // final: every carve clamped to a real text end
  });
}
// Back-restore scroll for the async views: the popstate scrollTo fires before the
// text exists, so the saved offset clamps — re-apply it once the content is tall.
function consumePendingY() {
  if (_pendingY == null || Reader.open) return;
  const y = _pendingY; _pendingY = null;
  requestAnimationFrame(() => { window.scrollTo(0, y); lockReadMin(y); });   // rAF lets layout settle; the lock keeps the phone chrome from flapping
}
/* ---------- amudim, as leaves of a real sefer ----------
   A daf is one LEAF. Amud א is its recto and sits on the LEFT page of an open
   spread; amud ב is the verso, on the RIGHT page. So א and ב are two sides of
   the same sheet (turning between them turns the leaf), while ב and the next
   daf's א face each other across the gutter (moving between them turns nothing
   — the book just shifts). Every transition animation follows from that. */
function amudKeysFor(masechta, daf) {
  const k = [daf + "a", daf + "b"];
  if (masechta === "Tamid" && daf === 26) k.unshift("25b");   // Tamid's opening Mishnah sits on Vilna 25b
  return k;
}
const amudLeaf = RM.amudLeaf;                                  // the sheet this amud is a side of
const amudSide = RM.amudSide;
// Step one amud, crossing daf and masechta boundaries in Shas order.
function amudStep(masechta, daf, amud, dir) {
  const keys = amudKeysFor(masechta, daf), i = keys.indexOf(String(amud)), j = i + dir;
  if (i >= 0 && j >= 0 && j < keys.length) return { masechta, daf, amud: keys[j] };
  const nx = dafStep(masechta, daf, dir); if (!nx) return null;
  const nk = amudKeysFor(nx.masechta, nx.daf);
  return { masechta: nx.masechta, daf: nx.daf, amud: dir > 0 ? nk[0] : nk[nk.length - 1] };
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
  const isTransition = raw => /^(?:\[?עד כאן פירוש|פירוש רבינו שמואל הרשב)/.test(String(raw || ""));
  const openingIndex = arr.findIndex(c => !isTransition(c));
  return arr.map((c, i) => {
    const raw = String(c || "");
    if (isTransition(raw)) {
      const note = raw.replace(/^\[/, "").replace(/\]$/, "");
      return `<p class="comm-transition" lang="he" dir="rtl" role="note">${esc(note)}</p>`;
    }
    const m = raw.match(/^([\s\S]*?)\s[-–]\s([\s\S]+)$/); // dibur hamatchil — explanation; real openings are not capped to an arbitrary length
    const isOpening = i === openingIndex, cls = isOpening ? "comm comm0" : "comm";
    const firstWord = text => {
      const p = String(text || "").match(/^(\s*)(\S+)([\s\S]*)$/);
      return p ? `${esc(p[1])}<span class="dh0">${esc(p[2])}</span>${esc(p[3])}` : esc(text);
    };
    if (!m) return `<p class="${cls}" lang="he" dir="rtl">${isOpening ? firstWord(raw) : esc(raw)}</p>`;
    const dh = isOpening ? firstWord(m[1]) : esc(m[1]); // every page's actual first commentary word gets the traditional square-letter opening
    return `<p class="${cls}" lang="he" dir="rtl"><b>${dh}</b> ${esc(m[2])}</p>`;
  }).join("");
}
// The operating folio header is the paper's sole running head. It stays outside
// the physical leaf so its title and buttons never turn, shift, or get cloned.
// The <i> carve spacers give each stream its printed shape. .cv keeps each
// commentary in its margin while Gemara runs; .cv2 keeps a half-page stream
// while the OTHER commentary continues beyond Gemara. The Gemara .cvg pair
// keeps it off each flank only while that flank is alive. All three sources
// begin together at the top, as on the Vilna page.
const CARVES = `<i class="cv" aria-hidden="true"></i><i class="cv2" aria-hidden="true"></i>`;
const GCARVES = `<i class="cvg r" aria-hidden="true"></i><i class="cvg l" aria-hidden="true"></i>`;
function dafPage(daf, amud, seg, c, sources) {
  const lines = (seg.he || "").split("\n").filter(Boolean);
  let gem = lines.map(safeHe).join("<br>");
  if (lines.length) {   // the amud's opening word in large square letters, as printed
    const first = lines[0], sp = first.indexOf(" "), w = sp > 0 ? first.slice(0, sp) : first;
    if (w.length <= 14) gem = `<span class="gm0">${safeHe(w)}</span>${sp > 0 ? " " + safeHe(first.slice(sp + 1)) : ""}` + (lines.length > 1 ? "<br>" + lines.slice(1).map(safeHe).join("<br>") : "");
  }
  return `<div class="dafpage">
    <div class="dafpage-grid classic">
      <section class="col side rashi" role="region" aria-label="${esc(sources?.labels?.rashi || "רש״י")}" lang="he" dir="rtl">${CARVES}<div class="col-h" lang="he">${esc(sources?.labels?.rashi || "רש״י")}</div>${commCol(c && c.r)}</section>
      <section class="col gemara" role="region" aria-label="Gemara" lang="he" dir="rtl">${GCARVES}<div class="col-h" lang="he">גמרא</div><div class="gem" lang="he" dir="rtl">${gem || '<div class="col-empty">—</div>'}</div></section>
      <section class="col side tosafos" role="region" aria-label="${esc(sources?.labels?.tosafos || "תוספות")}" lang="he" dir="rtl">${CARVES}<div class="col-h" lang="he">${esc(sources?.labels?.tosafos || "תוספות")}</div>${commCol(c && c.t)}</section>
    </div></div>`;
}
// One amud = one big page, exactly as it sits in the open sefer: amud א on the
// left of the gutter, amud ב on its right. The gutter shows the fold and a faded
// sliver of the page facing it across the seam — decorative only (it carries no
// scroll memory and nothing interactive).
function gutterHtml(facing, facingData) {
  let peek = "";
  const seg = facing && facingData && facingData[facing.amud];
  if (seg && seg.he) peek = safeHe(String(seg.he).replace(/\n/g, " ").slice(0, 700));
  return `<div class="leaf-gutter" aria-hidden="true"><div class="leaf-fold"></div><div class="leaf-peek"><div class="lp-txt" lang="he">${peek}</div></div></div>`;
}
function renderDafLayout(masechta, daf, key, data, comm, facingData) {
  comm = comm || {};
  const seg = data[key];
  if (!seg) return dafColHead(masechta, daf, key, { showSources: false }) + `<div class="empty-mini">This amud isn't available.</div>`;
  const pageComm = comm[key] || {};
  const sources = {
    showSources: true,
    labels: { tosafos: "תוספות", gemara: "גמרא", rashi: pageComm.rl || "רש״י" },
    available: { tosafos: !!pageComm.t?.length, gemara: true, rashi: !!pageComm.r?.length },
  };
  const side = amudSide(key);                                   // א → left page, ב → right page
  const facing = amudStep(masechta, daf, key, side === "left" ? -1 : 1);   // the page across the gutter
  const page = dafPage(daf, key, seg, pageComm, sources);
  return dafColHead(masechta, daf, key, sources) + `<div class="leaf-book side-${side}">${page}${gutterHtml(facing, facingData)}</div>`;
}

/* ---------- physical page motion ----------
   The operating rail is the fixed viewing frame. Only inert paper snapshots may
   move beneath it:

   TURN (א↔ב, the two faces of one leaf) is a genuine two-sided 180° leaf.
   Its free edge rises toward the reader, crosses the fold, and the incoming
   amud settles flat as the back face. The hinge travels to the opposite side so
   the fixed one-page viewport still follows the physical sefer.

   SHIFT (ב↔א, facing pages across a fold) turns nothing. Two opaque pages
   ride one track: the outgoing text leaves, the incoming text enters, and their
   shared spine moves exactly along the boundary between them. No crossfade means
   dense Hebrew never doubles into a blur.

   Both snapshots retain their own restored vertical offset. Reduced-motion skips
   the portal entirely and performs the same semantic navigation instantly. */
const pageMotionFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
function stripMotionClone(node) {
  const clone = node.cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
  clone.style.cssText += ";height:auto;overflow:visible;position:static;margin:0;width:100%;max-width:none;transform:none";
  return clone;
}
function capturePage(surface) {
  if (!surface?.isConnected) return null;
  try { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null; } catch {}
  const book = surface.querySelector(":scope > .leaf-book");
  const page = book?.querySelector(":scope > .dafpage") || surface.querySelector(":scope > .amud");
  if (!page) return null;
  const pageRect = page.getBoundingClientRect(), surfaceRect = surface.getBoundingClientRect();
  const railRect = surface.querySelector(":scope > .daf-colhead")?.getBoundingClientRect();
  const chromeFloor = railRect?.bottom > 0 ? railRect.bottom : Math.max(0, surfaceRect.top);
  const stageTop = Math.max(pageRect.top, chromeFloor);
  // The player paints above the paper portal. Let paper continue behind it so
  // the wider shoulders never turn into blank strips during motion.
  const stageBottom = Math.min(pageRect.bottom, surfaceRect.bottom, window.innerHeight || 800);
  if (pageRect.width < 80 || stageBottom - stageTop < 80) return null;
  const overlap = book ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--leaf-spine-overlap")) || 18) : 0;
  const gutter = book?.querySelector(":scope > .leaf-gutter"), gutterRect = gutter?.getBoundingClientRect();
  const sideClass = book?.classList.contains("side-right") || (!book && amudSide(surface.dataset.amud || Reader.amud) === "right") ? "side-right" : "side-left";
  const columnClass = ["col-gemara", "col-rashi", "col-tosafos"].find(c => surface.classList.contains(c)) || "";
  return {
    surface, page: stripMotionClone(page), pageRect, gutter: gutter ? stripMotionClone(gutter) : null, gutterRect,
    stageTop, stageBottom, stageLeft: pageRect.left - overlap, stageWidth: pageRect.width + overlap * 2,
    pageWidth: pageRect.width, overlap, sideClass, columnClass,
    hasSpread: !!surface.closest(".daf-read.has-spread"), inReader: Reader.open && surface.id === "rdBody",
  };
}
function pageMotionInner(frame, stageTop) {
  const inner = el("div", `pf-inner ${frame.sideClass}${frame.columnClass ? " " + frame.columnClass : ""}`);
  inner.style.cssText = `top:${frame.pageRect.top - stageTop}px;left:0;width:100%;transform:none;position:absolute`;
  inner.appendChild(frame.page);
  return inner;
}
function pageMotionSpineFace(frame, role, stageTop) {
  if (!frame.gutter || !frame.gutterRect) return null;
  const face = el("div", `pf-spine-face pf-spine-${role} ${frame.sideClass}`);
  face.style.cssText = `top:${frame.gutterRect.top - stageTop}px;height:${frame.gutterRect.height}px`;
  frame.gutter.style.cssText += ";display:block;position:static!important;inset:auto!important;width:100%;height:100%;margin:0";
  face.appendChild(frame.gutter);
  return face;
}
function captureFolioHeaderState(surface) {
  const rail = surface?.querySelector(":scope > .daf-colhead");
  const read = selector => rail?.querySelector(`${selector} .folio-current`)?.textContent || "";
  return rail ? { title: read(".daf-flip-lbl"), left: read(".folio-source-left"), right: read(".folio-source-right") } : null;
}
function prepareFolioHeaderSwap(tx, duration) {
  const old = tx?.outgoingHeader, rail = tx?.surface?.querySelector(":scope > .daf-colhead");
  if (!old || !rail) return;
  const slots = [[".daf-flip-lbl", old.title], [".folio-source-left", old.left], [".folio-source-right", old.right]];
  slots.forEach(([selector, value]) => {
    const slot = rail.querySelector(selector); if (!slot) return;
    const ghost = el("span", "folio-swap-old"); ghost.textContent = value; ghost.setAttribute("aria-hidden", "true");
    slot.appendChild(ghost);
  });
  rail.style.setProperty("--folio-swap-ms", `${duration}ms`);
  rail.classList.add("folio-swap-ready");
  tx.startHeaderSwap = () => { rail.classList.remove("folio-swap-ready"); rail.classList.add("folio-swapping"); };
  tx.headerCleanup = () => {
    rail.querySelectorAll(".folio-swap-old").forEach(node => node.remove());
    rail.classList.remove("folio-swap-ready", "folio-swapping"); rail.style.removeProperty("--folio-swap-ms");
  };
}
function clearPageMotions() {
  document.querySelectorAll(".pflip").forEach(n => typeof n._finish === "function" ? n._finish() : n.remove());
}
function beginPageFlip(surface, kind, outSide) {
  const outgoing = capturePage(surface); if (!outgoing) return null;
  clearPageMotions();
  const move = kind === "turn" ? (outSide === "left" ? "turn-r" : "turn-l")
                               : (outSide === "right" ? "shift-right" : "shift-left");
  const ov = el("div", `pflip ${move}${outgoing.inReader ? " in-reader" : ""}${outgoing.hasSpread ? " has-spread" : ""}`);
  ov.setAttribute("aria-hidden", "true"); ov.inert = true;
  ov.style.cssText = `top:${outgoing.stageTop}px;left:${outgoing.stageLeft}px;width:${outgoing.stageWidth}px;height:${outgoing.stageBottom - outgoing.stageTop}px`;
  ov.style.setProperty("--pf-page-width", `${outgoing.pageWidth}px`);
  ov.style.setProperty("--pf-page-inset", `${outgoing.overlap}px`);
  ov.style.setProperty("--pf-spine-start", `${outSide === "left" ? outgoing.pageWidth : 0}px`);
  ov.style.setProperty("--pf-perspective", `${Math.max(2800, Math.min(4200, outgoing.pageWidth * 3.25))}px`);

  const track = el("div", kind === "turn" ? "pf-turn-track pf-motion-driver" : "pf-shift-track pf-motion-driver");
  if (kind === "turn") {
    const lift = el("div", "pf-turn-lift"), leaf = el("div", "pf-turn-leaf"), front = el("div", "pf-face pf-front"), back = el("div", "pf-face pf-back");
    front.appendChild(pageMotionInner(outgoing, outgoing.stageTop));
    leaf.append(front, back); lift.appendChild(leaf); track.appendChild(lift); ov._incomingSlot = back;
    const cast = el("div", "pf-turn-cast"); track.appendChild(cast);
  } else {
    const oldSheet = el("div", "pf-sheet pf-outgoing"), newSheet = el("div", "pf-sheet pf-incoming");
    oldSheet.appendChild(pageMotionInner(outgoing, outgoing.stageTop));
    track.append(oldSheet, newSheet); ov._incomingSlot = newSheet;
  }
  if (outgoing.gutter) {
    const spine = el("div", "pf-spine"), oldFace = pageMotionSpineFace(outgoing, "old", outgoing.stageTop);
    if (oldFace) spine.appendChild(oldFace);
    track.appendChild(spine); ov._spine = spine;
  }
  ov.appendChild(track);
  const tx = {
    ov, surface, outgoing, kind, outSide, track, stageTop: outgoing.stageTop, stageBottom: outgoing.stageBottom,
    outgoingHeader: captureFolioHeaderState(surface), done: false, resolve: null,
  };
  const cleanup = () => {
    if (tx.done) return;
    tx.done = true;
    if (tx.onUserScroll) {
      window.removeEventListener("wheel", tx.onUserScroll, true);
      window.removeEventListener("touchmove", tx.onUserScroll, true);
      document.removeEventListener("keydown", tx.onScrollKey, true);
    }
    if (tx.headerCleanup) { tx.headerCleanup(); tx.headerCleanup = null; }
    ov.remove();
    if (surface._pageMotion === tx) { surface.classList.remove("page-motion-active"); surface._pageMotion = null; }
    const resolve = tx.resolve; tx.resolve = null; if (resolve) resolve();
  };
  tx.cleanup = cleanup; ov._finish = cleanup; surface._pageMotion = tx;
  // Reader motion belongs to the reader's own stacking context. The fixed
  // player is a later/higher sibling there, so its chrome remains solid while
  // the full-width paper continues moving beneath it.
  const host = outgoing.inReader ? surface.closest("#reader") : document.body;
  (host || document.body).appendChild(ov);
  surface.classList.add("page-motion-active");                 // keeps layout, but the portal now owns the visible paper
  return tx;
}
function clipPageMotion(tx, top, bottom) {
  if (!tx || bottom - top < 80) return false;
  tx.stageTop = top; tx.stageBottom = bottom;
  tx.ov.style.top = `${top}px`; tx.ov.style.height = `${bottom - top}px`;
  const oldInner = tx.ov.querySelector(".pf-front .pf-inner, .pf-outgoing .pf-inner");
  if (oldInner) oldInner.style.top = `${tx.outgoing.pageRect.top - top}px`;
  const oldSpine = tx.ov.querySelector(".pf-spine-old");
  if (oldSpine && tx.outgoing.gutterRect) oldSpine.style.top = `${tx.outgoing.gutterRect.top - top}px`;
  return true;
}
// Capture only after scroll restoration's rAF. This gives each face its own
// saved vertical position while the stationary old snapshot prevents a flash.
async function playPageFlip(tx, beforeStart) {
  // Reduced motion has no visual transaction, but the destination still needs
  // the same deterministic rail settlement as the animated path.
  if (!tx) { if (beforeStart) await beforeStart(); return; }
  const duration = tx.kind === "turn" ? 700 : 520;
  prepareFolioHeaderSwap(tx, duration);                         // old title stays painted while the incoming paper settles
  // Restore the destination and freeze the operating frame before sampling its
  // paper. This prevents a docked pager from jumping for the first few motion
  // frames when the new amud has a very different remembered scroll position.
  if (beforeStart) await beforeStart();
  await pageMotionFrame();
  if (tx.done || !tx.surface.isConnected || tx.surface._pageMotion !== tx) { tx.cleanup(); return; }
  // Sticky chrome can change on the restore frame. Clip before that frame is
  // painted, then wait once more for final paper/carve geometry.
  const interimRail = tx.surface.querySelector(":scope > .daf-colhead")?.getBoundingClientRect();
  const interimTop = Math.max(tx.outgoing.stageTop, interimRail?.bottom > 0 ? interimRail.bottom : tx.stageTop);
  if (!clipPageMotion(tx, interimTop, tx.outgoing.stageBottom)) { tx.cleanup(); return; }
  await pageMotionFrame();                                     // one paint applies scroll; the next settles sticky/carve geometry and its scroll event
  if (tx.done || !tx.surface.isConnected || tx.surface._pageMotion !== tx) { tx.cleanup(); return; }
  const incoming = capturePage(tx.surface);
  if (!incoming || Math.abs(incoming.pageWidth - tx.outgoing.pageWidth) > 2
      || Math.abs(incoming.pageRect.left - tx.outgoing.pageRect.left) > 2) { tx.cleanup(); return; }
  // Scroll restoration can expand/collapse sticky chrome. Re-clip the already
  // mounted old snapshot to the stricter of both rail ceilings before motion,
  // preserving its global text position while guaranteeing zero control overlap.
  const safeTop = Math.max(tx.outgoing.stageTop, incoming.stageTop);
  const safeBottom = Math.min(tx.outgoing.stageBottom, incoming.stageBottom);
  if (!clipPageMotion(tx, safeTop, safeBottom)) { tx.cleanup(); return; }
  tx.ov._incomingSlot.appendChild(pageMotionInner(incoming, safeTop));
  if (tx.ov._spine) {
    const newFace = pageMotionSpineFace(incoming, "new", safeTop);
    if (newFace) tx.ov._spine.appendChild(newFace);
  }
  _minLockUntil = Math.max(_minLockUntil, Date.now() + duration + 180);
  void tx.ov.offsetWidth;
  return new Promise(resolve => {
    tx.resolve = resolve;
    const finish = tx.cleanup;
    tx.track.addEventListener("animationend", finish, { once: true });
    tx.track.addEventListener("animationcancel", finish, { once: true });
    // Scroll events also fire for the destination amud's asynchronous memory
    // restore, so they cannot distinguish interruption from correct setup. Only
    // explicit human scroll intent cancels decoration; semantic page arrows stay
    // queued and every amud remains free to restore a very different saved spot.
    tx.onUserScroll = () => { tx.userInterrupted = true; finish(); };
    tx.onScrollKey = e => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) { tx.userInterrupted = true; finish(); } };
    window.addEventListener("wheel", tx.onUserScroll, { passive: true, capture: true });
    window.addEventListener("touchmove", tx.onUserScroll, { passive: true, capture: true });
    document.addEventListener("keydown", tx.onScrollKey, true);
    tx.startHeaderSwap?.(); tx.ov.classList.add("is-running");
    setTimeout(finish, duration + 260);                        // an interrupted CSS animation can never strand hidden live text
  });
}
/* Compact source selector: show one full-width stream at a time. These operating
   controls deliberately keep one fixed order; the paper's subtle running-head
   labels—not the buttons—swap to reflect its physical inner/outer margins. */
const DAF_COLS = [["tosafos", "תוספות"], ["gemara", "גמרא"], ["rashi", 'רש"י']];
const dafColIndex = k => DAF_COLS.findIndex(c => c[0] === k);
// Unified column title bar: the current column's name in the center (the title of
// what you're reading) flanked by the two columns you can switch to — all in the
// same serif as the page titles. It sticks to the top while you scroll; you can
// also swipe the daf left/right. Hidden on desktop, where all three show at once.
// The column-switcher row: all three names in their fixed printed-page order
// (תוספות · גמרא · רש"י) — they never move; only the highlight does. Selecting a
// column just lights it up, so the names stay put exactly where you tapped.
// The parsha page keeps its own column choice (State._parCol) — "Rashi" there is a
// different physical column than on the daf, so the two views must not share state.
const isTorahBox = box => !!box && (box.id === "parshaText" || box.dataset.readerKind === "torah");
const activeTorahBox = () => Reader.open && Reader.kind === "torah" ? $("#rdBody") : $("#parshaText");
const parshaColActive = () => !!activeTorahBox();
const activeTorahSource = () => Reader.open && Reader.kind === "torah" ? (Reader.source || "gemara") : (State._parCol || "gemara");
const activeReadingSource = () => parshaColActive() ? activeTorahSource() : (State._dafCol || "gemara");
function dafColsInner(labels, curCol, available, ariaLabels) {
  const cur = curCol || "gemara";
  return DAF_COLS.map(([key, name]) => {
    const on = key === cur, enabled = !available || available[key] !== false;
    const label = (labels && labels[key]) || name;
    const aria = (ariaLabels && ariaLabels[key]) || label;
    return `<button data-dcol="${key}" aria-pressed="${on}" aria-label="${esc(aria)}${enabled ? "" : " — unavailable on this amud"}" class="col-tab${on ? " on" : ""}"${enabled ? "" : ' disabled title="Unavailable on this amud"'}>${esc(label)}</button>`;
  }).join("");
}
function dafColHead(masechta, daf, amud, sources) {
  const key = amud || amudKeysFor(masechta, daf)[0];
  const dest = d => amudStep(masechta, daf, key, d);
  const dis = d => dest(d) ? "" : " disabled";
  const aria = (d, word) => { const x = dest(d); return x ? `${word}: ${x.masechta} ${amudLeaf(x.amud)}${amudSide(x.amud) === "right" ? "b" : "a"}` : word; };
  const dafLbl = `${DY.BYEN[masechta] ? DY.BYEN[masechta].he : masechta} ${heAmud(amudLeaf(key), key)}`;
  const side = amudSide(key);
  const sourceLabel = name => sources?.showSources === false || sources?.available?.[name] === false ? "" : (sources?.labels?.[name] || (name === "rashi" ? "רש״י" : "תוספות"));
  const leftSource = side === "left" ? sourceLabel("tosafos") : sourceLabel("rashi");
  const rightSource = side === "left" ? sourceLabel("rashi") : sourceLabel("tosafos");
  return `<nav class="daf-colhead side-${side}" aria-label="Amud navigation">
    <span class="folio-source folio-source-left" lang="he" aria-hidden="true"><span class="folio-current">${esc(leftSource)}</span></span>
    <div class="daf-flip-row">
      <button class="pageflip next" data-gemflip="1" aria-label="${esc(aria(1, "Next amud"))}" title="Next amud"${dis(1)}>‹</button>
      <span class="daf-flip-lbl" lang="he" role="heading" aria-level="2" aria-label="${esc(dafLbl)}"><span class="folio-current">${esc(dafLbl)}</span></span>
      <button class="pageflip prev" data-gemflip="-1" aria-label="${esc(aria(-1, "Previous amud"))}" title="Previous amud"${dis(-1)}>›</button>
    </div>
    <span class="folio-source folio-source-right" lang="he" aria-hidden="true"><span class="folio-current">${esc(rightSource)}</span></span>
    ${sources?.showSources === false ? "" : `<div class="daf-cols-row" role="group" aria-label="Daf column — tap a name or swipe">${dafColsInner(sources?.labels, State._dafCol, sources?.available)}</div>`}
  </nav>`;
}
function applyDafCol(box) {        // reflect the chosen column as a class on the container (per-view choice)
  if (!box) return;
  const torah = isTorahBox(box);
  const desired = box.dataset.readerKind === "torah" ? (Reader.source || "gemara") : (State._parCol || "gemara");
  let col = (torah ? (box.dataset.mode === "he" ? "gemara" : desired) : State._dafCol) || "gemara";
  const chosen = box.querySelector(`.col-tab[data-dcol="${col}"]`);
  if (chosen?.disabled) {                                             // never strand a compact reader on an unavailable commentary stream
    col = "gemara";
  }
  ["gemara", "rashi", "tosafos"].forEach(c => box.classList.toggle("col-" + c, c === col));
  box.querySelectorAll(".col-tab").forEach(t => { const on = t.dataset.dcol === col; t.classList.toggle("on", on); t.setAttribute("aria-pressed", on ? "true" : "false"); });
}
function selectDafCol(col, pointerIntent) {
  clearPageMotions();                                        // source text may change immediately; never leave a stale paper portal above it
  const torahReader = Reader.open && Reader.kind === "torah", torah = parshaColActive();
  const old = torah ? activeTorahSource() : (State._dafCol || "gemara");
  if (col === old) return;
  const intent = pointerIntent || pagerIntent(), fallbackY = intent.fallbackY, anchor = parshaScrollAnchor(activeTorahBox());
  saveColScroll(old);                                 // remember where we were in the column we're leaving
  holdPagerIntent(intent);
  if (torahReader) { Reader.source = col; Reader._sourceChanged = true; }
  else if (torah) State._parCol = col;
  else State._dafCol = col;
  const apply = box => {
    if (!box) return;
    applyDafCol(box);
    const row = box.querySelector(".daf-cols-row");   // names stay fixed — just move the highlight to the selected one
    if (row) row.querySelectorAll(".col-tab").forEach(t => {
      const on = t.dataset.dcol === col;
      t.classList.toggle("on", on); t.setAttribute("aria-pressed", on ? "true" : "false");
    });
    restartAnim(box, "col-switched");                 // gentle fade-in of the new column's text
  };
  apply($("#dafText"));
  apply($("#parshaText"));                            // the parsha page shares the column machinery
  if (Reader.open) apply($("#rdBody"));
  restoreColScroll(col, false, fallbackY, anchor, intent.preserveRail, true, intent); // the source changes, never the rail's viewport position
  const activeSurface = Reader.open ? $("#rdBody") : ($("#parshaText") || $("#dafText"));
  if (!torah) void settlePagerIntent(activeSurface, intent, () => activeSurface?.isConnected);
  requestAnimationFrame(() => {
    if (Reader.open) { if (Reader.kind === "daf") commitDafReadState(); else commitReaderHistoryState(); }
    else if (State.route?.name === "daf") commitDafReadState();
    else if (State.route?.name === "parshaS") commitTorahReadState();
  });
}
function restartAnim(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
// Per-column scroll memory so switching back and forth keeps your place in each
// column. Keyed by view + daf + column, so a different daf starts fresh.
function dafScrollEl() { return Reader.open ? $("#rdBody") : null; }   // null → the window scrolls
function curDafScroll() { const el = dafScrollEl(); return el ? el.scrollTop : (window.scrollY || 0); }
function setDafScroll(y) { const el = dafScrollEl(); if (el) el.scrollTop = y; else window.scrollTo(0, y); }
function colScrollKey(col) {   // every physical side, display mode, and source owns its position
  if (Reader.open && Reader.kind === "torah") return `tr:${Reader.sefer}:${Reader.parsha}:${Reader.mode}:${col}`;
  if (Reader.open) return `r:${Reader.masechta}:${Reader.amud || Reader.daf}:${Reader.mode}:${col}`;
  const pb = $("#parshaText"); if (pb) return `pp:${pb.dataset.sefer}:${pb.dataset.parsha}:${pb.dataset.mode}:${col}`;
  const b = $("#dafText"); return `p:${b ? b.dataset.mas : ""}:${b ? (b.dataset.amud || b.dataset.daf) : ""}:${b ? b.dataset.mode : ""}:${col}`;
}
function ensureColScroll() {
  if (State._colScroll) return State._colScroll;
  try { State._colScroll = JSON.parse(sessionStorage.getItem("dy_reader_positions_v2") || "{}") || {}; }
  catch { State._colScroll = {}; }
  return State._colScroll;
}
function persistColScroll() {
  const all = ensureColScroll(), entries = Object.entries(all).sort((a, b) => (+b[1]?.at || 0) - (+a[1]?.at || 0)).slice(0, 160);
  State._colScroll = Object.fromEntries(entries);
  try { sessionStorage.setItem("dy_reader_positions_v2", JSON.stringify(State._colScroll)); } catch {}
}
function parshaReadingTop(box) {
  if (!box) return 0;
  const h = box.querySelector(".parsha-colhead"), r = h?.getBoundingClientRect();
  return Math.max(0, r && r.bottom > 0 ? r.bottom : 0) + 8;
}
function parshaScrollAnchor(box) {
  if (!box || !box.querySelector(".torah-verse")) return null;
  const top = parshaReadingTop(box), probe = top + 2, rows = [...box.querySelectorAll(".torah-verse")];
  const hit = document.elementFromPoint(Math.min(window.innerWidth - 1, window.innerWidth / 2), Math.min(window.innerHeight - 1, probe));
  const row = hit?.closest(".torah-verse") || rows.find(n => n.getBoundingClientRect().bottom > probe) || rows[rows.length - 1];
  if (!row) return null;
  const rect = row.getBoundingClientRect(), offset = rect.top - top;
  return { ref: row.dataset.ref, offset, progress: rect.height > 0 ? Math.max(0, Math.min(1, -offset / rect.height)) : 0 };
}
function dafPaperScrollAnchor(box) {
  if (!box || activeTorahBox()) return null;
  const paper = box.querySelector(":scope > .leaf-book > .dafpage, :scope > .amud");
  const rail = box.querySelector(":scope > .daf-colhead");
  if (!paper || !rail) return null;
  const pageRect = paper.getBoundingClientRect(), railRect = rail.getBoundingClientRect();
  return { paperOffset: Math.max(0, railRect.bottom - pageRect.top) };
}
function visibleTorahVerse(box, ref) {
  const rows = [...box.querySelectorAll(".torah-verse")], exact = rows.find(n => n.dataset.ref === ref);
  const visible = n => { const r = n?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; };
  if (visible(exact)) return exact;
  const at = Math.max(0, rows.indexOf(exact));
  for (let distance = 1; distance < rows.length; distance++) {
    if (visible(rows[at + distance])) return rows[at + distance];
    if (visible(rows[at - distance])) return rows[at - distance];
  }
  return null;
}
function saveColScroll(col) {
  const all = ensureColScroll(), pb = activeTorahBox(), anchor = parshaScrollAnchor(pb);
  const dafAnchor = pb ? null : dafPaperScrollAnchor(Reader.open ? $("#rdBody") : $("#dafText"));
  let key = colScrollKey(col || "gemara");
  if (Reader.open && Reader.kind === "daf" && Reader._renderedM && Reader._renderedD)
    key = `r:${Reader._renderedM}:${Reader._renderedD}:${Reader._renderedMode || Reader.mode}:${col || "gemara"}`;
  else {
    const b = $("#dafText");
    if (b?._renderedMas && b._renderedAmud)
      key = `p:${b._renderedMas}:${b._renderedAmud}:${b._renderedMode || b.dataset.mode}:${col || "gemara"}`;
  }
  all[key] = { y: curDafScroll(), ...(anchor || {}), ...(dafAnchor || {}), at: Date.now() };
  persistColScroll();
}
function committedDafSnapshot() {
  if (Reader.open && Reader.kind === "daf") {
    const masechta = Reader._renderedM || Reader.masechta, amud = Reader._renderedD || Reader.amud;
    const daf = +(Reader._renderedN || Reader.daf), mode = Reader._renderedMode || Reader.mode;
    return normalizeReadSnapshot({ masechta, daf, amud, mode, source: State._dafCol, y: curDafScroll() });
  }
  const box = $("#dafText"); if (!box) return null;
  return normalizeReadSnapshot({
    masechta: box._renderedMas || box.dataset.mas,
    daf: +(box._renderedDaf || box.dataset.daf),
    amud: box._renderedAmud || box.dataset.amud,
    mode: box._renderedMode || box.dataset.mode,
    source: State._dafCol,
    y: window.scrollY || 0,
  });
}
function readerHistorySnapshot() {
  if (!Reader.open) return null;
  if (Reader.kind === "daf") { const read = committedDafSnapshot(); return read ? { kind: "daf", read } : null; }
  if (Reader.kind === "torah") return {
    kind: "torah", sefer: Reader.sefer, parsha: Reader.parsha, mode: Reader.mode,
    inlineMode: Reader.inlineMode || "daf", source: Reader.source || "gemara", sourceChanged: !!Reader._sourceChanged, y: curDafScroll(),
    anchor: parshaScrollAnchor($("#rdBody")),
  };
  return null;
}
function commitReaderHistoryState() {
  if (!Reader.open) return;
  try { history.replaceState({ ...(history.state || {}), reader: readerHistorySnapshot() }, ""); } catch {}
  persistRoute();
}
function commitDafReadState() {
  const read = committedDafSnapshot(); if (!read) return;
  if (Reader.open && Reader.kind === "daf") {
    try { history.replaceState({ ...(history.state || {}), reader: { kind: "daf", read } }, "", urlFor({ ...State.route, read })); } catch {}
  } else if (!Reader.open && State.route?.name === "daf") {
    State.route = { ...State.route, read };
    try { history.replaceState({ ...(history.state || {}), route: State.route, sponsor: State.sponsor, depth: _navDepth, y: window.scrollY || 0 }, "", urlFor(State.route)); } catch {}
  }
  persistRoute();
}
function commitTorahReadState() {
  if (Reader.open) { if (Reader.kind === "torah") commitReaderHistoryState(); return; }
  const box = $("#parshaText"); if (!box || State.route?.name !== "parshaS") return;
  const torah = normalizeTorahSnapshot({ mode: box.dataset.mode, source: State._parCol, y: window.scrollY || 0, anchor: parshaScrollAnchor(box) });
  State.route = { ...State.route, torah };
  try { history.replaceState({ ...(history.state || {}), route: State.route, sponsor: State.sponsor, depth: _navDepth, y: window.scrollY || 0 }, "", urlFor(State.route)); } catch {}
  persistRoute();
}
function saveActiveReadingPosition() {
  if (Reader.open) {
    saveColScroll(Reader.kind === "torah" ? (Reader.source || "gemara") : (State._dafCol || "gemara"));
    if (Reader.kind === "daf") commitDafReadState(); else commitReaderHistoryState();
    return;
  }
  if ($("#parshaText")) { saveColScroll(State._parCol || "gemara"); commitTorahReadState(); return; }
  if ($("#dafText")) { saveColScroll(State._dafCol || "gemara"); commitDafReadState(); }
}
function commitRestoredReadingState() {
  if (Reader.open) {
    if (Reader.kind === "daf") commitDafReadState();
    else if (Reader.kind === "torah") commitReaderHistoryState();
  } else if (State.route?.name === "daf") commitDafReadState();
  else if (State.route?.name === "parshaS") commitTorahReadState();
}
// "The top of this daf" for the active scroller: the reader body scrolls to 0;
// the in-page view scrolls so the daf reading region sits just under the bar.
function dafTopScroll() {
  if (Reader.open) return 0;
  const box = $("#dafText"); if (!box) return 0;
  // collapsed chrome → the bar is hidden and the colhead pins at the very top, so the
  // "ceiling" sits a bar-height higher; measure accordingly
  const min = document.documentElement.classList.contains("dy-min");
  const barH = min ? 0 : (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 0);
  return Math.max(0, Math.ceil((window.scrollY || 0) + box.getBoundingClientRect().top - barH));
}
function pagerStickyViewportTop(rail) {
  if (!rail) return 0;
  const offset = parseFloat(getComputedStyle(rail).top) || 0;
  const scroller = rail.closest(".reader-body");
  if (!scroller) return offset;
  const pad = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
  return scroller.getBoundingClientRect().top + pad + offset;
}
function holdPagerIntent(intent) {
  if (!intent) return;
  if (typeof intent.minimized === "boolean" && !Reader.open)
    document.documentElement.classList.toggle("dy-min", intent.minimized);
  lockReadMin(curDafScroll());
}
function enforceDockedPager(surface, intent) {
  if (!surface || !intent?.docked || activeTorahBox()) return;
  if (typeof intent.minimized === "boolean" && !Reader.open)
    document.documentElement.classList.toggle("dy-min", intent.minimized);
  const rail = surface.querySelector(":scope > .daf-colhead"); if (!rail) return;
  const delta = rail.getBoundingClientRect().top - pagerStickyViewportTop(rail);
  if (delta > .5) setDafScroll(curDafScroll() + Math.ceil(delta));
}
async function settlePagerIntent(surface, intent, isCurrent) {
  if (!surface || !intent) return;
  for (let frame = 0; frame < 3; frame++) {
    if (!surface.isConnected || (isCurrent && !isCurrent())) return;
    holdPagerIntent(intent); enforceDockedPager(surface, intent); lockReadMin(curDafScroll());
    if (frame < 2) await pageMotionFrame();
  }
  if (!isCurrent || isCurrent()) commitRestoredReadingState();
}
// Restore a remembered spot for this daf+column. On a plain column switch we stay
// put when the column hasn't been seen; on a page flip (toTopIfUnseen) an unseen
// daf starts at its top instead of inheriting the previous page's scroll.
function restoreColScroll(col, toTopIfUnseen, fallbackY, fallbackAnchor, preferFallback, preferSavedSameRef = false, railIntent = null) {
  const saved = ensureColScroll()[colScrollKey(col || "gemara")];
  const wasReaderOpen = Reader.open, surface = Reader.open ? $("#rdBody") : ($("#parshaText") || $("#dafText"));
  const identity = () => Reader.open
    ? `${Reader.kind}|${Reader.masechta || ""}|${Reader.daf || ""}|${Reader.amud || ""}|${Reader.sefer || ""}|${Reader.parsha || ""}|${Reader.mode || ""}`
    : `${surface?.id || ""}|${surface?.dataset.mas || ""}|${surface?.dataset.daf || ""}|${surface?.dataset.amud || ""}|${surface?.dataset.sefer || ""}|${surface?.dataset.parsha || ""}|${surface?.dataset.mode || ""}`;
  const expectedIdentity = identity(), restoreGen = surface ? (surface._scrollRestoreGen = (surface._scrollRestoreGen || 0) + 1) : 0;
  const surfaceIsCurrent = () => Reader.open === wasReaderOpen && !!surface?.isConnected
    && (Reader.open ? $("#rdBody") : ($("#parshaText") || $("#dafText"))) === surface
    && surface._scrollRestoreGen === restoreGen && identity() === expectedIdentity;
  // When the operating rail has not docked yet, its exact viewport position is
  // the invariant—not the destination amud's remembered scroll. Pin it once
  // immediately after the DOM swap and once on the next paint; this also covers
  // keyboard activation, where there is no pointer event to hold the surface.
  const pinSurface = preferFallback && fallbackY != null && !fallbackAnchor && !activeTorahBox();
  if (pinSurface) {
    const target = Math.max(0, fallbackY);
    setDafScroll(target); enforceDockedPager(surface, railIntent); lockReadMin(curDafScroll());
    commitRestoredReadingState();
    requestAnimationFrame(() => {
      if (!surfaceIsCurrent()) return;
      setDafScroll(target); enforceDockedPager(surface, railIntent); lockReadMin(curDafScroll());
      commitRestoredReadingState();
    });
    return;
  }
  requestAnimationFrame(() => {
    if (!surfaceIsCurrent()) return;                            // route/mode/reader changed within the frame — this target belongs to the superseded surface
    // A direct Torah source switch follows the verse the reader can see. A saved
    // position is used for reopen/mode restoration, but never yanks this switch
    // away from the current semantic reference.
    const savedAnchor = saved && saved.ref ? saved : null;
    const anchor = preferSavedSameRef && savedAnchor?.ref === fallbackAnchor?.ref ? savedAnchor : (fallbackAnchor || savedAnchor);
    const pb = activeTorahBox();
    if (pb && anchor?.ref) {
      const target = visibleTorahVerse(pb, anchor.ref);
      if (target) {
        const rect = target.getBoundingClientRect(), same = target.dataset.ref === anchor.ref;
        const offset = same && Number.isFinite(+anchor.progress) && +anchor.progress > 0
          ? -Math.min(Math.max(0, Math.min(1, +anchor.progress)) * rect.height, Math.max(0, rect.height - 3))
          : (same ? (anchor.offset || 0) : 0);
        const delta = rect.top - parshaReadingTop(pb) - offset;
        setDafScroll(curDafScroll() + delta); lockReadMin(curDafScroll()); commitRestoredReadingState(); return;
      }
    }
    const ceil = dafTopScroll();                               // the sticky-header "ceiling" (column top, header pinned)
    let target = null;
    const savedY = typeof saved === "number" ? saved : saved?.y;
    const savedPaperOffset = Number.isFinite(+saved?.paperOffset) ? Math.max(0, +saved.paperOffset) : null;
    // When a reader flips before the rail has reached its sticky position, the
    // operating buttons must remain under the pointer. Restoring the new amud's
    // top here would pull that rail up to the header and make it look as though
    // the control jumped. Preserve the surface offset for this one case; once
    // the rail is docked, normal per-amud memory remains authoritative.
    if (preferFallback && fallbackY != null) target = Math.max(0, fallbackY);
    else if (savedPaperOffset != null && !activeTorahBox()) {
      const paper = surface?.querySelector(":scope > .leaf-book > .dafpage, :scope > .amud");
      const rail = surface?.querySelector(":scope > .daf-colhead");
      if (paper && rail) target = Math.max(0, curDafScroll() + paper.getBoundingClientRect().top + savedPaperOffset - rail.getBoundingClientRect().bottom);
    }
    else if (savedY != null) target = Math.max(savedY, ceil);  // restore a remembered spot — but never above the ceiling
    else if (toTopIfUnseen) target = ceil;                    // page-flip into an unseen daf → its top
    else if (fallbackY != null) target = Math.max(fallbackY, ceil);
    else if (curDafScroll() < ceil) target = ceil;            // column switch, first view → snap down, never above the ceiling
    if (target != null) setDafScroll(target);
    enforceDockedPager(surface, railIntent);
    if (target != null || railIntent?.docked) { lockReadMin(curDafScroll()); commitRestoredReadingState(); }   // this programmatic scroll must NOT flip the header open/closed
  });
}

/* ---------- collapse the top chrome while reading ----------
   Scrolling DOWN hides the site bar; scrolling UP — or returning to the top —
   brings it back. The complete operating rail (amud arrows and source tabs)
   stays available and stationary; only the surrounding site chrome collapses. */
let _lastReadY = 0, _minLockUntil = 0, _readPersistTimer = 0;
function resetReadMin() { document.documentElement.classList.remove("dy-min"); _lastReadY = 0; _minLockUntil = 0; }
// Pin the collapse state across a programmatic scroll (page flip / column switch) so
// pagination never slides the app bar open or closed — that toggle is the user's
// own scrolling only.
function lockReadMin(y) { _minLockUntil = Date.now() + 450; if (typeof y === "number") _lastReadY = y; }
function onReadScroll() {
  const html = document.documentElement;
  const onRead = Reader.open || (State.route && (State.route.name === "daf" || State.route.name === "parshaS"));
  if (!onRead) { html.classList.remove("dy-min"); _lastReadY = 0; return; }
  const y = Reader.open ? ($("#rdBody") ? $("#rdBody").scrollTop : 0) : (window.scrollY || 0);
  const now = Date.now(), min = html.classList.contains("dy-min");
  if (now < _minLockUntil) { _lastReadY = y; return; }       // brief settle window after a toggle — avoids reflow-induced flapping
  let changed = false;
  if (y <= 60) { if (min) { html.classList.remove("dy-min"); changed = true; } }                  // near the top → full chrome
  else if (y > _lastReadY + 6) { if (!min) { html.classList.add("dy-min"); changed = true; } }     // moving down → minimize
  else if (y < _lastReadY - 6) { if (min) { html.classList.remove("dy-min"); changed = true; } }   // moving up → restore
  if (changed) _minLockUntil = now + 350;
  _lastReadY = y;
  if (State.route?.name === "parshaS" || (Reader.open && Reader.kind === "torah")) syncParshaChapterNav();
  clearTimeout(_readPersistTimer);
  _readPersistTimer = setTimeout(saveActiveReadingPosition, 240);
}
// Switch columns by swiping the daf: swipe content left → reveal the column to the
// right, and vice-versa. Clamped to the three columns; only the single-column
// phone layout is affected (desktop shows all three side-by-side).
function swipeDafCol(dir) {
  const ci = dafColIndex(activeReadingSource());
  const ni = Math.max(0, Math.min(DAF_COLS.length - 1, ci + dir));
  if (ni !== ci) selectDafCol(DAF_COLS[ni][0]);
}
function attachDafSwipe(box) {
  if (!box || box._dafSwipe) return; box._dafSwipe = true;
  let x0 = 0, y0 = 0, t0 = 0, valid = false;
  box.addEventListener("touchstart", e => {
    const t = e.changedTouches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    valid = x0 > 24 && x0 < (window.innerWidth || 0) - 24;       // preserve native browser edge gestures
  }, { passive: true });
  box.addEventListener("touchend", e => {
    if (!valid) return; valid = false;
    if (!document.documentElement.classList.contains("is-phone")) return;     // one column shows only in the phone layout
    if (!box.querySelector(".dafpage-grid, .torah-page")) return;     // printed Daf or aligned Torah source page
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4 || Date.now() - t0 > 700) return;   // deliberate horizontal flick
    swipeDafCol(dx < 0 ? 1 : -1);
  }, { passive: true });
  box.addEventListener("touchcancel", () => { valid = false; }, { passive: true });
  if (box.id === "rdBody") box.addEventListener("scroll", onReadScroll, { passive: true });   // the reader body scrolls itself
}

function renderAmud(seg, mode) {
  const he = (seg.he || "").split("\n").filter(Boolean), en = (seg.en || "").split("\n").filter(Boolean);
  if (mode === "he") return `<div class="daf-he" lang="he">${he.map(safeHe).join("<br>")}</div>`;
  if (mode === "en") return `<div class="daf-en" lang="en" dir="ltr">${en.map(safeEn).join("<br>")}</div>`;
  // both: interleave by segment if counts align, else stacked blocks
  if (he.length === en.length && he.length) return he.map((h, i) => `<div class="seg-pair"><div class="daf-he" lang="he" dir="rtl">${safeHe(h)}</div><div class="daf-en" lang="en" dir="ltr">${safeEn(en[i])}</div></div>`).join("");
  return `<div class="daf-he" lang="he" dir="rtl">${he.map(safeHe).join("<br>")}</div><hr class="rule thin"><div class="daf-en" lang="en" dir="ltr">${en.map(safeEn).join("<br>")}</div>`;
}

/* ---------- two navigation layers ----------
   1. The fixed rail above the paper flips ONLY the daf/gemara reading region in
      place — the paper canvas and the shiur above it stay put.
   2. The lecture-header arrows navigate the WHOLE page to the previous / next
      daf, including its recording and supporting material. */
let _gemaraFlipBusy = false, _gemaraFlipQueue = [], _gemaraFlipEpoch = 0;
function resetGemaraFlipTransactions() {
  _gemaraFlipEpoch++;
  _gemaraFlipQueue = [];
  _gemaraFlipBusy = false;
}
const pagerKind = source => typeof source === "string" ? (source === "head" ? "head" : "") : (source?.closest(".daf-colhead") ? "head" : "");
function pagerIntent(source, fromPointer = false) {
  const kind = pagerKind(source);
  const surface = Reader.open ? $("#rdBody") : ($("#parshaText") || $("#dafText"));
  const rail = kind === "head" && typeof source !== "string" ? source.closest(".daf-colhead") : surface?.querySelector(".daf-colhead");
  const focusedDir = !fromPointer && source instanceof Element && source.matches("[data-gemflip]") && document.activeElement === source
    ? +source.dataset.gemflip : null;
  if (!rail) return { kind, focusedDir, fallbackY: curDafScroll(), preserveRail: false, docked: false, minimized: document.documentElement.classList.contains("dy-min") };
  const rectTop = rail.getBoundingClientRect().top;
  const stickyTop = pagerStickyViewportTop(rail), docked = rectTop <= stickyTop + 2;
  return { kind, focusedDir, fallbackY: curDafScroll(), preserveRail: !docked, docked, minimized: document.documentElement.classList.contains("dy-min"), railTop: rectTop };
}
function repairPagerFocus(box, activatedDir) {
  if (!box || activatedDir == null) return;
  const same = box.querySelector(`[data-gemflip="${activatedDir}"]`);
  const target = same && !same.disabled ? same : box.querySelector(`[data-gemflip="${-activatedDir}"]:not([disabled])`);
  if (target && document.activeElement !== target) { try { target.focus({ preventScroll: true }); } catch { target.focus(); } }
}
function announceAmud(masechta, amud) {
  const s = $("#readStatus"), text = `${masechta} ${amudLeaf(amud)}${amudSide(amud) === "right" ? "b" : "a"} loaded. Reading position restored.`;
  if (s) s.textContent = text;
  const rs = $("#rdStatus"); if (rs) rs.textContent = text;
}
async function gemaraFlip(dir, source, pointerIntent) { // stable rail arrows — daf text only, in place
  const intent = pointerIntent || pagerIntent(source);
  if (_gemaraFlipBusy) { if (_gemaraFlipQueue.length < 6) _gemaraFlipQueue.push({ dir, intent }); return; }
  const epoch = _gemaraFlipEpoch;
  _gemaraFlipBusy = true;
  try { await gemaraFlipOnce(dir, intent, epoch); }
  finally {
    if (epoch !== _gemaraFlipEpoch) return;
    _gemaraFlipBusy = false;
    const next = _gemaraFlipQueue.shift(); if (next) gemaraFlipOnceQueued(next, epoch);
  }
}
async function gemaraFlipOnceQueued(next, epoch) {
  if (epoch !== _gemaraFlipEpoch) return;
  _gemaraFlipBusy = true;
  try { await gemaraFlipOnce(next.dir, next.intent, epoch); }
  finally {
    if (epoch !== _gemaraFlipEpoch) return;
    _gemaraFlipBusy = false;
    const after = _gemaraFlipQueue.shift(); if (after) gemaraFlipOnceQueued(after, epoch);
  }
}
async function gemaraFlipOnce(dir, intent, epoch = _gemaraFlipEpoch) {
  if (epoch !== _gemaraFlipEpoch) return;
  const box = $("#dafText"); if (!box) return;
  // Re-measure before the async render as a hard fallback for keyboard and
  // assistive activations, which have no pointer target to carry an intent.
  const liveIntent = pagerIntent(box.querySelector(".daf-colhead"));
  const stableIntent = {
    kind: intent?.kind || "",
    focusedDir: intent?.focusedDir ?? liveIntent.focusedDir,
    fallbackY: intent?.fallbackY ?? liveIntent.fallbackY,
    preserveRail: !!(intent?.preserveRail || liveIntent.preserveRail),
    docked: intent?.docked ?? liveIntent.docked,
    minimized: intent?.minimized ?? liveIntent.minimized,
    railTop: intent?.railTop ?? liveIntent.railTop,
  };
  const cur = box.dataset.amud || amudKeysFor(box.dataset.mas, +box.dataset.daf)[0];
  const nx = amudStep(box.dataset.mas, +box.dataset.daf, cur, dir); if (!nx) return;
  const transition = RM.transitionFor({ masechta: box.dataset.mas, amud: cur }, nx);
  const expected = `${box.dataset.mas}|${box.dataset.daf}|${cur}|${box.dataset.mode}`;
  // Prepare while the old page remains fully live. Only once the destination is
  // ready do we freeze its last visual frame, commit, and begin the motion. A
  // cold cross-masechta fetch therefore never strands a screenshot on screen.
  box.setAttribute("aria-busy", "true");
  const prepared = await dafBodyHtml(nx.masechta, nx.daf, box.dataset.mode, nx.amud);
  const stillExpected = epoch === _gemaraFlipEpoch && box.isConnected
    && `${box.dataset.mas}|${box.dataset.daf}|${box.dataset.amud || cur}|${box.dataset.mode}` === expected;
  if (!stillExpected) { if (box.isConnected) box.setAttribute("aria-busy", "false"); return; }
  const motion = beginPageFlip(box, transition.kind, transition.outSide);
  if (!box._renderedDaf || (box._renderedMas === box.dataset.mas && box._renderedDaf === box.dataset.daf && box._renderedAmud === cur))
    saveColScroll(State._dafCol);                // remember our place — but only when what's on screen IS this amud (rapid double-flip guard)
  holdPagerIntent(stableIntent);                 // DOM height changes cannot reopen chrome or undock the frozen pager before restoration
  // Only a keyboard-activated control that is still focused at commit owns a
  // focus repair. Pointer taps and users who Tab elsewhere during a cold load
  // must never have focus pulled back after the destination arrives.
  const repairDir = stableIntent.focusedDir != null
    && document.activeElement === box.querySelector(`[data-gemflip="${stableIntent.focusedDir}"]`) ? stableIntent.focusedDir : null;
  box.dataset.mas = nx.masechta; box.dataset.daf = nx.daf; box.dataset.amud = nx.amud;
  const painted = await hydrateDaf(prepared);    // synchronous commit of the prepared amud incl. fresh boundary arrows
  if (!painted) { motion?.cleanup(); return; }
  restoreColScroll(State._dafCol, true, stableIntent.fallbackY, null, stableIntent.preserveRail, false, stableIntent); // keep the pager at the same viewport edge while restoring this amud
  const arrived = () => epoch === _gemaraFlipEpoch && box.dataset.mas === nx.masechta && +box.dataset.daf === nx.daf && box.dataset.amud === nx.amud;
  announceAmud(nx.masechta, nx.amud); repairPagerFocus(box, repairDir);
  await playPageFlip(motion, () => settlePagerIntent(box, stableIntent, arrived));
  if (!motion?.userInterrupted) await settlePagerIntent(box, stableIntent, arrived);
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
const Reader = { kind: null, masechta: null, daf: null, amud: null, sefer: null, parsha: null, source: null, mode: "daf", open: false,
  _bodyGen: 0, _flipEpoch: 0, _flipBusy: false, _flipQueue: [] };
let _readerClosing = false, _readerOpener = null;
function openReader(masechta, daf, mode, amud) {
  if (Reader.open) return;   // already open — don't stack a second history entry or clobber the opener
  closeMenu();
  Reader.kind = "daf"; Reader.sefer = null; Reader.parsha = null;
  Reader._renderedM = Reader._renderedN = Reader._renderedD = Reader._renderedMode = null;
  Reader.masechta = masechta; Reader.daf = +daf; Reader.amud = amud || amudKeysFor(masechta, +daf)[0];
  Reader.mode = mode || State._dafMode || "daf"; Reader.open = true; Reader._restoreScroll = true;
  showReader();
}
function openTorahReader(sefer, parsha, mode) {
  if (Reader.open) return;
  closeMenu();
  const inlineMode = mode || State._parMode || "daf";
  Reader.kind = "torah"; Reader.masechta = null; Reader.daf = null; Reader.amud = null;
  Reader._renderedM = Reader._renderedN = Reader._renderedD = Reader._renderedMode = null;
  Reader.sefer = sefer; Reader.parsha = parsha; Reader.inlineMode = inlineMode; Reader.mode = "daf";
  Reader.source = inlineMode === "he" ? "gemara" : (State._parCol || "gemara"); Reader._sourceChanged = false;
  Reader._restoreAnchor = parshaScrollAnchor($("#parshaText")); Reader.open = true; Reader._restoreScroll = true;
  showReader();
}
function showReader({ push = true } = {}) {
  const r = $("#reader"); if (!r) return;
  resetGemaraFlipTransactions();                            // the inert page underneath cannot keep navigating in the background
  Reader._flipEpoch++; Reader._flipQueue = []; Reader._flipBusy = false;
  _readerOpener = document.activeElement;
  r.hidden = false; r.setAttribute("aria-hidden", "false");
  r.classList.toggle("torah-reader", Reader.kind === "torah");
  document.documentElement.classList.add("reader-open");
  renderReader();
  const player = $("#player"); if (player) r.appendChild(player);   // keep playback inside the modal's focus/accessibility scope
  $("#app")?.setAttribute("inert", "");
  resetReadMin();                                       // reader opens at the top with full chrome
  setTimeout(() => $("#rdClose")?.focus(), 0);           // move focus into the overlay
  if (push) { try { history.pushState({ ...(history.state || {}), reader: readerHistorySnapshot() }, ""); } catch {} }  // Back / Esc closes the reader first
  persistRoute();
}
function closeReader() { if (Reader.open && !_readerClosing) { _readerClosing = true; try { history.back(); } catch { hideReader(); } } }  // routed through popstate so #view is left intact
function hideReader() {
  const kind = Reader.kind, torahAnchor = kind === "torah" ? parshaScrollAnchor($("#rdBody")) : null;
  const torahSource = kind === "torah" ? (Reader.source || "gemara") : null;
  // Chumash is fully representable in the compact Mikra surface. A reader may
  // visit another source and then return to Chumash; closing should follow the
  // final source, not the fact that a source button was used earlier.
  const torahMode = kind === "torah" && Reader.inlineMode === "he" && torahSource === "gemara" ? "he" : "daf";
  if (Reader.open) saveColScroll(kind === "torah" ? torahSource : (State._dafCol || "gemara"));
  Reader._bodyGen++; Reader._flipEpoch++; Reader._flipQueue = []; Reader._flipBusy = false;
  clearPageMotions();
  Reader.open = false; _readerClosing = false;
  const r = $("#reader"), app = $("#app"), player = $("#player");
  if (player && app) app.appendChild(player);
  if (r) { r.hidden = true; r.setAttribute("aria-hidden", "true"); }
  document.documentElement.classList.remove("reader-open");
  app?.removeAttribute("inert");
  resetReadMin();
  try { _readerOpener && _readerOpener.focus(); } catch {}   // restore focus to whatever opened the reader
  if (kind === "torah") { if (Reader._sourceChanged) State._parCol = torahSource; syncInpageTorah(Reader.sefer, Reader.parsha, torahMode, torahAnchor); }
  else syncInpageRead(Reader.masechta, Reader.daf, Reader.amud, Reader.mode);   // leave the in-page reader where we stopped
  Reader.kind = null; Reader.source = null; Reader._sourceChanged = false; Reader._restoreAnchor = null;
}
function syncInpageRead(masechta, daf, amud, mode) {
  const box = $("#dafText"); if (!box) return;
  mode = mode || State._dafMode || "daf"; State._dafMode = mode;
  $$("#dafMode button").forEach(x => { const on = x.dataset.mode === mode; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
  if (box.dataset.mas === masechta && +box.dataset.daf === daf && box.dataset.amud === amud && box.dataset.mode === mode) { applyDafCol(box); commitDafReadState(); return; }
  box.dataset.mas = masechta; box.dataset.daf = daf; box.dataset.amud = amud; box.dataset.mode = mode;
  hydrateDaf();   // re-renders #dafText incl. the flip arrows; no separate UI step needed
}
async function syncInpageTorah(sefer, parsha, mode, anchor) {
  const box = $("#parshaText"); if (!box || box.dataset.sefer !== sefer || box.dataset.parsha !== parsha) return;
  mode = mode || State._parMode || "daf"; State._parMode = mode;
  $$("#parshaMode button").forEach(x => { const on = x.dataset.pmode === mode; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
  const needsPaint = box.dataset.mode !== mode;
  box.dataset.mode = mode;
  if (needsPaint) await hydrateParsha(); else applyDafCol(box);
  restoreColScroll(State._parCol || "gemara", false, undefined, anchor || null);
  requestAnimationFrame(commitTorahReadState);
  // Closing the modal reveals a site header whose sticky offset settles over a
  // short CSS transition. Re-apply the semantic verse once that chrome is still
  // so the same words—not merely the same raw scroll number—stay under the eye.
  if (anchor) setTimeout(() => {
    if (!Reader.open && box.isConnected) { restoreColScroll(State._parCol || "gemara", false, undefined, anchor); requestAnimationFrame(commitTorahReadState); }
  }, 320);
}
function normalizeReaderSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (snapshot.kind === "daf") {
    const read = normalizeReadSnapshot(snapshot.read);
    return read ? { kind: "daf", read } : null;
  }
  if (snapshot.kind === "torah") {
    const sefer = String(snapshot.sefer || ""), parsha = String(snapshot.parsha || "");
    const known = !!CHUMASH_BY_EN[sefer] && PARSHA_LIST.some(p => p.sefer === sefer && p.parsha === parsha);
    if (!known) return null;
    const source = DAF_SOURCE_KEYS.has(snapshot.source) ? snapshot.source : "gemara";
    const y = Number.isFinite(+snapshot.y) && +snapshot.y >= 0 ? +snapshot.y : 0;
    const anchor = snapshot.anchor && /^\d+-\d+$/.test(String(snapshot.anchor.ref || ""))
      ? { ref: String(snapshot.anchor.ref), offset: Number.isFinite(+snapshot.anchor.offset) ? +snapshot.anchor.offset : 0,
          ...(Number.isFinite(+snapshot.anchor.progress) ? { progress: Math.max(0, Math.min(1, +snapshot.anchor.progress)) } : {}) } : null;
    return { kind: "torah", sefer, parsha, mode: "daf", inlineMode: snapshot.inlineMode === "he" ? "he" : "daf", source,
      sourceChanged: !!snapshot.sourceChanged, y, anchor };
  }
  return null;
}
function restoreReaderFromSnapshot(snapshot, { push = false } = {}) {
  const saved = normalizeReaderSnapshot(snapshot); if (!saved || Reader.open) return false;
  closeMenu(); Reader._renderedM = Reader._renderedN = Reader._renderedD = Reader._renderedMode = null;
  if (saved.kind === "daf") {
    if (State.route?.name !== "daf") return false;
    const read = saved.read; State._dafCol = read.source;
    Reader.kind = "daf"; Reader.sefer = null; Reader.parsha = null;
    Reader.masechta = read.masechta; Reader.daf = read.daf; Reader.amud = read.amud; Reader.mode = read.mode;
    ensureColScroll()[`r:${read.masechta}:${read.amud}:${read.mode}:${read.source}`] = { y: read.y || 0, at: Date.now() };
  } else {
    if (State.route?.name !== "parshaS" || State.route.parsha !== saved.parsha) return false;
    Reader.kind = "torah"; Reader.masechta = null; Reader.daf = null; Reader.amud = null;
    Reader.sefer = saved.sefer; Reader.parsha = saved.parsha; Reader.mode = "daf"; Reader.inlineMode = saved.inlineMode;
    Reader.source = saved.source; Reader._sourceChanged = saved.sourceChanged;
    Reader._restoreAnchor = saved.anchor;
    ensureColScroll()[`tr:${saved.sefer}:${saved.parsha}:daf:${saved.source}`] = { y: saved.y, ...(saved.anchor || {}), at: Date.now() };
  }
  Reader.open = true; Reader._restoreScroll = true; _pendingY = null;
  showReader({ push });
  return true;
}
async function readerFlip(dir, source) {
  const intent = source && typeof source === "object" && "fallbackY" in source ? source : pagerIntent(source);
  if (Reader._flipBusy) { Reader._flipQueue = Reader._flipQueue || []; if (Reader._flipQueue.length < 6) Reader._flipQueue.push({ dir, intent }); return; }
  const epoch = Reader._flipEpoch;
  Reader._flipBusy = true;
  try { await readerFlipOnce(dir, intent, epoch); }
  finally {
    if (epoch !== Reader._flipEpoch) return;
    Reader._flipBusy = false;
    const next = Reader._flipQueue?.shift(); if (next && Reader.open && epoch === Reader._flipEpoch) readerFlip(next.dir, next.intent);
  }
}
async function readerFlipOnce(dir, intent, epoch = Reader._flipEpoch) {
  if (epoch !== Reader._flipEpoch || !Reader.open || Reader.kind !== "daf") return;
  const cur = Reader.amud || amudKeysFor(Reader.masechta, Reader.daf)[0];
  const nx = amudStep(Reader.masechta, Reader.daf, cur, dir); if (!nx) return;
  const transition = RM.transitionFor({ masechta: Reader.masechta, amud: cur }, nx);
  const body = $("#rdBody"), liveIntent = pagerIntent(body?.querySelector(".daf-colhead")), mode = Reader.mode;
  const stableIntent = {
    kind: intent?.kind || "", focusedDir: intent?.focusedDir ?? liveIntent.focusedDir, fallbackY: intent?.fallbackY ?? liveIntent.fallbackY,
    preserveRail: !!(intent?.preserveRail || liveIntent.preserveRail), docked: intent?.docked ?? liveIntent.docked,
    minimized: intent?.minimized ?? liveIntent.minimized, railTop: intent?.railTop ?? liveIntent.railTop,
  };
  const expected = `${Reader.masechta}|${Reader.daf}|${cur}|${mode}`;
  body?.setAttribute("aria-busy", "true");
  const prepared = await dafBodyHtml(nx.masechta, nx.daf, mode, nx.amud);
  const stillExpected = epoch === Reader._flipEpoch && Reader.open && Reader.kind === "daf" && body?.isConnected
    && `${Reader.masechta}|${Reader.daf}|${Reader.amud || cur}|${Reader.mode}` === expected;
  if (!stillExpected) { if (body?.isConnected) body.setAttribute("aria-busy", "false"); return; }
  const motion = beginPageFlip(body, transition.kind, transition.outSide);
  if (!Reader._renderedD || (Reader._renderedM === Reader.masechta && Reader._renderedD === cur))
    saveColScroll(State._dafCol);                // save a spot only for the amud actually rendered (rapid double-flip guard)
  holdPagerIntent(stableIntent);
  const repairDir = stableIntent.focusedDir != null
    && document.activeElement === body?.querySelector(`[data-gemflip="${stableIntent.focusedDir}"]`) ? stableIntent.focusedDir : null;
  Reader.masechta = nx.masechta; Reader.daf = nx.daf; Reader.amud = nx.amud; Reader._restoreScroll = true;
  syncReaderChrome();
  const painted = await fillReaderBody(nx.masechta, nx.daf, mode, nx.amud, prepared, stableIntent);
  if (!painted) { motion?.cleanup(); return; }
  const arrived = () => epoch === Reader._flipEpoch && Reader.open && Reader.kind === "daf" && Reader.masechta === nx.masechta && Reader.daf === nx.daf && Reader.amud === nx.amud;
  announceAmud(nx.masechta, nx.amud); repairPagerFocus(body, repairDir);
  await playPageFlip(motion, () => settlePagerIntent(body, stableIntent, arrived));
  if (!motion?.userInterrupted) await settlePagerIntent(body, stableIntent, arrived);
}
function renderReader() {
  if (Reader.kind === "torah") { renderTorahReader(); return; }
  renderDafReader();
}
function renderDafReader() {
  const r = $("#reader"); if (!r) return;
  r.innerHTML = `
    <div class="reader-bar daf-reader-bar">
      <div class="rd-side rd-left"><button class="rd-ic close" id="rdClose" aria-label="Close full screen">✕</button></div>
      <div class="rd-title sr-only" id="rdTitle"><span class="he" lang="he"></span><span class="en"></span></div>
      <div class="rd-side rd-right">
        <div class="rd-modes">${modeSegHtml("rdMode", Reader.mode, "rmode")}</div>
        <div class="rd-tools">${tsizeHtml()}<button class="rd-ic play" id="rdPlay" aria-label="Play this shiur" title="Play this daf's shiur">${svgPlay(13)}</button></div>
      </div>
    </div>
    <div class="sr-only" id="rdStatus" role="status" aria-live="polite" aria-atomic="true"></div>
    <div class="reader-body daf-reader-body" id="rdBody" role="region" aria-label="Daf text" aria-busy="true" aria-keyshortcuts="ArrowLeft ArrowRight"><div class="daf-loading">Loading the daf…</div></div>`;
  $("#rdClose").onclick = closeReader;
  $$("#rdMode button").forEach(b => b.onclick = () => setReaderMode(b.dataset.rmode));
  $$("#reader [data-tsize]").forEach(b => b.onclick = () => bumpDafScale(+b.dataset.tsize));
  const body = $("#rdBody");
  let bodyControlIntent = null;
  const rememberControlIntent = e => {
    const control = e.target.closest("[data-gemflip], [data-dcol]");
    if (control) { bodyControlIntent = pagerIntent(control, true); lockReadMin(bodyControlIntent.fallbackY); }
  };
  body.onpointerdown = rememberControlIntent;
  body.onmousedown = e => { if (!bodyControlIntent) rememberControlIntent(e); if (e.target.closest("[data-gemflip], [data-dcol]")) e.preventDefault(); };
  body.onclick = e => {
    const g = e.target.closest("[data-gemflip]");
    if (g) { const intent = bodyControlIntent || pagerIntent(g); bodyControlIntent = null; readerFlip(+g.dataset.gemflip, intent); return; }
    const c = e.target.closest("[data-dcol]"); if (c) { const intent = bodyControlIntent; bodyControlIntent = null; selectDafCol(c.dataset.dcol, intent); }
  };
  syncReaderChrome();
  fillReaderBody(Reader.masechta, Reader.daf, Reader.mode, Reader.amud);
}
function renderTorahReader() {
  const r = $("#reader"); if (!r) return;
  r.innerHTML = `
    <div class="reader-bar torah-reader-bar">
      <div class="rd-side rd-left"><button class="rd-ic close" id="rdClose" aria-label="Close full screen">✕</button></div>
      <div class="rd-title" id="rdTitle"><span class="he" lang="he"></span><span class="en"></span></div>
      <div class="rd-side rd-right">
        <div class="rd-tools">${tsizeHtml()}</div>
      </div>
    </div>
    <div class="sr-only" id="rdStatus" role="status" aria-live="polite" aria-atomic="true"></div>
    <div class="reader-body reader-torah-body" id="rdBody" role="region" aria-label="Torah text" aria-busy="true" data-reader-kind="torah" data-sefer="${esc(Reader.sefer)}" data-parsha="${esc(Reader.parsha)}" data-mode="${esc(Reader.mode)}"><div class="daf-loading">Loading the parsha…</div></div>`;
  $("#rdClose").onclick = closeReader;
  $$("#reader [data-tsize]").forEach(b => b.onclick = () => bumpDafScale(+b.dataset.tsize));
  const body = $("#rdBody");
  let bodyControlIntent = null;
  const rememberControlIntent = e => {
    const control = e.target.closest("[data-dcol]");
    if (control) { bodyControlIntent = pagerIntent(control); lockReadMin(bodyControlIntent.fallbackY); }
  };
  body.onpointerdown = rememberControlIntent;
  body.onmousedown = e => { if (!bodyControlIntent) rememberControlIntent(e); if (e.target.closest("[data-dcol]")) e.preventDefault(); };
  body.onclick = e => {
    const c = e.target.closest("[data-dcol]");
    if (c) { const intent = bodyControlIntent; bodyControlIntent = null; selectDafCol(c.dataset.dcol, intent); }
  };
  syncTorahReaderChrome();
  fillTorahReaderBody(Reader.sefer, Reader.parsha, Reader.mode, Reader._restoreAnchor);
}
function syncTorahReaderChrome() {
  if (!Reader.open || Reader.kind !== "torah") return;
  const title = $("#rdTitle");
  if (title) {
    $(".he", title).textContent = parshaHe(Reader.parsha);
    $(".en", title).textContent = `Chumash · ${pDisp(Reader.parsha)}`;
  }
  updateTextSizeControls($("#reader"));
}
async function fillTorahReaderBody(sefer, parsha, mode, anchor) {
  const gen = ++Reader._bodyGen, body = $("#rdBody");
  if (body) body.setAttribute("aria-busy", "true");
  const data = await loadTorah(sefer);
  const html = data ? parshaBodyHtml(sefer, parsha, mode, data)
    : `<div class="empty-mini">${(typeof navigator !== "undefined" && navigator.onLine === false) ? "You're offline — reconnect to load the parsha." : "The text of this parsha isn't available yet."}</div>`;
  if (body && gen === Reader._bodyGen && Reader.open && Reader.kind === "torah" && Reader.sefer === sefer && Reader.parsha === parsha && Reader.mode === mode) {
    body.innerHTML = html; body.dataset.readerKind = "torah"; body.dataset.sefer = sefer; body.dataset.parsha = parsha; body.dataset.mode = mode;
    body.setAttribute("aria-busy", "false");
    applyDafCol(body); attachDafSwipe(body); wireParshaChapterJumps(body);
    Reader._restoreAnchor = null; Reader._restoreScroll = false;
    restoreColScroll(Reader.source || "gemara", true, undefined, anchor || null);
    syncParshaChapterNav();
    return true;
  }
  return false;
}
function syncReaderChrome() {
  if (!Reader.open) return;
  const leaf = amudLeaf(Reader.amud), suffix = amudSide(Reader.amud) === "right" ? "b" : "a";
  const title = $("#rdTitle");
  if (title) {
    $(".he", title).textContent = `${DY.masechtaHe(Reader.masechta)} ${heDaf(leaf)} ${suffix === "b" ? "ב" : "א"}`;
    $(".en", title).textContent = `${Reader.masechta} · Daf ${leaf}${suffix}`;
  }
  $$("#rdMode button").forEach(b => { const on = b.dataset.rmode === Reader.mode; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  const shiur = shiurFor(Reader.masechta, Reader.daf), play = $("#rdPlay");
  if (play) { play.hidden = !shiur; play.onclick = shiur ? () => { playId(shiur.id); toast("Playing — keep reading"); } : null; }
  updateTextSizeControls($("#reader"));
}
async function setReaderMode(mode) {
  if (!Reader.open || Reader.mode === mode) return;
  clearPageMotions();
  const intent = pagerIntent(); holdPagerIntent(intent);
  saveColScroll(State._dafCol || "gemara");
  Reader.mode = mode; State._dafMode = mode; Reader._restoreScroll = true;
  syncReaderChrome();
  await fillReaderBody(Reader.masechta, Reader.daf, mode, Reader.amud, undefined, intent);
  await settlePagerIntent($("#rdBody"), intent, () => Reader.open && Reader.kind === "daf" && Reader.mode === mode);
}
async function fillReaderBody(m, d, mode, amud, preparedHtml, railIntent) {
  const gen = ++Reader._bodyGen, body = $("#rdBody");
  if (body) body.setAttribute("aria-busy", "true");
  const html = preparedHtml == null ? await dafBodyHtml(m, d, mode, amud) : preparedHtml;
  if (body && gen === Reader._bodyGen && Reader.open && Reader.masechta === m && Reader.daf === d && Reader.amud === amud && Reader.mode === mode) {
    commitDafBodyHtml(body, html); Reader._renderedM = m; Reader._renderedN = d; Reader._renderedD = amud; Reader._renderedMode = mode;
    body.setAttribute("aria-busy", "false");
    sizeDafCarves(body); applyDafCol(body); attachDafSwipe(body);
    Reader._restoreScroll = false; restoreColScroll(State._dafCol, true, railIntent?.fallbackY, null, railIntent?.preserveRail, false, railIntent);
    requestAnimationFrame(commitDafReadState);
    return true;
  }
  return false;
}

function viewSearch() { return `<div class="pagetitle" role="heading" aria-level="1">Search</div><div class="searchbar"><input id="q" type="search" aria-label="Search" placeholder="search a daf (“chullin 100”), masechta, or topic…" autocomplete="off"></div><div id="results"></div>`; }
// A daf reference typed in any natural form — "chullin 100", "Daf 100 Chullin",
// "בבא מציעא 8" — pins an "Open the daf" card above the shiur matches.
function searchRef(q) {
  let mas = DY.normalizeMasechta(q);
  if (!mas) { const hit = DY.SHAS.find(m => q.includes(m.he)); if (hit) mas = hit.en; }   // Hebrew masechta names
  if (!mas) return "";
  const nm = /(\d{1,3})/.exec(q); const m = DY.BYEN[mas];
  const daf = nm ? +nm[1] : null;
  if (daf && m && daf >= m.firstDaf && daf <= m.lastDaf) {
    return `<div class="rows"><div class="row"><button class="row-main" data-rowdaf="${esc(mas)}|${daf}">
      <span class="rnum">${esc(window.HebCal ? window.HebCal.gematria(daf) : daf)}</span>
      <span class="rmain"><b>Open ${esc(mas)} · Daf ${daf}</b><span class="rmeta">read the daf${shiurFor(mas, daf) ? " · shiur available" : ""}</span></span>
    </button></div></div>`;
  }
  return `<div class="rows"><div class="row"><button class="row-main" data-go="masechta" data-p="${esc(JSON.stringify({ masechta: mas }))}">
    <span class="rnum" lang="he">${esc(m ? m.he.slice(0, 1) : "▸")}</span>
    <span class="rmain"><b>Browse ${esc(mas)} <span lang="he">· ${esc(m ? m.he : "")}</span></b><span class="rmeta">${m ? m.dapim : ""} dafim</span></span>
  </button></div></div>`;
}
function runSearch(q) {
  const box = $("#results"); if (!box) return;
  q = (q || "").trim().toLowerCase();
  if (!q) { box.innerHTML = `<div class="empty-mini">Type to search ${State.all.filter(l => !isHiddenShiur(l)).length.toLocaleString()} shiurim.</div>`; return; }
  const toks = q.split(/\s+/).filter(Boolean);
  const hay = l => (l.title + " " + l.series + " " + (l.category || "")).toLowerCase();
  const res = State.all.filter(l => !isHiddenShiur(l) && (h => toks.every(t => h.includes(t)))(hay(l))).slice(0, 60);
  const ref = searchRef(q);
  box.innerHTML = (ref || "") + (res.length ? `<div class="rows">${res.map(l => rowHtml(l)).join("")}</div>`
    : ref ? "" : `<div class="empty-mini">No shiurim match “${esc(q)}”.</div>`);
  wireRows(box);
  box.querySelectorAll("[data-go]").forEach(a => a.onclick = () => { let p = {}; try { p = JSON.parse(a.dataset.p || "{}"); } catch {} route(a.dataset.go, p); });
}
function viewMyStuff() {
  const f = favs(), p = getStore(CFG.progKey), lt = learnedTotal();
  const fav = State.all.filter(l => f[l.id] && !isHiddenShiur(l)).sort((a, b) => (+f[b.id] || 0) - (+f[a.id] || 0));
  const pr = State.all.filter(l => p[l.id] && !isHiddenShiur(l)).sort((a, b) => (+p[b.id] || 0) - (+p[a.id] || 0)).slice(0, 12);
  const sec = (t, list, e) => `<div class="section" role="heading" aria-level="2">${t}</div>` + (list.length ? `<div class="rows">${list.map(l => rowHtml(l)).join("")}</div>` : `<div class="empty-mini">${e}</div>`);
  const head = (lt || lastInProgress())
    ? `<div class="mystuff-top">${progressBar(lt, shasTotal(), { label: "Your Shas progress" })}${upNextLink()}</div>`
    : `<p class="lead">Your progress lives on this device — mark dapim as learned and your spot is saved automatically.</p>`;
  return `<div class="pagetitle" role="heading" aria-level="1">My Learning</div>` + head
    + sec("Continue", pr, "Play a shiur and it appears here.")
    + sec("Saved", fav, "Tap ☆ Save on any daf or shiur to keep it here.")
    + `<div class="section" role="heading" aria-level="2">Back up your progress</div>
       <p class="muted center" style="font-size:14px;max-width:46ch;margin:6px auto 12px">Learned dapim, saved shiurim, and listening spots live only on this device. Keep a backup file, or move them to a new phone.</p>
       <p class="center" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
         <button class="btn sm" id="bkExport">Download backup</button>
         <button class="btn sm" id="bkImport">Restore from backup</button>
         <input type="file" id="bkFile" accept="application/json,.json" hidden>
       </p>`;
}
/* ---------- progress backup / restore (all dy_* personal keys) ---------- */
const BK_KEYS = [CFG.favKey, CFG.progKey, CFG.notesKey, CFG.learnedKey, CFG.posKey];
function exportProgress() {
  const out = { site: "monseydafyomi", saved: todayStr(), data: {} };
  for (const k of BK_KEYS) out.data[k] = getStore(k);
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = u; a.download = `daf-yomi-progress-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
  toast("Backup downloaded ✓");
}
function importProgress(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!d || d.site !== "monseydafyomi" || !d.data || typeof d.data !== "object") throw new Error("bad");
      let n = 0;
      for (const k of BK_KEYS) {
        const inc = d.data[k];
        if (!inc || typeof inc !== "object" || Array.isArray(inc)) continue;
        const cur = getStore(k);                        // merge — restoring on a used device loses nothing
        const ts = v => (v && typeof v === "object") ? (+v.at || 0) : (+v || 0);   // values are timestamps (favs/progress/learned) or {t,d,at} (positions)
        for (const kk in inc) {
          if (!(kk in cur)) { cur[kk] = inc[kk]; n++; continue; }
          if (ts(inc[kk]) > ts(cur[kk])) cur[kk] = inc[kk];   // keep whichever side is newer — a stale backup never rewinds this device
        }
        setStore(k, cur);
      }
      toast(`Progress restored ✓ (${n} new item${n === 1 ? "" : "s"})`);
      rerender();
    } catch { toast("That file isn't a Daf Yomi backup."); }
  };
  rd.readAsText(file);
}

/* ---------- Shiurim (non-daf: parsha, holidays, machshava, …) ---------- */
const isDafShiur = l => (l._dk && l._dk.daf) || /daf yomi|daily talmud/i.test(l.category || "");
const HIDDEN_CAT = /must\s*see/i;                     // "Must See" is retired — hidden everywhere
const isHiddenShiur = l => HIDDEN_CAT.test(l.category || "");
const PARSHA_CAT = /paras/i, HOLIDAY_CAT = /holiday/i;
function prettyCat(c) { return ({ "Parasha/Torah Portion": "Parsha", "Daf Yomi/Daily Talmud": "Daf Yomi", "Eulogies/Hespedim": "Hespedim", "Jewish Understanding": "Machshava", "Teshuvah/Repentance": "Teshuvah" })[c] || c; }
function nonDafCats() {
  const m = new Map();
  for (const l of State.all) { if (isDafShiur(l) || isHiddenShiur(l)) continue; const c = l.category || "Other"; m.set(c, (m.get(c) || 0) + 1); }
  return [...m.entries()].map(([name, count]) => ({ name, pretty: prettyCat(name), count })).sort((a, b) => b.count - a.count);
}

/* The five Chumashim and their parshiyos — spellings match the library's series
   names once normalized (apostrophes/spaces dropped). */
const CHUMASHIM = [
  { en: "Bereishit", he: "בראשית", parshiyos: [["Bereishit", "בראשית"], ["Noach", "נח"], ["Lech Lecha", "לך לך"], ["Vayeira", "וירא"], ["Chayei Sarah", "חיי שרה"], ["Toldot", "תולדות"], ["Vayetzei", "ויצא"], ["Vayishlach", "וישלח"], ["Vayeshev", "וישב"], ["Mikeitz", "מקץ"], ["Vayigash", "ויגש"], ["Vayechi", "ויחי"]] },
  { en: "Shemot", he: "שמות", parshiyos: [["Shemot", "שמות"], ["Va'eira", "וארא"], ["Bo", "בא"], ["Beshalach", "בשלח"], ["Yitro", "יתרו"], ["Mishpatim", "משפטים"], ["Terumah", "תרומה"], ["Tetzaveh", "תצוה"], ["Ki Tisa", "כי תשא"], ["Vayakhel", "ויקהל"], ["Pekudei", "פקודי"]] },
  { en: "Vayikra", he: "ויקרא", parshiyos: [["Vayikra", "ויקרא"], ["Tzav", "צו"], ["Shemini", "שמיני"], ["Tazria", "תזריע"], ["Metzora", "מצורע"], ["Acharei Mot", "אחרי מות"], ["Kedoshim", "קדושים"], ["Emor", "אמור"], ["Behar", "בהר"], ["Bechukotai", "בחוקותי"]] },
  { en: "Bamidbar", he: "במדבר", parshiyos: [["Bamidbar", "במדבר"], ["Naso", "נשא"], ["Be'halot'cha", "בהעלותך"], ["Shelach", "שלח"], ["Korach", "קרח"], ["Chukat", "חקת"], ["Balak", "בלק"], ["Pinchas", "פינחס"], ["Matot", "מטות"], ["Masay", "מסעי"]] },
  { en: "Devarim", he: "דברים", parshiyos: [["Devarim", "דברים"], ["V'etchanan", "ואתחנן"], ["Ekev", "עקב"], ["Re'eh", "ראה"], ["Shoftim", "שופטים"], ["Ki Tetzei", "כי תצא"], ["Ki Tavo", "כי תבוא"], ["Nitzavim", "נצבים"], ["Vayelech", "וילך"], ["Ha'azinu", "האזינו"], ["V'Zot Haberacha", "וזאת הברכה"]] },
];
const CHUMASH_BY_EN = Object.fromEntries(CHUMASHIM.map(s => [s.en, s]));
// The internal keys match the library's series names (Israeli translit); the
// SITE speaks yeshivish like the gemara side (Berachos, Kesubos) — display maps:
const PARSHA_DISPLAY = { "Bereishit": "Bereishis", "Toldot": "Toldos", "Vayetzei": "Vayeitzei", "Vayeshev": "Vayeishev", "Shemot": "Shemos", "Yitro": "Yisro", "Ki Tisa": "Ki Sisa", "Acharei Mot": "Acharei Mos", "Bechukotai": "Bechukosai", "Be'halot'cha": "Beha'aloscha", "Chukat": "Chukas", "Matot": "Matos", "Masay": "Masei", "V'etchanan": "Va'eschanan", "Ekev": "Eikev", "Ki Tetzei": "Ki Seitzei", "Ki Tavo": "Ki Savo", "Vayelech": "Vayeilech", "V'Zot Haberacha": "V'Zos Habracha" };
const SEFER_DISPLAY = { Bereishit: "Bereishis", Shemot: "Shemos" };
const pDisp = en => PARSHA_DISPLAY[en] || en;
const sDisp = en => SEFER_DISPLAY[en] || en;
// Every parsha in Torah order, with its sefer — for prev/next navigation.
const PARSHA_LIST = CHUMASHIM.flatMap(s => s.parshiyos.map(([en]) => ({ sefer: s.en, parsha: en })));
const parshaStep = (en, dir) => { const i = PARSHA_LIST.findIndex(p => p.parsha === en); return i < 0 ? null : PARSHA_LIST[i + dir] || null; };
/* Chumash text (with Rashi + Onkelos), extracted from our own Sefaria mirror by
   build/extract_torah.py — loaded lazily per sefer, rendered like the daf. */
async function loadTorah(sefer) {
  State.torahCache = State.torahCache || {};
  if (State.torahCache[sefer]) return State.torahCache[sefer];
  if (!CHUMASH_BY_EN[sefer]) return null;
  try { const d = await fetch(`data/torah/${sefer}.json`).then(r => r.ok ? r.json() : null); if (d) State.torahCache[sefer] = d; return d; }
  catch { return null; }
}
const normName = s => (s || "").toLowerCase().replace(/[^a-z]/g, "");
// A shiur belongs to a parsha when its series matches it exactly, or is a doubled
// reading that contains it ("Behar-Bechukotai" shows under both Behar and Bechukotai).
function parshaMatches(series, parshaEn) {
  const p = normName(parshaEn); if (!p) return false;
  if (normName(series) === p) return true;
  return String(series || "").split(/[-–—/]/).some(part => normName(part) === p);
}
const parshaShiurim = () => State.all.filter(l => PARSHA_CAT.test(l.category || "") && !isDafShiur(l));
const holidayShiurim = () => State.all.filter(l => HOLIDAY_CAT.test(l.category || "") && !isDafShiur(l));
const shiurimForParsha = en => parshaShiurim().filter(l => parshaMatches(l.series, en)).sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
const parshaHe = en => { for (const s of CHUMASHIM) for (const [e, h] of s.parshiyos) if (e === en) return h; return en; };

/* Holidays — box per yom tov, in calendar order; anything new in the library
   is appended automatically. */
const HOLIDAY_ORDER = [
  ["Rosh Hashanah", "ראש השנה"], ["Yom Kippur", "יום כיפור"], ["Sukkot", "סוכות"], ["Hoshana Raba", "הושענא רבה"],
  ["Chanukah", "חנוכה"], ["Purim", "פורים"], ["Pesach/Passover", "פסח"], ["Omer", "ספירת העומר"],
  ["Shavuot", "שבועות"], ["Tisha B'Av", "תשעה באב"],
];
function holidayList() {
  const counts = new Map();
  for (const l of holidayShiurim()) { const s = l.series || "Other"; counts.set(s, (counts.get(s) || 0) + 1); }
  const out = [];
  for (const [en, he] of HOLIDAY_ORDER) if (counts.has(en)) { out.push({ series: en, he, count: counts.get(en) }); counts.delete(en); }
  for (const [en, count] of counts) out.push({ series: en, he: en, count, latin: true });   // unknown series: keep its Latin name, styled Latin
  return out;
}
const holidayHe = series => { const h = HOLIDAY_ORDER.find(([en]) => en === series); return h ? h[1] : series; };
const HOLIDAY_DISPLAY = { "Sukkot": "Sukkos", "Shavuot": "Shavuos", "Pesach/Passover": "Pesach", "Omer": "Sefiras HaOmer" };
const hDisp = series => HOLIDAY_DISPLAY[series] || String(series).replace(/\/.*$/, "");
// When is each yom tov next? (Hebrew-calendar aware.) `starts` matches the first
// day; `len` is the span in days, so a multi-day yom tov counts as "today"
// throughout — counting BACKWARD from today handles variable month lengths
// (Chanukah ending 2 vs 3 Teves) without naming end dates.
const HOLIDAY_WHEN = {
  "Rosh Hashanah": { starts: h => h.m === 7 && h.d === 1, len: 2 },
  "Yom Kippur": { starts: h => h.m === 7 && h.d === 10, len: 1 },
  "Sukkot": { starts: h => h.m === 7 && h.d === 15, len: 9 },   // through Shmini Atzeres & Simchas Torah — their shiurim live here
  "Hoshana Raba": { starts: h => h.m === 7 && h.d === 21, len: 1 },
  "Chanukah": { starts: h => h.m === 9 && h.d === 25, len: 8 },
  "Purim": { starts: h => (h.leap ? h.m === 13 : h.m === 12) && h.d === 14, len: 1 },
  "Pesach/Passover": { starts: h => h.m === 1 && h.d === 15, len: 8 },
  "Omer": { starts: h => h.m === 1 && h.d === 16, len: 49 },
  "Shavuot": { starts: h => h.m === 3 && h.d === 6, len: 2 },
  "Tisha B'Av": { starts: h => h.m === 5 && h.d === 9, len: 1 },
};
function daysUntilHoliday(series) {
  const w = HOLIDAY_WHEN[series]; if (!w || !window.HebCal) return null;
  const b = new Date();   // inside the span right now? (scan back up to len-1 days for the start day)
  for (let i = 0; i < (w.len || 1); i++) { const h = window.HebCal.fromDate(b); if (h && w.starts(h)) return 0; b.setDate(b.getDate() - 1); }
  const d = new Date();
  for (let i = 0; i <= 400; i++) { const h = window.HebCal.fromDate(d); if (h && w.starts(h)) return i; d.setDate(d.getDate() + 1); }
  return null;
}

function viewTopics() {
  const cats = nonDafCats();
  const parshaN = parshaShiurim().length, holN = holidayShiurim().length;
  let boxes = "";
  if (parshaN) boxes += navBox(`data-route="parsha"`, "פרשה", `Parsha · ${parshaN} shiurim`);
  if (holN) boxes += navBox(`data-route="holidays"`, "ימים טובים", `Holidays · ${holN} shiurim`);
  for (const c of cats) {
    if (PARSHA_CAT.test(c.name) || HOLIDAY_CAT.test(c.name)) continue;   // the two rich flows above
    boxes += navBox(`data-cat="${esc(c.name)}"`, esc(c.pretty), `${c.count} shiur${c.count > 1 ? "im" : ""}`, "latin");
  }
  if (!boxes) return `<div class="empty-mini">No shiurim found yet.</div>`;
  return boxHead("שיעורים", "More Shiurim — parsha, yomim tovim & hashkafa", false, ["today", {}]) + `<div class="boxcol">${boxes}</div>`;
}

function viewParsha() {
  const all = parshaShiurim();
  const strays = all.filter(l => !CHUMASHIM.some(s => s.parshiyos.some(([en]) => parshaMatches(l.series, en))))
    .sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
  return boxHead("חומש", "Chumash & Parsha — the full text, with the Rov's shiurim", false, ["today", {}]) +
    `<div class="boxcol">${CHUMASHIM.map(s => {
      const ids = new Set();                                   // distinct shiurim — a doubled parsha counts once
      for (const [en] of s.parshiyos) for (const l of shiurimForParsha(en)) ids.add(l.id);
      const n = ids.size;
      return navBox(`data-sefer="${esc(s.en)}"`, esc(s.he), n ? `${sDisp(s.en)} · ${n} shiurim` : sDisp(s.en));
    }).join("")}</div>` +
    (strays.length ? `<div class="section" role="heading" aria-level="2">More parsha shiurim</div><div class="rows">${strays.map(l => rowHtml(l)).join("")}</div>` : "");
}

function viewSefer(r) {
  const s = CHUMASH_BY_EN[r.sefer];
  if (!s) return boxHead("—") + `<div class="empty-mini">That sefer isn't available.</div>`;
  return crumbs([["Chumash", "parsha"]], esc(s.he)) + boxHead(esc(s.he), sDisp(s.en), false, ["parsha", {}]) +
    `<div class="boxcol">${s.parshiyos.map(([en, he]) => {
      const n = shiurimForParsha(en).length;
      return navBox(`data-parsha="${esc(en)}"`, esc(he), n ? `${pDisp(en)} · ${n} shiur${n > 1 ? "im" : ""}` : pDisp(en));
    }).join("")}</div>`;
}

const PARSHA_MODES = [["daf", '<span class="seg-he" lang="he">עם רש״י ואונקלוס</span>'], ["he", '<span class="seg-he" lang="he">מקרא</span>']];
const parshaModeSegHtml = (id, mode, attr) => `<span class="seg" id="${id}" role="group" aria-label="Torah display mode">${PARSHA_MODES.map(([x, lbl]) => `<button data-${attr}="${x}" class="${x === mode ? "on" : ""}" aria-pressed="${x === mode}">${lbl}</button>`).join("")}</span>`;
function viewParshaShiurim(r) {
  const list = shiurimForParsha(r.parsha);
  const pk = `parsha:${r.parsha}`;
  const sef = CHUMASH_BY_EN[(PARSHA_LIST.find(p => p.parsha === r.parsha) || {}).sefer];
  const admin = pageMediaHtml(pk) + worksheetsHtml(pk);   // gate the empty-state on what actually rendered
  const read = normalizeTorahSnapshot(r.torah), mode = read?.mode || State._parMode || "daf";
  State._parMode = mode; State._parCol = read?.source || State._parCol || "gemara";
  const text = sef ? `
    <div class="daf-toolbar">
      ${parshaModeSegHtml("parshaMode", mode, "pmode")}
      ${tsizeHtml()}
      <button class="fs-btn" id="parshaFsBtn" aria-label="Read Torah full screen" title="Read full screen — a focused source at a time">${svgExpand(14)}<span class="fs-lbl">Full screen</span></button>
    </div>
    <div class="daf-read">
      <div id="parshaText" role="region" aria-label="Torah text" aria-busy="true" data-sefer="${esc(sef.en)}" data-parsha="${esc(r.parsha)}" data-mode="${mode}"><div class="daf-loading">Loading the parsha…</div></div>
    </div>` : "";
  return crumbs([["Chumash", "parsha"], [sef ? sef.he : "", "sefer", { sefer: sef ? sef.en : "" }]], esc(parshaHe(r.parsha))) +
    boxHead(esc(parshaHe(r.parsha)), pDisp(r.parsha), false, sef ? ["sefer", { sefer: sef.en }] : ["parsha", {}]) +
    `<div class="daf-daynav parsha-daynav">
      ${(n => `<button class="daynav next" data-parnav="1" aria-label="Next parsha"${n ? "" : " disabled"}>‹<span class="dn-t" lang="he">${n ? esc(parshaHe(n.parsha)) : ""}</span></button>`)(parshaStep(r.parsha, 1))}
      ${(p => `<button class="daynav prev" data-parnav="-1" aria-label="Previous parsha"${p ? "" : " disabled"}><span class="dn-t" lang="he">${p ? esc(parshaHe(p.parsha)) : ""}</span>›</button>`)(parshaStep(r.parsha, -1))}
    </div>` +
    (list.length ? `<details class="shiur-disclosure"><summary>${list.length} shiur${list.length > 1 ? "im" : ""} on ${esc(pDisp(r.parsha))}</summary><div class="rows">${list.map(l => rowHtml(l, { stripSeries: true })).join("")}</div></details>` : "") +
    text + admin +
    (!list.length && !admin && !text ? `<div class="empty-mini">No shiurim on this parsha yet.</div>` : "");
}

/* ---------- the parsha text, rendered like a printed chumash ----------
   Center: the pesukim with taamim. Right leaf-margin: Targum Onkelos (verse-
   aligned). Left: Rashi in Rashi script. On phones the same one-column-at-a-time
   switcher as the daf (the columns reuse the daf's column classes). */
const PARSHA_COL_LABELS = { tosafos: 'רש"י', gemara: "חומש", rashi: "אונקלוס" };
const PARSHA_COL_ARIA = { tosafos: 'פירוש רש"י', gemara: "חומש", rashi: "תרגום אונקלוס" };
function parshaColHead(parsha, chapters, mode) {
  const opts = chapters.map(n => `<option value="${n}">פרק ${heNum(n)}</option>`).join("");
  return `<div class="daf-colhead parsha-colhead mode-${mode}">
    <div class="daf-flip-row"><span class="daf-flip-lbl" lang="he">${esc(parshaHe(parsha))}</span><button class="rail-fs" data-parsha-fullscreen aria-label="Read Torah full screen" title="Read full screen">${svgExpand(14)}</button></div>
    ${mode === "daf" ? `<div class="daf-cols-row" role="group" aria-label="Torah source — tap a name or swipe">${dafColsInner(PARSHA_COL_LABELS, activeTorahSource(), null, PARSHA_COL_ARIA)}</div>` : ""}
    <label class="chapter-jump"><span>Jump to</span><select data-chapter-jump aria-label="Jump to chapter" lang="he" dir="rtl">${opts}</select></label>
  </div>`;
}
const heNum = n => esc(window.HebCal ? window.HebCal.gematria(n) : n);
function torahRashiHtml(v) {
  if (!Array.isArray(v.ra) || !v.ra.length) return `<div class="col-empty" role="note" aria-label="No Rashi commentary on this verse"></div>`;
  const comments = v.ra.map((c, i) => {
    const raw = String(c), parsed = raw.match(/^(.+?)(?:\.\s+|\s+[–—-]\s+)([\s\S]+)$/);
    const m = parsed && [...parsed[1]].length <= 80 ? parsed : null;  // beyond this, punctuation is prose—not a credible dibbur hamatchil boundary
    const num = i === 0 ? `<span class="vnum" lang="he">${heNum(v.v)}</span> ` : "";
    if (!m) {
      const first = /^(\S+)([\s\S]*)$/.exec(raw);  // delimiter-less entries still expose a restrained boundary without inventing a long DH
      return `<span class="rashi-comment">${num}${first ? `<b>${esc(first[1])}</b>${esc(first[2])}` : esc(raw)}</span>`;
    }
    const body = /^(\S+)([\s\S]*)$/.exec(m[2]);
    return `<span class="rashi-comment">${num}<b>${esc(m[1])}</b><span class="rashi-explain-lead">&nbsp;—&nbsp;${esc(body ? body[1] : m[2])}</span>${body ? esc(body[2]) : ""}</span>`;
  }).join("");
  return `<div class="comm torah-rashi-flow" lang="he" dir="rtl">${comments}</div>`;
}
function parshaBodyHtml(sef, parsha, mode, data) {
  const p = data && data[parsha];
  if (!p || !Array.isArray(p.verses) || !p.verses.length) return `<div class="empty-mini">The text of this parsha isn't available yet.</div>`;
  const chapters = [...new Set(p.verses.map(v => +v.c))];
  const groups = chapters.map(chap => {
    const verses = p.verses.filter(v => +v.c === chap).map(v => {
      const ref = `${v.c}-${v.v}`, num = `<span class="vnum" lang="he">${heNum(v.v)}</span>`;
      if (mode === "he") return `<div class="torah-verse torah-single" data-ref="${ref}"><section class="torah-cell col gemara" role="region" aria-label="Chapter ${v.c}, verse ${v.v}" lang="he" dir="rtl"><div class="gem">${num} ${safeHe(v.he)}</div></section></div>`;
      return `<div class="torah-verse" data-ref="${ref}">
        <section class="torah-cell col side rashi" role="region" aria-label="Onkelos, chapter ${v.c}, verse ${v.v}" lang="he" dir="rtl"><div class="tg">${v.on ? `${num} ${safeHe(v.on)}` : '<div class="col-empty">—</div>'}</div></section>
        <section class="torah-cell col gemara" role="region" aria-label="Chumash, chapter ${v.c}, verse ${v.v}" lang="he" dir="rtl"><div class="gem">${num} ${safeHe(v.he)}</div></section>
        <section class="torah-cell col side tosafos" role="region" aria-label="Rashi, chapter ${v.c}, verse ${v.v}" lang="he" dir="rtl">${torahRashiHtml(v)}</section>
      </div>`;
    }).join("");
    return `<section class="torah-chapter" data-chapter="${chap}" aria-labelledby="torah-chapter-${chap}"><h2 class="chap-head" id="torah-chapter-${chap}" lang="he">פרק ${heNum(chap)}</h2>${verses}</section>`;
  }).join("");
  return parshaColHead(parsha, chapters, mode) + `<div class="dafpage parsha-page torah-page${mode === "he" ? " torah-he-only" : ""}">
    <div class="dafpage-label" lang="he">${esc(parshaHe(parsha))}</div>
    ${mode === "daf" ? '<div class="torah-source-head" aria-hidden="true" lang="he" dir="rtl"><span>תרגום אונקלוס</span><span>חומש</span><span>רש״י</span></div>' : ""}
    <div class="torah-chapters">${groups}</div></div>`;
}
async function hydrateParsha() {
  const box = $("#parshaText"); if (!box) return false;
  const gen = (box._hydGen = (box._hydGen || 0) + 1);
  box.setAttribute("aria-busy", "true");
  const data = await loadTorah(box.dataset.sefer);
  if (!box.isConnected || box._hydGen !== gen) return false;
  box.innerHTML = data ? parshaBodyHtml(box.dataset.sefer, box.dataset.parsha, box.dataset.mode, data)
    : `<div class="empty-mini">${(typeof navigator !== "undefined" && navigator.onLine === false) ? "You're offline — reconnect to load the parsha." : "The text of this parsha isn't available yet."}</div>`;
  box.setAttribute("aria-busy", "false");
  const dr = box.closest(".daf-read"); if (dr) dr.classList.toggle("has-spread", !!box.querySelector(".torah-page"));
  applyDafCol(box); attachDafSwipe(box); wireParshaChapterJumps(box);
  const hadPendingY = _pendingY != null;
  consumePendingY();
  if (hadPendingY) requestAnimationFrame(commitTorahReadState); else commitTorahReadState();
  return true;
}
function wireParshaChapterJumps(box) {
  box.querySelectorAll("[data-chapter-jump]").forEach(select => select.onchange = () => {
    const target = box.querySelector(`.torah-chapter[data-chapter="${select.value}"]`); if (!target) return;
    const top = parshaReadingTop(box);
    const scroller = box.id === "rdBody" ? box : window;
    scroller.scrollBy({ top: target.getBoundingClientRect().top - top, behavior: "smooth" });
  });
}
function syncParshaChapterNav() {
  const box = activeTorahBox(), select = box?.querySelector("[data-chapter-jump]"); if (!box || !select) return;
  const top = parshaReadingTop(box), chapters = [...box.querySelectorAll(".torah-chapter")];
  const current = chapters.findLast ? chapters.findLast(n => n.getBoundingClientRect().top <= top + 16) : chapters.filter(n => n.getBoundingClientRect().top <= top + 16).pop();
  if (current) select.value = current.dataset.chapter;
  if (Reader.open && Reader.kind === "torah") {
    const rows = [...box.querySelectorAll(".torah-verse")], probe = top + 48;
    const verse = rows.find(n => n.getBoundingClientRect().bottom > probe) || rows[rows.length - 1], i = rows.indexOf(verse);
    const en = $("#rdTitle .en");
    if (en && verse) en.textContent = `${Reader.sefer} ${String(verse.dataset.ref || "").replace("-", ":")} · ${i + 1}/${rows.length}`;
  }
}

function viewHolidays() {
  let hols = holidayList();
  if (!hols.length) return boxHead("ימים טובים", "Yomim Tovim", false, ["today", {}]) + `<div class="empty-mini">No holiday shiurim yet.</div>`;
  // The next yom tov (within ~10 weeks) leads the list with a "coming up" tag.
  let soon = null, soonDays = 1e9;
  for (const h of hols) { const n = daysUntilHoliday(h.series); if (n != null && n < soonDays) { soonDays = n; soon = h.series; } }
  if (soon && soonDays <= 70) hols = [hols.find(h => h.series === soon), ...hols.filter(h => h.series !== soon)];
  return boxHead("ימים טובים", "Yomim Tovim", false, ["today", {}]) +
    `<div class="boxcol">${hols.map(h => {
      const isSoon = h.series === soon && soonDays <= 70;
      const sub = (isSoon ? `<span class="nb-tag">${soonDays === 0 ? "today" : soonDays === 1 ? "tomorrow" : "in " + soonDays + " days"}</span> · ` : "") + `${esc(hDisp(h.series))} · ${h.count} shiur${h.count > 1 ? "im" : ""}`;
      return navBox(`data-holiday="${esc(h.series)}"`, esc(h.he), sub, h.latin ? "latin" : "");
    }).join("")}</div>`;
}

function viewHoliday(r) {
  const list = holidayShiurim().filter(l => (l.series || "Other") === r.series).sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
  const he = holidayHe(r.series), latin = /[a-z]/i.test(he);
  const pk = `holiday:${r.series}`;
  const admin = pageMediaHtml(pk) + worksheetsHtml(pk);   // gate the empty-state on what actually rendered
  return crumbs([["Yomim Tovim", "holidays"]], esc(hDisp(r.series))) +
    boxHead(esc(he), latin ? "" : hDisp(r.series), latin, ["holidays", {}]) + admin +
    (list.length ? `<div class="rows">${list.map(l => rowHtml(l)).join("")}</div>`
                 : admin ? "" : `<div class="empty-mini">No shiurim for this yom tov yet.</div>`);
}

function viewCategory(r) {
  const cat = r.cat, pretty = prettyCat(cat);
  if (HIDDEN_CAT.test(cat || "")) return `<div class="empty-mini">No shiurim in this category.</div>`;
  if (PARSHA_CAT.test(cat || "")) return viewParsha();       // old links land on the new flows
  if (HOLIDAY_CAT.test(cat || "")) return viewHolidays();
  const list = State.all.filter(l => l.category === cat && !isDafShiur(l)).sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
  const back = boxHead(esc(pretty), "", true, ["topics", {}]);
  if (!list.length) return back + `<div class="empty-mini">No shiurim in this category yet.</div>`;
  return back + `<div class="rows">${list.map(l => rowHtml(l)).join("")}</div>`;
}
function moreSection() {
  const nondaf = State.all.filter(l => !isDafShiur(l) && !isHiddenShiur(l)).slice(0, 3);
  if (!nondaf.length) return "";
  return `<div class="section" role="heading" aria-level="2">Parsha &amp; more</div><div class="rows">${nondaf.map(l => rowHtml(l)).join("")}</div>
    <p class="center" style="margin-top:14px"><button class="textlink" data-route="topics">More shiurim →</button></p>`;
}

/* ---------- Sponsor ---------- */
function viewSponsor() {
  const s = State.content.sponsor || {}, amt = s.amounts || {}, sp = State.sponsor;
  const today = DY.dafForDate(new Date());
  const opt = (kind, t, sub, price, attr) => `<button class="sp-opt ${sp.kind === kind ? "on" : ""}" ${attr} aria-pressed="${sp.kind === kind ? "true" : "false"}"><span><b>${t}</b><span>${sub}</span></span><span class="price">${esc(price || "")}</span></button>`;
  const pre = sp.pre && sp.pre.masechta ? sp.pre : (sp.kind === "daf" ? { masechta: sp.masechta, daf: sp.daf } : null);   // the daf you came from stays offered even while comparing
  const picker = `<div class="sp-opts">
      ${pre ? opt("daf", "This daf", `${esc(pre.masechta || "")} ${esc(pre.daf || "")}`, amt.daf, `data-sp="daf"`) : ""}
      ${opt("today", "Today's daf", `${today.masechta} ${today.daf}`, amt.daf, `data-sp="today"`)}
      ${opt("future", "A future daf", "for a yahrtzeit or simcha", amt.daf, `data-sp="future"`)}
      ${opt("masechta", "A whole masechta", "dedicate an entire tractate", amt.masechta, `data-sp="masechta"`)}
    </div>
    ${sp.kind === "future" ? `<div class="field-label">Date</div><input type="date" id="spDate" aria-label="Date" value="${esc(sp.date || todayStr())}">${sp.date ? `<p class="center muted" style="font-size:14px">that day's daf: <b>${esc(sponsorFutureDaf().masechta)} ${sponsorFutureDaf().daf}</b></p>` : ""}` : ""}
    ${sp.kind === "masechta" ? `<div class="field-label">Masechta</div><select id="spMas" aria-label="Masechta">${DY.SHAS.map(m => `<option value="${esc(m.en)}" ${sp.masechta === m.en ? "selected" : ""}>${esc(m.en)} — ${esc(m.he)}</option>`).join("")}</select>` : ""}`;
  const form = sp.kind ? `<div class="sp-form">
      <div class="sp-target">Sponsoring: <b>${esc(sponsorTargetLabel())}</b></div>
      <div class="sp-steps">Step 1 · The dedication</div>
      <div class="field-label">Dedication</div>
      <select id="spType" aria-label="Dedication">${(Array.isArray(s.dedicationTypes) ? s.dedicationTypes : ["L'ilui nishmas", "In honor of"]).map(t => `<option${sp.type === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <div class="field-label"><label for="spFor">Name (for the dedication)</label></div>
      <input id="spFor" placeholder="e.g. R' Chaim ben Moshe" value="${esc(sp.forName || "")}">
      <div class="field-label"><label for="spFrom">Your name</label></div>
      <input id="spFrom" placeholder="sponsored by…" value="${esc(sp.fromName || "")}">
      <div class="field-label"><label for="spEmail">Your email</label></div>
      <input id="spEmail" type="email" placeholder="so we can confirm" value="${esc(sp.email || "")}">
      <div class="sp-steps">Step 2 · Send it to us</div>
      <div class="sp-preview" id="spPreview">${esc(sponsorBody())}</div>
      <button class="btn solid block" id="spCopy">Copy the dedication</button>
      <button class="btn block" id="spSend" style="margin-top:8px">Email it instead</button>
      <div class="sp-steps">Step 3 · Complete by Zelle</div>
      <button class="btn block" data-route="donate">Open Zelle details →</button>
      ${s.note ? `<p class="muted" style="font-size:12.5px;margin-top:12px">${esc(s.note)}</p>` : ""}
    </div>` : "";
  return `<div class="pagetitle" role="heading" aria-level="1">${esc(s.heading || "Sponsor the Shiur")}</div><p class="lead prewrap">${esc(s.blurb || "")}</p>${picker}${form}`;
}
function sponsorBody() {
  const sp = State.sponsor, c = State.content;
  return `I would like to sponsor: ${sponsorTargetLabel()}\nDedication: ${sp.type || "L'ilui nishmas"} ${sp.forName || ""}\nFrom: ${sp.fromName || ""}${sp.email ? " · " + sp.email : ""}\n(I will complete the sponsorship by Zelle to ${c?.donate?.zelle?.email || ""}.)`;
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
  location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent("Daf Yomi sponsorship — " + sponsorTargetLabel())}&body=${encodeURIComponent(sponsorBody())}`;
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
  // On the phone that would do the paying, a QR on the same screen is unusable —
  // the name + email + Copy lead; the QR follows for a second device.
  return `<div class="pagetitle" role="heading" aria-level="1">${esc(d.heading || "Donate")}</div><p class="lead prewrap">${esc(d.blurb || "")}</p>
    <div class="donate-box">
      <div class="zelle-line" style="margin-top:0">Pay <b>${esc(z.name || "")}</b> via <span class="zelle-brand">Zelle</span><span class="muted">${esc(z.email || "")}</span></div>
      <button class="btn sm copy-btn" data-copy="${esc(z.email || "")}">Copy email</button>
      <p class="muted" style="font-size:13px;margin:10px auto 20px;max-width:40ch">In your bank's app, choose “Send with Zelle” and paste the email above.</p>
      <div class="qr-frame">${qr}<div class="qr-cap">On a computer? Scan with your bank app to pay by <span class="zelle-brand">Zelle</span></div></div>
      ${d.dedicationNote ? `<p class="muted prewrap" style="font-size:13px;margin-top:14px">${esc(d.dedicationNote)}</p>` : ""}</div>`;
}
function viewAbout() {
  const a = State.content.about || {}, c = State.content.contact || {}, p = State.content.phone || {};
  return `<div class="pagetitle" role="heading" aria-level="1">${esc(a.heading || "About")}</div>
    <div class="prose">${(Array.isArray(a.paragraphs) ? a.paragraphs : []).map(x => `<p>${esc(x)}</p>`).join("")}</div>
    ${a.tradition ? `<div class="section" role="heading" aria-level="2">${esc(a.tradition.heading)}</div><div class="prose"><p>${esc(a.tradition.body)}</p></div>` : ""}
    <div class="section" role="heading" aria-level="2">FAQ</div>${(Array.isArray(State.content.faqs) ? State.content.faqs : []).map(x => `<details class="faq"><summary>${esc(x.q)}</summary><div class="a">${esc(x.a)}</div></details>`).join("")}
    <div class="section" role="heading" aria-level="2">Contact</div>
    <p class="prose"><a class="textlink" href="mailto:${esc(c.email || "")}">${esc(c.email || "")}</a>${c.phone ? ` · <a class="textlink" href="tel:${esc(telHref(c.phone))}">${esc(c.phone)}</a>` : ""}${c.whatsapp ? ` · WhatsApp: <a class="textlink" href="tel:${esc(telHref(c.whatsapp))}">${esc(c.whatsapp)}</a>` : ""}${p.number ? ` · ${esc(p.label || "Listen by phone")}: <a class="textlink" href="tel:${esc(telHref(p.number))}">${esc(p.number)}</a>${p.extension ? `, then ext. ${esc(p.extension)}` : ""}` : ""}</p>
    ${p.note ? `<p class="muted" style="font-size:13.5px;margin-top:-6px">${esc(p.note)}</p>` : ""}
    <p class="credits">Torah &amp; daf text courtesy of Sefaria — Tanach, Gemara, Rashi, Tosafos &amp; Onkelos public domain · English © Steinsaltz (CC-BY-NC)</p>`;
}
// "605-477-2100" → tel:+16054772100 (assume US when 10 digits; otherwise dial as written)
function telHref(num) { const d = String(num || "").replace(/\D/g, ""); return d.length === 10 ? "+1" + d : (d.length === 11 && d[0] === "1" ? "+" + d : String(num || "")); }

/* shared */
// Geometric play/pause icons — the text "▶" centers differently on every
// platform (and can render as emoji on phones); an inline SVG is identical
// everywhere and sits dead-center in its circle.
const svgPlay = px => `<svg class="svg-ic" viewBox="0 0 12 12" width="${px}" height="${px}" aria-hidden="true" focusable="false"><path d="M3.4 1.6 L11.2 6 L3.4 10.4 Z" fill="currentColor"/></svg>`;
const svgPause = px => `<svg class="svg-ic" viewBox="0 0 12 12" width="${px}" height="${px}" aria-hidden="true" focusable="false"><rect x="2.7" y="2" width="2.5" height="8" rx=".7" fill="currentColor"/><rect x="6.8" y="2" width="2.5" height="8" rx=".7" fill="currentColor"/></svg>`;
// ▦/⛶ render as tofu or emoji on older phones — draw them ourselves like play/pause
const svgVideo = px => `<svg class="svg-ic" viewBox="0 0 14 12" width="${px}" height="${Math.round(px * 12 / 14)}" aria-hidden="true" focusable="false" style="display:inline-block;vertical-align:-1px"><rect x=".8" y="1.2" width="9.2" height="9.6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.6 4.6 L13.2 2.9 V9.1 L10.6 7.4 Z" fill="currentColor"/></svg>`;
const svgExpand = px => `<svg class="svg-ic" viewBox="0 0 12 12" width="${px}" height="${px}" aria-hidden="true" focusable="false"><path d="M1.2 4.4 V1.2 H4.4 M7.6 1.2 H10.8 V4.4 M10.8 7.6 V10.8 H7.6 M4.4 10.8 H1.2 V7.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const svgShare = px => `<svg class="svg-ic" viewBox="0 0 12 12" width="${px}" height="${px}" aria-hidden="true" focusable="false"><path d="M6 7.6 V1.4 M3.6 3.4 L6 1.2 L8.4 3.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.4 6 H1.6 V10.8 H10.4 V6 H9.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
// One row contract everywhere: the body OPENS the daf's page (text, worksheets,
// watch, sponsor) and the circled ▶ plays. A non-daf shiur has no page of its
// own, so its body plays directly and it gets a ☆ save instead.
function rowHtml(lec, opts = {}) {
  const k = lec._dk, isDaf = k && k.daf;
  const num = isDaf ? esc(window.HebCal ? window.HebCal.gematria(k.daf) : k.daf) : "▸";
  const title = isDaf ? `${esc(k.masechta)} · Daf ${k.daf}` : esc(rowTitle(lec, opts));
  const meta = [fmtDur(lec.duration), gregOf(lec.recorded || lec.posted)].filter(Boolean).join(" · ");
  const main = isDaf
    ? `<button class="row-main" data-rowdaf="${esc(k.masechta)}|${k.daf}" aria-label="Open ${esc(k.masechta)} Daf ${k.daf}">`
    : `<button class="row-main" data-play="${esc(lec.id)}">`;
  const tail = isDaf
    ? `<button class="row-play" data-play="${esc(lec.id)}" aria-label="Play ${esc(k.masechta)} Daf ${k.daf}">${svgPlay(11)}</button>`
    : `<button class="row-fav${isFav(lec.id) ? " on" : ""}" data-rowfav="${esc(lec.id)}" aria-pressed="${isFav(lec.id)}" aria-label="Save this shiur">${isFav(lec.id) ? "★" : "☆"}</button>
       <button class="row-play" data-play="${esc(lec.id)}" aria-label="Play">${svgPlay(11)}</button>`;
  return `<div class="row${State.newIds.has(lec.id) ? " is-new" : ""}">
    ${main}
    <span class="rnum${isDaf ? "" : " sym"}"${isDaf ? "" : ' aria-hidden="true"'}>${num}</span>
    <span class="rmain"><b>${title}</b><span class="rmeta">${meta}</span></span>
    </button>${tail}</div>`;
}
// On a series page ("Re'eh"), titles like "Parashas Re'eh - the topic" repeat the
// page title; keep just the topic there.
function rowTitle(lec, opts) {
  let t = (lec.title || "").trim();
  if (opts.stripSeries && lec.series) {
    const re = new RegExp("^\\s*(parash?a[st]?\\s+)?" + lec.series.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[-–—:·]\\s*", "i");
    const stripped = t.replace(re, "").trim();
    if (stripped) t = stripped;
  }
  return t;
}
function crumbs(parts, title) {
  const heAttr = l => /[֐-׿]/.test(l || "") ? ' lang="he"' : "";   // Hebrew crumb labels get lang="he" for screen readers
  return `<div class="crumbs" dir="ltr">${parts.map(([l, n, p]) => `<button data-go="${n}" data-p="${esc(JSON.stringify(p || {}))}"${heAttr(l)}>${esc(l)}</button>`).join(" › ")} › <b${heAttr(title)}>${esc(title)}</b></div>`;
}

/* ---------- admin-managed page media + worksheets (see loadAdminData) ---------- */
const fmtBytes = n => { n = +n || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + " MB"; if (n >= 1e3) return Math.round(n / 1e3) + " KB"; return n ? n + " B" : ""; };

// Admin-uploaded audio/video for a page that has no catalog shiur to hang
// buttons on (parsha/holiday pages, or an override-only daf).
function pageMediaHtml(pk) {
  const ovm = adminPageMedia(pk); if (!ovm) return "";
  const a = ovm.audio ? adminMediaUrl(ovm.audio.key) : "", v = ovm.video ? adminMediaUrl(ovm.video.key) : "";
  if (!a && !v) return "";
  return `<div class="daf-media ws-pagemedia">
      ${a ? `<button class="btn solid sm" data-oplay="${esc(pk)}">▶ Listen</button>` : ""}
      ${v ? `<button class="btn sm" data-owatch="${esc(pk)}"><span class="vic" aria-hidden="true">${svgVideo(15)}</span>Watch</button>` : ""}
    </div><div id="videoSlot"></div>`;
}

// "Worksheets & sources" — the Rov's PDFs/pictures for this daf or parsha.
// Every item has a proper Open (new tab, our own file on the media CDN) and a
// Download button (blob fetch — the download attribute is ignored cross-origin).
function worksheetsHtml(pk) {
  const items = adminAttachments(pk).map(a => {
    const url = adminMediaUrl(a && a.key); if (!url) return "";
    const title = String(a.title || "Worksheet");
    const he = /[֐-׿]/.test(title);
    const tail = String(a.key).split(".").pop().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const ext = (tail.length >= 2 && tail.length <= 5 && String(a.key).includes(".")) ? tail : "";   // archive keys may have no extension at all
    const meta = [ext, fmtBytes(a.size)].filter(Boolean).join(" · ");
    const dlname = (title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) || "worksheet") + (ext ? "." + ext.toLowerCase() : "");
    return `<div class="ws-row">
      <a class="ws-open" href="${esc(url)}" target="_blank" rel="noopener">
        <span class="ws-ic" aria-hidden="true">▤</span>
        <span class="ws-t"><b${he ? ' lang="he" dir="rtl"' : ""}>${esc(title)}</b>${meta ? `<span class="ws-meta">${esc(meta)}</span>` : ""}</span>
        <span class="ws-go" aria-hidden="true">↗</span>
      </a>
      <button class="ws-dl" data-dl="${esc(url)}" data-dlname="${esc(dlname)}" aria-label="Download ${esc(title)}" title="Download">↓</button>
    </div>`;
  }).join("");
  if (!items) return "";
  return `<div class="section" role="heading" aria-level="2">Worksheets &amp; sources</div><div class="ws-list">${items}</div>`;
}

// Share a daf: the OS share sheet where available (WhatsApp-friendly), else copy the link.
async function shareDaf(id) {
  const [m, d] = String(id || "").split("|");
  const samePage = State.route?.name === "daf" && State.route.id === `${m}|${+d}`;
  const routeToShare = samePage ? State.route : { name: "daf", id: `${m}|${+d}` };
  const url = location.origin + location.pathname + location.search + hashFor(routeToShare);
  const read = samePage ? normalizeReadSnapshot(State.route.read) : null;
  const title = `${read?.masechta || m} · Daf ${read ? read.amud : +d} — Rabbi Shea Stern`;
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch { /* user closed the sheet */ } }
  try { await navigator.clipboard.writeText(url); toast("Link copied — paste it anywhere"); }
  catch { toast(esc(url), 8000); }
}

async function downloadFile(url, name) {
  toast("Downloading…");
  try {
    const r = await fetch(url); if (!r.ok) throw new Error(r.status);
    const b = await r.blob();
    const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = name || "worksheet";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
  } catch { toast("Download failed — try Open instead."); }
}

/* =====================================================================
   wiring
   ===================================================================== */
function wireView(r) {
  const v = $("#view");
  v.querySelectorAll("[data-seder]").forEach(b => b.onclick = () => route("seder", { seder: b.dataset.seder }));
  v.querySelectorAll("[data-masechta]").forEach(b => b.onclick = () => route("masechta", { masechta: b.dataset.masechta }));
  v.querySelectorAll("button[data-sefer]").forEach(b => b.onclick = () => route("sefer", { sefer: b.dataset.sefer }));   // button-qualified: #parshaText/#dafText carry these data attributes too
  v.querySelectorAll("button[data-parsha]").forEach(b => b.onclick = () => route("parshaS", { parsha: b.dataset.parsha }));
  v.querySelectorAll("[data-holiday]").forEach(b => b.onclick = () => route("holiday", { series: b.dataset.holiday }));
  v.querySelectorAll("[data-goback]").forEach(b => b.onclick = goBack);
  v.querySelectorAll("[data-goup]").forEach(b => b.onclick = () => { let p = {}; try { p = JSON.parse(b.dataset.p || "{}"); } catch {} route(b.dataset.goup, p); });
  v.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => route("category", { cat: b.dataset.cat }));
  v.querySelectorAll("button[data-daf]").forEach(b => b.onclick = () => route("daf", { id: b.dataset.daf }));
  v.querySelectorAll("[data-go]").forEach(a => a.onclick = () => { let p = {}; try { p = JSON.parse(a.dataset.p || "{}"); } catch {} route(a.dataset.go, p); });
  v.querySelectorAll("[data-route]").forEach(b => b.onclick = () => route(b.dataset.route));
  v.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => { const p = navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy); if (p && p.then) p.then(() => toast("Email copied")).catch(() => toast(esc(b.dataset.copy))); else toast(esc(b.dataset.copy)); });
  v.querySelectorAll("[data-sponsor-daf]").forEach(b => b.onclick = e => { e.stopPropagation(); const [m, d] = b.dataset.sponsorDaf.split("|"); route("sponsor", { pre: { kind: "daf", masechta: m, daf: +d } }); });
  v.querySelectorAll("[data-watch]").forEach(b => b.onclick = e => { e.stopPropagation(); watchVideo(+b.dataset.watch); });
  v.querySelectorAll("[data-watchdaf]").forEach(b => b.onclick = () => route("daf", { id: b.dataset.watchdaf, watch: true }));
  v.querySelectorAll("[data-oplay]").forEach(b => b.onclick = e => { e.stopPropagation(); playOverride(b.dataset.oplay, "audio"); });
  v.querySelectorAll("[data-owatch]").forEach(b => b.onclick = e => { e.stopPropagation(); playOverride(b.dataset.owatch, "video"); });
  v.querySelectorAll("[data-dl]").forEach(b => b.onclick = e => { e.stopPropagation(); downloadFile(b.dataset.dl, b.dataset.dlname); });
  v.querySelectorAll("button[data-mode]").forEach(b => b.onclick = async () => {
    clearPageMotions();
    const intent = b._pagerIntent || pagerIntent(); b._pagerIntent = null;
    const mode = b.dataset.mode; State._dafMode = mode;
    $$("#dafMode button").forEach(x => { const on = x.dataset.mode === mode; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
    const box = $("#dafText"); if (box) {
      saveColScroll(State._dafCol || "gemara"); holdPagerIntent(intent); box.dataset.mode = mode;
      if (await hydrateDaf()) {
        restoreColScroll(State._dafCol, true, intent.fallbackY, null, intent.preserveRail, false, intent);
        await settlePagerIntent(box, intent, () => box.isConnected && box.dataset.mode === mode);
      }
    } // re-render text only; leaves any playing video intact
  });
  const dr = $(".daf-read");   // these controls are re-rendered inside the text region each flip → delegate
  let drControlIntent = null;
  const rememberControlIntent = e => {
    const control = e.target.closest("[data-gemflip], [data-dcol]");
    if (control) { drControlIntent = pagerIntent(control, true); lockReadMin(drControlIntent.fallbackY); }
  };
  if (dr) dr.onpointerdown = rememberControlIntent;
  if (dr) dr.onmousedown = e => { if (!drControlIntent) rememberControlIntent(e); if (e.target.closest("[data-gemflip], [data-dcol]")) e.preventDefault(); };
  if (dr) dr.onclick = e => {
    const g = e.target.closest("[data-gemflip]"); if (g) { e.preventDefault(); const intent = drControlIntent; drControlIntent = null; gemaraFlip(+g.dataset.gemflip, g, intent); return; }
    const c = e.target.closest("[data-dcol]"); if (c) { const intent = drControlIntent; drControlIntent = null; selectDafCol(c.dataset.dcol, intent); }
    const fs = e.target.closest("[data-parsha-fullscreen]"); if (fs) { const box = $("#parshaText"); if (box) openTorahReader(box.dataset.sefer, box.dataset.parsha, box.dataset.mode); }
  };
  v.querySelectorAll("[data-daynav]").forEach(b => b.onclick = () => dayNav(+b.dataset.daynav));
  v.querySelectorAll("[data-parnav]").forEach(b => b.onclick = () => { const nx = parshaStep(State.route.parsha, +b.dataset.parnav); if (nx) route("parshaS", { parsha: nx.parsha }); });
  v.querySelectorAll("[data-pmode]").forEach(b => b.onclick = async () => {
    const intent = b._pagerIntent || pagerIntent(), anchor = parshaScrollAnchor($("#parshaText")); b._pagerIntent = null;
    saveColScroll(State._parCol || "gemara");
    State._parMode = b.dataset.pmode;
    $$("#parshaMode button").forEach(x => { const on = x.dataset.pmode === State._parMode; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
    const box = $("#parshaText"); if (box) { box.dataset.mode = State._parMode; if (await hydrateParsha()) restoreColScroll(State._parCol || "gemara", true, intent.fallbackY, anchor, intent.preserveRail); }
  });
  [...v.querySelectorAll("button[data-mode], [data-pmode]")].forEach(b => {
    const remember = () => { b._pagerIntent = pagerIntent(); lockReadMin(b._pagerIntent.fallbackY); };
    b.onpointerdown = remember;
    b.onmousedown = e => { if (!b._pagerIntent) remember(); e.preventDefault(); };
  });
  v.querySelectorAll("[data-tsize]").forEach(b => b.onclick = () => bumpDafScale(+b.dataset.tsize));
  v.querySelectorAll("[data-share]").forEach(b => b.onclick = () => shareDaf(b.dataset.share));
  const st = v.querySelector("[data-scrolltoday]"); if (st) st.onclick = () => { const row = $("#drow-today"); if (row) { row.scrollIntoView({ block: "center" }); restartAnim(row, "col-switched"); } };
  const jd = $("#jumpDaf"); if (jd) {   // commit on Enter or the Go button — never on blur, which would swallow a tap on a daf row below
    const jump = () => {
      if (!jd.value) return;
      const d = +jd.value, [mn, mx] = [+jd.min, +jd.max];
      if (d >= mn && d <= mx) route("daf", { id: `${State.route.masechta}|${d}` });
      else toast(`This masechta runs daf ${mn}–${mx}.`);
    };
    jd.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); jump(); } };
    const jg = $("#jumpGo"); if (jg) jg.onclick = jump;
  }
  if ($("#dafFsBtn")) $("#dafFsBtn").onclick = () => { const box = $("#dafText"); if (box) openReader(box.dataset.mas, +box.dataset.daf, box.dataset.mode, box.dataset.amud); };
  if ($("#parshaFsBtn")) $("#parshaFsBtn").onclick = () => { const box = $("#parshaText"); if (box) openTorahReader(box.dataset.sefer, box.dataset.parsha, box.dataset.mode); };
  const bx = $("#bkExport"); if (bx) bx.onclick = exportProgress;
  const bi = $("#bkImport"), bf = $("#bkFile");
  if (bi && bf) { bi.onclick = () => bf.click(); bf.onchange = () => { if (bf.files && bf.files[0]) importProgress(bf.files[0]); bf.value = ""; }; }
  wireRows(v);
  const q = $("#q"); if (q) {   // the query rides in history.state, so Back into Search restores the results
    let _sd;
    q.oninput = () => { clearTimeout(_sd); _sd = setTimeout(() => { runSearch(q.value); try { history.replaceState({ ...(history.state || {}), q: q.value }, ""); } catch {} }, 150); };
    const saved = (history.state && typeof history.state.q === "string") ? history.state.q : "";
    q.value = saved; runSearch(saved);
    if (!saved) q.focus();   // don't pop the phone keyboard over restored results
  }
  v.querySelectorAll("[data-fav]").forEach(b => b.onclick = e => {   // in-place — a rerender would kill a playing in-page video
    e.stopPropagation(); toggleFav(+b.dataset.fav);
    const on = isFav(+b.dataset.fav);
    b.setAttribute("aria-pressed", on); b.textContent = on ? "★ Saved" : "☆ Save";
    toast(on ? "Saved to My Learning ★" : "Removed from saved");
  });
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
  $$("[data-sp]").forEach(b => b.onclick = () => {
    const sp = State.sponsor;
    sp.kind = b.dataset.sp;
    if (b.dataset.sp === "daf" && sp.pre) { sp.masechta = sp.pre.masechta; sp.daf = sp.pre.daf; }
    if (b.dataset.sp === "masechta" && !sp.masechta) sp.masechta = DY.SHAS[0].en;
    rerender();
  });
  const dt = $("#spDate"); if (dt) dt.onchange = () => { State.sponsor.date = dt.value; rerender(); };
  const ms = $("#spMas"); if (ms) ms.onchange = () => { State.sponsor.masechta = ms.value; };
  // typed fields persist in State.sponsor — navigating away and back loses nothing
  const wireField = (id, key) => { const n = $(id); if (n) n.oninput = () => { State.sponsor[key] = n.value; const pv = $("#spPreview"); if (pv) pv.textContent = sponsorBody(); }; };
  wireField("#spFor", "forName"); wireField("#spFrom", "fromName"); wireField("#spEmail", "email");
  const ty = $("#spType"); if (ty) ty.onchange = () => { State.sponsor.type = ty.value; const pv = $("#spPreview"); if (pv) pv.textContent = sponsorBody(); };
  const cp = $("#spCopy"); if (cp) cp.onclick = () => {
    const done = () => toast("Dedication copied — paste it into an email or WhatsApp to us");
    const p = navigator.clipboard && navigator.clipboard.writeText(sponsorBody());
    if (p && p.then) p.then(done).catch(() => toast("Couldn't copy — use Email instead")); else done();
  };
  const send = $("#spSend"); if (send) send.onclick = sendSponsor;
}
function wireRows(scope) {
  // wires every play button in scope (recent rows, search results, and the daf-page / today Listen buttons)
  scope.querySelectorAll("[data-play]").forEach(b => b.onclick = e => { e.stopPropagation(); playId(+b.dataset.play); });
  scope.querySelectorAll("[data-rowdaf]").forEach(b => b.onclick = e => { e.stopPropagation(); route("daf", { id: b.dataset.rowdaf }); });
  scope.querySelectorAll("[data-rowfav]").forEach(b => b.onclick = e => {
    e.stopPropagation(); toggleFav(+b.dataset.rowfav);
    const on = isFav(+b.dataset.rowfav);
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.textContent = on ? "★" : "☆";
    toast(on ? "Saved to My Learning ★" : "Removed from saved");
  });
}
function playId(id) {
  const lec = State.all.find(l => l.id === id); if (!lec) return;
  // "What plays on this page" in the admin is a PAGE override, and every other
  // surface lets it win — so a ▶ in a list has to honour it too.
  const pgOv = lec._dk && lec._dk.daf
    ? (om => om && om.audio && adminMediaUrl(om.audio.key))(adminPageMedia(`daf:${lec._dk.masechta}:${lec._dk.daf}`))
    : "";
  const localUrl = lec.origAudio || lec.localAudio;   // origAudio = self-hosted original recording, preferred over the TA-sourced copy
  const local = pgOv || lec.ovAudio || (State.content.options?.preferSelfHosted !== false && localUrl);   // an admin replacement outranks every tier
  const url = pgOv || lec.ovAudio || (local ? localUrl : lec.audio);
  if (!url) { toast("This shiur isn't available to play yet."); return; }
  Player.playAudio(lec, url, !!local); noteProgress(id);
}

// Play the admin-uploaded media attached to a PAGE (daf/parsha/holiday) —
// works even where no catalog shiur exists at all.
function playOverride(pk, kind) {
  const ovm = adminPageMedia(pk), e = ovm && ovm[kind]; if (!e) return;
  const url = adminMediaUrl(e.key); if (!url) return;
  const lec = { id: "ov:" + pk, title: String(e.label || "Shiur"), duration: 0 };
  const m = /^daf:([^:]+):(\d+)$/.exec(pk);
  if (m) lec._dk = { masechta: m[1], daf: +m[2] };   // so the player bar titles it and "ended" marks the daf learned
  if (kind === "audio") { Player.playAudio(lec, url, true); return; }
  const slot = $("#videoSlot"); if (!slot) return;
  const old = slot.querySelector("video"); if (old) { try { old.pause(); old.removeAttribute("src"); old.load(); } catch {} }
  slot.innerHTML = `<video class="daf-video" controls playsinline preload="metadata"></video>`;
  Player.playVideo(slot.querySelector("video"), lec, url, true);
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
  const local = lec.ovVideo || (State.content.options?.preferSelfHosted !== false && lec.localVideo);   // admin replacement first
  const src = lec.ovVideo || (local ? lec.localVideo : lec.video); if (!src) return;
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
    m.addEventListener("play", () => { pauseAllExcept(m); if (this.media === m) this.ctrls(); });   // one voice, unconditionally — even a stale in-page video restarted via its native controls silences everything else
    m.addEventListener("pause", () => { if (this.media === m) this.ctrls(); });
    m.addEventListener("ratechange", () => { if (this.media === m && this.speed !== m.playbackRate) { this.speed = m.playbackRate; this.ctrls(); } });   // keep the bar's speed in sync with the native video menu (and vice-versa)
    m.addEventListener("ended", () => { if (this.media === m && this.lec) { clearPos(this.lec.id); markShiurLearned(this.lec); this._onEnded(); } });
    m.addEventListener("error", () => { if (this.media === m && this.lec && this.local && !this.isVideo) { this.local = false; if (!this.lec.audio) { this.bar(); return; } this._skipPending = true; this.audio.src = this.lec.audio; this.audio.play().catch(() => {}); this.bar(); } });
  },
  // End of a shiur: say the daf was marked learned, and offer the next one —
  // the daily catch-up loop shouldn't end in silence.
  _onEnded() {
    const k = this.lec && this.lec._dk;
    if (k && k.daf) {
      toast(`Marked ${esc(k.masechta)} ${k.daf} as learned ✓`);
      const nx = dafStep(k.masechta, k.daf, 1);
      const nxShiur = nx && shiurFor(nx.masechta, nx.daf);
      const nxPk = nx ? `daf:${nx.masechta}:${nx.daf}` : null;   // an override-only next daf continues too
      // the page override wins here exactly as it does everywhere else, not
      // only when the catalog has nothing for that daf
      const nxOv = nxPk && (om => om && om.audio && adminMediaUrl(om.audio.key))(adminPageMedia(nxPk));
      if (nxShiur || nxOv) {
        this._next = nxOv ? { ovPk: nxPk } : nxShiur;
        const t = $("#pTitle"); if (t) t.innerHTML = `Up next: ${esc(nx.masechta)} ${nx.daf} — press ▶`;
      }
    }
    this.ctrls();
  },
  playAudio(lec, url, local) {
    this.lec = lec; this.local = !!local; this.isVideo = false; this.media = this.audio; this._next = null;
    this._skipPending = !local; this._resumeTo = resumePoint(lec.id); this._lastSave = 0;
    pauseAllExcept(this.audio);
    this.audio.src = url || lec.audio; this.audio.playbackRate = this.speed;
    this.show(); this.bar(); this.audio.play().catch(() => {});
  },
  playVideo(v, lec, url, local) {
    this.lec = lec; this.local = !!local; this.isVideo = true; this.media = v; this._next = null;
    this._skipPending = !local; this._resumeTo = resumePoint(lec.id); this._lastSave = 0;
    this._bind(v); pauseAllExcept(v);
    v.playbackRate = this.speed; v.src = url;
    this.show(); this.bar(); v.play().catch(() => {});
  },
  show() { $("#player").classList.remove("hidden"); $("#app")?.classList.add("player-active"); document.documentElement.classList.add("player-on"); },
  toggle() {
    const m = this.media; if (!m) return;
    if (m.ended && this._next) { const n = this._next; this._next = null; if (n.ovPk) playOverride(n.ovPk, "audio"); else playId(n.id); return; }   // ▶ after the end plays the next daf
    m.paused ? m.play().catch(() => {}) : m.pause();
  },
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
    const linkable = k && k.daf;
    $("#player").innerHTML = `<div class="scrub"><input type="range" id="pSeek" min="0" max="1000" value="0" aria-label="Seek"></div>
      <div class="prow">
        <button class="pnow" id="pNow" ${linkable ? `title="Open this daf's page"` : 'disabled style="cursor:default"'}><span class="ptype" aria-hidden="true">${this.isVideo ? svgVideo(15) : "♪"}</span><span class="ptxt"><b id="pTitle">${esc(label)}</b><span class="ptime"><span id="pCur">0:00</span> / <span id="pDur">--:--</span></span></span></button>
        <div class="ctrls" id="pCtrls"></div>
        <button class="x" id="pX" aria-label="Close player">✕</button>
      </div>`;
    $("#pX").onclick = () => this.hide();
    if (linkable) $("#pNow").onclick = () => {
      if (Reader.open) { closeReader(); return; }              // reveal the page behind the reader; a second tap navigates
      const id = `${k.masechta}|${k.daf}`, r = State.route;
      if (r.name === "daf" && r.id === id) { window.scrollTo({ top: 0 }); return; }   // already here — don't rerender (that would kill a playing video)
      route("daf", this.isVideo ? { id, watch: true } : { id });   // navigating away mid-video restarts it on its own page at the saved spot
    };
    $("#pSeek").oninput = e => { const m = this.media; if (m && m.duration) m.currentTime = (e.target.value / 1000) * m.duration; };
    this._elCur = $("#pCur"); this._elDur = $("#pDur"); this._elSeek = $("#pSeek");   // cache the stable bar refs — tick() runs ~4Hz, no need to re-query each fire
    this._meta(); this.ctrls(); this.tick();
  },
  ctrls() {
    const c = $("#pCtrls"); if (!c) return; const m = this.media, playing = m && !m.paused && !m.ended;
    if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = playing ? "playing" : "paused"; } catch {} }
    c.innerHTML = `<button id="pB" aria-label="Back 10 seconds">↺<span class="d">10</span></button><button class="pp" id="pP" aria-label="${playing ? "Pause" : "Play"}">${playing ? svgPause(16) : svgPlay(16)}</button><button id="pF" aria-label="Forward 10 seconds"><span class="d">10</span>↻</button><button class="pill" id="pS" aria-label="Playback speed">${this.speed}×</button>`;
    $("#pP").onclick = () => this.toggle(); $("#pB").onclick = () => this.skip(-10); $("#pF").onclick = () => this.skip(10); $("#pS").onclick = () => this.setSpeed();
  },
  tick() {
    const m = this.media, cur = m ? m.currentTime || 0 : 0, dur = m ? m.duration || 0 : 0, c = this._elCur, d = this._elDur, s = this._elSeek;
    if (c) c.textContent = clock(cur); if (d) d.textContent = dur ? clock(dur) : "--:--";
    if (s && dur) { s.value = (cur / dur) * 1000; s.style.setProperty("--fill", ((cur / dur) * 100) + "%"); s.setAttribute("aria-valuetext", clock(cur) + " of " + clock(dur)); }
    this._pos();
    if (this.lec && dur && cur > 8 && cur < dur - 8 && m && !m.paused) { const now = Date.now(); if (now - (this._lastSave || 0) > 4000) { this._lastSave = now; savePos(this.lec.id, cur, dur); } }
  },
};

/* =====================================================================
   status / toast / editor
   ===================================================================== */
function setStatus(kind) { State._sk = kind; const d = $("#live"); if (d) d.className = "live" + (kind === "err" ? " err" : kind === "checking" ? " warn" : ""); }
function toast(html, ms = 4000) { const w = $("#toasts"); if (!w) return; const n = el("div", "toast", html); w.appendChild(n); setTimeout(() => { n.style.transition = "opacity .4s"; n.style.opacity = "0"; setTimeout(() => n.remove(), 400); }, ms); }


function dialogFocusables(root) {
  return root ? [...root.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(n => !n.hidden && n.getAttribute("aria-hidden") !== "true" && n.getClientRects().length) : [];
}
function trapDialogTab(e, root) {
  if (e.key !== "Tab") return false;
  const nodes = dialogFocusables(root); if (!nodes.length) { e.preventDefault(); return true; }
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  return true;
}
window.addEventListener("keydown", e => {
  // Arrows must stay native where they already mean something: form fields, a
  // focused video/audio (seek), text selection (Shift), and under the open menu.
  const tag = (e.target && e.target.tagName) || "";
  const interactive = !!e.target?.closest?.('button, a, input, textarea, select, video, audio, [contenteditable="true"], [role="slider"]');
  const typing = /INPUT|TEXTAREA|SELECT|VIDEO|AUDIO/.test(tag) || (e.target && e.target.isContentEditable);
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
  if (Reader.open) {
    if (e.key === "Escape") { e.preventDefault(); closeReader(); }
    else if (trapDialogTab(e, $("#reader"))) return;
    else if (typing || interactive || !plain) return;
    else if (Reader.kind === "daf" && e.key === "ArrowLeft") { e.preventDefault(); readerFlip(1); }      // RTL: ← advances to the next daf
    else if (Reader.kind === "daf" && e.key === "ArrowRight") { e.preventDefault(); readerFlip(-1); }    // RTL: → goes back to the previous daf
    return;
  }
  const menu = $("#menu");
  if (menu?.classList.contains("open")) {
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
    else trapDialogTab(e, menu);
    return;
  }
  // the in-page daf turns with the arrow keys too
  if (State.route && State.route.name === "daf" && !typing && !interactive && plain) {
    if (e.key === "ArrowLeft") { e.preventDefault(); gemaraFlip(1); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); gemaraFlip(-1); return; }
  }
  if (e.key === "Escape") closeMenu();
});
let _readerResizeRaf = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(_readerResizeRaf);
  _readerResizeRaf = requestAnimationFrame(() => {
    clearPageMotions();
    applyViewportClasses(); setBarH(); sizeDafCarves();
  });
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => sizeDafCarves());   // the gemara's height settles once the webfonts land
try { window.matchMedia("(max-width: 960px)").addEventListener("change", applyViewportClasses); } catch {}
try { window.matchMedia("(max-width: 560px)").addEventListener("change", applyViewportClasses); } catch {}
window.addEventListener("scroll", onReadScroll, { passive: true });
window.addEventListener("pagehide", saveActiveReadingPosition);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveActiveReadingPosition(); });
boot();
