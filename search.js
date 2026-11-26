// Search logic: turns what Gedo says (or types) into a surah or an ayah.
//   "سورة الكهف"            -> surah 18
//   "سورة البقرة آية 255"   -> surah 2, ayah 255
//   "الله لا إله إلا هو الحي القيوم" -> the matching ayah(s)

// ---------- Arabic normalisation ----------
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalize(s) {
  return String(s || "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^ء-ي0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// ---------- Surah names ----------
// Other names people commonly use for some surahs (normalised spelling).
const ALIASES = {
  1: ["فاتحه الكتاب", "ام الكتاب", "الحمد"],
  9: ["براءه"],
  17: ["بني اسرائيل"],
  20: ["طاها"],
  36: ["ياسين", "يا سين"],
  38: ["صاد"],
  40: ["المومن"],
  41: ["حم السجده"],
  47: ["القتال"],
  50: ["قاف"],
  54: ["اقتربت الساعه"],
  67: ["تبارك"],
  68: ["نون", "ن والقلم"],
  76: ["الدهر", "هل اتي"],
  78: ["عم", "عم يتساءلون"],
  94: ["الانشراح", "الم نشرح"],
  96: ["اقرا"],
  98: ["لم يكن"],
  107: ["ارايت"],
  109: ["الكافرين"],
  111: ["تبت", "ابي لهب", "اللهب"],
  112: ["قل هو الله احد", "التوحيد"],
  113: ["قل اعوذ برب الفلق"],
  114: ["قل اعوذ برب الناس"],
};

const nameKey = (s) => normalize(s).replace(/^ال/, "").replace(/ ال/g, " ").replace(/\s/g, "");

let surahKeys = null;
function buildSurahKeys(surahs) {
  surahKeys = [];
  for (const s of surahs) {
    surahKeys.push([s.n, nameKey(s.name)]);
    for (const a of ALIASES[s.n] || []) surahKeys.push([s.n, nameKey(a)]);
  }
}

export function findSurah(text, surahs) {
  if (!surahKeys) buildSurahKeys(surahs);
  const q = normalize(text);
  if (/^\d+$/.test(q)) {
    const n = +q;
    return n >= 1 && n <= 114 ? n : null;
  }
  const k = nameKey(q);
  if (!k) return null;
  let best = null, bestD = Infinity;
  for (const [n, key] of surahKeys) {
    const d = lev(k, key);
    if (d < bestD) { bestD = d; best = n; }
  }
  const allowed = k.length <= 3 ? 0 : Math.max(1, Math.floor(k.length / 3));
  return bestD <= allowed ? best : null;
}

// ---------- Ayah index ----------
const PREFIXES = ["وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك"];
function stem(w) {
  for (const p of PREFIXES) if (w.length - p.length >= 2 && w.startsWith(p)) return w.slice(p.length);
  return w;
}

let index = null; // [{s, a, text, words:Set, stems:Set, list:[]}]
let joined = null; // per surah: {s, text, starts:[offset of each ayah]}
export function buildIndex(raw) {
  index = raw.map(([s, a, t]) => {
    const text = normalize(t);
    const list = text.split(" ");
    return { s, a, text: " " + text + " ", list, words: new Set(list), stems: new Set(list.map(stem)) };
  });
  joined = [];
  for (const v of index) {
    let j = joined[joined.length - 1];
    if (!j || j.s !== v.s) joined.push((j = { s: v.s, text: "", starts: [] }));
    j.starts.push(j.text.length);
    j.text += v.text.slice(0, -1);
  }
  for (const j of joined) j.text += " ";
}

// phrase that runs across the end of one ayah into the next
function findAcross(q) {
  const out = [];
  for (const j of joined) {
    let from = 0, pos;
    while ((pos = j.text.indexOf(" " + q + " ", from)) !== -1) {
      let a = 0;
      while (a + 1 < j.starts.length && j.starts[a + 1] <= pos) a++;
      out.push({ s: j.s, a: a + 1 });
      from = pos + 1;
    }
  }
  return out;
}
export const indexReady = () => !!index;

const OPENINGS = ["اعوذ بالله من الشيطان الرجيم", "بسم الله الرحمن الرحيم", "قال الله تعالي", "قال تعالي"];
const ENDINGS = ["صدق الله العظيم"];

function cleanAyahQuery(q) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of OPENINGS) {
      if (q.startsWith(o + " ")) { q = q.slice(o.length + 1); changed = true; }
    }
    for (const e of ENDINGS) {
      if (q.endsWith(" " + e)) { q = q.slice(0, -e.length - 1); changed = true; }
    }
    const m = q.match(/^(ال)?اي[هت] (.+)$/); // "آية ..." said before the verse
    if (m && m[2].split(" ").length >= 2) { q = m[2]; changed = true; }
  }
  return q;
}

