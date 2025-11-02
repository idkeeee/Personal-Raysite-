// ==== Supabase config (same project keys) ====
const SUPABASE_URL = "https://ntlsmrzpatcultvsrpll.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";

// ==== Dedicated table for Nights (Option B) ====
const TABLE = "task_lists_night";     // 👈 different table than mornings
const STORAGE_FALLBACK = "nightTasks_v1"; // different localStorage key

// Realtime client
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM
const taskBody = document.getElementById("taskBody");
const addBtn = document.getElementById("addTaskBtn");

// State
let tasks = [];               // [{ id:number, text:string }]
let rowId = null;             // primary key of the single row we store data in
let lastSeenVersion = 0;

// ---- Helpers ----
const readCache  = () => { try { return JSON.parse(localStorage.getItem(STORAGE_FALLBACK)) || []; } catch { return []; } };
const writeCache = (x) => { try { localStorage.setItem(STORAGE_FALLBACK, JSON.stringify(x)); } catch {} };
const nowVersion = () => Date.now();

// REST helper (for fine-grained messages on failure)
async function sbFetch(path, options = {}) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: "application/json",
    ...options.headers,
  };
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers, mode: "cors" });
  if (!res.ok) {
    let msg = "";
    try {
      const ct = res.headers.get("content-type") || "";
      msg = ct.includes("application/json") ? (await res.json())?.message || "" : await res.text();
    } catch {}
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return res;
}

// Ensure we have exactly one row to store data in
async function ensureRow() {
  const r = await sbFetch(`/rest/v1/${TABLE}?select=id,data&limit=1`);
  const rows = await r.json();
  if (rows.length) {
    rowId = rows[0].id;
    const blob = rows[0].data ?? {};
    tasks = Array.isArray(blob) ? blob : (blob.payload ?? []);
    writeCache(tasks);
    return;
  }
  // create empty row once
  const create = await sbFetch(`/rest/v1/${TABLE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ data: { payload: [], version: 0 } }),
  });
  const created = await create.json();
  rowId = created[0].id;
  tasks = [];
  writeCache(tasks);
}

// Load tasks (remote with local fallback)
async function loadTasks() {
  try {
    await ensureRow();
  } catch (e) {
    console.warn("Nights load failed; using cache:", e);
    tasks = readCache();
  }
}

// Save (PATCH by id). If row wasn’t found for any reason, recreate once.
let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveTasks, 300); }

async function saveTasks() {
  try {
    if (!rowId) await ensureRow();
    lastSeenVersion = nowVersion();
    const body = { data: { payload: tasks, version: lastSeenVersion } };
    const res = await sbFetch(`/rest/v1/${TABLE}?id=eq.${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    // 204 OK is expected for PATCH with return=minimal
    writeCache(tasks);
  } catch (e) {
    writeCache(tasks);
    console.warn("Save failed (offline or RLS?):", e);
    alert("Save failed: " + (e?.message || e));
  }
}

// Realtime: listen to all changes on this table (no slug filter)
function subscribeRealtime() {
  const ch = sb
    .channel(`tasklists-realtime-${TABLE}`)
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, (payload) => {
      const v = payload.new?.data?.version ?? payload.old?.data?.version ?? 0;
      if (v && v <= lastSeenVersion) return; // ignore our own recent write
      // pull latest
      ensureRow().then(render).catch(console.warn);
    })
    .subscribe();
  window.addEventListener("beforeunload", () => sb.removeChannel(ch));
}

// ====== Render ======
function render() {
  taskBody.innerHTML = "";

  tasks.forEach((t, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.id = String(t.id);

    const tdNo = document.createElement("td");
    tdNo.textContent = String(idx + 1);
    tr.appendChild(tdNo);

    const tdTask = document.createElement("td");
    tdTask.className = "task-td";

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "≡";
    handle.title = "Drag to reorder";
    handle.style.marginRight = "8px";
    handle.style.cursor = "grab";
    handle.style.userSelect = "none";
    tdTask.appendChild(handle);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "task-input";
    input.value = t.text || "";
    input.placeholder = "Type your task…";
    input.dataset.id = String(t.id);
    tdTask.appendChild(input);

    const btn = document.createElement("button");
    btn.className = "delete-btn";
    btn.textContent = "–";
    btn.title = "Delete task";
    btn.dataset.id = String(t.id);
    tdTask.appendChild(btn);

    tr.appendChild(tdTask);

    const tdStatus = document.createElement("td");
    tdStatus.textContent = "—";
    tdStatus.style.opacity = 0.75;
    tr.appendChild(tdStatus);

    taskBody.appendChild(tr);
  });
}

