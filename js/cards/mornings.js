// ---- Supabase config ----
const SUPABASE_URL = "https://ntlsmrzpatcultvsrpll.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const LIST_SLUG = "ray-mornings";

// Realtime client
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let lastSeenVersion = 0;

// REST helper
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

// Realtime subscription
function subscribeRealtime() {
  const channel = sb
    .channel("tasklists-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "task_lists", filter: `slug=eq.${LIST_SLUG}` },
      (payload) => {
        const row = payload.new || payload.old;
        const incomingVersion = row?.data?.version ?? 0;
        if (incomingVersion && incomingVersion <= lastSeenVersion) return; // ignore our own writes
        loadTasks().then(render);
      }
    )
    .subscribe();

  window.addEventListener("beforeunload", () => sb.removeChannel(channel));
}

// ---- DOM ----
const STORAGE_FALLBACK = "morningTasks_v1";
const taskBody = document.getElementById("taskBody");
const addBtn = document.getElementById("addTaskBtn");

let tasks = []; // [{id:number, text:string}]

// ---- remote load/save with local fallback ----
async function loadTasks() {
  try {
    const res = await sbFetch(`/rest/v1/task_lists?slug=eq.${LIST_SLUG}&select=data`);
    const rows = await res.json();
    const blob = rows?.[0]?.data ?? [];
    tasks = Array.isArray(blob) ? blob : blob.payload ?? [];
    localStorage.setItem(STORAGE_FALLBACK, JSON.stringify(tasks));
  } catch (e) {
    const raw = localStorage.getItem(STORAGE_FALLBACK);
    tasks = raw ? JSON.parse(raw) : [];
    console.warn("Using local cache (offline?):", e);
  }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveTasks, 300);
}

async function saveTasks() {
  try {
    lastSeenVersion = Date.now();
    const body = { data: { payload: tasks, version: lastSeenVersion } };
    await sbFetch(`/rest/v1/task_lists?slug=eq.${LIST_SLUG}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    localStorage.setItem(STORAGE_FALLBACK, JSON.stringify(tasks));
  } catch (e) {
    localStorage.setItem(STORAGE_FALLBACK, JSON.stringify(tasks));
    console.warn("Save failed (offline?):", e);
  }
}

// ========= Drag & Drop state (long-press + ghost) =========
const PRESS_MS = 220;      // long-press threshold
const MOVE_TOL = 8;        // cancel long-press if finger moves too much
let pressTimer = null;
let pressStartX = 0, pressStartY = 0;
let draggingTr = null;
let ghostEl = null;

// Utility: build ghost element
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
  // text inside ghost = task text
  const txt = fromRow.querySelector(".task-input")?.value || `Row ${fromRow.rowIndex}`;
  g.textContent = txt;
  return g;
}

// ========= Render =========
function render() {
  taskBody.innerHTML = "";

  tasks.forEach((t, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.id = String(t.id); // so we can reconstruct order after drag

    // NO
    const tdNo = document.createElement("td");
    tdNo.textContent = String(idx + 1);
    tr.appendChild(tdNo);

    // TASK (input + delete + drag handle)
    const tdTask = document.createElement("td");
    tdTask.className = "task-td";

    // drag handle
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "≡";
    handle.title = "Drag to reorder";
    handle.style.marginRight = "8px";
    handle.style.cursor = "grab";
    handle.style.userSelect = "none";
    tdTask.appendChild(handle);

    // input
    const input = document.createElement("input");
    input.type = "text";
    input.className = "task-input";
    input.value = t.text || "";
    input.placeholder = "Type your task…";
    input.dataset.id = String(t.id);
    tdTask.appendChild(input);

    // minus button INSIDE the task cell
    const btn = document.createElement("button");
    btn.className = "delete-btn";
    btn.textContent = "–";
    btn.title = "Delete task";
    btn.dataset.id = String(t.id);
    tdTask.appendChild(btn);

    tr.appendChild(tdTask);

    // STATUS (kept for desktop)
    const tdStatus = document.createElement("td");
    tdStatus.textContent = "—";
    tdStatus.style.opacity = 0.75;
    tr.appendChild(tdStatus);

    taskBody.appendChild(tr);
  });
}

// ========= Interactions =========
function addTask() {
  const nextId = tasks.length ? Math.max(...tasks.map((t) => t.id)) + 1 : 1;
  tasks.push({ id: nextId, text: "" });
  render();
  scheduleSave();
  const lastInput = taskBody.querySelector("tr:last-child .task-input");
  lastInput?.focus();
}

function onTaskEdit(e) {
  if (!(e.target instanceof HTMLInputElement)) return;
  if (!e.target.classList.contains("task-input")) return;
  const id = Number(e.target.dataset.id);
  const t = tasks.find((x) => x.id === id);
  if (t) {
    t.text = e.target.value;
    scheduleSave();
  }
}

function onDeleteClick(e) {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  tasks = tasks.filter((t) => t.id !== id);
  render();
  scheduleSave();
}

// ---- Drag handlers (long-press + ghost; drag handle only) ----
taskBody.addEventListener("pointerdown", (e) => {
  const handle = e.target.closest(".drag-handle");
  if (!handle) return;

  const tr = handle.closest("tr");
  if (!tr) return;

  pressStartX = e.clientX;
  pressStartY = e.clientY;

  // Mouse: start immediately; Touch: long-press
  if (e.pointerType !== "touch") {
    startDrag(e, tr, handle);
    return;
  }
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => startDrag(e, tr, handle), PRESS_MS);
  handle.setPointerCapture?.(e.pointerId);
});

taskBody.addEventListener("pointermove", (e) => {
  if (!pressTimer) return;
  const dx = Math.abs(e.clientX - pressStartX);
  const dy = Math.abs(e.clientY - pressStartY);
  if (dx > MOVE_TOL || dy > MOVE_TOL) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
});

["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) =>
  taskBody.addEventListener(ev, () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  })
);

function startDrag(e, tr, handle) {
   // prevent iOS selection / keyboard while dragging
  window.getSelection?.().removeAllRanges?.();
  document.activeElement?.blur?.();
  draggingTr = tr;

  ghostEl = makeGhost(tr);
  document.body.appendChild(ghostEl);

  tr.style.visibility = "hidden";
  document.documentElement.classList.add("drag-lock"); // prevent scroll if you style it

  const onMove = (ev) => {
    const rect = draggingTr.getBoundingClientRect();
    ghostEl.style.top = `${ev.clientY - rect.height / 2}px`;

    // Find where to place: before the first row whose midpoint is below cursor
    const others = [...taskBody.querySelectorAll("tr")].filter((x) => x !== draggingTr);
    let target = null;
    for (const row of others) {
      const r = row.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (ev.clientY < mid) {
        target = row;
        break;
      }
    }
    if (target) taskBody.insertBefore(draggingTr, target);
    else taskBody.appendChild(draggingTr);
  };

  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    ghostEl?.remove(); ghostEl = null;
    draggingTr.style.visibility = "";
    draggingTr = null;
    document.documentElement.classList.remove("drag-lock");

    // Commit new order by DOM
    const idOrder = [...taskBody.querySelectorAll("tr")].map((row) => Number(row.dataset.id));
    const map = new Map(tasks.map((t) => [t.id, t]));
    tasks = idOrder.map((id) => map.get(id)).filter(Boolean);

    render();        // re-number NO column
    scheduleSave();  // persist
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



