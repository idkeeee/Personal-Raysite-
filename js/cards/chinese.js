/* ===== Supabase ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);

/* rows in zh_words */
const ZH_WORDS_SLUG = "zh-default";
const ZH_CHAPTERS_SLUG = "zh-chapters";
const ZH_WOTD_HISTORY_SLUG = "zh-wotd-history";
const ZH_WOTD_SETTINGS_SLUG = "zh-wotd-settings";

/* local mirror (offline-ish) */
const CACHE_WORDS_KEY = "zh.words.v2";
const CACHE_CHAPTERS_KEY = "zh.chapters.v1";
const CACHE_WOTD_KEY = "zh.wotd.history.v1";
const CACHE_WOTD_SETTINGS_KEY = "zh.wotd.settings.v1";
const readLocal = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

/* sample fallback */
const SAMPLE_WORDS = [
  { hanzi: "你好", pinyin: "nǐ hǎo",     yisi: "hello", chapters: [] },
  { hanzi: "学习", pinyin: "xuéxí",      yisi: "to study", chapters: [] },
  { hanzi: "天气", pinyin: "tiānqì",     yisi: "weather", chapters: [] },
  { hanzi: "谢谢", pinyin: "xièxie",     yisi: "thank you", chapters: [] },
];

/* state */
let words = readLocal(CACHE_WORDS_KEY) || [...SAMPLE_WORDS];
let chapters = readLocal(CACHE_CHAPTERS_KEY) || [];
let wotdHistory = Array.isArray(readLocal(CACHE_WOTD_KEY)) ? readLocal(CACHE_WOTD_KEY) : [];
let wotdSettings = readLocal(CACHE_WOTD_SETTINGS_KEY) || { enabled:true, every_hours:1 };
let session = "main"; // "main" | "trash"
let uiMode = "trainer"; // "trainer" | "wotd"
let viewIndex = 0;
let wotdViewIndex = 0;
let wotdDeck = [];
let wotdRevealAll = false;
let wotdCurrentPrompt = "hanzi";
let lastWordsVersion = 0;
let lastChaptersVersion = 0;
let lastWotdVersion = 0;
let lastWotdSettingsVersion = 0;
let wotdSettingsPersisted = false;

function normalizeWord(word = {}){
  return {
    hanzi: word.hanzi ?? "",
    pinyin: word.pinyin ?? "",
    yisi: word.yisi ?? "",
    deleted_at: word.deleted_at ?? null,
    chapters: Array.isArray(word.chapters) ? [...new Set(word.chapters)] : []
  };
}

function normalizeChapter(chapter = {}){
  return {
    id: chapter.id ?? makeChapterId(),
    name: chapter.name ?? formatChapterName(chapter.created_at ?? new Date().toISOString()),
    created_at: chapter.created_at ?? new Date().toISOString()
  };
}

function normalizeWotdEntry(entry = {}){
  return {
    date: String(entry.date || ""),
    hanzi: String(entry.hanzi || ""),
    pinyin: String(entry.pinyin || ""),
    yisi: String(entry.yisi || ""),
    created_at: entry.created_at ?? new Date().toISOString()
  };
}

function normalizeWotdSettings(value = {}){
  const everyHours = Number(value.every_hours);
  return {
    enabled: value.enabled !== false,
    every_hours: Number.isInteger(everyHours) && everyHours >= 1 && everyHours <= 24
      ? everyHours
      : 1
  };
}

function getShanghaiDateKey(date = new Date()){
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Asia/Shanghai",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function getTodayWotd(){
  const today = getShanghaiDateKey();
  return wotdHistory.find(entry => normalizeWotdEntry(entry).date === today) || null;
}

function rebuildWotdDeck(preferredDate = null){
  const currentDate = preferredDate || wotdDeck[wotdViewIndex]?.date || getTodayWotd()?.date || null;
  wotdDeck = wotdHistory
    .map(normalizeWotdEntry)
    .filter(entry => entry.date && entry.hanzi && entry.pinyin && entry.yisi)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!wotdDeck.length){
    wotdViewIndex = 0;
    return;
  }

  const preferredIndex = currentDate
    ? wotdDeck.findIndex(entry => entry.date === currentDate)
    : -1;

  wotdViewIndex = preferredIndex >= 0
    ? preferredIndex
    : Math.max(0, Math.min(wotdViewIndex, wotdDeck.length - 1));
}

function getView(){
  const out = [];
  words.forEach((word, rawIdx) => {
    const w = normalizeWord(word);
    const isTrash = Boolean(w.deleted_at);
    const inAnyChapter = Array.isArray(w.chapters) && w.chapters.length > 0;

    if (session === "trash") {
      if (isTrash) out.push({ w, rawIdx });
      return;
    }

    // main session only shows words that are:
    // - not deleted
    // - not inside any chapter
    if (!isTrash && !inAnyChapter) {
      out.push({ w, rawIdx });
    }
  });
  return out;
}
function clampViewIndex(){
  const n = getView().length;
  if (n <= 0) { viewIndex = 0; return; }
  viewIndex = Math.max(0, Math.min(viewIndex, n - 1));
}

