import { parseQuery, buildIndex, indexReady } from "./search.js";

// ---------- reciters (all have word-by-word timing on quran.com) ----------
const RECITERS = [
  { id: 3, name: "عبد الرحمن السديس", style: "مرتل" },
  { id: 9, name: "محمد صديق المنشاوي", style: "مرتل" },
  { id: 2, name: "عبد الباسط عبد الصمد", style: "مرتل" },
  { id: 1, name: "عبد الباسط عبد الصمد", style: "مجوَّد" },
  { id: 6, name: "محمود خليل الحصري", style: "مرتل" },
  { id: 7, name: "مشاري راشد العفاسي", style: "مرتل" },
  { id: 10, name: "سعود الشريم", style: "مرتل" },
  { id: 4, name: "أبو بكر الشاطري", style: "مرتل" },
  { id: 97, name: "ياسر الدوسري", style: "مرتل" },
  { id: 5, name: "هاني الرفاعي", style: "مرتل" },
];
const SIZES = [30, 36, 40, 44, 50, 56, 64, 72, 82, 94, 108];
const TIMINGS_API = (r, s) => `https://api.qurancdn.com/api/qdc/audio/reciters/${r}/audio_files?chapter=${s}&segments=true`;

// ---------- saved settings ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("q_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("q_" + k, JSON.stringify(v)); } catch {} },
};
const settings = {
  reciter: store.get("reciter", 3),
  theme: store.get("theme", "dark"),
  size: store.get("size", 5), // index in SIZES
};
let last = store.get("last", null); // {s, a}

const $ = (id) => document.getElementById(id);
const toArabicNum = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

// ---------- data ----------
let SURAHS = [];
const surahCache = new Map();
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function loadSurahText(n) {
  if (!surahCache.has(n)) surahCache.set(n, await getJSON(`data/s/${n}.json`));
  return surahCache.get(n);
}
let indexLoading = null;
function ensureIndex() {
  if (!indexLoading) indexLoading = getJSON("data/search.json").then(buildIndex);
  return indexLoading;
}

// ---------- theme & size ----------
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  document.querySelector('meta[name="theme-color"]').content = settings.theme === "dark" ? "#000000" : "#fffdf2";
  document.querySelectorAll(".theme-btn").forEach((b) => b.classList.toggle("on", b.dataset.themeSet === settings.theme));
}
function applySize() {
  document.documentElement.style.setProperty("--qsize", SIZES[settings.size] + "px");
  $("size-down").disabled = settings.size === 0;
  $("size-up").disabled = settings.size === SIZES.length - 1;
}

// ---------- screens / routing ----------
const SCREENS = ["home", "search", "surahs", "settings", "reader"];
function show(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  if (id !== "search") stopListening();
  if (id === "reader") keepAwake(); else releaseAwake();
}
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
async function route() {
  const h = location.hash || "#/";
  const m = h.match(/^#\/read\/(\d+)(?:\/(\d+))?/);
  if (m) return openSurah(+m[1], +(m[2] || 1));
  if (h === "#/search") { show("search"); return startSearch(); }
  if (h === "#/surahs") { show("surahs"); return; }
  if (h === "#/settings") { show("settings"); return; }
  show("home");
  renderHome();
}
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) { $("result-bar").hidden = true; go(g.dataset.go); }
});

// ---------- home ----------
function renderHome() {
  const b = $("continue-btn");
  if (last && SURAHS.length) {
    b.hidden = false;
    $("continue-label").textContent = `أكمل: ${SURAHS[last.s - 1].name} — آية ${toArabicNum(last.a)}`;
  } else b.hidden = true;
}
$("continue-btn").onclick = () => last && go(`#/read/${last.s}/${last.a}`);

// ---------- surah list ----------
function renderSurahList() {
  $("surah-list").innerHTML = SURAHS.map(
    (s) => `<li><button data-go="#/read/${s.n}/1"><span class="no">${toArabicNum(s.n)}</span>` +
      `<span class="nm">${s.name}</span><span class="ct">${toArabicNum(s.ayahs)} آية</span></button></li>`
  ).join("");
}

