// ---------- Supabase helpers (reuse from mornings if you already have them) ----------
const SUPABASE_URL = "https://ntlsmrzpatcultvsrpll.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g"; // same as mornings.js

async function sbFetch(path, options = {}) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...options.headers,
  };
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(await res.text());
  return res;
}

// ---------- per-section state ----------
const gymState = {
  "gym-upper": { rows: [], saveTimer: null },
  "gym-core":  { rows: [], saveTimer: null },
  "gym-lower": { rows: [], saveTimer: null },
};

async function loadGym(slug) {
  const res = await sbFetch(`/rest/v1/gym_logs?slug=eq.${slug}&select=data`);
  const rows = (await res.json())?.[0]?.data ?? [];
  gymState[slug].rows = rows;
  return rows;
}

function scheduleSave(slug) {
  const S = gymState[slug];
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => saveGym(slug), 300);
}

async function saveGym(slug) {
  const S = gymState[slug];
  await sbFetch(`/rest/v1/gym_logs?slug=eq.${slug}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ data: S.rows }),
  });
}

// ---------- render into the overlay ----------
function renderGymTable(container, slug) {
  const S = gymState[slug];

  container.innerHTML = `
    <h2 class="overlay-title">${slugLabel(slug)}</h2>
    <section class="workout-table-wrap">
      <div class="hscroll">
        <table class="workout-table">
          <thead>
            <tr>
              <th class="dragcol" style="width:44px"></th>
              <th style="width:280px">workout</th>
              <th style="width:280px">intensity</th>
              <th style="width:280px">amount</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <button class="add-row-btn" type="button">＋ Add row</button>
      </div>
    </section>
  `;

  const tbody = container.querySelector("tbody");
  const addBtn = container.querySelector(".add-row-btn");

  function rowHTML(row, idx) {
  const w = row.workout ?? "";
  const i = row.intensity ?? "";
  const a = row.amount ?? "";
  return `
    <tr data-idx="${idx}">
      <td class="dragcol"><span class="drag-handle" title="Drag">≡</span></td>
      <td><input class="cell-input" data-field="workout"  value="${escapeHtml(w)}"  placeholder="Bench press, squats..." /></td>
      <td><input class="cell-input" data-field="intensity" value="${escapeHtml(i)}"  placeholder="2s up, 5s down / RPE..." /></td>
      <td><input class="cell-input" data-field="amount"    value="${escapeHtml(a)}"  placeholder="5x5, 12 reps, 40kg..." /></td>
    </tr>
  `;
  } 

  function renderBody() {
    tbody.innerHTML = S.rows.map(rowHTML).join("");
  }

  renderBody();



    
    // --- Drag & drop with long-press on touch, immediate on mouse ---
    let draggingTr = null;
    let fromIndex = -1;
    let pressTimer = null;
    let pressStartY = 0;
    let pressStartX = 0;
    const PRESS_MS = 220;        // hold time to start drag on touch
    const MOVE_TOL = 8;          // px tolerance before cancelling press

    const scroller = container.querySelector(".hscroll");

    let ghostEl = null;
    let ghostOffsetY = 0;
    let ghostLeft = 0;
    let ghostWidth = 0;

    function refreshRowIndices() {
      [...tbody.children].forEach((tr, i) => (tr.dataset.idx = String(i)));
    }

    function beginDrag(e, handle) {

      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      
      draggingTr = handle.closest("tr");
      if (!draggingTr) return;

      // lock scroll while dragging
      scroller.classList.add("drag-lock");
      tbody.classList.add("dragging");
      draggingTr.classList.add("is-dragging");

      handle.setPointerCapture?.(e.pointerId);
      e.preventDefault();

      const rows = [...tbody.children];
      fromIndex = rows.indexOf(draggingTr);

      const onMove = (ev) => {
        const y = ev.clientY;

        // find target row by midpoint
        const others = [...tbody.querySelectorAll("tr")].filter(tr => tr !== draggingTr);
        let target = null;
        for (const tr of others) {
          const r = tr.getBoundingClientRect();
          const mid = r.top + r.height / 2;
          if (y < mid) { target = tr; break; }
        }
        if (target) tbody.insertBefore(draggingTr, target); else tbody.appendChild(draggingTr);

        // mirror in data
        const domRows = [...tbody.children];
        const toIndex = domRows.indexOf(draggingTr);
        if (toIndex !== fromIndex && toIndex >= 0 && fromIndex >= 0) {
          const moved = S.rows.splice(fromIndex, 1)[0];
          S.rows.splice(toIndex, 0, moved);
          fromIndex = toIndex;
          scheduleSave(slug);
          refreshRowIndices();
        }
      };

      const end = (ev) => {
        draggingTr?.releasePointerCapture?.(ev.pointerId);
        window.removeEventListener("pointermove", onMove, { capture: true });
        window.removeEventListener("pointerup", end, { capture: true });
        window.removeEventListener("pointercancel", end, { capture: true });
        scroller.classList.remove("drag-lock");
        tbody.classList.remove("dragging");
        draggingTr?.classList.remove("is-dragging");
        draggingTr = null;
        fromIndex = -1;
      };

      window.addEventListener("pointermove", onMove, { capture: true, passive: false });
      window.addEventListener("pointerup", end, { capture: true });
      window.addEventListener("pointercancel", end, { capture: true });
    }

  // start: long-press on touch, immediate on mouse
  tbody.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;

    pressStartY = e.clientY;
    pressStartX = e.clientX;

    // Desktop mouse: start immediately
    if (e.pointerType !== "touch") {
      beginDrag(e, handle);
      return;
    }

    // Touch: start only after hold
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => beginDrag(e, handle), PRESS_MS);
    handle.setPointerCapture?.(e.pointerId);
  });

  tbody.addEventListener("pointermove", (e) => {
    if (pressTimer) {
      const dx = Math.abs(e.clientX - pressStartX);
      const dy = Math.abs(e.clientY - pressStartY);
      // if user scrolls or moves too much before the hold finishes, cancel
      if (dx > MOVE_TOL || dy > MOVE_TOL) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }
  });

tbody.addEventListener("pointerup", () => {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
});
tbody.addEventListener("pointercancel", () => {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
});




  // edit handler
  tbody.addEventListener("input", (e) => {
    const input = e.target.closest(".cell-input");
    if (!input) return;
    const tr = input.closest("tr");
    const idx = Number(tr.dataset.idx);
    const field = input.dataset.field;
    S.rows[idx] = { ...S.rows[idx], [field]: input.value };
    scheduleSave(slug);
  });

  // add row (we’ll make delete later if you want)
  addBtn.addEventListener("click", () => {
    S.rows.push({ workout: "", intensity: "", amount: "" });
    renderBody();
    scheduleSave(slug);
    // focus the first cell of the new row
    const last = tbody.querySelector('tr:last-child input[data-field="workout"]');
    if (last) last.focus();
  });
}

function slugLabel(slug) {
  if (slug === "gym-upper") return "Upper Body";
  if (slug === "gym-core")  return "Core Body";
  if (slug === "gym-lower") return "Lower Body";
  return slug;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

// ---------- hook into your overlay opening ----------
document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("gymOverlay");
  const overlayBody = document.getElementById("overlayBody");
  const backBtn = document.getElementById("overlayBack");

  // Only these three show a table
  const targets = {
    upper: "gym-upper",
    core:  "gym-core",
    lower: "gym-lower",
  };

  document.querySelectorAll(".gym-card").forEach(card => {
    card.addEventListener("click", async () => {
      const tag = card.dataset.target;
      const slug = targets[tag];

      overlay.style.display = "flex";

      if (!slug) {
        overlayBody.innerHTML = `<h2 class="overlay-title">READ.ME.</h2><p>Notes and instructions go here.</p>`;
        return;
      }

      // load data then render table
      await loadGym(slug);
      renderGymTable(overlayBody, slug);
    });
  });

  backBtn.addEventListener("click", () => (overlay.style.display = "none"));
});
