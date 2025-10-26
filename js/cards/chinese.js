/* ===== Supabase (reuse your global creds if present) ===== */
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
const selected = new Set(["hanzi","pinyin","yisi"]); // multi-select on

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

/* ===== Renderers ===== */
function renderCard(){
  const w = words[index] ?? {hanzi:"—", pinyin:"—", yisi:"—"};
  const parts = [];
  if (selected.has("hanzi"))  parts.push(`<div class="hanzi">${escapeHtml(w.hanzi)}</div>`);
  if (selected.has("pinyin")) parts.push(`<div class="pinyin">${escapeHtml(w.pinyin)}</div>`);
  if (selected.has("yisi"))   parts.push(`<div class="yisi">${escapeHtml(w.yisi)}</div>`);

  cardEl.innerHTML = parts.length
    ? `<div class="zh-lines">${parts.join("")}</div>`
    : `<div class="yisi" style="opacity:.6">Select Hanzi / Pinyin / Yìsi to display</div>`;
}

function renderDict(){
  dictList.innerHTML = "";
  words.forEach((w, i) => {
    const li = document.createElement("li");
    li.className = "dict-item";
    li.innerHTML = `
      <div>
        <div class="dict-hanzi">${escapeHtml(w.hanzi)}</div>
        <div class="dict-pinyin">${escapeHtml(w.pinyin)}</div>
        <div class="dict-yisi">${escapeHtml(w.yisi)}</div>
      </div>
      <button class="zh-btn ghost" data-i="${i}">View</button>
      <button class="zh-btn" data-edit="${i}">Edit</button>
    `;
    li.querySelector('[data-i]').addEventListener("click", () => { index = i; renderCard(); scrollIntoViewCard(); });
    li.querySelector('[data-edit]').addEventListener("click", () => openAddModal("edit", i));
    dictList.appendChild(li);
  });
}

/* ===== Controls (placeholders) ===== */
document.getElementById("btnPrev").addEventListener("click", () => {
  if (!words.length) return;
  index = (index - 1 + words.length) % words.length;
  renderCard();
});
document.getElementById("btnNext").addEventListener("click", () => {
  if (!words.length) return;
  index = (index + 1) % words.length;
  renderCard();
});
document.getElementById("btnReveal").addEventListener("click", () => flashCard());
document.getElementById("btnShuffle").addEventListener("click", () => {
  shuffle(words);
  index = 0;
  renderCard(); renderDict(); scheduleSave();
});

/* ===== Toggles (multi-select) ===== */
document.querySelectorAll(".zh-toggle").forEach(btn => {
  const m = btn.dataset.mode;
  btn.addEventListener("click", () => {
    if (selected.has(m)) selected.delete(m); else selected.add(m);
    btn.classList.toggle("active", selected.has(m));
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
  // strict validation: all three required
  if (!hanzi || !pinyin || !yisi) { pulseInputs(); return; }

  if (mode === "create") {
    words.push({ hanzi, pinyin, yisi });
    index = words.length - 1;
  } else if (mode === "edit" && idx != null) {
    words[idx] = { hanzi, pinyin, yisi };
    index = idx;
  }
  renderCard(); renderDict();
  scheduleSave();
  closeModal();
}

/* ===== visuals/helpers ===== */
function flashCard(){
  cardEl.style.transition = "background-color .25s";
  const old = cardEl.style.backgroundColor;
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
  renderCard();
  renderDict();
  subscribeRealtime();
})();
