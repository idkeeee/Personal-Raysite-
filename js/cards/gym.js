/* ===========================
   GYM page logic (overlay + tables)
   - Upper/Core/Lower: 3 columns (workout | intensity | amount)
   - READ.ME.: 1 column (message)
   - Per-row Delete, Add row, Drag-to-reorder (mouse + touch long-press)
   - Supabase save/load (same table as before: gym_logs { slug, data })
   =========================== */

/* ---- Supabase helpers (reuse your existing values) ----
   If you already define these elsewhere, you may delete this block
   or let the existing globals (window.SUPABASE_URL/ANON) override. */
const SUPABASE_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SUPABASE_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";

async function sbFetch(path, options = {}) {
  const headers = {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${SUPABASE_ANON}`,
    Accept: "application/json",
    ...options.headers,
  };

  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      ...options,
      mode: "cors",
      headers,
    });

    if (!res.ok) {
      // Try to extract a meaningful message
      let msg = "";
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        try { msg = (await res.json())?.message || ""; } catch {}
      }
      if (!msg) {
        try { msg = await res.text(); } catch {}
      }
      throw new Error(msg || `${res.status} ${res.statusText}`);
    }

    return res;
  } catch (e) {
    // Network, adblock, DNS, etc.
    console.error("Supabase fetch error:", e);
    throw new Error(e?.message || "Network error");
  }
}


// ---------- local mirror helpers ----------
function cacheKey(slug) { return `gym:${slug}`; }

function saveLocal(slug, rows) {
  try { localStorage.setItem(cacheKey(slug), JSON.stringify(rows)); } catch {}
}

function loadLocal(slug) {
  try {
    const s = localStorage.getItem(cacheKey(slug));
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

// ---------- Data I/O (replace your load/save) ----------
async function loadGym(slug) {
  try {
    const res = await sbFetch(`/rest/v1/gym_logs?slug=eq.${encodeURIComponent(slug)}&select=data`);
    const rows = (await res.json())?.[0]?.data ?? [];
    gymState[slug].rows = rows;
    saveLocal(slug, rows);               // keep a mirror
    return rows;
  } catch (err) {
    // Fallback to local cache so UI still opens
    const cached = loadLocal(slug);
    if (cached) {
      console.warn("Using cached data for", slug, err);
      gymState[slug].rows = cached;
      // Surface the error non-blocking in console, not the UI
      return cached;
    }
    // No cache — rethrow so the UI shows the error
    throw err;
  }
}

async function saveGym(slug) {
  const S = gymState[slug];
  const body = JSON.stringify({ data: S.rows });
  try {
    await sbFetch(`/rest/v1/gym_logs?slug=eq.${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body,
    });
    saveLocal(slug, S.rows);            // update mirror on success
  } catch (err) {
    console.error("Save failed:", err);
    // Optional: queue for retry later if you want
    throw err;
  }
}




/* ---- Per-section state (4 slugs) ---- */
const gymState = {
  "gym-upper":  { rows: [], saveTimer: null },
  "gym-core":   { rows: [], saveTimer: null },
  "gym-lower":  { rows: [], saveTimer: null },
  "gym-readme": { rows: [], saveTimer: null }, // single-column
};

function scheduleSave(slug) {
  const S = gymState[slug];
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => saveGym(slug), 300);
}