// ---------- settings ----------
function renderReciters() {
  $("reciter-list").innerHTML = RECITERS.map(
    (r) => `<button data-rec="${r.id}" class="${r.id === settings.reciter ? "on" : ""}">` +
      `<span class="tick">${r.id === settings.reciter ? "✓" : ""}</span>` +
      `<span>${r.name}<small>${r.style}</small></span></button>`
  ).join("");
}
$("reciter-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rec]");
  if (!b) return;
  settings.reciter = +b.dataset.rec;
  store.set("reciter", settings.reciter);
  renderReciters();
  resetAudio();
  previewReciter();
});
// play a few seconds of the chosen reciter so Gedo hears the voice
async function previewReciter() {
  try {
    const t = await getTimings(settings.reciter, 1);
    const a = new Audio(t.url);
    previewAudio?.pause();
    previewAudio = a;
    await a.play();
    setTimeout(() => a.pause(), 7000);
  } catch {}
}
let previewAudio = null;

document.querySelectorAll(".theme-btn").forEach((b) => {
  b.onclick = () => { settings.theme = b.dataset.themeSet; store.set("theme", settings.theme); applyTheme(); };
});
$("size-down").onclick = () => { if (settings.size > 0) { settings.size--; store.set("size", settings.size); applySize(); } };
$("size-up").onclick = () => { if (settings.size < SIZES.length - 1) { settings.size++; store.set("size", settings.size); applySize(); } };

// ---------- reader ----------
let cur = { s: 0, a: 1 }; // surah shown and current ayah
async function openSurah(s, a) {
  s = Math.min(Math.max(1, s), 114);
  const info = SURAHS[s - 1];
  a = Math.min(Math.max(1, a), info.ayahs);
  show("reader");
  if (cur.s !== s) {
    if (audioSurah && audioSurah !== s) resetAudio();
    $("reader-title").textContent = "سورة " + info.name;
    $("text").innerHTML = "<p>…</p>";
    const ayahs = await loadSurahText(s);
    $("bismillah").hidden = !info.bism;
    $("text").innerHTML = ayahs.map(
      (words, i) => `<span class="ayah" data-a="${i + 1}">` +
        words.map((w, j) => `<span class="w" data-w="${j + 1}">${w}</span>`).join(" ") +
        ` <span class="num">${toArabicNum(i + 1)}</span></span> `
    ).join("");
    const nb = $("next-surah");
    nb.hidden = s === 114;
    if (s < 114) nb.textContent = `السورة التالية: ${SURAHS[s].name} ◀`;
    cur.s = s;
    $("page").scrollTop = 0;
  }
  setAyah(a, true);
  hideMsg();
}
$("next-surah").onclick = () => go(`#/read/${cur.s + 1}/1`);

function ayahEl(a) { return $("text").querySelector(`.ayah[data-a="${a}"]`); }
function setAyah(a, scroll, flash) {
  const old = $("text").querySelector(".ayah.cur");
  if (old) old.classList.remove("cur");
  const el = ayahEl(a);
  if (!el) return;
  el.classList.add("cur");
  cur.a = a;
  last = { s: cur.s, a };
  store.set("last", last);
  if (scroll) {
    if (a === 1) $("page").scrollTop = 0;
    else el.scrollIntoView({ block: "start" });
  }
  if (flash) {
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }
}
// tapping an ayah plays from it
$("text").addEventListener("click", (e) => {
  const el = e.target.closest(".ayah");
  if (!el) return;
  const a = +el.dataset.a;
  setAyah(a, false);
  playFrom(cur.s, a);
});
$("prev-btn").onclick = () => moveAyah(-1);
$("next-btn").onclick = () => moveAyah(1);
function moveAyah(d) {
  const n = cur.a + d;
  if (n < 1) { if (cur.s > 1) go(`#/read/${cur.s - 1}/${SURAHS[cur.s - 2].ayahs}`); return; }
  if (n > SURAHS[cur.s - 1].ayahs) { if (cur.s < 114) go(`#/read/${cur.s + 1}/1`); return; }
  setAyah(n, true);
  if (!audio.paused) playFrom(cur.s, n);
}

function showMsg(t) { $("msg").textContent = t; $("msg").hidden = false; }
function hideMsg() { $("msg").hidden = true; }

// ---------- audio with word-by-word highlighting ----------
const audio = $("audio");
let audioSurah = 0, audioReciter = 0, timings = null, tick = null, litWord = null, litAyah = 0;
const timingCache = new Map();

