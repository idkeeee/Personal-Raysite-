/* ===== Supabase reuse ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);

const LONG_PRESS_MS = 220;
const MOVE_TOL = 8;
const isTouch = () => "ontouchstart" in window || navigator.maxTouchPoints > 0;

/* one row for this page */
const BAG_SLUG = "bag-default";

/* offline cache */
const CACHE_KEY = "bag.items.v1";
const readLocal  = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } };
const writeLocal = (arr) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); } catch {} };

/* state: [{id, label, on}] */
let items = readLocal() || [
  { id:1, label:"Wallet", on:true },
  { id:2, label:"Keys", on:false },
  { id:3, label:"Phone", on:true },
  { id:4, label:"Earbuds", on:false },
  { id:5, label:"Charger", on:false },
  { id:6, label:"Notebook", on:false },
];
let lastVersion = 0;

const grid = document.getElementById("bagGrid");

/* ===== remote IO ===== */
async function loadRemote(){
  const { data, error } = await sb.from("bag_items").select("data,version").eq("slug", BAG_SLUG).maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  if (data?.data && Array.isArray(data.data)) {
    items = data.data;
    lastVersion = data.version ?? 0;
    writeLocal(items);
  }
}

let saveTimer = null;
function scheduleSave(){ clearTimeout(saveTimer); saveTimer = setTimeout(saveRemote, 250); }
async function saveRemote(){
  lastVersion = Date.now();
  const { error } = await sb.from("bag_items").upsert(
    { slug: BAG_SLUG, data: items, version: lastVersion, updated_at: new Date().toISOString() },
    { onConflict: "slug" }
  );
  if (!error) writeLocal(items);
}

/* realtime */
function subscribeRealtime(){
  const ch = sb
    .channel("bag-rt")
    .on("postgres_changes",
      { event:"*", schema:"public", table:"bag_items", filter:`slug=eq.${BAG_SLUG}` },
      (payload) => {
        const row = payload.new || payload.old;
        const v = row?.version ?? 0;
        if (v && v <= lastVersion) return; // ignore own
        const arr = Array.isArray(row?.data) ? row.data : [];
        items = arr; writeLocal(items);
        render();
      })
    .subscribe();
  window.addEventListener("beforeunload", () => sb.removeChannel(ch));
}