export function findAyahs(text, max = 50) {
  let q = normalize(text);
  if (!q || !index) return [];
  if (/^(ال)?اي[هت] (ال)?كرسي$/.test(q)) return [{ s: 2, a: 255 }];
  const full = q;
  q = cleanAyahQuery(q);
  if (!q) q = full; // e.g. he only said "بسم الله الرحمن الرحيم"

  // 1) exact phrase
  const exact = index.filter((v) => v.text.includes(" " + q + " "));
  if (exact.length) return exact.slice(0, max).map(({ s, a }) => ({ s, a }));
  const across = findAcross(q);
  if (across.length) return across.slice(0, max);
  const partial = index.filter((v) => v.text.includes(q));
  if (partial.length && q.length >= 8) return partial.slice(0, max).map(({ s, a }) => ({ s, a }));

  // 2) word overlap (speech recognition is not always exact)
  const qw = q.split(" ").filter((w) => w.length >= 2);
  if (!qw.length) return [];
  const qs = qw.map(stem);
  const scored = [];
  for (const v of index) {
    let score = 0, hits = [];
    for (let i = 0; i < qw.length; i++) {
      let pt = 0;
      if (v.words.has(qw[i])) pt = 1;
      else if (v.stems.has(qs[i])) pt = 0.85;
      else if (qs[i].length >= 4) {
        for (const w of v.list) {
          if (Math.abs(stem(w).length - qs[i].length) <= 1 && lev(stem(w), qs[i]) <= 1) { pt = 0.6; break; }
        }
      }
      score += pt;
      hits.push(pt > 0);
    }
    if (score / qw.length < 0.55) continue;
    let order = 0;
    for (let i = 1; i < hits.length; i++) if (hits[i] && hits[i - 1]) order++;
    scored.push({ s: v.s, a: v.a, rank: score / qw.length + order * 0.02 - v.list.length * 0.0005 });
  }
  scored.sort((x, y) => y.rank - x.rank);
  return scored.slice(0, max).map(({ s, a }) => ({ s, a }));
}

// ---------- Main entry ----------
// Returns {type:"surah", s, a} | {type:"ayah", results:[{s,a}]} | {type:"none"}
export function parseQuery(text, surahs) {
  const q = normalize(text);
  if (!q) return { type: "none" };
  const m = q.match(/^(ال)?(سوره|سورت|صوره|سور)( رقم)? (.+)$/);
  if (m) {
    let rest = m[4];
    let ayah = 1;
    const am = rest.match(/^(.*?)\s*(?:(?:ال)?اي[هت]|رقم)?\s*(\d+)$/);
    if (am && am[1]) { rest = am[1]; ayah = +am[2]; }
    const s = findSurah(rest, surahs);
    if (s) {
      const max = surahs[s - 1].ayahs;
      return { type: "surah", s, a: Math.min(Math.max(1, ayah), max) };
    }
    if (m[2] === "سوره") {
      // he clearly said "surah" — try the whole thing as a name before giving up
      const s2 = findSurah(m[4], surahs);
      if (s2) return { type: "surah", s: s2, a: 1 };
    }
  }
  const results = findAyahs(text);
  if (results.length) return { type: "ayah", results };
  // last chance: maybe he said only a surah name without "surah"
  const s = findSurah(q, surahs);
  if (s) return { type: "surah", s, a: 1 };
  return { type: "none" };
}