async function getTimings(r, s) {
  const key = r + ":" + s;
  if (!timingCache.has(key)) {
    const j = await getJSON(TIMINGS_API(r, s));
    const f = j.audio_files[0];
    timingCache.set(key, {
      url: f.audio_url,
      verses: f.verse_timings.map((v) => ({
        a: +v.verse_key.split(":")[1],
        from: v.timestamp_from,
        to: v.timestamp_to,
        // each segment: [word position, start ms, end ms]
        segs: (v.segments || []).filter((x) => x.length >= 3).map((x) => [x[0], x[x.length - 2], x[x.length - 1]]),
      })),
    });
  }
  return timingCache.get(key);
}

function resetAudio() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  audioSurah = 0; timings = null;
  clearHighlight();
  setPlayUI(false);
}

async function playFrom(s, a) {
  hideMsg();
  try {
    setPlayUI(true, true);
    if (audioSurah !== s || audioReciter !== settings.reciter || !timings) {
      timings = await getTimings(settings.reciter, s);
      audioSurah = s; audioReciter = settings.reciter;
      audio.src = timings.url;
    }
    const v = timings.verses.find((x) => x.a === a);
    // ayah 1 starts at 0 so the bismillah (if recited) is heard too
    const t = a === 1 ? 0 : (v ? v.from : 0) / 1000;
    if (audio.readyState < 1) await new Promise((res, rej) => {
      audio.addEventListener("loadedmetadata", res, { once: true });
      audio.addEventListener("error", rej, { once: true });
      audio.load();
    });
    audio.currentTime = t;
    await audio.play();
    setMediaSession(s);
  } catch (e) {
    console.error(e);
    setPlayUI(false);
    showMsg(navigator.onLine ? "تعذر تشغيل الصوت، حاول مرة أخرى" : "لا يوجد إنترنت — الصوت يحتاج إلى اتصال بالإنترنت");
  }
}

$("play-btn").onclick = () => {
  if (!audio.paused) { audio.pause(); return; }
  if (audioSurah === cur.s && audioReciter === settings.reciter && audio.currentSrc && audioAyahNow() === cur.a) {
    audio.play().catch(() => playFrom(cur.s, cur.a));
  } else playFrom(cur.s, cur.a);
};
function audioAyahNow() {
  if (!timings) return 0;
  const ms = audio.currentTime * 1000;
  const v = timings.verses.find((x) => ms >= x.from && ms < x.to);
  return v ? v.a : 0;
}

audio.addEventListener("playing", () => { setPlayUI(true); startTick(); });
audio.addEventListener("waiting", () => setPlayUI(true, true));
audio.addEventListener("pause", () => { setPlayUI(false); stopTick(); });
audio.addEventListener("ended", () => {
  stopTick(); clearHighlight();
  // continue with the next surah automatically
  if (audioSurah < 114 && audioSurah === cur.s) {
    const next = audioSurah + 1;
    go(`#/read/${next}/1`);
    setTimeout(() => playFrom(next, 1), 300);
  }
});

function setPlayUI(playing, loading) {
  $("play-ico").textContent = loading ? "⏳" : playing ? "❚❚" : "▶";
  $("play-label").textContent = loading ? "جارٍ التحميل" : playing ? "إيقاف" : "تشغيل";
  $("play-btn").setAttribute("aria-label", playing ? "إيقاف" : "تشغيل");
}

function startTick() { stopTick(); tick = setInterval(highlightNow, 90); highlightNow(); }
function stopTick() { if (tick) clearInterval(tick); tick = null; }
function clearHighlight() { if (litWord) litWord.classList.remove("on"); litWord = null; litAyah = 0; }

function highlightNow() {
  if (!timings || audioSurah !== cur.s) return;
  const ms = audio.currentTime * 1000;
  const vs = timings.verses;
  let v = null;
  for (let i = 0; i < vs.length; i++) {
    if (ms < vs[i].to) { if (ms >= vs[i].from) v = vs[i]; break; }
  }
  if (!v) return;
  if (v.a !== litAyah) { litAyah = v.a; setAyah(v.a, false); }
  let pos = 0;
  for (const [p, st, en] of v.segs) { if (ms >= st && ms < en) { pos = p; break; } if (ms >= st) pos = p; }
  const el = pos ? $("text").querySelector(`.ayah[data-a="${v.a}"] .w[data-w="${pos}"]`) : null;
  if (el !== litWord) {
    if (litWord) litWord.classList.remove("on");
    litWord = el;
    if (el) { el.classList.add("on"); followWord(el); }
  }
}
// keep the word being recited comfortably on screen
function followWord(el) {
  const page = $("page");
  const pr = page.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < pr.top + pr.height * 0.1 || r.bottom > pr.top + pr.height * 0.7) {
    page.scrollBy({ top: r.top - pr.top - pr.height * 0.3, behavior: "smooth" });
  }
}

