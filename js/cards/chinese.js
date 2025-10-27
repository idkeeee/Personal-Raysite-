/* ===== Supabase ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);

/* one row holding the array of words */
const ZH_SLUG = "zh-default";

/* local mirror (offline) */
const CACHE_KEY = "zh.words.v1";
const readLocal  = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } };
const writeLocal = (arr) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); } catch {} };

/* sample fallback */
const SAMPLE_WORDS = [
  { hanzi: "你好", pinyin: "nǐ hǎo",     yisi: "hello" },
  { hanzi: "学习", pinyin: "xuéxí",      yisi: "to study" },
  { hanzi: "天气", pinyin: "tiānqì",     yisi: "weather" },
  { hanzi: "谢谢", pinyin: "xièxie",     yisi: "thank you" },
];

/* state */
let words = readLocal() || [...SAMPLE_WORDS];
let index = 0;
let lastVersion = 0;

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

/* Voice toggle state */
let voiceEnabled = false;
const btnVoice = document.getElementById("btnVoice");

/* Click/tap: always speak Hanzi of current card */
btnVoice.addEventListener("click", () => {
  const w = words[index];
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
    if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) return;
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
  const { data, error } = await sb.from("zh_words").select("data,version").eq("slug", ZH_SLUG).maybeSingle();
  if (error && error.code !== "PGRST116") throw error; // not-found is ok
  if (data?.data && Array.isArray(data.data)) {
    words = data.data;
    lastVersion = data.version ?? 0;
    writeLocal(words);
  }
}

let saveTimer=null;
function scheduleSave(){ clearTimeout(saveTimer); saveTimer = setTimeout(saveRemote, 250); }
async function saveRemote(){
  lastVersion = Date.now();
  const { error } = await sb.from("zh_words").upsert(
    { slug: ZH_SLUG, data: words, version: lastVersion, updated_at: new Date().toISOString() },
    { onConflict: "slug" }
  );
  if (!error) writeLocal(words);
}

function subscribeRealtime(){
  const ch = sb
    .channel("zh-rt")
    .on("postgres_changes",
      { event:"*", schema:"public", table:"zh_words", filter:`slug=eq.${ZH_SLUG}` },
      (payload) => {
        const row = payload.new || payload.old;
        const v = row?.version ?? 0;
        if (v && v <= lastVersion) return;  // ignore our own latest
        const arr = Array.isArray(row?.data) ? row.data : [];
        words = arr;
        writeLocal(words);
        index = Math.min(index, Math.max(0, words.length - 1));
        renderCard(); renderDict();
      })
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
function renderCard(){
  const w = words[index] ?? {hanzi:"—", pinyin:"—", yisi:"—"};
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
      if (!words.length) return;
      index = Math.floor(Math.random() * words.length);
      const ww = words[index];
      speakChinese(ww.hanzi);
    });
  }

}
function renderDict(){
  dictList.innerHTML = "";
  words.forEach((w, i) => {
    const li = document.createElement("li");
    li.className = "dict-item";
    li.dataset.idx = i;
    li.innerHTML = `
      <div>
        <div class="dict-hanzi">${escapeHtml(w.hanzi)}</div>
        <div class="dict-pinyin">${escapeHtml(w.pinyin)}</div>
        <div class="dict-yisi">${escapeHtml(w.yisi)}</div>
      </div>
      <button class="zh-btn mini" data-edit="${i}">Edit</button>
      <button class="zh-btn ghost mini" data-del="${i}">Delete</button>
    `;
    dictList.appendChild(li);
  });
}

// uses event delegation so buttons work after every re-render
dictList.addEventListener("click", (e) => {
  const editBtn = e.target.closest("[data-edit]");
  const delBtn  = e.target.closest("[data-del]");
  if (!editBtn && !delBtn) return;

  if (editBtn) {
    const i = Number(editBtn.dataset.edit);
    openAddModal("edit", i);              // opens modal prefilled
    return;
  }

  if (delBtn) {
    const i = Number(delBtn.dataset.del);
    // adjust the current index so the card view remains valid
    if (i < index) index--;
    words.splice(i, 1);
    if (index >= words.length) index = Math.max(0, words.length - 1);

    renderCard();
    renderDict();
    scheduleSave();                        // persist to Supabase + localStorage
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
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = (zhVoice && zhVoice.lang) || 'zh-CN';
  if (zhVoice) u.voice = zhVoice;
  u.rate = 0.95;
  u.pitch = 1.0;
  speechSynthesis.speak(u);
}


/* ===== controls ===== */
document.getElementById("btnPrev").addEventListener("click", () => {
  if (!words.length) return;
  index = (index - 1 + words.length) % words.length;
  revealAll = false;        // arrive hidden
  pickPromptRandom();       // choose one of enabled modes
  renderCard();
});
document.getElementById("btnNext").addEventListener("click", () => {
  if (!words.length) return;
  index = (index + 1) % words.length;
  revealAll = false;
  pickPromptRandom();
  renderCard();
});
document.getElementById("btnReveal").addEventListener("click", () => {
  revealAll = true;
  renderCard();
});
document.getElementById("btnShuffle").addEventListener("click", () => {
  shuffle(words);
  index = 0;
  revealAll = false;
  pickPromptRandom();
  renderCard(); renderDict(); scheduleSave();
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
    const w = words[idx];
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
modal.addEventListener("click", (e)=>{ if (e.target === modal) closeModal(); });

function saveWord(mode, idx=null){
  const hanzi  = inHanzi.value.trim();
  const pinyin = inPinyin.value.trim();
  const yisi   = inYisi.value.trim();
  if (!hanzi || !pinyin || !yisi) { pulseInputs(); return; } // strict require all

  if (mode === "create") {
    words.push({ hanzi, pinyin, yisi });
    index = words.length - 1;
  } else if (mode === "edit" && idx != null) {
    words[idx] = { hanzi, pinyin, yisi };
    index = idx;
  }
  revealAll = false;        // after add/edit, go to prompt mode
  pickPromptRandom();
  renderCard(); renderDict();
  scheduleSave();
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
function shuffle(arr){
  for (let i=arr.length-1; i>0; i--) { const j = Math.floor(Math.random()*(i+1)); [arr[i],arr[j]] = [arr[j],arr[i]]; }
}
function scrollIntoViewCard(){ cardEl.scrollIntoView({behavior:"smooth", block:"center"}); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

/* ===== boot ===== */
(async function init(){
  try { await loadRemote(); } catch(e){ console.warn("zh load failed, using local:", e.message); }
  pickPromptRandom();     // choose an initial single field to show
  renderCard();
  renderDict();
  subscribeRealtime();
})();
