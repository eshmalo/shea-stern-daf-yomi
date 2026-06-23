/* =====================================================================
   hebrewcal.js — exact Hebrew-calendar conversion (no dependencies)
   Algorithm: Dershowitz & Reingold, "Calendrical Calculations" (arithmetic
   Hebrew calendar), via fixed/RD day numbers. Verified against known dates
   (1 Tishrei 5786 = 2025-09-23; 6 Tammuz 5786 = 2026-06-21).
   Exposes window.HebCal.
   ===================================================================== */
(function (g) {
  const EPOCH = -1373427; // RD of 1 Tishrei, A.M. 1
  const mod = (a, b) => ((a % b) + b) % b;

  const gregLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  function fixedFromGregorian(y, m, d) {
    return 365 * (y - 1) + Math.floor((y - 1) / 4) - Math.floor((y - 1) / 100) + Math.floor((y - 1) / 400)
      + Math.floor((367 * m - 362) / 12) + (m <= 2 ? 0 : (gregLeap(y) ? -1 : -2)) + d;
  }

  const hebLeap = y => mod(7 * y + 1, 19) < 7;
  const lastMonth = y => (hebLeap(y) ? 13 : 12);
  function elapsedDays(y) {
    const months = Math.floor((235 * y - 234) / 19);
    const parts = 12084 + 13753 * months;
    let day = months * 29 + Math.floor(parts / 25920);
    if (mod(3 * (day + 1), 7) < 3) day += 1;
    return day;
  }
  function newYear(y) { // RD of 1 Tishrei of Hebrew year y
    const a = elapsedDays(y - 1), b = elapsedDays(y), c = elapsedDays(y + 1);
    let delay = 0;
    if (c - b === 356) delay = 2; else if (b - a === 382) delay = 1;
    return EPOCH + b + delay;
  }
  const daysInYear = y => newYear(y + 1) - newYear(y);
  const longCheshvan = y => mod(daysInYear(y), 10) === 5;
  const shortKislev = y => mod(daysInYear(y), 10) === 3;
  function monthDays(y, m) { // m: Nisan=1 … Tishrei=7 … Adar I=12, Adar II=13
    if (m === 2 || m === 4 || m === 6 || m === 10 || m === 13) return 29;
    if (m === 8 && !longCheshvan(y)) return 29;
    if (m === 9 && shortKislev(y)) return 29;
    if (m === 12 && !hebLeap(y)) return 29;
    return 30;
  }
  function fixedFromHeb(y, m, d) {
    let days = newYear(y) + d - 1;
    if (m < 7) {
      const last = lastMonth(y);
      for (let mm = 7; mm <= last; mm++) days += monthDays(y, mm);
      for (let mm = 1; mm < m; mm++) days += monthDays(y, mm);
    } else {
      for (let mm = 7; mm < m; mm++) days += monthDays(y, mm);
    }
    return days;
  }
  function hebFromFixed(date) {
    let y = Math.floor((date - EPOCH) / 365.246822) + 1;
    while (newYear(y + 1) <= date) y++;
    while (newYear(y) > date) y--;
    let m = (date < fixedFromHeb(y, 1, 1)) ? 7 : 1;
    while (date > fixedFromHeb(y, m, monthDays(y, m))) m++;
    const d = date - fixedFromHeb(y, m, 1) + 1;
    return { y, m, d, leap: hebLeap(y) };
  }

  // ---- gematria ----
  const G = { 1: "א", 2: "ב", 3: "ג", 4: "ד", 5: "ה", 6: "ו", 7: "ז", 8: "ח", 9: "ט", 10: "י", 20: "כ", 30: "ל", 40: "מ", 50: "נ", 60: "ס", 70: "ע", 80: "פ", 90: "צ", 100: "ק", 200: "ר", 300: "ש", 400: "ת" };
  function gematria(n) {
    n = Math.round(n); if (!Number.isFinite(n) || n < 1) return "";   // reject junk / negative / zero (e.g. a crafted ?id=…|-1 URL) instead of emitting "undefined"
    let s = "", h = Math.floor(n / 100) * 100; n = n % 100;
    while (h > 0) { const take = Math.min(h, 400); s += G[take]; h -= take; }
    if (n === 15) s += "טו"; else if (n === 16) s += "טז";
    else { const t = Math.floor(n / 10) * 10, o = n % 10; if (t) s += G[t]; if (o) s += G[o]; }
    return s;
  }
  function gematriaP(n) { // with geresh / gershayim
    const s = gematria(n); if (!s) return s;            // no bare gershayim for empty input
    return s.length === 1 ? s + "׳" : s.slice(0, -1) + "״" + s.slice(-1);
  }

  function monthName(y, m, lang) {
    const leap = hebLeap(y);
    const en = ["", "Nisan", "Iyar", "Sivan", "Tammuz", "Av", "Elul", "Tishrei", "Cheshvan", "Kislev", "Tevet", "Shevat", leap ? "Adar I" : "Adar", "Adar II"];
    const he = ["", "ניסן", "אייר", "סיון", "תמוז", "אב", "אלול", "תשרי", "חשון", "כסלו", "טבת", "שבט", leap ? "אדר א׳" : "אדר", "אדר ב׳"];
    return (lang === "he" ? he : en)[m];
  }

  function fromDate(dt) { // JS Date (local) -> hebrew parts + formatted
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return null;   // invalid Date in -> null out (caller already guards the one live call site)
    const f = fixedFromGregorian(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    const h = hebFromFixed(f);
    return {
      ...h,
      monthEn: monthName(h.y, h.m, "en"),
      monthHe: monthName(h.y, h.m, "he"),
      dayHe: gematriaP(h.d),
      yearHe: gematriaP(h.y % 1000),     // e.g. 5786 -> תשפ"ו
      he: `${gematriaP(h.d)} ${monthName(h.y, h.m, "he")} ${gematriaP(h.y % 1000)}`,
      en: `${h.d} ${monthName(h.y, h.m, "en")} ${h.y}`,
    };
  }
  function fromYMD(y, m, d) { return fromDate(new Date(y, m - 1, d)); }

  g.HebCal = { fromDate, fromYMD, gematria, gematriaP, hebFromFixed, fixedFromGregorian, hebLeap, monthName };
})(typeof window !== "undefined" ? window : globalThis);