/* multi-select toggles define the pool */
const selected = new Set(["hanzi","pinyin","yisi"]);

/* training presentation state */
let revealAll = false;              // false = show one field; true = show all selected
let currentPrompt = "hanzi";        // which single field is showing when revealAll=false

/* DOM */
const cardEl    = document.getElementById("zhCard");
const dictList  = document.getElementById("dictList");
const addBtn    = document.getElementById("zhAddBtn");
const modal     = document.getElementById("zhModal");
const inHanzi   = document.getElementById("inHanzi");
const inPinyin  = document.getElementById("inPinyin");
const inYisi    = document.getElementById("inYisi");
const mSave     = document.getElementById("mSave");
const mCancel   = document.getElementById("mCancel");
const dictSection = document.querySelector(".zh-dict");
const toggleDictBtn = document.getElementById("toggleDictBtn");
const btnOpenChapters = document.getElementById("btnOpenChapters");
const modalTitle = document.getElementById("zhModalTitle");

const trainerPane = document.getElementById("zhTrainerPane");
const wotdPane = document.getElementById("zhWotdPane");
const btnTrainerMode = document.getElementById("btnTrainerMode");
const btnWotdMode = document.getElementById("btnWotdMode");
const wotdCardEl = document.getElementById("zhWotdCard");
const btnWotdAdd = document.getElementById("btnWotdAdd");
const wotdTodayTitle = document.getElementById("wotdTodayTitle");
const wotdTodayMeta = document.getElementById("wotdTodayMeta");
const wotdFrequency = document.getElementById("wotdFrequency");
const btnSaveWotdFrequency = document.getElementById("btnSaveWotdFrequency");
const wotdReminderStatus = document.getElementById("wotdReminderStatus");
const wotdHistoryCount = document.getElementById("wotdHistoryCount");
const wotdHistoryList = document.getElementById("wotdHistoryList");
const btnWotdPrev = document.getElementById("btnWotdPrev");
const btnWotdReveal = document.getElementById("btnWotdReveal");
const btnWotdNext = document.getElementById("btnWotdNext");
const btnWotdShuffle = document.getElementById("btnWotdShuffle");

/* Voice toggle state */
let voiceEnabled = false;
const btnVoice = document.getElementById("btnVoice");

/* Click/tap: always speak Hanzi of current card */
btnVoice.addEventListener("click", () => {
  const w = uiMode === "wotd"
    ? wotdDeck[wotdViewIndex]
    : getView()[viewIndex]?.w;

  if (w) speakChinese(w.hanzi);
});

/* Desktop: right-click to toggle active (glow on/off) */
btnVoice.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  voiceEnabled = !voiceEnabled;
  btnVoice.classList.toggle("active", voiceEnabled);
});

/* Touch: long-press to toggle active */
(() => {
  let t=null, sx=0, sy=0;
  const PRESS=220, MOV=8;
  btnVoice.addEventListener("pointerdown", (e) => {
    if (!("ontouchstart" in window || navigator.maxTouchPoints > 0)) return;
    sx=e.clientX; sy=e.clientY;
    clearTimeout(t);
    t = setTimeout(() => {
      voiceEnabled = !voiceEnabled;
      btnVoice.classList.toggle("active", voiceEnabled);
    }, PRESS);
    btnVoice.setPointerCapture?.(e.pointerId);
  });
  btnVoice.addEventListener("pointermove", (e) => {
    if (!t) return;
    if (Math.abs(e.clientX-sx)>MOV || Math.abs(e.clientY-sy)>MOV) { clearTimeout(t); t=null; }
  });
  ["pointerup","pointercancel","lostpointercapture"].forEach(ev =>
    btnVoice.addEventListener(ev, () => { if (t){ clearTimeout(t); t=null; } })
  );
})();

/* ===== Remote I/O ===== */
async function loadRemote(){
  const { data, error } = await sb
    .from("zh_words")
    .select("slug,data,version")
    .in("slug", [ZH_WORDS_SLUG, ZH_CHAPTERS_SLUG, ZH_WOTD_HISTORY_SLUG, ZH_WOTD_SETTINGS_SLUG]);

  if (error) throw error;

  const rows = new Map((data ?? []).map(row => [row.slug, row]));
  const wordsRow = rows.get(ZH_WORDS_SLUG);
  const chaptersRow = rows.get(ZH_CHAPTERS_SLUG);
  const wotdRow = rows.get(ZH_WOTD_HISTORY_SLUG);
  const wotdSettingsRow = rows.get(ZH_WOTD_SETTINGS_SLUG);

  if (wordsRow?.data && Array.isArray(wordsRow.data)) {
    words = wordsRow.data.map(normalizeWord);
    lastWordsVersion = wordsRow.version ?? 0;
    writeLocal(CACHE_WORDS_KEY, words);
  }

  if (chaptersRow?.data && Array.isArray(chaptersRow.data)) {
    chapters = chaptersRow.data.map(normalizeChapter).sort((a, b) =>
      new Date(a.created_at) - new Date(b.created_at)
    );
    lastChaptersVersion = chaptersRow.version ?? 0;
    writeLocal(CACHE_CHAPTERS_KEY, chapters);
  }

  if (wotdRow?.data && Array.isArray(wotdRow.data)) {
    wotdHistory = wotdRow.data.map(normalizeWotdEntry);
    lastWotdVersion = wotdRow.version ?? 0;
    writeLocal(CACHE_WOTD_KEY, wotdHistory);
  }

  if (wotdSettingsRow?.data && typeof wotdSettingsRow.data === "object" && !Array.isArray(wotdSettingsRow.data)) {
    wotdSettings = normalizeWotdSettings(wotdSettingsRow.data);
    lastWotdSettingsVersion = wotdSettingsRow.version ?? 0;
    wotdSettingsPersisted = true;
    writeLocal(CACHE_WOTD_SETTINGS_KEY, wotdSettings);
  }

  rebuildWotdDeck();
}

