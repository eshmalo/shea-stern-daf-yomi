/* =====================================================================
   dafyomi.js — the Daf Yomi engine (pure, no DOM)
   Full Shas (Bavli), VERIFIED against the Sefaria library (KHK):
     [english, hebrew, firstDaf, lastDaf, seder, hebrewbooks#]
   - daf counts & Hebrew names confirmed masechta-by-masechta from Sefaria.
   - The Meilah volume is one continuously-paginated unit (daf 2–37,
     HebrewBooks mesechta 36): Meilah 2–22, Kinnim 23–25, Tamid 26–33
     (its text begins on Vilna daf 25b), Middos 34–37.
   - Cycle = 2711 days. Anchor 2020-01-05 = Berachos 2 (verified: today
     2026-06-21 -> Chullin 52, matching the speaker's shiurim).
   ===================================================================== */
(function (g) {
  // [en, he, firstDaf, lastDaf, seder, hb]    (DafYomi days = lastDaf - firstDaf + 1)
  const RAW = [
    ["Berachos", "ברכות", 2, 64, "Zeraim", 1],
    ["Shabbos", "שבת", 2, 157, "Moed", 2],
    ["Eruvin", "עירובין", 2, 105, "Moed", 3],
    ["Pesachim", "פסחים", 2, 121, "Moed", 4],
    ["Shekalim", "שקלים", 2, 22, "Moed", 5],
    ["Yoma", "יומא", 2, 88, "Moed", 6],
    ["Sukkah", "סוכה", 2, 56, "Moed", 7],
    ["Beitzah", "ביצה", 2, 40, "Moed", 8],
    ["Rosh Hashanah", "ראש השנה", 2, 35, "Moed", 9],
    ["Taanis", "תענית", 2, 31, "Moed", 10],
    ["Megillah", "מגילה", 2, 32, "Moed", 11],
    ["Moed Katan", "מועד קטן", 2, 29, "Moed", 12],
    ["Chagigah", "חגיגה", 2, 27, "Moed", 13],
    ["Yevamos", "יבמות", 2, 122, "Nashim", 14],
    ["Kesubos", "כתובות", 2, 112, "Nashim", 15],
    ["Nedarim", "נדרים", 2, 91, "Nashim", 16],
    ["Nazir", "נזיר", 2, 66, "Nashim", 17],
    ["Sotah", "סוטה", 2, 49, "Nashim", 18],
    ["Gittin", "גיטין", 2, 90, "Nashim", 19],
    ["Kiddushin", "קידושין", 2, 82, "Nashim", 20],
    ["Bava Kamma", "בבא קמא", 2, 119, "Nezikin", 21],
    ["Bava Metzia", "בבא מציעא", 2, 119, "Nezikin", 22],
    ["Bava Basra", "בבא בתרא", 2, 176, "Nezikin", 23],
    ["Sanhedrin", "סנהדרין", 2, 113, "Nezikin", 24],
    ["Makkos", "מכות", 2, 24, "Nezikin", 25],
    ["Shevuos", "שבועות", 2, 49, "Nezikin", 26],
    ["Avodah Zarah", "עבודה זרה", 2, 76, "Nezikin", 27],
    ["Horayos", "הוריות", 2, 14, "Nezikin", 28],
    ["Zevachim", "זבחים", 2, 120, "Kodshim", 29],
    ["Menachos", "מנחות", 2, 110, "Kodshim", 30],
    ["Chullin", "חולין", 2, 142, "Kodshim", 31],
    ["Bechoros", "בכורות", 2, 61, "Kodshim", 32],
    ["Arachin", "ערכין", 2, 34, "Kodshim", 33],
    ["Temurah", "תמורה", 2, 34, "Kodshim", 34],
    ["Kerisos", "כריתות", 2, 28, "Kodshim", 35],
    ["Meilah", "מעילה", 2, 22, "Kodshim", 36],
    ["Kinnim", "קינים", 23, 25, "Kodshim", 36],
    ["Tamid", "תמיד", 26, 33, "Kodshim", 36],
    ["Middos", "מדות", 34, 37, "Kodshim", 36],
    ["Niddah", "נדה", 2, 73, "Tahoros", 37],
  ];
  const SHAS = RAW.map(([en, he, firstDaf, lastDaf, seder, hb]) =>
    ({ en, he, firstDaf, lastDaf, seder, hb, dapim: lastDaf - firstDaf + 1 }));

  const SEDARIM = [
    { en: "Zeraim", he: "זרעים" }, { en: "Moed", he: "מועד" }, { en: "Nashim", he: "נשים" },
    { en: "Nezikin", he: "נזיקין" }, { en: "Kodshim", he: "קדשים" }, { en: "Tahoros", he: "טהרות" },
  ];

  const CYCLE = SHAS.reduce((s, m) => s + m.dapim, 0); // 2711
  const ANCHOR = Date.UTC(2020, 0, 5);                 // Berachos 2

  function dafForDate(d) {
    const ms = (d instanceof Date) ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) : d;
    let idx = Math.floor((ms - ANCHOR) / 864e5) % CYCLE;
    if (idx < 0) idx += CYCLE;
    for (const m of SHAS) { if (idx < m.dapim) return { masechta: m.en, he: m.he, daf: idx + m.firstDaf }; idx -= m.dapim; }
    return null;
  }

  // map many spellings (TorahAnytime uses modern translit; we store yeshivish)
  const ALIAS = {
    berachos: "Berachos", berachot: "Berachos", brachos: "Berachos", berakhot: "Berachos",
    shabbos: "Shabbos", shabbat: "Shabbos", shabos: "Shabbos",
    eruvin: "Eruvin", eiruvin: "Eruvin",
    pesachim: "Pesachim", psachim: "Pesachim",
    shekalim: "Shekalim", shkalim: "Shekalim",
    yoma: "Yoma", yuma: "Yoma",
    sukkah: "Sukkah", sukkot: "Sukkah", succah: "Sukkah", sukka: "Sukkah",
    beitzah: "Beitzah", beitza: "Beitzah", beytza: "Beitzah",
    "rosh hashanah": "Rosh Hashanah", "rosh hashana": "Rosh Hashanah",
    taanis: "Taanis", taanit: "Taanis", taanith: "Taanis",
    megillah: "Megillah", megilla: "Megillah", megilah: "Megillah",
    "moed katan": "Moed Katan", "moed kattan": "Moed Katan",
    chagigah: "Chagigah", chagiga: "Chagigah",
    yevamos: "Yevamos", yevamot: "Yevamos", yevamoth: "Yevamos",
    kesubos: "Kesubos", kesuvos: "Kesubos", ketubot: "Kesubos", ketuvot: "Kesubos",
    nedarim: "Nedarim",
    nazir: "Nazir",
    sotah: "Sotah", sota: "Sotah",
    gittin: "Gittin", gitin: "Gittin",
    kiddushin: "Kiddushin", kidushin: "Kiddushin",
    "bava kamma": "Bava Kamma", "bava kama": "Bava Kamma", "baba kamma": "Bava Kamma",
    "bava metzia": "Bava Metzia", "bava metziah": "Bava Metzia", "baba metzia": "Bava Metzia",
    "bava basra": "Bava Basra", "bava batra": "Bava Basra", "baba basra": "Bava Basra",
    sanhedrin: "Sanhedrin",
    makkos: "Makkos", makkot: "Makkos", makos: "Makkos",
    shevuos: "Shevuos", shevuot: "Shevuos", shvuos: "Shevuos", shavuot: "Shevuos", shavuos: "Shevuos",
    "avodah zarah": "Avodah Zarah", "avoda zara": "Avodah Zarah", "avodah zara": "Avodah Zarah",
    horayos: "Horayos", horayot: "Horayos",
    zevachim: "Zevachim", zvachim: "Zevachim",
    menachos: "Menachos", menachot: "Menachos", menochos: "Menachos",
    chullin: "Chullin", chulin: "Chullin",
    bechoros: "Bechoros", bechorot: "Bechoros", bekhorot: "Bechoros",
    arachin: "Arachin", erchin: "Arachin", erachin: "Arachin", arakhin: "Arachin",
    temurah: "Temurah", temura: "Temurah",
    kerisos: "Kerisos", keritot: "Kerisos", kerisus: "Kerisos",
    meilah: "Meilah", meila: "Meilah", "me'ilah": "Meilah",
    kinnim: "Kinnim", kinim: "Kinnim", kinnin: "Kinnim",
    tamid: "Tamid",
    middos: "Middos", middot: "Middos", midos: "Middos", midot: "Middos",
    niddah: "Niddah", nidah: "Niddah", nida: "Niddah",
  };

  const BYEN = Object.fromEntries(SHAS.map(m => [m.en, m]));

  function normalizeMasechta(name) {
    if (!name) return null;
    const k = name.toString().trim().toLowerCase().replace(/[`'’."]/g, "").replace(/\s+/g, " ");
    if (ALIAS[k]) return ALIAS[k];
    for (const a in ALIAS) if (k.includes(a)) return ALIAS[a];
    return null;
  }
  function parseDaf(title) { const m = /daf\s*0*(\d{1,3})/i.exec(title || ""); return m ? +m[1] : null; }
  function shiurDaf(lec) {
    const mas = normalizeMasechta(lec.series) || normalizeMasechta(lec.title);
    const daf = parseDaf(lec.title);
    return mas ? { masechta: mas, daf } : null;
  }

  g.DafYomi = {
    SHAS, SEDARIM, CYCLE, BYEN,
    dafForDate, normalizeMasechta, parseDaf, shiurDaf,
    masechtaHe: en => (BYEN[en] ? BYEN[en].he : en),
    sederHe: en => (SEDARIM.find(s => s.en === en) || {}).he || en,
    masechtosInSeder: seder => SHAS.filter(m => m.seder === seder),
    hbNum: en => (BYEN[en] ? BYEN[en].hb : null),
  };
})(typeof window !== "undefined" ? window : globalThis);
