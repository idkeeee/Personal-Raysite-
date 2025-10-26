// ===== sample state (Supabase later) =====
const SAMPLE_WORDS = [
  { hanzi: "你好", pinyin: "nǐ hǎo",     yisi: "hello" },
  { hanzi: "学习", pinyin: "xuéxí",      yisi: "to study" },
  { hanzi: "天气", pinyin: "tiānqì",     yisi: "weather" },
  { hanzi: "谢谢", pinyin: "xièxie",     yisi: "thank you" },
];

let words = [...SAMPLE_WORDS];
let index = 0;

// multi-select modes
const selected = new Set(["hanzi","pinyin","yisi"]); // start with all on

// DOM
const cardEl    = document.getElementById("zhCard");
const dictList  = document.getElementById("dictList");
const addBtn    = document.getElementById("zhAddBtn");
const modal     = document.getElementById("zhModal");
const inHanzi   = document.getElementById("inHanzi");
const inPinyin  = document.getElementById("inPinyin");
const inYisi    = document.getElementById("inYisi");
const mSave     = document.getElementById("mSave");
const mCancel   = document.getElementById("mCancel");

// ===== renderers =====
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

// ===== controls (placeholders) =====
document.getElementById("btnPrev").addEventListener("click", () => {
  index = (index - 1 + words.length) % words.length;
  renderCard();
});
document.getElementById("btnNext").addEventListener("click", () => {
  index = (index + 1) % words.length;
  renderCard();
});
document.getElementById("btnReveal").addEventListener("click", () => {
  // placeholder – later we can hide/show lines
  flashCard();
});
document.getElementById("btnShuffle").addEventListener("click", () => {
  shuffle(words);
  index = 0;
  renderCard(); renderDict();
});

// ===== toggles (multi-select) =====
document.querySelectorAll(".zh-toggle").forEach(btn => {
  const m = btn.dataset.mode;
  btn.addEventListener("click", () => {
    if (selected.has(m)) selected.delete(m); else selected.add(m);
    btn.classList.toggle("active", selected.has(m));
    renderCard();
  });
});

// ===== add/edit modal =====
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
  // strict validation: all required
  if (!hanzi || !pinyin || !yisi) {
    // no alerts, just a subtle shake/flash feel
    pulseInputs();
    return;
  }
  if (mode === "create") {
    words.push({ hanzi, pinyin, yisi });
    index = words.length - 1;
  } else if (mode === "edit" && idx != null) {
    words[idx] = { hanzi, pinyin, yisi };
    index = idx;
  }
  renderCard(); renderDict();
  closeModal();
}

// ===== visuals/helpers =====
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

// ===== boot =====
renderCard();
renderDict();
