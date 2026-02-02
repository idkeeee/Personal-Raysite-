/* ===== Supabase ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);

/* lists → slugs */
const SLUGS = {
  "todo-long":   "todo-long",
  "todo-short":  "todo-short",
  "todo-school": "todo-school",
  "todo-super":  "todo-super",
};

/* local cache */
const cacheKey   = (slug) => `todo:${slug}:v1`;
const readLocal  = (slug) => { try { return JSON.parse(localStorage.getItem(cacheKey(slug))); } catch { return null; } };
const writeLocal = (slug, data) => { try { localStorage.setItem(cacheKey(slug), JSON.stringify(data)); } catch {} };

/* item shape: { id:number, text:string, last_progress_at: ISOString } */
const state = {
  "todo-long":   { rows: [], version: 0, saveTimer: null, el: null },
  "todo-short":  { rows: [], version: 0, saveTimer: null, el: null },
  "todo-school": { rows: [], version: 0, saveTimer: null, el: null },
  "todo-super":  { rows: [], version: 0, saveTimer: null, el: null },
};

/* ===== remote load/save ===== */
async function loadList(slug){
  const { data, error } = await sb.from("todo_lists").select("data,version").eq("slug", slug).maybeSingle();
  if (error && error.code !== "PGRST116") throw error; // ignore "no rows"
  const S = state[slug];
  if (data?.data) {
    S.rows = Array.isArray(data.data) ? data.data : (data.data.items ?? []);
    S.version = data.version ?? 0;
    writeLocal(slug, S.rows);
  } else {
    const cached = readLocal(slug);
    if (cached) S.rows = cached;
    else S.rows = [{ id: 1, text: "", last_progress_at: new Date().toISOString() }];
  }
}

function scheduleSave(slug){
  const S = state[slug];
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => saveList(slug), 300);
}

async function saveList(slug){
  const S = state[slug];
  S.version = Date.now();
  const { error } = await sb.from("todo_lists").upsert(
    { slug, data: S.rows, version: S.version, updated_at: new Date().toISOString() },
    { onConflict: "slug" }
  );
  if (!error) writeLocal(slug, S.rows);
}