/* ===== Modal ===== */
let modalEl = null;
function ensureModal(){
  if (modalEl) return modalEl;
  modalEl = document.createElement("div");
  modalEl.className = "bag-modal";
  modalEl.innerHTML = `
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="bagModalTitle">
      <h3 id="bagModalTitle">Item</h3>
      <div class="field">
        <label for="bagModalName">Name</label>
        <input id="bagModalName" type="text" placeholder="Type a name"/>
      </div>
      <div class="actions">
        <button class="btn danger"  id="bagModalDelete" type="button">Delete</button>
        <span style="flex:1"></span>
        <button class="btn"          id="bagModalCancel" type="button">Cancel</button>
        <button class="btn primary"  id="bagModalSave"   type="button">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modalEl);
  modalEl.addEventListener("click", (e)=>{ if(e.target===modalEl) closeModal(false); });
  return modalEl;
}

let modalCtx = null; // {mode:'create'|'edit', item}
function openModal(ctx){
  ensureModal();
  modalCtx = ctx;
  const title = modalEl.querySelector("#bagModalTitle");
  const input = modalEl.querySelector("#bagModalName");
  const del   = modalEl.querySelector("#bagModalDelete");
  title.textContent = ctx.mode === "create" ? "Add item" : "Edit item";
  input.value = ctx.mode === "create" ? "" : ctx.item.label;
  del.style.display = ctx.mode === "create" ? "none" : "";

  modalEl.querySelector("#bagModalSave").onclick   = () => closeModal(true);
  modalEl.querySelector("#bagModalCancel").onclick = () => closeModal(false);
  del.onclick = () => { deleteItem(ctx.item); closeModal(false, {deleted:true}); };

  document.body.classList.add("modal-open");
  modalEl.classList.add("open");
  setTimeout(()=>{ input.focus(); input.select(); }, 0);
}

function closeModal(commit, extra={}){
  if (!modalEl) return;
  const input = modalEl.querySelector("#bagModalName");
  modalEl.classList.remove("open");
  document.body.classList.remove("modal-open");

  if (commit && modalCtx){
    const name = (input.value || "").trim();
    if (modalCtx.mode === "create"){
      if (name) addItemWithName(name);
    } else if (modalCtx.mode === "edit"){
      if (!extra.deleted && name){
        modalCtx.item.label = name;
        scheduleSave(); render();
      }
    }
  }
  modalCtx = null;
}

function addItemWithName(name){
  const id = items.length ? Math.max(...items.map(x=>x.id))+1 : 1;
  items.push({ id, label: name, on:false });
  scheduleSave(); render();
}
function deleteItem(item){
  items = items.filter(x => x.id !== item.id);
  scheduleSave(); render();
}

/* ===== rendering ===== */
function render(){
  grid.innerHTML = "";

  // render item tiles
  items.forEach((it) => {
    const div = document.createElement("button");
    div.type = "button";
    div.className = "bag-tile" + (it.on ? " active" : "");
    div.setAttribute("data-id", it.id);
    div.innerHTML = `<span class="bag-name">${escapeHtml(it.label)}</span>`;

    // tap / click toggles
    div.addEventListener("click", () => {
      it.on = !it.on;
      div.classList.toggle("active", it.on);
      scheduleSave();
    });

    // desktop: right-click for menu
    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!isTouch()) openModal({ mode: "edit", item: it });
    });

    // touch: long-press for menu
    let lpTimer = null, sx=0, sy=0;
    div.addEventListener("pointerdown", (e)=>{
      if (!isTouch()) return;
      sx=e.clientX; sy=e.clientY;
      clearTimeout(lpTimer);
      lpTimer = setTimeout(()=> openModal({ mode: "edit", item: it }), LONG_PRESS_MS);
      div.setPointerCapture?.(e.pointerId);
    });
    div.addEventListener("pointermove", (e)=>{
      if (!lpTimer) return;
      if (Math.abs(e.clientX-sx)>MOVE_TOL || Math.abs(e.clientY-sy)>MOVE_TOL){
        clearTimeout(lpTimer); lpTimer=null;
      }
    });
    ["pointerup","pointercancel","lostpointercapture"].forEach(ev =>
      div.addEventListener(ev, ()=>{ if(lpTimer){ clearTimeout(lpTimer); lpTimer=null; } })
    );

    grid.appendChild(div);
  });

  // add tile (＋)
  const add = document.createElement("button");
  add.type = "button";
  add.className = "bag-tile bag-add";
  add.innerHTML = `<span class="bag-name">＋</span>`;
  add.title = "Add item";
  add.addEventListener("click", () => openModal({ mode: "create" }));

  // touch long-press create (optional)
  let addLP=null, ax=0, ay=0;
  add.addEventListener("pointerdown",(e)=>{
    if (!isTouch()) return;
    ax=e.clientX; ay=e.clientY;
    clearTimeout(addLP);
    addLP=setTimeout(()=> openModal({mode:"create"}), LONG_PRESS_MS);
  });
  ["pointermove","pointerup","pointercancel","lostpointercapture"].forEach(ev =>
    add.addEventListener(ev, (e)=>{
      if (!addLP) return;
      if (ev==="pointermove" && (Math.abs(e.clientX-ax)>MOVE_TOL || Math.abs(e.clientY-ay)>MOVE_TOL)) { clearTimeout(addLP); addLP=null; }
      if (ev!=="pointermove") { clearTimeout(addLP); addLP=null; }
    })
  );

  grid.appendChild(add);
}

/* utils */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* boot */
(async function init(){
  try { await loadRemote(); } catch(e){ console.warn("bag load fallback to local:", e.message); }
  render();
  subscribeRealtime();
})();