// ====== Interactions ======
function addTask() {
  const nextId = tasks.length ? Math.max(...tasks.map((t) => t.id)) + 1 : 1;
  tasks.push({ id: nextId, text: "" });
  render();
  scheduleSave();
  taskBody.querySelector("tr:last-child .task-input")?.focus();
}

function onTaskEdit(e) {
  if (!(e.target instanceof HTMLInputElement)) return;
  if (!e.target.classList.contains("task-input")) return;
  const id = Number(e.target.dataset.id);
  const t = tasks.find((x) => x.id === id);
  if (t) { t.text = e.target.value; scheduleSave(); }
}

function onDeleteClick(e) {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  tasks = tasks.filter((t) => t.id !== id);
  render(); scheduleSave();
}

// ====== Drag (long-press for touch) ======
const PRESS_MS = 220, MOVE_TOL = 8;
let pressTimer = null, pressStartX = 0, pressStartY = 0, draggingTr = null, ghostEl = null;

function makeGhost(fromRow) {
  const rect = fromRow.getBoundingClientRect();
  const g = document.createElement("div");
  g.style.position = "fixed";
  g.style.left = `${rect.left}px`;
  g.style.top = `${rect.top}px`;
  g.style.width = `${rect.width}px`;
  g.style.height = `${rect.height}px`;
  g.style.pointerEvents = "none";
  g.style.opacity = "0.92";
  g.style.background = "rgba(32,32,36,0.95)";
  g.style.borderRadius = "10px";
  g.style.boxShadow = "0 10px 26px rgba(0,0,0,.45)";
  g.style.padding = "6px 10px";
  g.style.zIndex = "9999";
  g.textContent = fromRow.querySelector(".task-input")?.value || `Row ${fromRow.rowIndex}`;
  return g;
}

taskBody.addEventListener("pointerdown", (e) => {
  const handle = e.target.closest(".drag-handle"); if (!handle) return;
  const tr = handle.closest("tr"); if (!tr) return;
  pressStartX = e.clientX; pressStartY = e.clientY;
  if (e.pointerType !== "touch") { startDrag(e, tr, handle); return; }
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => startDrag(e, tr, handle), PRESS_MS);
  handle.setPointerCapture?.(e.pointerId);
});

taskBody.addEventListener("pointermove", (e) => {
  if (!pressTimer) return;
  const dx = Math.abs(e.clientX - pressStartX);
  const dy = Math.abs(e.clientY - pressStartY);
  if (dx > MOVE_TOL || dy > MOVE_TOL) { clearTimeout(pressTimer); pressTimer = null; }
});

["pointerup","pointercancel","lostpointercapture"].forEach(ev =>
  taskBody.addEventListener(ev, () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } })
);

function startDrag(e, tr) {
  window.getSelection?.().removeAllRanges?.();
  document.activeElement?.blur?.();
  draggingTr = tr;

  ghostEl = makeGhost(tr);
  document.body.appendChild(ghostEl);

  tr.style.visibility = "hidden";
  document.documentElement.classList.add("drag-lock");

  const onMove = (ev) => {
    const rect = draggingTr.getBoundingClientRect();
    ghostEl.style.top = `${ev.clientY - rect.height / 2}px`;
    const others = [...taskBody.querySelectorAll("tr")].filter((x) => x !== draggingTr);
    let target = null;
    for (const row of others) {
      const r = row.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (ev.clientY < mid) { target = row; break; }
    }
    if (target) taskBody.insertBefore(draggingTr, target); else taskBody.appendChild(draggingTr);
  };

  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    ghostEl?.remove(); ghostEl = null;
    draggingTr.style.visibility = ""; draggingTr = null;
    document.documentElement.classList.remove("drag-lock");

    const order = [...taskBody.querySelectorAll("tr")].map((row) => Number(row.dataset.id));
    const map = new Map(tasks.map((t) => [t.id, t]));
    tasks = order.map((id) => map.get(id)).filter(Boolean);
    render(); scheduleSave();
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

// ---- init ----
(async function init() {
  await loadTasks();
  render();
  subscribeRealtime();
})();

addBtn.addEventListener("click", addTask);
taskBody.addEventListener("input", onTaskEdit);
taskBody.addEventListener("click", onDeleteClick);
