/* ===== Supabase ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);

/* rows in zh_words */
const ZH_WORDS_SLUG = "zh-default";
const ZH_CHAPTERS_SLUG = "zh-chapters";

/* local mirror (offline-ish) */
const CACHE_WORDS_KEY = "zh.words.v2";
const CACHE_CHAPTERS_KEY = "zh.chapters.v1";
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
let session = "main"; // "main" | "trash"
let viewIndex = 0;
let lastWordsVersion = 0;
let lastChaptersVersion = 0;

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

/* Voice toggle state */
let voiceEnabled = false;
const btnVoice = document.getElementById("btnVoice");

/* Click/tap: always speak Hanzi of current card */
btnVoice.addEventListener("click", () => {
  const w = getView()[viewIndex]?.w;
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
    .in("slug", [ZH_WORDS_SLUG, ZH_CHAPTERS_SLUG]);

  if (error) throw error;

  const rows = new Map((data ?? []).map(row => [row.slug, row]));
  const wordsRow = rows.get(ZH_WORDS_SLUG);
  const chaptersRow = rows.get(ZH_CHAPTERS_SLUG);

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
}

let saveWordsTimer = null;
let saveChaptersTimer = null;
function scheduleSaveWords(){ clearTimeout(saveWordsTimer); saveWordsTimer = setTimeout(saveWordsRemote, 250); }
function scheduleSaveChapters(){ clearTimeout(saveChaptersTimer); saveChaptersTimer = setTimeout(saveChaptersRemote, 250); }

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
        }
      }
    )
    .subscribe();
  window.addEventListener("beforeunload", () => sb.removeChannel(ch));
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
    renderCard();
  });
});

/* ===== Add/Edit Modal ===== */
addBtn.addEventListener("click", () => openAddModal("create"));

function openAddModal(mode, idx=null){
  modal.hidden = false;
  document.body.classList.add("modal-open");
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
  pickPromptRandom();
  renderCard();
  renderDict();
  syncTrashBtn();
  subscribeRealtime();
})();