/* realtime cross-tabs/devices */
function subscribeRealtime(slug){
  const ch = sb
    .channel(`todo-${slug}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "todo_lists", filter: `slug=eq.${slug}` },
      (payload) => {
        const S = state[slug];
        const row = payload.new || payload.old;
        const ver = row?.version ?? 0;
        if (ver && ver <= S.version) return; // ours or older
        const arr = Array.isArray(row?.data) ? row.data : (row?.data?.items ?? []);
        if (Array.isArray(arr)) {
          S.rows = arr;
          S.version = ver;
          writeLocal(slug, S.rows);
          renderTable(slug);
        }
      })
    .subscribe();
  window.addEventListener("beforeunload", () => sb.removeChannel(ch));
}

/* ===== utilities ===== */
const dayDiff = (iso) => {
  if (!iso) return 0;
  const a = new Date(iso);
  const now = new Date();
  const utcA   = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const utcNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((utcNow - utcA) / 86400000));
};
const newRow = (rows) => ({
  id: rows.length ? Math.max(...rows.map(r => r.id)) + 1 : 1,
  text: "",
  details: "",                 // NEW: per-task expandable notes
  last_progress_at: new Date().toISOString()
});


/* days → color (0d green → 10d red). applied to all except long-term. */
const AGE_LIMIT_DAYS = 10;
function dayColor(days) {
  const t = Math.max(0, Math.min(days, AGE_LIMIT_DAYS)) / AGE_LIMIT_DAYS; // 0..1
  const hue   = 120 - 120 * t;  // 120→0
  const sat   = 70 + 20 * t;    // 70%→90%
  const light = 62 - 18 * t;    // 62%→44%
  return `color:hsl(${hue}deg, ${sat}%, ${light}%);`;
}

/* rarity + XP */
function getRarity(days, slug){
  if (slug === 'todo-long') return 'neutral';
  if (days >= 9) return 'epic';
  if (days >= 6) return 'rare';
  if (days >= 3) return 'uncommon';
  return 'common';
}
function computeXP(text, days){
  const base = 10 + Math.min(40, days * 5);
  const bonus = Math.min(20, Math.floor((text || '').length / 20));
  return base + bonus;
}
function showXpToast(rowEl, text){
  const r = rowEl.getBoundingClientRect();
  const t = document.createElement('div');
  t.className = 'xp-float';
  t.textContent = text;
  t.style.left = (r.right - 60) + 'px';
  t.style.top  = (r.top + 6 + window.scrollY) + 'px';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 900);
}

/* ===== render ===== */
function renderTable(slug){
  const S = state[slug];
  const root = S.el;
  const tbody = root.querySelector("tbody");
  tbody.innerHTML = "";

  if (!Array.isArray(S.rows) || !S.rows.length) {
    S.rows = [ newRow([]) ];
  }

  S.rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.dataset.id = String(r.id);

    // drag handle
    const tdHandle = document.createElement("td");
    tdHandle.className = "thin";
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "≡";
    tdHandle.appendChild(handle);
    tr.appendChild(tdHandle);

    // task input + expand details
    tr.classList.add("task-row");

    const tdTask = document.createElement("td");

    // Top line: input + expand button
    const main = document.createElement("div");
    main.className = "task-main";

    const input = document.createElement("input");
    input.className = "task-input";
    input.value = r.text || "";
    input.placeholder = "Type a task…";
    input.addEventListener("input", () => {
      r.text = input.value;
      scheduleSave(slug);
    });
    input.addEventListener("keydown", (e) => {  // Enter → new row
      if (e.key === "Enter") {
        const idx = S.rows.findIndex(x => x.id === r.id);
        S.rows.splice(idx + 1, 0, newRow(S.rows));
        renderTable(slug);
        scheduleSave(slug);
        tr.nextElementSibling?.querySelector(".task-input")?.focus();
        e.preventDefault();
      }
    });

    // Expand button (per row)
    const expandBtn = document.createElement("button");
    expandBtn.className = "btn expand-btn";
    expandBtn.type = "button";

    // Details area
    const detailsWrap = document.createElement("div");
    detailsWrap.className = "task-details";

    const detailsTa = document.createElement("textarea");
    detailsTa.value = r.details || "";
    detailsTa.placeholder = "Add details for this task…";
    detailsTa.addEventListener("input", () => {
      r.details = detailsTa.value;
      scheduleSave(slug);
    });
    detailsWrap.appendChild(detailsTa);

    // Initial state
    const isOpen = Boolean(r._open);          // UI-only flag (not required to exist)
    tr.classList.toggle("task-open", isOpen);
    expandBtn.textContent = isOpen ? "▾" : "▸";
    expandBtn.title = isOpen ? "Hide details" : "Show details";

    // Toggle open/closed without re-rendering
    expandBtn.addEventListener("click", () => {
      r._open = !r._open;                     // UI-only flag; harmless if stored
      tr.classList.toggle("task-open", r._open);
      expandBtn.textContent = r._open ? "▾" : "▸";
      expandBtn.title = r._open ? "Hide details" : "Show details";
      if (r._open) setTimeout(() => detailsTa.focus(), 0);
    });

    main.appendChild(input);
    main.appendChild(expandBtn);

    tdTask.appendChild(main);
    tdTask.appendChild(detailsWrap);
    tr.appendChild(tdTask);

    // days (+ color + xp badge)  —— always-on quest skin
    const tdDays = document.createElement("td");
    tdDays.className = "thin";
    const pill = document.createElement("span");
    pill.className = "days-pill";
    const d = dayDiff(r.last_progress_at);
    pill.textContent = `${d}d`;
    pill.style = (slug !== 'todo-long') ? dayColor(d) : '';
    tdDays.appendChild(pill);

    // rarity border class
    const rarity = getRarity(d, slug);
    ['q-common','q-uncommon','q-rare','q-epic'].forEach(c => tr.classList.remove(c));
    if (rarity !== 'neutral') tr.classList.add('q-' + rarity);

    // XP badge
    const xp = computeXP(r.text, d);
    const xpSpan = document.createElement('span');
    xpSpan.className = 'xp-badge';
    xpSpan.textContent = `${xp} XP`;
    tdDays.appendChild(xpSpan);

    tr.appendChild(tdDays);

    // progress (resets days + XP toast)
    const tdOk = document.createElement("td");
    tdOk.className = "thin";
    const okBtn = document.createElement("button");
    okBtn.className = "btn ok";
    okBtn.title = "Mark progress (resets days)";
    okBtn.textContent = "⚡";
    okBtn.addEventListener("click", () => {
      r.last_progress_at = new Date().toISOString();
      pill.textContent = "0d";
      pill.style = (slug !== 'todo-long') ? dayColor(0) : '';
      showXpToast(tr, `+${computeXP(r.text, 0)} XP`);
      scheduleSave(slug);
    });
    tdOk.appendChild(okBtn);
    tr.appendChild(tdOk);

    // delete
    const tdDel = document.createElement("td");
    tdDel.className = "thin";
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.title = "Delete row";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      // optional: cleanup UI open flag
      r._open = false;

      S.rows = S.rows.filter(x => x.id !== r.id);
      if (!S.rows.length) S.rows.push(newRow([]));
      renderTable(slug);
      scheduleSave(slug);
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });
}

/* ===== drag & drop ===== */
const PRESS_MS = 220, MOVE_TOL = 8;
function wireDrag(slug){
  const S = state[slug];
  const root = S.el;
  const tbody = root.querySelector("tbody");

  let pressTimer=null, startX=0, startY=0;
  let dragging=null, ghost=null;

  function startDrag(ev, handle){
    document.activeElement?.blur?.(); window.getSelection?.().removeAllRanges?.();
    dragging = handle.closest("tr");
    const rect = dragging.getBoundingClientRect();

    ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.style.left = `${rect.left}px`;
    ghost.style.top  = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height= `${rect.height}px`;
    ghost.textContent = dragging.querySelector(".task-input")?.value || "Row";
    document.body.appendChild(ghost);

    dragging.style.visibility = "hidden";
    document.documentElement.classList.add("drag-lock");

    const onMove = (e) => {
      ghost.style.top = `${e.clientY - rect.height/2}px`;
      const others = [...tbody.querySelectorAll("tr")].filter(tr => tr !== dragging);
      let target=null;
      for (const row of others){
        const r = row.getBoundingClientRect();
        const mid = r.top + r.height/2;
        if (e.clientY < mid){ target = row; break; }
      }
      if (target) tbody.insertBefore(dragging, target);
      else tbody.appendChild(dragging);
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      ghost.remove(); ghost=null;
      dragging.style.visibility = ""; dragging=null;
      document.documentElement.classList.remove("drag-lock");

      const order = [...tbody.querySelectorAll("tr")].map(tr => Number(tr.dataset.id));
      const map = new Map(S.rows.map(r => [r.id, r]));
      S.rows = order.map(id => map.get(id)).filter(Boolean);
      renderTable(slug);
      scheduleSave(slug);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  tbody.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    startX = e.clientX; startY = e.clientY;

    if (e.pointerType !== "touch"){ startDrag(e, handle); return; }
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => startDrag(e, handle), PRESS_MS);
    handle.setPointerCapture?.(e.pointerId);
  });

  tbody.addEventListener("pointermove", (e) => {
    if (!pressTimer) return;
    const dx=Math.abs(e.clientX-startX), dy=Math.abs(e.clientY-startY);
    if (dx>MOVE_TOL || dy>MOVE_TOL){ clearTimeout(pressTimer); pressTimer=null; }
  });

  ["pointerup","pointercancel","lostpointercapture"].forEach(ev =>
    tbody.addEventListener(ev, ()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer=null; } })
  );
}

/* ===== boot ===== */
document.addEventListener("DOMContentLoaded", async () => {
  // attach containers and add-row buttons
  document.querySelectorAll(".todo-card").forEach(card => {
    const slug = card.dataset.slug;
    state[slug].el = card;
    card.querySelector(".add-btn").addEventListener("click", () => {
      const S = state[slug];
      S.rows.push(newRow(S.rows));
      renderTable(slug);
      scheduleSave(slug);
      card.querySelector("tbody tr:last-child .task-input")?.focus();
    });
  });

  for (const slug of Object.keys(SLUGS)) {
    try { await loadList(slug); } catch(e){ console.warn("load failed", slug, e.message); }
    renderTable(slug);
    wireDrag(slug);
    subscribeRealtime(slug);
  }

  // refresh color once an hour (rolls to next day)
  setInterval(() => {
    for (const slug of Object.keys(SLUGS)) renderTable(slug);
  }, 60*60*1000);
});