/* ---- Render into overlay ---- */
function renderGymTable(container, slug) {
  const S = gymState[slug];
  const READMODE = isReadmeSlug(slug);

  container.innerHTML = `
    <h2 class="overlay-title">${slugLabel(slug)}</h2>
    <section class="workout-table-wrap">
      <div class="hscroll">
        <table class="workout-table ${READMODE ? "readme" : ""}">
          <thead>
            <tr>
              <th class="dragcol" style="width:44px"></th>
              ${READMODE
                ? `<th style="width:100%">message</th>`
                : `
                  <th style="width:280px">workout</th>
                  <th style="width:280px">intensity</th>
                  <th style="width:280px">amount</th>
                `}
              <th class="thin">Del</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <button class="add-row-btn" type="button">＋ Add row</button>
      </div>
    </section>
  `;

  const tbody  = container.querySelector("tbody");
  const addBtn = container.querySelector(".add-row-btn");

  /* -- row HTML (dual-mode) -- */
  function rowHTML(row, idx) {
    if (READMODE) {
      const m = row.message ?? "";
      return `
        <tr data-idx="${idx}">
          <td class="dragcol"><span class="drag-handle" title="Drag">≡</span></td>
          <td>
            <input class="cell-input" data-field="message"
                   value="${escapeHtml(m)}"
                   placeholder="Type a note…"/>
          </td>
          <td class="thin">
            <button class="row-del" type="button" aria-label="Delete row">✕</button>
          </td>
        </tr>`;
    } else {
      const w = row.workout ?? "";
      const i = row.intensity ?? "";
      const a = row.amount ?? "";
      return `
        <tr data-idx="${idx}">
          <td class="dragcol"><span class="drag-handle" title="Drag">≡</span></td>
          <td><input class="cell-input" data-field="workout"   value="${escapeHtml(w)}" placeholder="Bench press, squats..." /></td>
          <td><input class="cell-input" data-field="intensity" value="${escapeHtml(i)}" placeholder="2s up, 5s down / RPE..." /></td>
          <td><input class="cell-input" data-field="amount"    value="${escapeHtml(a)}" placeholder="5×5, 12 reps, 40kg..." /></td>
          <td class="thin">
            <button class="row-del" type="button" aria-label="Delete row">✕</button>
          </td>
        </tr>`;
    }
  }

  function renderBody() {
    tbody.innerHTML = S.rows.map(rowHTML).join("");
  }

  // initial draw (ensure at least one row)
  if (!Array.isArray(S.rows) || S.rows.length === 0) {
    S.rows = [ READMODE ? { message: "" } : { workout: "", intensity: "", amount: "" } ];
  }
  renderBody();

  /* -- Input edits -> state + save -- */
  tbody.addEventListener("input", (e) => {
    const input = e.target.closest(".cell-input");
    if (!input) return;
    const tr = input.closest("tr");
    const idx = Number(tr.dataset.idx);
    const field = input.dataset.field;
    S.rows[idx] = { ...S.rows[idx], [field]: input.value };
    scheduleSave(slug);
  });

  /* -- Delete (event delegation) -- */
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest(".row-del");
    if (!btn) return;
    const tr = btn.closest("tr");
    const idx = Number(tr.dataset.idx);
    S.rows.splice(idx, 1);
    if (S.rows.length === 0) {
      S.rows.push(READMODE ? { message: "" } : { workout: "", intensity: "", amount: "" });
    }
    renderBody();
    scheduleSave(slug);
  });

  /* -- Add row -- */
  addBtn.addEventListener("click", () => {
    S.rows.push(READMODE ? { message: "" } : { workout: "", intensity: "", amount: "" });
    renderBody();
    scheduleSave(slug);
    const sel = READMODE ? 'tr:last-child input[data-field="message"]'
                         : 'tr:last-child input[data-field="workout"]';
    const last = tbody.querySelector(sel);
    last?.focus();
  });

  /* -- Drag & drop (long-press on touch) -- */
  let draggingTr = null;
  let pressTimer = null;
  let pressStartY = 0, pressStartX = 0;
  const PRESS_MS = 220, MOVE_TOL = 8;
  const scroller = container.querySelector(".hscroll");

  function beginDrag(e, handle) {
    draggingTr = handle.closest("tr");
    const rr = draggingTr.getBoundingClientRect();

    const ghostEl = document.createElement("div");
    ghostEl.className = "drag-ghost";
    ghostEl.style.position = "fixed";
    ghostEl.style.left = `${rr.left}px`;
    ghostEl.style.top = `${rr.top}px`;
    ghostEl.style.width = `${rr.width}px`;
    ghostEl.style.height = `${rr.height}px`;
    ghostEl.style.pointerEvents = "none";
    ghostEl.style.opacity = "0.9";
    ghostEl.style.background = "rgba(32,32,36,.92)";
    ghostEl.style.borderRadius = "10px";
    ghostEl.style.boxShadow = "0 10px 26px rgba(0,0,0,.45)";
    ghostEl.style.padding = "6px 10px";
    ghostEl.textContent = (draggingTr.querySelector('input')?.value || `Row ${Number(draggingTr.dataset.idx) + 1}`);
    document.body.appendChild(ghostEl);

    draggingTr.style.visibility = "hidden";
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();

    const rows = [...tbody.children];
    let fromIndex = rows.indexOf(draggingTr);

    const onMove = (ev) => {
      ghostEl.style.top = `${ev.clientY - rr.height/2}px`;

      // insert before first row with midpoint below cursor
      const others = [...tbody.querySelectorAll("tr")].filter(tr => tr !== draggingTr);
      let target = null;
      for (const tr of others) {
        const r = tr.getBoundingClientRect();
        const mid = r.top + r.height/2;
        if (ev.clientY < mid) { target = tr; break; }
      }
      if (target) tbody.insertBefore(draggingTr, target);
      else        tbody.appendChild(draggingTr);
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      ghostEl.remove();
      draggingTr.style.visibility = "";
      draggingTr = null;

      // commit new order to S.rows based on DOM order
      const newOrder = [];
      tbody.querySelectorAll("tr").forEach(tr => {
        newOrder.push(S.rows[Number(tr.dataset.idx)]);
      });
      S.rows = newOrder;
      renderBody();        // reindex data-idx
      scheduleSave(slug);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  tbody.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;

    pressStartY = e.clientY;
    pressStartX = e.clientX;

    if (e.pointerType !== "touch") { beginDrag(e, handle); return; }
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => beginDrag(e, handle), PRESS_MS);
    handle.setPointerCapture?.(e.pointerId);
  });

  tbody.addEventListener("pointermove", (e) => {
    if (!pressTimer) return;
    const dx = Math.abs(e.clientX - pressStartX);
    const dy = Math.abs(e.clientY - pressStartY);
    if (dx > MOVE_TOL || dy > MOVE_TOL) { clearTimeout(pressTimer); pressTimer = null; }
  });

  ["pointerup","pointercancel","lostpointercapture"].forEach(ev =>
    tbody.addEventListener(ev, () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } })
  );
}

