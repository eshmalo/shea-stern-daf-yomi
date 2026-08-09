/* =====================================================================
   admin.js — site admin for Rabbi Shea Stern's Daf Yomi site.
   Pick any page (daf / parsha / yom tov), upload or replace its audio
   and video, and attach worksheet PDFs. Files go straight to R2 via
   presigned URLs from the admin API; the public site reads the result
   from site/admin-data.json.
   ===================================================================== */
(function () {
  "use strict";
  const API = String(window.ADMIN_API_URL || "").replace(/\/+$/, "");
  const DY = window.DafYomi;
  const TOKEN_KEY = "dy_admin_session";

  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => (s ?? "").toString().replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const hebrew = s => /[֐-׿]/.test(s || "");
  const fmtBytes = n => { n = +n || 0; if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB"; if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB"; if (n >= 1e3) return Math.round(n / 1e3) + " KB"; return n + " B"; };
  const fmtDate = ts => ts ? new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

  /* Parsha + holiday tables — keep in sync with app.js CHUMASHIM / HOLIDAY_ORDER. */
  const CHUMASHIM = [
    { en: "Bereishit", he: "בראשית", parshiyos: [["Bereishit", "בראשית"], ["Noach", "נח"], ["Lech Lecha", "לך לך"], ["Vayeira", "וירא"], ["Chayei Sarah", "חיי שרה"], ["Toldot", "תולדות"], ["Vayetzei", "ויצא"], ["Vayishlach", "וישלח"], ["Vayeshev", "וישב"], ["Mikeitz", "מקץ"], ["Vayigash", "ויגש"], ["Vayechi", "ויחי"]] },
    { en: "Shemot", he: "שמות", parshiyos: [["Shemot", "שמות"], ["Va'eira", "וארא"], ["Bo", "בא"], ["Beshalach", "בשלח"], ["Yitro", "יתרו"], ["Mishpatim", "משפטים"], ["Terumah", "תרומה"], ["Tetzaveh", "תצוה"], ["Ki Tisa", "כי תשא"], ["Vayakhel", "ויקהל"], ["Pekudei", "פקודי"]] },
    { en: "Vayikra", he: "ויקרא", parshiyos: [["Vayikra", "ויקרא"], ["Tzav", "צו"], ["Shemini", "שמיני"], ["Tazria", "תזריע"], ["Metzora", "מצורע"], ["Acharei Mot", "אחרי מות"], ["Kedoshim", "קדושים"], ["Emor", "אמור"], ["Behar", "בהר"], ["Bechukotai", "בחוקותי"]] },
    { en: "Bamidbar", he: "במדבר", parshiyos: [["Bamidbar", "במדבר"], ["Naso", "נשא"], ["Be'halot'cha", "בהעלותך"], ["Shelach", "שלח"], ["Korach", "קרח"], ["Chukat", "חקת"], ["Balak", "בלק"], ["Pinchas", "פינחס"], ["Matot", "מטות"], ["Masay", "מסעי"]] },
    { en: "Devarim", he: "דברים", parshiyos: [["Devarim", "דברים"], ["V'etchanan", "ואתחנן"], ["Ekev", "עקב"], ["Re'eh", "ראה"], ["Shoftim", "שופטים"], ["Ki Tetzei", "כי תצא"], ["Ki Tavo", "כי תבוא"], ["Nitzavim", "נצבים"], ["Vayelech", "וילך"], ["Ha'azinu", "האזינו"], ["V'Zot Haberacha", "וזאת הברכה"]] },
  ];
  const HOLIDAYS = [
    ["Rosh Hashanah", "ראש השנה"], ["Yom Kippur", "יום כיפור"], ["Sukkot", "סוכות"], ["Hoshana Raba", "הושענא רבה"],
    ["Chanukah", "חנוכה"], ["Purim", "פורים"], ["Pesach/Passover", "פסח"], ["Omer", "ספירת העומר"],
    ["Shavuot", "שבועות"], ["Tisha B'Av", "תשעה באב"],
  ];

  const ACCEPT = {
    audio: ".mp3,.m4a,.wav,.ogg,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg",
    video: ".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime",
    worksheet: ".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.ppt,.pptx",
  };
  const EXT_TYPE = {
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", gif: "image/gif",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  const contentTypeOf = f => {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    return EXT_TYPE[ext] || f.type || "";
  };

  const S = {
    tokenExp: 0, data: null, cdnBase: "",
    sel: { type: "daf", masechta: "Berachos", daf: 2, sefer: "Bereishit", parsha: "Bereishit", holiday: "Rosh Hashanah" },
    pendingFile: null, pendingKind: "", busy: false,
  };

  /* ---------- session + api ---------- */
  function token() {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
      if (t && t.token && t.exp * 1000 > Date.now() + 60000) return t.token;
    } catch {}
    return "";
  }
  function setToken(t, exp) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: t, exp })); } catch {} }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }

  async function api(path, body, method) {
    const r = await fetch(API + path, {
      method: method || (body !== undefined ? "POST" : "GET"),
      headers: Object.assign({ "content-type": "application/json" }, token() ? { authorization: "Bearer " + token() } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let out = {};
    try { out = await r.json(); } catch {}
    if (r.status === 401 && path !== "/login") { clearToken(); render(); throw new Error("Signed out — please sign in again."); }
    if (!r.ok) throw new Error(out.error || ("Request failed (" + r.status + ")"));
    return out;
  }

  /* ---------- page identity ---------- */
  function pageKey() {
    const s = S.sel;
    if (s.type === "daf") return `daf:${s.masechta}:${s.daf}`;
    if (s.type === "parsha") return `parsha:${s.parsha}`;
    return `holiday:${s.holiday}`;
  }
  function pageTitle() {
    const s = S.sel;
    if (s.type === "daf") { const m = DY.BYEN[s.masechta]; return { he: `${m ? m.he : s.masechta} דף ${s.daf}`, en: `${s.masechta} · Daf ${s.daf}` }; }
    if (s.type === "parsha") { for (const c of CHUMASHIM) for (const [en, he] of c.parshiyos) if (en === s.parsha) return { he: `פרשת ${he}`, en: `Parshas ${en}` }; return { he: s.parsha, en: s.parsha }; }
    const h = HOLIDAYS.find(([en]) => en === s.holiday); return { he: h ? h[1] : s.holiday, en: s.holiday.replace(/\/.*$/, "") };
  }
  const fileUrl = key => S.cdnBase + "/" + encodeURI(String(key || "").replace(/^\/+/, ""));

  /* ---------- rendering ---------- */
  function render() {
    const root = $("#adminRoot");
    if (!token()) { root.innerHTML = loginHtml(); wireLogin(); return; }
    if (!S.data) { root.innerHTML = shellHtml(`<div class="adm-note">Loading current site data…</div>`); refresh(); return; }
    root.innerHTML = shellHtml(pickerHtml() + panelHtml());
    wireMain();
  }
  const shellHtml = inner => `
    <div class="adm-wrap">
      <div class="adm-head"><div class="he" lang="he" role="heading" aria-level="1">ניהול האתר</div><div class="en">Rabbi Shea Stern · Daf Yomi — Site Admin</div></div>
      <div class="adm-bar">
        <span class="adm-user">Signed in as the site admin</span>
        <span class="adm-acts"><a class="btn sm" href="https://monseydafyomi.com" target="_blank" rel="noopener">Open the site ↗</a><button class="btn sm" id="btnLogout">Sign out</button></span>
      </div>
      ${inner}
      <p class="adm-note">Changes go live within about a minute. Videos can take a while to upload — keep this page open until the bar finishes.</p>
    </div>`;

  const loginHtml = () => `
    <div class="adm-wrap">
      <div class="adm-head"><div class="he" lang="he" role="heading" aria-level="1">ניהול האתר</div><div class="en">Rabbi Shea Stern · Daf Yomi — Site Admin</div></div>
      <form class="adm-login" id="loginForm">
        <div style="font-size:19px;font-weight:600" role="heading" aria-level="2">Sign in</div>
        <label class="field-label" for="pw">Admin password</label>
        <input type="password" id="pw" autocomplete="current-password" required>
        <div class="adm-err" id="loginErr" role="alert" aria-live="polite"></div>
        <button class="btn solid block" type="submit" id="btnLogin">Sign in</button>
      </form>
    </div>`;

  function pickerHtml() {
    const s = S.sel;
    const segBtn = (t, label) => `<button type="button" data-ptype="${t}" class="${s.type === t ? "on" : ""}" aria-pressed="${s.type === t}">${label}</button>`;
    let selects = "";
    if (s.type === "daf") {
      const mas = DY.SEDARIM.map(sd => `<optgroup label="${esc(sd.en)}">${DY.masechtosInSeder(sd.en).map(m =>
        `<option value="${esc(m.en)}"${m.en === s.masechta ? " selected" : ""}>${esc(m.en)}</option>`).join("")}</optgroup>`).join("");
      const m = DY.BYEN[s.masechta];
      let dafs = "";
      for (let d = m.firstDaf; d <= m.lastDaf; d++) dafs += `<option value="${d}"${d === s.daf ? " selected" : ""}>Daf ${d}</option>`;
      selects = `<select id="selMas" aria-label="Masechta">${mas}</select><select id="selDaf" aria-label="Daf">${dafs}</select>`;
    } else if (s.type === "parsha") {
      const sefer = CHUMASHIM.map(c => `<option value="${esc(c.en)}"${c.en === s.sefer ? " selected" : ""}>${esc(c.en)}</option>`).join("");
      const cur = CHUMASHIM.find(c => c.en === s.sefer) || CHUMASHIM[0];
      const par = cur.parshiyos.map(([en]) => `<option value="${esc(en)}"${en === s.parsha ? " selected" : ""}>${esc(en)}</option>`).join("");
      selects = `<select id="selSefer" aria-label="Chumash">${sefer}</select><select id="selParsha" aria-label="Parsha">${par}</select>`;
    } else {
      const hol = HOLIDAYS.map(([en]) => `<option value="${esc(en)}"${en === s.holiday ? " selected" : ""}>${esc(en.replace(/\/.*$/, ""))}</option>`).join("");
      selects = `<select id="selHol" aria-label="Yom Tov">${hol}</select>`;
    }
    return `<div class="adm-pick">
      <span class="seg" role="group" aria-label="Page type">${segBtn("daf", "Daf")}${segBtn("parsha", "Parsha")}${segBtn("holiday", "Yom Tov")}</span>
      <div class="adm-selrow">${selects}</div>
    </div>`;
  }

  function panelHtml() {
    const pk = pageKey(), t = pageTitle();
    const rawMedia = S.data.media && S.data.media.pages && S.data.media.pages[pk];
    const media = (rawMedia && typeof rawMedia === "object" && !Array.isArray(rawMedia)) ? rawMedia : {};
    const rawAtts = S.data.attachments && S.data.attachments.pages && S.data.attachments.pages[pk];
    const atts = (Array.isArray(rawAtts) ? rawAtts : []).filter(a => a && typeof a === "object");
    const mrow = kind => {
      const e = media[kind];
      const label = kind === "audio" ? "Audio" : "Video";
      return `<div class="adm-mrow">
        <span class="mk">${label}</span>
        <span class="mv">${e ? `<b>✓ Replaced by the Rov's upload</b> · ${esc(fmtDate(e.updated))} · <a href="${esc(fileUrl(e.key))}" target="_blank" rel="noopener">listen / view ↗</a>` : `Using the regular shiur (nothing uploaded here)`}</span>
        <span class="adm-acts">
          <button class="btn sm" data-upmedia="${kind}">${e ? "Replace" : "Upload"}</button>
          ${e ? `<button class="btn sm" data-clearmedia="${kind}">Remove</button>` : ""}
        </span>
      </div>`;
    };
    const attRows = atts.map((a, i) => `
      <div class="adm-att">
        <span class="at"${hebrew(a.title) ? ' dir="rtl"' : ""}><b${hebrew(a.title) ? ' lang="he"' : ""}>${esc(a.title)}</b>
          <span class="m" dir="ltr">${esc([String(a.contentType || "").split("/").pop().toUpperCase(), a.size ? fmtBytes(a.size) : "", fmtDate(a.uploaded)].filter(Boolean).join(" · "))}</span></span>
        <span class="adm-acts">
          <a class="adm-ib" href="${esc(fileUrl(a.key))}" target="_blank" rel="noopener" aria-label="Open ${esc(a.title)}" title="Open">↗</a>
          <button class="adm-ib" data-attup="${esc(a.id)}" ${i === 0 ? "disabled" : ""} aria-label="Move up" title="Move up">↑</button>
          <button class="adm-ib" data-attdn="${esc(a.id)}" ${i === atts.length - 1 ? "disabled" : ""} aria-label="Move down" title="Move down">↓</button>
          <button class="adm-ib" data-attren="${esc(a.id)}" aria-label="Rename" title="Rename">✎</button>
          <button class="adm-ib danger" data-attdel="${esc(a.id)}" aria-label="Delete ${esc(a.title)}" title="Delete">✕</button>
        </span>
      </div>`).join("");
    const pending = S.pendingFile ? `
      <div class="adm-up">
        <div><b>${esc(S.pendingFile.name)}</b> · ${esc(fmtBytes(S.pendingFile.size))}</div>
        <label class="field-label" for="attTitle" style="text-align:left;margin:10px 0 5px;display:block">Title shown on the site</label>
        <input type="text" id="attTitle" style="width:100%;box-sizing:border-box;border:1px solid var(--hair-2);border-radius:4px;padding:10px;font:inherit;background:#fffdf8" value="${esc(S.pendingFile.name.replace(/\.[^.]+$/, ""))}">
        <div class="adm-acts" style="justify-content:center;margin-top:12px">
          <button class="btn solid sm" id="btnAttGo">Upload worksheet</button>
          <button class="btn sm" id="btnAttCancel">Cancel</button>
        </div>
      </div>` : `
      <div class="adm-up">
        <button class="btn accent" data-upws>＋ Add a worksheet / source sheet</button>
        <div class="hint">PDF, picture, or Word/PowerPoint — it appears on this page under “Worksheets &amp; sources”.</div>
      </div>`;
    return `<div class="adm-panel">
      <h2 lang="he" dir="rtl">${esc(t.he)}</h2><div class="sub">${esc(t.en)}</div>
      <div class="adm-sec">Shiur recording</div>
      ${mrow("audio")}${mrow("video")}
      <div class="adm-sec">Worksheets &amp; sources (${atts.length})</div>
      ${attRows || `<div class="adm-mrow"><span class="mv">Nothing attached to this page yet.</span></div>`}
      ${pending}
    </div>
    <input type="file" id="fileMedia">
    <input type="file" id="fileWs" accept="${ACCEPT.worksheet}">`;
  }

  /* ---------- wiring ---------- */
  function wireLogin() {
    $("#loginForm").onsubmit = async e => {
      e.preventDefault();
      const btn = $("#btnLogin"), err = $("#loginErr");
      btn.disabled = true; err.textContent = "";
      try {
        const out = await api("/login", { password: $("#pw").value });
        setToken(out.token, out.exp); render();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    };
  }

  function wireMain() {
    $("#btnLogout").onclick = () => { clearToken(); S.data = null; render(); };
    document.querySelectorAll("[data-ptype]").forEach(b => b.onclick = () => { S.sel.type = b.dataset.ptype; S.pendingFile = null; render(); });
    const on = (id, fn) => { const n = $(id); if (n) n.onchange = fn; };
    on("#selMas", e => { S.sel.masechta = e.target.value; S.sel.daf = DY.BYEN[S.sel.masechta].firstDaf; S.pendingFile = null; render(); });
    on("#selDaf", e => { S.sel.daf = +e.target.value; S.pendingFile = null; render(); });
    on("#selSefer", e => { S.sel.sefer = e.target.value; S.sel.parsha = (CHUMASHIM.find(c => c.en === S.sel.sefer) || CHUMASHIM[0]).parshiyos[0][0]; S.pendingFile = null; render(); });
    on("#selParsha", e => { S.sel.parsha = e.target.value; S.pendingFile = null; render(); });
    on("#selHol", e => { S.sel.holiday = e.target.value; S.pendingFile = null; render(); });

    document.querySelectorAll("[data-upmedia]").forEach(b => b.onclick = () => {
      const kind = b.dataset.upmedia, inp = $("#fileMedia");
      inp.accept = ACCEPT[kind];
      inp.onchange = () => { if (inp.files[0]) uploadMedia(inp.files[0], kind); inp.value = ""; };
      inp.click();
    });
    document.querySelectorAll("[data-clearmedia]").forEach(b => b.onclick = () => clearMedia(b.dataset.clearmedia));
    const ws = document.querySelector("[data-upws]");
    if (ws) ws.onclick = () => {
      const inp = $("#fileWs");
      inp.onchange = () => { if (inp.files[0]) { S.pendingFile = inp.files[0]; render(); } inp.value = ""; };
      inp.click();
    };
    const go = $("#btnAttGo"); if (go) go.onclick = () => uploadWorksheet();
    const cancel = $("#btnAttCancel"); if (cancel) cancel.onclick = () => { S.pendingFile = null; render(); };
    document.querySelectorAll("[data-attdel]").forEach(b => b.onclick = () => deleteAttachment(b.dataset.attdel));
    document.querySelectorAll("[data-attren]").forEach(b => b.onclick = () => renameAttachment(b.dataset.attren));
    document.querySelectorAll("[data-attup]").forEach(b => b.onclick = () => moveAttachment(b.dataset.attup, -1));
    document.querySelectorAll("[data-attdn]").forEach(b => b.onclick = () => moveAttachment(b.dataset.attdn, 1));
  }

  async function refresh() {
    try { const out = await api("/state"); S.data = out.data; S.cdnBase = out.cdnBase; render(); }
    catch (ex) { if (token()) { $("#adminRoot").innerHTML = shellHtml(`<div class="adm-err" style="text-align:center">${esc(ex.message)}</div>`); $("#btnLogout").onclick = () => { clearToken(); render(); }; } }
  }

  /* ---------- uploads ---------- */
  function progUI(name) {
    const div = document.createElement("div");
    div.className = "adm-prog";
    div.setAttribute("role", "dialog");
    div.setAttribute("aria-modal", "true");
    div.setAttribute("aria-label", "Uploading " + name);
    div.innerHTML = `<div class="card"><div class="fn">${esc(name)}</div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div></div></div><div class="pct" aria-live="polite">Starting…</div><div style="margin-top:14px"><button class="btn sm" id="progCancel">Cancel</button></div></div>`;
    document.body.appendChild(div);
    return {
      set(frac, note) { const pc = Math.round(frac * 100); div.querySelector(".bar > div").style.width = pc + "%"; div.querySelector(".bar").setAttribute("aria-valuenow", pc); div.querySelector(".pct").textContent = note || pc + "%"; },
      done() { div.remove(); },
      onCancel(fn) { div.querySelector("#progCancel").onclick = fn; },
    };
  }

  function putWithProgress(url, blob, ctype, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      if (ctype) xhr.setRequestHeader("Content-Type", ctype);
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? resolve({ etag: xhr.getResponseHeader("ETag") || "" })
        : reject(new Error("Upload failed (" + xhr.status + ")"));
      xhr.onerror = () => reject(new Error("Upload failed — check the connection."));
      xhr.onabort = () => reject(new Error("cancelled"));
      xhr.send(blob);
      putWithProgress._xhr = xhr;
    });
  }

  async function uploadToR2(file, kind, prog) {
    const ctype = contentTypeOf(file);
    if (!ctype) throw new Error("That file type isn't supported.");
    const pre = await api("/presign", { kind, pageKey: pageKey(), filename: file.name, contentType: ctype, size: file.size });
    let cancelled = false;
    prog.onCancel(() => { cancelled = true; if (putWithProgress._xhr) putWithProgress._xhr.abort(); });
    if (pre.mode === "single") {
      await putWithProgress(pre.url, file, ctype, (l, t) => prog.set(l / t));
      return pre.key;
    }
    const parts = [];
    const nParts = Math.ceil(file.size / pre.partSize);
    try {
      for (let i = 0; i < nParts; i++) {
        if (cancelled) throw new Error("cancelled");   // cancel pressed between parts
        const blob = file.slice(i * pre.partSize, Math.min((i + 1) * pre.partSize, file.size));
        const { url } = await api("/sign-part", { key: pre.key, uploadId: pre.uploadId, partNumber: i + 1 });
        let etag;
        try {
          ({ etag } = await putWithProgress(url, blob, "", l => prog.set((i * pre.partSize + l) / file.size, `Part ${i + 1} of ${nParts} · ${Math.round(((i * pre.partSize + l) / file.size) * 100)}%`)));
        } catch (ex) {
          if (cancelled) throw ex;
          ({ etag } = await putWithProgress(url, blob, "", l => prog.set((i * pre.partSize + l) / file.size)));   // one retry per part
        }
        if (!etag) throw new Error("The storage server didn't return an upload receipt (ETag) — check the bucket CORS settings.");
        parts.push({ PartNumber: i + 1, ETag: etag });
      }
      await api("/complete", { key: pre.key, uploadId: pre.uploadId, parts });
      return pre.key;
    } catch (ex) {
      try { await api("/abort", { key: pre.key, uploadId: pre.uploadId }); } catch {}
      throw ex;
    }
  }

  async function uploadMedia(file, kind) {
    if (S.busy) return; S.busy = true;
    const prog = progUI(file.name);
    try {
      const pk = pageKey();
      const old = (((S.data.media || {}).pages || {})[pk] || {})[kind];
      const key = await uploadToR2(file, kind, prog);
      prog.set(1, "Saving…");
      const out = await api("/mutate", { ops: [{ op: "set_page_media", pageKey: pk, kind, key, label: pageTitle().en }] });
      S.data = out.data;
      if (old && /^site\/uploads\//.test(old.key)) { try { await api("/delete-object", { key: old.key }); } catch {} }
      render();
    } catch (ex) { if (ex.message !== "cancelled") alert(ex.message); }
    finally { prog.done(); S.busy = false; }
  }

  async function uploadWorksheet() {
    if (S.busy || !S.pendingFile) return; S.busy = true;
    const file = S.pendingFile;
    const title = ($("#attTitle").value || "").trim() || file.name;
    const prog = progUI(file.name);
    try {
      const key = await uploadToR2(file, "worksheet", prog);
      prog.set(1, "Saving…");
      const out = await api("/mutate", { ops: [{ op: "add_attachment", pageKey: pageKey(), title, key, contentType: contentTypeOf(file), size: file.size }] });
      S.data = out.data; S.pendingFile = null;
      render();
    } catch (ex) { if (ex.message !== "cancelled") alert(ex.message); }
    finally { prog.done(); S.busy = false; }
  }

  async function clearMedia(kind) {
    if (!confirm("Remove the uploaded " + kind + "? The page goes back to the regular shiur recording.")) return;
    const pk = pageKey();
    const old = (((S.data.media || {}).pages || {})[pk] || {})[kind];
    try {
      const out = await api("/mutate", { ops: [{ op: "clear_page_media", pageKey: pk, kind }] });
      S.data = out.data;
      if (old && /^site\/uploads\//.test(old.key)) { try { await api("/delete-object", { key: old.key }); } catch {} }
      render();
    } catch (ex) { alert(ex.message); }
  }

  function findAtt(id) { return (((S.data.attachments || {}).pages || {})[pageKey()] || []).find(a => a.id === id); }

  async function deleteAttachment(id) {
    const a = findAtt(id); if (!a) return;
    if (!confirm(`Delete “${a.title}” from this page?`)) return;
    try {
      const out = await api("/mutate", { ops: [{ op: "remove_attachment", pageKey: pageKey(), id }] });
      S.data = out.data;
      if (/^site\/uploads\//.test(a.key)) { try { await api("/delete-object", { key: a.key }); } catch {} }
      render();
    } catch (ex) { alert(ex.message); }
  }

  async function renameAttachment(id) {
    const a = findAtt(id); if (!a) return;
    const title = prompt("Title shown on the site:", a.title);
    if (title == null || !title.trim()) return;
    try { const out = await api("/mutate", { ops: [{ op: "rename_attachment", pageKey: pageKey(), id, title: title.trim() }] }); S.data = out.data; render(); }
    catch (ex) { alert(ex.message); }
  }

  async function moveAttachment(id, dir) {
    try { const out = await api("/mutate", { ops: [{ op: "move_attachment", pageKey: pageKey(), id, dir }] }); S.data = out.data; render(); }
    catch (ex) { alert(ex.message); }
  }

  /* ---------- boot ---------- */
  if (!API) {
    $("#adminRoot").innerHTML = `<div class="adm-wrap"><div class="adm-err" style="text-align:center;margin-top:60px">The admin API address isn't configured (admin/config.js).</div></div>`;
  } else {
    render();
  }
})();