let saveWordsTimer = null;
let saveChaptersTimer = null;
let saveWotdTimer = null;
function scheduleSaveWords(){ clearTimeout(saveWordsTimer); saveWordsTimer = setTimeout(saveWordsRemote, 250); }
function scheduleSaveChapters(){ clearTimeout(saveChaptersTimer); saveChaptersTimer = setTimeout(saveChaptersRemote, 250); }
function scheduleSaveWotd(){ clearTimeout(saveWotdTimer); saveWotdTimer = setTimeout(saveWotdRemote, 150); }

async function saveWordsRemote(){
  lastWordsVersion = Date.now();
  const { error } = await sb.from("zh_words").upsert(
    { slug: ZH_WORDS_SLUG, data: words, version: lastWordsVersion, updated_at: new Date().toISOString() },
    { onConflict: "slug" }
  );
  if (!error) writeLocal(CACHE_WORDS_KEY, words);
}

async function saveChaptersRemote(){
  lastChaptersVersion = Date.now();
  const { error } = await sb.from("zh_words").upsert(
    { slug: ZH_CHAPTERS_SLUG, data: chapters, version: lastChaptersVersion, updated_at: new Date().toISOString() },
    { onConflict: "slug" }
  );
  if (!error) writeLocal(CACHE_CHAPTERS_KEY, chapters);
}

async function saveWotdRemote(){
  lastWotdVersion = Date.now();
  const { error } = await sb.from("zh_words").upsert(
    {
      slug: ZH_WOTD_HISTORY_SLUG,
      data: wotdHistory.map(normalizeWotdEntry),
      version: lastWotdVersion,
      updated_at: new Date().toISOString()
    },
    { onConflict:"slug" }
  );

  if (error) throw error;
  writeLocal(CACHE_WOTD_KEY, wotdHistory);
}

async function saveWotdSettingsRemote(){
  lastWotdSettingsVersion = Date.now();
  const cleanSettings = normalizeWotdSettings(wotdSettings);

  const { error } = await sb.from("zh_words").upsert(
    {
      slug: ZH_WOTD_SETTINGS_SLUG,
      data: cleanSettings,
      version: lastWotdSettingsVersion,
      updated_at: new Date().toISOString()
    },
    { onConflict:"slug" }
  );

  if (error) throw error;

  wotdSettings = cleanSettings;
  wotdSettingsPersisted = true;
  writeLocal(CACHE_WOTD_SETTINGS_KEY, wotdSettings);
}


function subscribeRealtime(){
  const ch = sb
    .channel("zh-rt")
    .on(
      "postgres_changes",
      { event:"*", schema:"public", table:"zh_words" },
      (payload) => {
        const row = payload.new || payload.old;
        if (!row?.slug) return;

        if (row.slug === ZH_WORDS_SLUG) {
          const v = row.version ?? 0;
          if (v && v <= lastWordsVersion) return;
          words = Array.isArray(row.data) ? row.data.map(normalizeWord) : [];
          writeLocal(CACHE_WORDS_KEY, words);
          clampViewIndex();
          renderCard(); renderDict();
          return;
        }

        if (row.slug === ZH_CHAPTERS_SLUG) {
          const v = row.version ?? 0;
          if (v && v <= lastChaptersVersion) return;
          chapters = Array.isArray(row.data) ? row.data.map(normalizeChapter).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) : [];
          writeLocal(CACHE_CHAPTERS_KEY, chapters);
          renderDict();
          return;
        }

        if (row.slug === ZH_WOTD_HISTORY_SLUG) {
          const v = row.version ?? 0;
          if (v && v <= lastWotdVersion) return;
          wotdHistory = Array.isArray(row.data) ? row.data.map(normalizeWotdEntry) : [];
          lastWotdVersion = v;
          writeLocal(CACHE_WOTD_KEY, wotdHistory);
          rebuildWotdDeck();
          renderWotdAll();
          return;
        }

        if (row.slug === ZH_WOTD_SETTINGS_SLUG) {
          const v = row.version ?? 0;
          if (v && v <= lastWotdSettingsVersion) return;
          wotdSettings = normalizeWotdSettings(row.data || {});
          lastWotdSettingsVersion = v;
          wotdSettingsPersisted = true;
          writeLocal(CACHE_WOTD_SETTINGS_KEY, wotdSettings);
          renderWotdReminderSettings();
        }
      }
    )
    .subscribe();
  window.addEventListener("beforeunload", () => sb.removeChannel(ch));
}


