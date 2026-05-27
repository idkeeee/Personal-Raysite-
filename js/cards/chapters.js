/* ===== Supabase ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
const sb = window.supabase.createClient(
  window.SUPABASE_URL ?? "https://ntlsmrzpatcultvsrpll.supabase.co",
  window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g"
);

const ZH_WORDS_SLUG = "zh-default";
const ZH_CHAPTERS_SLUG = "zh-chapters";
const CACHE_WORDS_KEY = "zh.words.v2";
const CACHE_CHAPTERS_KEY = "zh.chapters.v1";

const readLocal = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

let words = readLocal(CACHE_WORDS_KEY) || [];
let chapters = readLocal(CACHE_CHAPTERS_KEY) || [];
let activeChapterId = null;
let viewIndex = 0;
let revealAll = false;
let currentPrompt = "hanzi";
let lastWordsVersion = 0;
let lastChaptersVersion = 0;
let voiceEnabled = false;
let zhVoice = null;

const selected = new Set(["hanzi","pinyin","yisi"]);

const chapterListEl = document.getElementById("chapterList");
const chapterCountBadge = document.getElementById("chapterCountBadge");
const activeChapterTitle = document.getElementById("activeChapterTitle");
const activeChapterMeta = document.getElementById("activeChapterMeta");
const cardEl = document.getElementById("zhCard");
const dictList = document.getElementById("dictList");
const btnVoice = document.getElementById("btnVoice");

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

function makeChapterId(){
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `chapter-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatChapterName(isoString){
  return new Date(isoString).toISOString().slice(0, 10);
}

function formatChapterMeta(isoString){
  return new Date(isoString).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getActiveChapter(){
  return chapters.find(ch => ch.id === activeChapterId) || null;
}

function getView(){
  if (!activeChapterId) return [];
  return words
    .map((word, rawIdx) => ({ w: normalizeWord(word), rawIdx }))
    .filter(({ w }) => !w.deleted_at && Array.isArray(w.chapters) && w.chapters.includes(activeChapterId));
}

function clampViewIndex(){
  const count = getView().length;
  if (count <= 0) {
    viewIndex = 0;
    return;
  }
  viewIndex = Math.max(0, Math.min(viewIndex, count - 1));
}

function enabledModes(){
  const pool = ["hanzi","pinyin","yisi"].filter(mode => selected.has(mode));
  if (voiceEnabled) pool.push("voice");
  return pool.length ? pool : ["hanzi"];
}

function pickPromptRandom(){
  const pool = enabledModes();
  currentPrompt = pool[Math.floor(Math.random() * pool.length)];
}

async function loadRemote(){
  const { data, error } = await sb
    .from("zh_words")
    .select("slug,data,version")
    .in("slug", [ZH_WORDS_SLUG, ZH_CHAPTERS_SLUG]);

  if (error) throw error;

  const rows = new Map((data ?? []).map(row => [row.slug, row]));
  const wordsRow = rows.get(ZH_WORDS_SLUG);
  const chaptersRow = rows.get(ZH_CHAPTERS_SLUG);

  if (Array.isArray(wordsRow?.data)) {
    words = wordsRow.data.map(normalizeWord);
    lastWordsVersion = wordsRow.version ?? 0;
    writeLocal(CACHE_WORDS_KEY, words);
  }

  if (Array.isArray(chaptersRow?.data)) {
    chapters = chaptersRow.data.map(normalizeChapter).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    lastChaptersVersion = chaptersRow.version ?? 0;
    writeLocal(CACHE_CHAPTERS_KEY, chapters);
  }

  if (!activeChapterId && chapters.length) {
    activeChapterId = chapters[chapters.length - 1].id;
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
    .channel("zh-chapters-rt")
    .on("postgres_changes", { event:"*", schema:"public", table:"zh_words" }, (payload) => {
      const row = payload.new || payload.old;
      if (!row?.slug) return;

      if (row.slug === ZH_WORDS_SLUG) {
        const version = row.version ?? 0;
        if (version && version <= lastWordsVersion) return;
        words = Array.isArray(row.data) ? row.data.map(normalizeWord) : [];
        writeLocal(CACHE_WORDS_KEY, words);
        clampViewIndex();
        renderAll();
        return;
      }

      if (row.slug === ZH_CHAPTERS_SLUG) {
        const version = row.version ?? 0;
        if (version && version <= lastChaptersVersion) return;
        chapters = Array.isArray(row.data) ? row.data.map(normalizeChapter).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) : [];
        writeLocal(CACHE_CHAPTERS_KEY, chapters);
        if (!chapters.some(chapter => chapter.id === activeChapterId)) {
          activeChapterId = chapters.length ? chapters[chapters.length - 1].id : null;
        }
        clampViewIndex();
        renderAll();
      }
    })
    .subscribe();

  window.addEventListener("beforeunload", () => sb.removeChannel(ch));
}

function renderChapterList(){
  chapterCountBadge.textContent = String(chapters.length);
  chapterListEl.innerHTML = "";

  if (!chapters.length) {
    chapterListEl.innerHTML = `<li class="chapter-empty">No chapters yet. Create one, then send words into it from the main trainer.</li>`;
    return;
  }

  [...chapters].reverse().forEach((chapter) => {
    const wordCount = words.filter(word => !word.deleted_at && Array.isArray(word.chapters) && word.chapters.includes(chapter.id)).length;
    const li = document.createElement("li");
    li.className = `chapter-item${chapter.id === activeChapterId ? " active" : ""}`;
    li.innerHTML = `
      <div class="chapter-name">${escapeHtml(chapter.name)}</div>
      <div class="chapter-meta">Created ${escapeHtml(formatChapterMeta(chapter.created_at))} · ${wordCount} words</div>
      <div class="chapter-actions">
        <button class="zh-btn mini" data-open-chapter="${chapter.id}">Open</button>
        <button class="zh-btn ghost mini" data-delete-chapter="${chapter.id}">Delete chapter</button>
      </div>
    `;
    chapterListEl.appendChild(li);
  });
}

function renderHeader(){
  const chapter = getActiveChapter();
  const count = getView().length;

  if (!chapter) {
    activeChapterTitle.textContent = "No chapter selected";
    activeChapterMeta.textContent = "Create a chapter first, then send words into it from the main trainer page.";
    return;
  }

  activeChapterTitle.textContent = chapter.name;
  activeChapterMeta.textContent = `${count} active words in this chapter`;
}

function renderCard(){
  const view = getView();

  if (!activeChapterId) {
    cardEl.innerHTML = `<div class="yisi" style="opacity:.6">No chapter selected yet.</div>`;
    return;
  }

  if (!view.length) {
    cardEl.innerHTML = `<div class="yisi" style="opacity:.6">This chapter is empty. Send words into it from the main trainer page.</div>`;
    return;
  }

  const w = view[viewIndex]?.w ?? { hanzi: "—", pinyin: "—", yisi: "—" };
  const parts = [];

  if (revealAll) {
    if (selected.has("hanzi")) parts.push(`<div class="hanzi">${escapeHtml(w.hanzi)}</div>`);
    if (selected.has("pinyin")) parts.push(`<div class="pinyin">${escapeHtml(w.pinyin)}</div>`);
    if (selected.has("yisi")) parts.push(`<div class="yisi">${escapeHtml(w.yisi)}</div>`);
  } else if (currentPrompt === "voice") {
    parts.push(`
      <div class="voice" aria-label="Tap to hear a random word">
        <span class="big-voice" id="bigVoice">🔊</span>
      </div>
    `);
  } else {
    parts.push(`<div class="${currentPrompt}">${escapeHtml(w[currentPrompt] ?? "—")}</div>`);
  }

  cardEl.innerHTML = `<div class="zh-lines">${parts.join("")}</div>`;

  if (!revealAll && currentPrompt === "voice") {
    document.getElementById("bigVoice")?.addEventListener("click", () => speakChinese(w.hanzi));
  }
}

function renderDict(){
  const view = getView();
  dictList.innerHTML = "";

  if (!activeChapterId) {
    dictList.innerHTML = `<li class="chapter-empty">Pick a chapter to see its words.</li>`;
    return;
  }

  if (!view.length) {
    dictList.innerHTML = `<li class="chapter-empty">This chapter has no words yet.</li>`;
    return;
  }

  view.forEach(({ w, rawIdx }) => {
    const li = document.createElement("li");
    li.className = "dict-item";
    li.innerHTML = `
      <div>
        <div class="dict-hanzi">${escapeHtml(w.hanzi)}</div>
        <div class="dict-pinyin">${escapeHtml(w.pinyin)}</div>
        <div class="dict-yisi">${escapeHtml(w.yisi)}</div>
      </div>
      <div class="word-actions">
        <button class="zh-btn ghost mini" data-remove-from-chapter="${rawIdx}">Remove</button>
      </div>
    `;
    dictList.appendChild(li);
  });
}

function renderAll(){
  renderChapterList();
  renderHeader();
  renderCard();
  renderDict();
}

function createChapter(){
  const chapter = normalizeChapter({
    id: makeChapterId(),
    created_at: new Date().toISOString()
  });
  chapters.push(chapter);
  chapters.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  activeChapterId = chapter.id;
  viewIndex = 0;
  revealAll = false;
  pickPromptRandom();
  renderAll();
  scheduleSaveChapters();
}

function deleteChapter(chapterId){
  const chapter = chapters.find(item => item.id === chapterId);
  if (!chapter) return;
  if (!confirm(`Delete chapter ${chapter.name}? Its words will stay in the main trainer.`)) return;

  chapters = chapters.filter(item => item.id !== chapterId);
  words = words.map(word => {
    const w = normalizeWord(word);
    return { ...w, chapters: w.chapters.filter(id => id !== chapterId) };
  });

  if (activeChapterId === chapterId) {
    activeChapterId = chapters.length ? chapters[chapters.length - 1].id : null;
    viewIndex = 0;
  }

  clampViewIndex();
  renderAll();
  scheduleSaveWords();
  scheduleSaveChapters();
}

function removeWordFromActiveChapter(rawIdx){
  if (!activeChapterId) return;
  const word = normalizeWord(words[rawIdx]);
  words[rawIdx] = { ...word, chapters: word.chapters.filter(id => id !== activeChapterId) };
  clampViewIndex();
  renderAll();
  scheduleSaveWords();
}

chapterListEl.addEventListener("click", (event) => {
  const openBtn = event.target.closest("[data-open-chapter]");
  const deleteBtn = event.target.closest("[data-delete-chapter]");

  if (openBtn) {
    activeChapterId = openBtn.dataset.openChapter;
    viewIndex = 0;
    revealAll = false;
    pickPromptRandom();
    renderAll();
    return;
  }

  if (deleteBtn) {
    deleteChapter(deleteBtn.dataset.deleteChapter);
  }
});

dictList.addEventListener("click", (event) => {
  const removeBtn = event.target.closest("[data-remove-from-chapter]");
  if (!removeBtn) return;
  removeWordFromActiveChapter(Number(removeBtn.dataset.removeFromChapter));
});

document.getElementById("btnBackToTrainer").addEventListener("click", () => {
  window.location.href = "html/cards/chinese.html";
});

document.getElementById("btnCreateChapter").addEventListener("click", createChapter);

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

document.getElementById("btnShuffle").addEventListener("click", () => {
  const ids = getView().map(item => item.rawIdx);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = ids[i];
    const b = ids[j];
    [words[a], words[b]] = [words[b], words[a]];
  }
  viewIndex = 0;
  revealAll = false;
  pickPromptRandom();
  renderAll();
  scheduleSaveWords();
});

document.querySelectorAll(".zh-toggle:not(#btnVoice)").forEach(btn => {
  const mode = btn.dataset.mode;
  btn.addEventListener("click", () => {
    if (selected.has(mode)) selected.delete(mode); else selected.add(mode);
    btn.classList.toggle("active", selected.has(mode));
    if (!revealAll) {
      const pool = enabledModes();
      if (!pool.includes(currentPrompt)) pickPromptRandom();
    }
    renderCard();
  });
});

btnVoice.addEventListener("click", () => {
  const word = getView()[viewIndex]?.w;
  if (word) speakChinese(word.hanzi);
});

btnVoice.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  voiceEnabled = !voiceEnabled;
  btnVoice.classList.toggle("active", voiceEnabled);
});

(() => {
  let t = null, sx = 0, sy = 0;
  const PRESS = 220, MOV = 8;
  btnVoice.addEventListener("pointerdown", (event) => {
    if (!("ontouchstart" in window || navigator.maxTouchPoints > 0)) return;
    sx = event.clientX; sy = event.clientY;
    clearTimeout(t);
    t = setTimeout(() => {
      voiceEnabled = !voiceEnabled;
      btnVoice.classList.toggle("active", voiceEnabled);
    }, PRESS);
    btnVoice.setPointerCapture?.(event.pointerId);
  });
  btnVoice.addEventListener("pointermove", (event) => {
    if (!t) return;
    if (Math.abs(event.clientX - sx) > MOV || Math.abs(event.clientY - sy) > MOV) {
      clearTimeout(t);
      t = null;
    }
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(name => {
    btnVoice.addEventListener(name, () => {
      if (t) {
        clearTimeout(t);
        t = null;
      }
    });
  });
})();

function pickZhVoice(){
  const voices = speechSynthesis.getVoices();
  zhVoice = voices.find(v => /zh[-_]CN/i.test(v.lang)) || voices.find(v => /^zh/i.test(v.lang)) || null;
}
if ("speechSynthesis" in window) {
  pickZhVoice();
  window.speechSynthesis.onvoiceschanged = pickZhVoice;
}
function speakChinese(text){
  if (!("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = (zhVoice && zhVoice.lang) || "zh-CN";
  if (zhVoice) utterance.voice = zhVoice;
  utterance.rate = 0.95;
  utterance.pitch = 1.0;
  speechSynthesis.speak(utterance);
}

function escapeHtml(text){
  return String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

(async function init(){
  try {
    await loadRemote();
  } catch (error) {
    console.warn("chapters load failed, using local:", error.message);
  }

  if (!activeChapterId && chapters.length) {
    activeChapterId = chapters[chapters.length - 1].id;
  }

  pickPromptRandom();
  clampViewIndex();
  renderAll();
  subscribeRealtime();
})();
