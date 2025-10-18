// ====== State & persistence ======
const KEY = "spinwheel.items.v1";
let items = loadItems() || ["Push-ups", "Study 30m", "Read 10p", "Walk", "Code", "Stretch"];
function loadItems(){ try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function saveItems(){ try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }

// ====== DOM ======
const canvas = document.getElementById("wheelCanvas");
const ctx     = canvas.getContext("2d");
const spinBtn = document.getElementById("spinBtn");
const result  = document.getElementById("wheelResult");
const addForm = document.getElementById("addForm");
const addInput= document.getElementById("addInput");
const listEl  = document.getElementById("itemList");
const shuffleBtn = document.getElementById("shuffleBtn");
const clearBtn   = document.getElementById("clearBtn");

// Resize for device pixel ratio (crisp canvas)
function fitCanvas() {
  const cssSize = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width  = Math.round(cssSize.width * dpr);
  canvas.height = Math.round(cssSize.height * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0); // keep drawing in CSS pixels
  drawWheel();
}
window.addEventListener("resize", fitCanvas);

// ====== Wheel drawing ======
let rotation = 0; // radians
function drawWheel(highlightIndex = -1) {
  const W = canvas.width, H = canvas.height;
  const r = Math.min(W, H) / (2 * (window.devicePixelRatio || 1)) - 6;
  const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
  const n = Math.max(1, items.length);
  const step = (Math.PI * 2) / n;
  const startBase = -Math.PI / 2; // start at top

  ctx.clearRect(0,0,canvas.clientWidth, canvas.clientHeight);

  // slices
  for (let i = 0; i < n; i++) {
    const a0 = startBase + rotation + i * step;
    const a1 = a0 + step;
    // color palette
    const hue = (i * (360 / n)) % 360;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = `hsl(${hue} 70% ${i===highlightIndex?40:50}%)`;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,.4)";
    ctx.stroke();

    // text
    const mid = (a0 + a1) / 2;
    const label = items[i];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(mid);
    ctx.textAlign = "right";
    ctx.fillStyle = "#111";
    ctx.font = "bold 16px ui-sans-serif, system-ui, -apple-system";
    ctx.fillText(label, r - 14, 6);
    ctx.restore();
  }

  // rim
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.stroke();
}

// ====== Spin logic ======
let anim = null;
function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

function spin() {
  if (items.length === 0 || anim) return;

  const n = items.length;
  const step = (Math.PI * 2) / n;

  // choose random index
  const idx = Math.floor(Math.random() * n);

  // final rotation so that chosen index’s center lines up to pointer (top)
  const extraTurns = 6 + Math.floor(Math.random() * 4); // 6-9 turns
  const target = extraTurns * Math.PI * 2 - (idx + 0.5) * step;

  const start = rotation;
  const delta = target - start;
  const duration = 3500 + Math.random()*1200;
  const t0 = performance.now();

  spinBtn.disabled = true;
  result.textContent = "Spinning…";

  cancelAnimationFrame(anim);
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    rotation = start + delta * easeOutCubic(t);
    drawWheel();
    if (t < 1) {
      anim = requestAnimationFrame(frame);
    } else {
      anim = null;
      rotation = target % (Math.PI*2);
      drawWheel(idx);
      // show result
      result.textContent = items[idx];
      result.classList.remove("flash"); // restart animation
      void result.offsetWidth;          // reflow
      result.classList.add("flash");
      spinBtn.disabled = false;
    }
  };
  anim = requestAnimationFrame(frame);
}

// ====== Editor UI ======
function rebuildList(){
  listEl.innerHTML = "";
  items.forEach((label, i) => {
    const li = document.createElement("li");
    li.className = "item-row";

    const input = document.createElement("input");
    input.value = label;
    input.placeholder = "Entry";
    input.addEventListener("input", () => {
      items[i] = input.value.trim();
      saveItems(); drawWheel();
    });

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const up = document.createElement("button");
    up.textContent = "↑";
    up.title = "Move up";
    up.addEventListener("click", () => {
      if (i === 0) return;
      const tmp = items[i-1]; items[i-1] = items[i]; items[i] = tmp;
      saveItems(); rebuildList(); drawWheel();
    });

    const down = document.createElement("button");
    down.textContent = "↓";
    down.title = "Move down";
    down.addEventListener("click", () => {
      if (i >= items.length - 1) return;
      const tmp = items[i+1]; items[i+1] = items[i]; items[i] = tmp;
      saveItems(); rebuildList(); drawWheel();
    });

    const del = document.createElement("button");
    del.textContent = "✕";
    del.className = "danger";
    del.title = "Remove";
    del.addEventListener("click", () => {
      items.splice(i, 1);
      saveItems(); rebuildList(); drawWheel();
    });

    actions.append(up, down, del);
    li.append(input, actions);
    listEl.appendChild(li);
  });
}

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = addInput.value.trim();
  if (!text) return;
  items.push(text);
  addInput.value = "";
  saveItems(); rebuildList(); drawWheel();
});

shuffleBtn.addEventListener("click", () => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  saveItems(); rebuildList(); drawWheel();
});

clearBtn.addEventListener("click", () => {
  if (!confirm("Clear all entries?")) return;
  items = [];
  saveItems(); rebuildList(); drawWheel();
});

// center button spins
spinBtn.addEventListener("click", spin);

// ====== init ======
rebuildList();
fitCanvas();
drawWheel();