/* ===== Word of the Day ===== */
function setUiMode(mode){
  uiMode = mode === "wotd" ? "wotd" : "trainer";
  const isWotd = uiMode === "wotd";

  trainerPane.hidden = isWotd;
  wotdPane.hidden = !isWotd;
  btnTrainerMode.classList.toggle("active", !isWotd);
  btnWotdMode.classList.toggle("active", isWotd);

  if (isWotd){
    renderWotdAll();
    if (location.hash !== "#wotd") history.replaceState(null, "", "#wotd");
  } else if (location.hash === "#wotd"){
    history.replaceState(null, "", location.pathname + location.search);
  }
}

function enabledWotdModes(){
  const pool = ["hanzi","pinyin","yisi"].filter(m => selected.has(m));
  if (voiceEnabled) pool.push("voice");
  return pool.length ? pool : ["hanzi"];
}

function pickWotdPromptRandom(){
  const pool = enabledWotdModes();
  wotdCurrentPrompt = pool[Math.floor(Math.random() * pool.length)];
}

function renderWotdToday(){
  const today = getTodayWotd();

  if (!today){
    wotdTodayTitle.textContent = "Nothing picked yet";
    wotdTodayMeta.textContent = "Add today's word and it becomes part of the permanent Word of the Day history.";
    btnWotdAdd.textContent = "＋ Add today's word";
    return;
  }

  const w = normalizeWotdEntry(today);
  wotdTodayTitle.innerHTML = `<span class="zh-wotd-today-word"><strong>${escapeHtml(w.hanzi)}</strong><span>${escapeHtml(w.pinyin)}</span></span>`;
  wotdTodayMeta.textContent = w.yisi;
  btnWotdAdd.textContent = "Edit today's word";
}

function renderWotdReminderSettings(){
  const settings = normalizeWotdSettings(wotdSettings);
  wotdFrequency.value = settings.enabled ? String(settings.every_hours) : "0";

  wotdReminderStatus.textContent = settings.enabled
    ? `Ray will remind you every ${settings.every_hours === 1 ? "hour" : `${settings.every_hours} hours`} outside global DND.`
    : "Word of the Day notifications are off.";

  wotdReminderStatus.className = "zh-wotd-reminder-status";
}

function renderWotdCard(){
  const w = wotdDeck[wotdViewIndex] || null;

  if (!w){
    wotdCardEl.innerHTML = `<div class="zh-wotd-empty-card">No Word of the Day history yet.<br>Add today's word to start the deck.</div>`;
    return;
  }

  const parts = [];

  if (wotdRevealAll){
    if (selected.has("hanzi")) parts.push(`<div class="hanzi">${escapeHtml(w.hanzi)}</div>`);
    if (selected.has("pinyin")) parts.push(`<div class="pinyin">${escapeHtml(w.pinyin)}</div>`);
    if (selected.has("yisi")) parts.push(`<div class="yisi">${escapeHtml(w.yisi)}</div>`);
  } else if (wotdCurrentPrompt === "voice"){
    parts.push(`
      <div class="voice" aria-label="Tap to hear this word">
        <span class="big-voice" id="wotdBigVoice">🔊</span>
      </div>
    `);
  } else {
    const key = wotdCurrentPrompt;
    parts.push(`<div class="${key}">${escapeHtml(w[key] || "—")}</div>`);
  }

  wotdCardEl.innerHTML = `<div class="zh-lines">${parts.join("")}</div>`;

  if (!wotdRevealAll && wotdCurrentPrompt === "voice"){
    document.getElementById("wotdBigVoice")?.addEventListener("click", () => speakChinese(w.hanzi));
  }
}

function renderWotdHistoryList(){
  wotdHistoryList.innerHTML = "";
  const sorted = wotdHistory
    .map(normalizeWotdEntry)
    .filter(entry => entry.date)
    .sort((a, b) => b.date.localeCompare(a.date));

  wotdHistoryCount.textContent = `${sorted.length} word${sorted.length === 1 ? "" : "s"}`;

  for (const entry of sorted){
    const li = document.createElement("li");
    li.className = "dict-item";
    li.innerHTML = `
      <div>
        <span class="zh-wotd-date">${escapeHtml(entry.date)}</span>
        <div class="dict-hanzi">${escapeHtml(entry.hanzi)}</div>
        <div class="dict-pinyin">${escapeHtml(entry.pinyin)}</div>
        <div class="dict-yisi">${escapeHtml(entry.yisi)}</div>
      </div>
      <div class="word-actions">
        <button class="zh-btn mini" data-wotd-edit="${escapeHtml(entry.date)}">Edit</button>
      </div>
    `;
    wotdHistoryList.appendChild(li);
  }
}

