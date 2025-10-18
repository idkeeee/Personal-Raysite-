/* ===== Supabase setup (reuses your project) ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);

/* one row identified by slug */
const SPIN_SLUG = "spin-default";

/* ===== Local mirror (offline) ===== */
const CACHE_KEY = "spinwheel.items.v1";
const readLocal  = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } };
const writeLocal = (arr) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); } catch {} };

/* ===== State ===== */
let items = readLocal() || ["ML & AI","Video Editing","Electronics Tinkering","web build"];
let lastVersion = 0; // monotonic timestamp to ignore our own realtime echoes

/* ===== DOM ===== */
const canvas = document.getElementById("wheelCanvas");
const ctx    = canvas.getContext("2d");
const spinBtn = document.getElementById("spinBtn");
const result  = document.getElementById("wheelResult");
const addForm = document.getElementById("addForm");
const addInput= document.getElementById("addInput");
const listEl  = document.getElementById("itemList");
const shuffleBtn = document.getElementById("shuffleBtn");
const clearBtn   = document.getElementById("clearBtn");

/* ===== Remote IO ===== */
async function loadRemote() {
  const { data, error } = await sb.from("spin_wheel").select("data").eq("slug", SPIN_SLUG).maybeSingle();
  if (error && error.code !== "PGRST116") throw error;  // not-found is fine
  if (data?.data) {
    const arr = Array.isArray(data.data) ? data.data : (data.data.items ?? []);
    if (Array.isArray(arr) && arr.length) { items = arr; writeLocal(items); }
  }
}

let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveRemote, 300); }

async function saveRemote() {
  lastVersion = Date.now();
  const payload = items; // store array directly in JSONB
  const { error } = await sb.from("spin_wheel").upsert(
    { slug: SPIN_SLUG, data: payload, updated_at: new Date().toISOString(), version: lastVersion },
    { onConflict: "slug" }
  );
  if (!error) writeLocal(items);
  else console.warn("Save failed:", error);
}

/* realtime: update when other device writes */
function subscribeRealtime() {
  const ch = sb
    .channel("spinwheel-rt")
    .on("postgres_changes",
        { event: "*", schema: "public", table: "spin_wheel", filter: `slug=eq.${SPIN_SLUG}` },
        (payload) => {
          const row = payload.new || payload.old;
          const v = row?.version ?? 0;
          if (v && v <= lastVersion) return; // ignore our own latest
          const arr = Array.isArray(row?.data) ? row.data : (row?.data?.items ?? []);
          if (Array.isArray(arr)) {
            items = arr;
            writeLocal(items);
            rebuildList();
            drawWheel();
          }
        })
    .subscribe();
  window.addEventListener("beforeunload", () => sb.removeChannel(ch));
}

/* ===== Canvas sizing & drawing ===== */
function fitCanvas() {
  const box = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width  = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawWheel();
}
window.addEventListener("resize", fitCanvas);

let rotation = 0;
function drawWheel(highlightIndex = -1) {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const r = Math.min(W, H) / 2 - 6;
  const cx = W / 2, cy = H / 2;
  const n = Math.max(1, items.length);
  const step = (Math.PI * 2) / n;
  const startBase = -Math.PI / 2;

  ctx.clearRect(0,0,W,H);

  for (let i = 0; i < n; i++) {
    const a0 = startBase + rotation + i * step;
    const a1 = a0 + step;
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

    const mid = (a0 + a1) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(mid);
    ctx.textAlign = "right";
    ctx.fillStyle = "#111";
    ctx.font = "bold 16px ui-sans-serif, system-ui, -apple-system";
    ctx.fillText(items[i], r - 14, 6);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.stroke();
}

/* ===== Spin animation ===== */
let anim = null;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

function spin() {
  if (!items.length || anim) return;
  const n = items.length;
  const step = (Math.PI * 2) / n;
  const idx = Math.floor(Math.random() * n);
  const extraTurns = 6 + Math.floor(Math.random() * 4);
  const target = extraTurns * Math.PI * 2 - (idx + 0.5) * step;

  const start = rotation, delta = target - start;
  const duration = 3600 + Math.random()*1200;
  const t0 = performance.now();

  spinBtn.disabled = true;
  result.textContent = "Spinning…";

  cancelAnimationFrame(anim);
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    rotation = start + delta * easeOutCubic(t);
    drawWheel();
    if (t < 1) anim = requestAnimationFrame(frame);
    else {
      anim = null;
      rotation = target % (Math.PI*2);
      drawWheel(idx);
      result.textContent = items[idx];
      result.classList.remove("flash"); void result.offsetWidth; result.classList.add("flash");
      spinBtn.disabled = false;
    }
  };
  anim = requestAnimationFrame(frame);
}

/* ===== Editor UI ===== */
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
      writeLocal(items); scheduleSave(); drawWheel();
    });

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const up = document.createElement("button");
    up.textContent = "↑"; up.title = "Move up";
    up.addEventListener("click", () => {
      if (i === 0) return;
      [items[i-1], items[i]] = [items[i], items[i-1]];
      writeLocal(items); scheduleSave(); rebuildList(); drawWheel();
    });

    const down = document.createElement("button");
    down.textContent = "↓"; down.title = "Move down";
    down.addEventListener("click", () => {
      if (i >= items.length - 1) return;
      [items[i+1], items[i]] = [items[i], items[i+1]];
      writeLocal(items); scheduleSave(); rebuildList(); drawWheel();
    });

    const del = document.createElement("button");
    del.textContent = "✕"; del.className = "danger"; del.title = "Remove";
    del.addEventListener("click", () => {
      items.splice(i, 1);
      writeLocal(items); scheduleSave(); rebuildList(); drawWheel();
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
  writeLocal(items); scheduleSave(); rebuildList(); drawWheel();
});

shuffleBtn.addEventListener("click", () => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  writeLocal(items); scheduleSave(); rebuildList(); drawWheel();
});

clearBtn.addEventListener("click", () => {
  if (!confirm("Clear all entries?")) return;
  items = [];
  writeLocal(items); scheduleSave(); rebuildList(); drawWheel();
});

spinBtn.addEventListener("click", spin);

/* ===== init ===== */
(async function init(){
  try { await loadRemote(); } catch (e) { console.warn("Remote load failed, using local:", e.message); }
  rebuildList();
  fitCanvas();
  drawWheel();
  subscribeRealtime();
})();