function setMediaSession(s) {
  if (!("mediaSession" in navigator)) return;
  const rec = RECITERS.find((r) => r.id === settings.reciter);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: "سورة " + SURAHS[s - 1].name, artist: rec ? rec.name : "", album: "قرآن جدو عبد الهادي",
    artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
  });
  navigator.mediaSession.setActionHandler("play", () => audio.play());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
}

// ---------- keep the screen on while reading ----------
let wakeLock = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); } } catch {}
}
function releaseAwake() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("reader").hidden) keepAwake(); });

// ---------- voice search ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false;
let searchResults = [], resultIdx = 0;

function setStatus(t) { $("search-status").textContent = t; }

function startSearch() {
  $("heard").textContent = "";
  ensureIndex();
  if (!SR) {
    $("mic-btn").hidden = true;
    setStatus("اكتب ما تريد البحث عنه");
    return;
  }
  startListening();
}
function startListening() {
  if (!SR) return;
  stopListening();
  rec = new SR();
  rec.lang = "ar-EG";
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.continuous = false;
  let finalText = "", alts = [];
  rec.onstart = () => { listening = true; $("mic-btn").classList.add("listening"); setStatus("تكلم الآن…"); };
  rec.onresult = (e) => {
    let t = "";
    for (let i = 0; i < e.results.length; i++) {
      t += e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        finalText = t;
        alts = Array.from(e.results[i]).map((x) => x.transcript);
      }
    }
    $("heard").textContent = t;
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") setStatus("اسمح للتطبيق باستخدام الميكروفون");
    else if (e.error === "network") setStatus("البحث بالصوت يحتاج إلى إنترنت");
    else if (e.error === "no-speech") setStatus("لم أسمع شيئًا — اضغط وتكلم");
    else setStatus("اضغط على الميكروفون وتكلم");
  };
  rec.onend = () => {
    listening = false;
    $("mic-btn").classList.remove("listening");
    if (finalText) runSearch(finalText, alts);
    else if ($("search-status").textContent === "تكلم الآن…") setStatus("اضغط على الميكروفون وتكلم");
  };
  try { rec.start(); } catch {}
}
function stopListening() {
  if (rec) { try { rec.abort(); } catch {} rec = null; }
  listening = false;
  $("mic-btn").classList.remove("listening");
}
$("mic-btn").onclick = () => (listening ? stopListening() : startListening());
$("type-form").onsubmit = (e) => {
  e.preventDefault();
  const t = $("type-input").value.trim();
  if (t) { $("type-input").blur(); runSearch(t, [t]); }
};

async function runSearch(text, alts) {
  setStatus("جارٍ البحث…");
  await ensureIndex();
  // try the best guess first, then the other things the recogniser thought it heard
  for (const t of [text, ...(alts || [])]) {
    const r = parseQuery(t, SURAHS);
    if (r.type === "surah") {
      searchResults = [];
      $("result-bar").hidden = true;
      location.replace(`#/read/${r.s}/${r.a}`);
      await openSurah(r.s, r.a);
      setAyah(r.a, true, r.a > 1);
      return;
    }
    if (r.type === "ayah") {
      searchResults = r.results;
      resultIdx = 0;
      return showResult();
    }
  }
  setStatus("لم أجد شيئًا — حاول مرة أخرى");
}
async function showResult() {
  const r = searchResults[resultIdx];
  location.replace(`#/read/${r.s}/${r.a}`);
  await openSurah(r.s, r.a);
  setAyah(r.a, true, true);
  const bar = $("result-bar");
  if (searchResults.length > 1) {
    bar.hidden = false;
    $("result-label").textContent = `النتيجة ${toArabicNum(resultIdx + 1)} من ${toArabicNum(searchResults.length)}`;
  } else bar.hidden = true;
}
$("result-next").onclick = () => { resultIdx = (resultIdx + 1) % searchResults.length; showResult(); };
$("result-close").onclick = () => { $("result-bar").hidden = true; };

// ---------- start ----------
applyTheme();
renderReciters();
(async () => {
  SURAHS = await getJSON("data/surahs.json");
  applySize();
  renderSurahList();
  window.addEventListener("hashchange", route);
  route();
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  // when a new version takes over, reload once so the new look appears straight away
  let reloaded = false;
  const hadOld = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadOld && !reloaded) { reloaded = true; location.reload(); } });
}
