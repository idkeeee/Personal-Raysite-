// ============ Minimal skeleton state ============
// Later we’ll replace with Supabase (same pattern as your other pages).
const SAMPLE_WORDS = [
  { hanzi: "你好", pinyin: "nǐ hǎo", yisi: "hello" },
  { hanzi: "学习", pinyin: "xuéxí",  yisi: "to study" },
  { hanzi: "天气", pinyin: "tiānqì", yisi: "weather" },
];

let words = [...SAMPLE_WORDS];
let currentIndex = 0;
let mode = "hanzi"; // 'hanzi' | 'pinyin' | 'yisi'

const cardEl = document.getElementById("zhCard");
const addBtn = document.getElementById("zhAddBtn");

// ============ Render ============

function renderCard(){
  const w = words[currentIndex] ?? { hanzi:"—", pinyin:"—", yisi:"—" };
  // content block with the active class for styling
  cardEl.innerHTML = `
    <div class="${mode}">
      ${escapeHtml(w[mode] || "—")}
    </div>
  `;
}

function setMode(newMode){
  mode = newMode;
  document.querySelectorAll(".zh-toggle").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  renderCard();
}

// ============ Events ============

// Toggle buttons
document.querySelectorAll(".zh-toggle").forEach(btn => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

// Add word (skeleton only)
addBtn.addEventListener("click", () => {
  // skeleton placeholder — we’ll build a real modal + Supabase save next step
  // For now, just console log to confirm wiring.
  console.log("[Chinese Trainer] Add new word clicked.");
  // TODO: open modal, collect {hanzi,pinyin,yisi}, push to words, save to Supabase
});

// Optional: tap card to cycle through sample words (just for demo feel)
cardEl.addEventListener("click", () => {
  currentIndex = (currentIndex + 1) % words.length;
  renderCard();
});

// ============ Utils ============

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

// ============ Boot ============
renderCard();