/* ---- Helpers ---- */
function isReadmeSlug(slug) {
  return slug === "gym-readme" || slug === "readme";
}
function slugLabel(slug) {
  if (slug === "gym-upper")  return "Upper Body";
  if (slug === "gym-core")   return "Core Body";
  if (slug === "gym-lower")  return "Lower Body";
  if (slug === "gym-readme") return "READ.ME.";
  return slug;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

/* ---- Boot ---- */
document.addEventListener("DOMContentLoaded", () => {
  const overlay    = document.getElementById("gymOverlay");
  const overlayBody= document.getElementById("overlayBody");
  const backBtn    = document.getElementById("overlayBack");

  if (!overlay || !overlayBody || !backBtn) {
    console.error("GYM overlay markup missing (gymOverlay/overlayBody/overlayBack).");
    return;
  }

  overlay.style.display = "none";
  overlayBody.innerHTML = "";

  const targets = { upper: "gym-upper", core: "gym-core", lower: "gym-lower", readme: "gym-readme" };

  document.querySelectorAll(".gym-card").forEach(card => {
    card.addEventListener("click", async () => {
      const tag  = card.dataset.target;
      const slug = targets[tag];
      if (!slug) return;

      try {
        await loadGym(slug);
        overlay.style.display = "flex";
        renderGymTable(overlayBody, slug);
      } catch (err) {
        overlay.style.display = "flex";
        overlayBody.innerHTML = `
          <h2 class="overlay-title">${slugLabel(slug)}</h2>
          <p style="color:#f88">Load failed: ${escapeHtml(err.message)}</p>`;
      }
    });
  });

  backBtn.addEventListener("click", () => {
    overlay.style.display = "none";
    overlayBody.innerHTML = "";
  });
});