function renderWotdAll(){
  rebuildWotdDeck();
  renderWotdToday();
  renderWotdReminderSettings();

  if (!wotdDeck.length){
    wotdRevealAll = false;
  } else if (!enabledWotdModes().includes(wotdCurrentPrompt)){
    pickWotdPromptRandom();
  }

  renderWotdCard();
  renderWotdHistoryList();
}

function openWotdModal(dateKey = getShanghaiDateKey()){
  const existingIndex = wotdHistory.findIndex(entry => normalizeWotdEntry(entry).date === dateKey);
  const existing = existingIndex >= 0 ? normalizeWotdEntry(wotdHistory[existingIndex]) : null;

  modal.hidden = false;
  document.body.classList.add("modal-open");
  modalTitle.textContent = dateKey === getShanghaiDateKey()
    ? (existing ? "Edit today's Word of the Day" : "Add today's Word of the Day")
    : `Edit Word of the Day · ${dateKey}`;

  inHanzi.value = existing?.hanzi || "";
  inPinyin.value = existing?.pinyin || "";
  inYisi.value = existing?.yisi || "";
  mSave.onclick = () => saveWotdWord(dateKey);
  setTimeout(() => inHanzi.focus(), 0);
}

async function saveWotdWord(dateKey){
  const hanzi = inHanzi.value.trim();
  const pinyin = inPinyin.value.trim();
  const yisi = inYisi.value.trim();

  if (!hanzi || !pinyin || !yisi){
    pulseInputs();
    return;
  }

  const existingIndex = wotdHistory.findIndex(entry => normalizeWotdEntry(entry).date === dateKey);
  const entry = normalizeWotdEntry({
    ...(existingIndex >= 0 ? wotdHistory[existingIndex] : {}),
    date: dateKey,
    hanzi,
    pinyin,
    yisi,
    created_at: existingIndex >= 0
      ? normalizeWotdEntry(wotdHistory[existingIndex]).created_at
      : new Date().toISOString()
  });

  if (existingIndex >= 0) wotdHistory[existingIndex] = entry;
  else wotdHistory.push(entry);

  rebuildWotdDeck(dateKey);
  wotdRevealAll = false;
  pickWotdPromptRandom();
  renderWotdAll();
  closeModal();

  try{
    await saveWotdRemote();
  } catch(error){
    console.error("Word of the Day save failed:", error);
    window.alert(`Word of the Day save failed: ${error.message || error}`);
  }

  if (typeof window.refreshCalendarNotifications === "function"){
    void window.refreshCalendarNotifications({ silent:true });
  }
}

/* ===== Curtain (drag-to-cover) ===== */
const CURTAIN_KEY = "zh.curtain.pct";   // 0..1 persisted
let curtainPct = Number(localStorage.getItem(CURTAIN_KEY) || 0); // default 0 = no cover

function ensureCurtain(){
  // create once
  let curtain = cardEl.querySelector(".peek-curtain");
  if (!curtain){
    curtain = document.createElement("div");
    curtain.className = "peek-curtain";
    const handle = document.createElement("div");
    handle.className = "peek-handle";
    curtain.appendChild(handle);
    cardEl.appendChild(curtain);

    // drag logic (pointer events)
    let startX=0, startW=0;
    const onDown = (e)=>{
      startX = e.clientX;
      startW = curtain.getBoundingClientRect().width;
      handle.setPointerCapture?.(e.pointerId);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once:true });
    };
    const onMove = (e)=>{
      const dx = e.clientX - startX;
      const cardRect = cardEl.getBoundingClientRect();
      let w = Math.max(0, Math.min(cardRect.width, startW + dx));
      curtain.style.width = `${w}px`;
      curtainPct = cardRect.width ? (w / cardRect.width) : 0;
    };
    const onUp = ()=>{
      window.removeEventListener("pointermove", onMove);
      localStorage.setItem(CURTAIN_KEY, String(curtainPct));
    };
    handle.addEventListener("pointerdown", onDown);

    // double-click handle to reset
    handle.addEventListener("dblclick", ()=> {
      curtainPct = 0; curtain.style.width = "0px";
      localStorage.setItem(CURTAIN_KEY, "0");
    });
  }

  // apply persisted width
  const rect = cardEl.getBoundingClientRect();
  curtain.style.width = `${Math.max(0, Math.min(rect.width, rect.width * curtainPct))}px`;
}

// keep width consistent on resize
window.addEventListener("resize", ()=>{
  if (!cardEl) return;
  const curtain = cardEl.querySelector(".peek-curtain");
  if (!curtain) return;
  const rect = cardEl.getBoundingClientRect();
  curtain.style.width = `${Math.max(0, Math.min(rect.width, rect.width * curtainPct))}px`;
});

/* ===== helpers ===== */
function enabledModes(){
  const pool = ["hanzi","pinyin","yisi"].filter(m => selected.has(m));
  if (voiceEnabled) pool.push("voice");
  return pool.length ? pool : ["hanzi"]; // never empty
}

function pickPromptRandom(){
  const pool = enabledModes();
  currentPrompt = pool[Math.floor(Math.random()*pool.length)];
}

function formatChapterName(isoString){
  return new Date(isoString).toISOString().slice(0, 10);
}

function makeChapterId(){
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `chapter-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getLatestChapter(){
  if (!chapters.length) return null;
  return [...chapters].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}

function addWordToLatestChapter(rawIdx){
  const latest = getLatestChapter();
  if (!latest) {
    window.alert("No chapter yet. Open Chapters and create one first.");
    return;
  }

  const word = normalizeWord(words[rawIdx]);
  if (!word.chapters.includes(latest.id)) {
    word.chapters.push(latest.id);
    words[rawIdx] = word;
    writeLocal(CACHE_WORDS_KEY, words);
    scheduleSaveWords();
  }

  clampViewIndex();
  revealAll = false;
  pickPromptRandom();
  renderCard();
  renderDict();
  flashCard();
}

function renderCard(){
  const view = getView();
  const w = view[viewIndex]?.w ?? {hanzi:"—", pinyin:"—", yisi:"—"};
  const parts = [];

  if (revealAll) {
    if (selected.has("hanzi"))  parts.push(`<div class="hanzi">${escapeHtml(w.hanzi)}</div>`);
    if (selected.has("pinyin")) parts.push(`<div class="pinyin">${escapeHtml(w.pinyin)}</div>`);
    if (selected.has("yisi"))   parts.push(`<div class="yisi">${escapeHtml(w.yisi)}</div>`);
  } else {
    if (currentPrompt === "voice") {
      parts.push(`
        <div class="voice" aria-label="Tap to hear a random word">
          <span class="big-voice" id="bigVoice">🔊</span>
        </div>
      `);
    } else {
      const key = currentPrompt;
      parts.push(`<div class="${key}">${escapeHtml(w[key] ?? "—")}</div>`);
    }
  }

  cardEl.innerHTML = parts.length
    ? `<div class="zh-lines">${parts.join("")}</div>`
    : `<div class="yisi" style="opacity:.6">Select Hanzi / Pinyin / Yìsi to display</div>`;

  // add/refresh the curtain overlay
  ensureCurtain();

  // re-hook voice button in voice-prompt mode (if you still use that path)
  if (!revealAll && currentPrompt === "voice") {
    const btn = document.getElementById("bigVoice");
    btn?.addEventListener("click", () => {
      const viewNow = getView();
      if (!viewNow.length) return;
      viewIndex = Math.floor(Math.random() * viewNow.length);
      const ww = viewNow[viewIndex].w;
      speakChinese(ww.hanzi);
    });
  }
}

function renderDict(){
  const view = getView();
  dictList.innerHTML = "";
  const latestChapter = getLatestChapter();

  view.forEach(({ w, rawIdx }) => {
    const li = document.createElement("li");
    li.className = "dict-item";

    const chapterCount = Array.isArray(w.chapters) ? w.chapters.length : 0;
    const badge = chapterCount > 0
      ? `<div class="chapter-badge">Chapters: ${chapterCount}</div>`
      : "";

    if (session === "trash") {
      li.innerHTML = `
        <div>
          <div class="dict-hanzi">${escapeHtml(w.hanzi)}</div>
          <div class="dict-pinyin">${escapeHtml(w.pinyin)}</div>
          <div class="dict-yisi">${escapeHtml(w.yisi)}</div>
          ${badge}
        </div>
        <div class="word-actions">
          <button class="zh-btn mini" data-restore="${rawIdx}">Restore</button>
          <button class="zh-btn ghost mini" data-purge="${rawIdx}">Delete forever</button>
        </div>
      `;
    } else {
      li.innerHTML = `
        <div>
          <div class="dict-hanzi">${escapeHtml(w.hanzi)}</div>
          <div class="dict-pinyin">${escapeHtml(w.pinyin)}</div>
          <div class="dict-yisi">${escapeHtml(w.yisi)}</div>
          ${badge}
        </div>
        <div class="word-actions">
          <button class="zh-btn mini" data-edit="${rawIdx}">Edit</button>
          <button class="zh-btn ghost mini" data-trash="${rawIdx}">Delete</button>
          <button class="zh-btn ghost mini" data-move-latest="${rawIdx}" ${latestChapter ? "" : "disabled"}>
            ${latestChapter ? `To latest chapter` : `No chapter yet`}
          </button>
        </div>
      `;
    }

    dictList.appendChild(li);
  });
}

dictList.addEventListener("click", (e) => {
  const editBtn    = e.target.closest("[data-edit]");
  const trashBtn   = e.target.closest("[data-trash]");
  const purgeBtn   = e.target.closest("[data-purge]");
  const restoreBtn = e.target.closest("[data-restore]");
  const moveLatestBtn = e.target.closest("[data-move-latest]");

  if (editBtn) {
    const raw = Number(editBtn.dataset.edit);
    openAddModal("edit", raw);
    return;
  }

  if (moveLatestBtn) {
    const raw = Number(moveLatestBtn.dataset.moveLatest);
    addWordToLatestChapter(raw);
    return;
  }

  // Main session delete => soft delete (no data loss)
  if (trashBtn) {
    const raw = Number(trashBtn.dataset.trash);
    words[raw] = { ...normalizeWord(words[raw]), deleted_at: new Date().toISOString() };
    clampViewIndex();
    renderCard(); renderDict();
    scheduleSaveWords();
    return;
  }

  // Trash session delete => permanent removal
  if (purgeBtn) {
    const raw = Number(purgeBtn.dataset.purge);
    if (!confirm("Permanently delete this word?")) return;
    words.splice(raw, 1);
    clampViewIndex();
    renderCard(); renderDict();
    scheduleSaveWords();
    return;
  }

  if (restoreBtn) {
    const raw = Number(restoreBtn.dataset.restore);
    words[raw] = { ...normalizeWord(words[raw]), deleted_at: null };
    clampViewIndex();
    renderCard(); renderDict();
    scheduleSaveWords();
    return;
  }
});

/* ===== TTS (Web Speech API) ===== */
let zhVoice = null;
function pickZhVoice() {
  const voices = speechSynthesis.getVoices();
  zhVoice =
    voices.find(v => /zh[-_]CN/i.test(v.lang)) ||
    voices.find(v => /^zh/i.test(v.lang)) ||
    null;
}
if ('speechSynthesis' in window) {
  pickZhVoice();
  window.speechSynthesis.onvoiceschanged = pickZhVoice;
}
function speakChinese(text) {
  if (!("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = (zhVoice && zhVoice.lang) || "zh-CN";
  if (zhVoice) u.voice = zhVoice;
  u.rate = 0.95;
  u.pitch = 1.0;
  speechSynthesis.speak(u);
}

/* ===== controls ===== */
const trashModeBtn = document.getElementById("btnTrashSession");

function syncTrashBtn(){
  if (!trashModeBtn) return;
  const on = (session === "trash");
  trashModeBtn.classList.toggle("active", on);
  trashModeBtn.textContent = on ? "Trash (ON)" : "Trash";
}

trashModeBtn?.addEventListener("click", () => {
  session = (session === "trash") ? "main" : "trash";
  viewIndex = 0;
  revealAll = false;
  pickPromptRandom();
  syncTrashBtn();
  renderCard();
  renderDict();
});

btnOpenChapters?.addEventListener("click", () => {
  window.location.href = "html/cards/chapters.html";
});

document.getElementById("btnPrev").addEventListener("click", () => {
  const view = getView();
  if (!view.length) return;
  viewIndex = (viewIndex - 1 + view.length) % view.length;
  revealAll = false;
  pickPromptRandom();
  renderCard();
});

document.getElementById("btnNext").addEventListener("click", () => {
  const view = getView();
  if (!view.length) return;
  viewIndex = (viewIndex + 1) % view.length;
  revealAll = false;
  pickPromptRandom();
  renderCard();
});

document.getElementById("btnReveal").addEventListener("click", () => {
  revealAll = true;
  renderCard();
});

function shuffleCurrentSession(){
  const ids = getView().map(v => v.rawIdx);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = ids[i], b = ids[j];
    [words[a], words[b]] = [words[b], words[a]];
  }
}

document.getElementById("btnShuffle").addEventListener("click", () => {
  shuffleCurrentSession();
  viewIndex = 0;
  revealAll = false;
  pickPromptRandom();
  renderCard(); renderDict(); scheduleSaveWords();
});

/* hide/show dictionary */
toggleDictBtn.addEventListener("click", () => {
  dictSection.classList.toggle("hidden");
  toggleDictBtn.textContent = dictSection.classList.contains("hidden") ? "Show" : "Hide";
});

/* ===== toggles (multi-select pool) ===== */
document.querySelectorAll(".zh-toggle:not(#btnVoice)").forEach(btn => {
  const m = btn.dataset.mode;
  btn.addEventListener("click", () => {
    if (selected.has(m)) selected.delete(m); else selected.add(m);
    btn.classList.toggle("active", selected.has(m));
    if (!revealAll) {
      const pool = enabledModes();
      if (!pool.includes(currentPrompt)) pickPromptRandom();
    }
    if (uiMode === "wotd") renderWotdCard();
    else renderCard();
  });
});

/* ===== Add/Edit Modal ===== */
addBtn.addEventListener("click", () => openAddModal("create"));

function openAddModal(mode, idx=null){
  modal.hidden = false;
  document.body.classList.add("modal-open");
  modalTitle.textContent = mode === "edit" ? "Edit word" : "Add new word";
  if (mode === "edit" && idx != null) {
    const w = normalizeWord(words[idx]);
    inHanzi.value  = w.hanzi;
    inPinyin.value = w.pinyin;
    inYisi.value   = w.yisi;
    mSave.onclick = () => saveWord("edit", idx);
  } else {
    inHanzi.value = inPinyin.value = inYisi.value = "";
    mSave.onclick = () => saveWord("create");
  }
  setTimeout(()=> inHanzi.focus(), 0);
}
function closeModal(){
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}
mCancel.addEventListener("click", closeModal);

function saveWord(mode, idx=null){
  const hanzi  = inHanzi.value.trim();
  const pinyin = inPinyin.value.trim();
  const yisi   = inYisi.value.trim();
  if (!hanzi || !pinyin || !yisi) { pulseInputs(); return; } // strict require all

  if (mode === "create") {
    words.push({ hanzi, pinyin, yisi, deleted_at: null, chapters: [] });
    session = "main";
    viewIndex = getView().length - 1;
  } else if (mode === "edit" && idx != null) {
    words[idx] = { ...normalizeWord(words[idx]), hanzi, pinyin, yisi };
    clampViewIndex();
  }
  revealAll = false;
  pickPromptRandom();
  renderCard(); renderDict();
  scheduleSaveWords();
  closeModal();
}


/* ===== Word of the Day controls ===== */
btnTrainerMode.addEventListener("click", () => setUiMode("trainer"));
btnWotdMode.addEventListener("click", () => setUiMode("wotd"));
btnWotdAdd.addEventListener("click", () => openWotdModal(getShanghaiDateKey()));

btnWotdPrev.addEventListener("click", () => {
  if (!wotdDeck.length) return;
  wotdViewIndex = (wotdViewIndex - 1 + wotdDeck.length) % wotdDeck.length;
  wotdRevealAll = false;
  pickWotdPromptRandom();
  renderWotdCard();
});

btnWotdNext.addEventListener("click", () => {
  if (!wotdDeck.length) return;
  wotdViewIndex = (wotdViewIndex + 1) % wotdDeck.length;
  wotdRevealAll = false;
  pickWotdPromptRandom();
  renderWotdCard();
});

btnWotdReveal.addEventListener("click", () => {
  wotdRevealAll = true;
  renderWotdCard();
});

btnWotdShuffle.addEventListener("click", () => {
  for (let i = wotdDeck.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [wotdDeck[i], wotdDeck[j]] = [wotdDeck[j], wotdDeck[i]];
  }

  wotdViewIndex = 0;
  wotdRevealAll = false;
  pickWotdPromptRandom();
  renderWotdCard();
});

wotdHistoryList.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-wotd-edit]");
  if (!edit) return;
  openWotdModal(edit.dataset.wotdEdit);
});

btnSaveWotdFrequency.addEventListener("click", async () => {
  const selectedValue = Number(wotdFrequency.value);
  const previousText = btnSaveWotdFrequency.textContent;

  wotdSettings = selectedValue === 0
    ? { enabled:false, every_hours:1 }
    : { enabled:true, every_hours:selectedValue };

  btnSaveWotdFrequency.disabled = true;
  btnSaveWotdFrequency.textContent = "Saving...";
  wotdReminderStatus.textContent = "Saving reminder frequency...";
  wotdReminderStatus.className = "zh-wotd-reminder-status";

  try{
    await saveWotdSettingsRemote();
    renderWotdReminderSettings();
    wotdReminderStatus.classList.add("is-success");

    if (typeof window.refreshCalendarNotifications === "function"){
      void window.refreshCalendarNotifications({ silent:true });
    }
  } catch(error){
    console.error("Word of the Day reminder settings save failed:", error);
    wotdReminderStatus.textContent = `Could not save: ${error.message || error}`;
    wotdReminderStatus.className = "zh-wotd-reminder-status is-error";
  } finally {
    btnSaveWotdFrequency.disabled = false;
    btnSaveWotdFrequency.textContent = previousText;
  }
});

/* ===== visuals/helpers ===== */
function flashCard(){
  cardEl.style.transition = "background-color .25s";
  cardEl.style.backgroundColor = "#242327";
  setTimeout(()=> { cardEl.style.backgroundColor = ""; }, 180);
}
function pulseInputs(){
  [inHanzi, inPinyin, inYisi].forEach(el => {
    el.animate([{boxShadow:"0 0 0 0 rgba(255,0,0,0)"},{boxShadow:"0 0 0 3px rgba(255,80,80,.35)"},{boxShadow:"0 0 0 0 rgba(255,0,0,0)"}],{duration:500});
  });
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

/* ===== boot ===== */
(async function init(){
  try { await loadRemote(); } catch(e){ console.warn("zh load failed, using local:", e.message); }

  if (!wotdSettingsPersisted){
    try { await saveWotdSettingsRemote(); }
    catch(e){ console.warn("WOTD settings init failed:", e.message); }
  }

  pickPromptRandom();
  pickWotdPromptRandom();
  renderCard();
  renderDict();
  rebuildWotdDeck();
  renderWotdAll();
  syncTrashBtn();
  setUiMode(location.hash === "#wotd" ? "wotd" : "trainer");
  subscribeRealtime();
})();
