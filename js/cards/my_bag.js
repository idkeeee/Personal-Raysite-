/* ===== Supabase reuse ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);

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
  if (data?.data && Array.isArray(data.data)) { items = data.data; writeLocal(items); lastVersion = data.version ?? 0; }
}

let saveTimer=null;
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

/* ===== rendering ===== */
function render(){
  grid.innerHTML = "";

  // render items
  items.forEach((it) => {
    const div = document.createElement("button");
    div.type = "button";
    div.className = "bag-tile" + (it.on ? " active" : "");
    div.setAttribute("data-id", it.id);
    div.innerHTML = `<span class="bag-name">${escapeHtml(it.label)}</span>`;
    div.addEventListener("click", () => {
      it.on = !it.on;
      div.classList.toggle("active", it.on);
      scheduleSave();
    });
    // long-press to rename (mobile-friendly)
    addRenameOnLongPress(div, it);
    grid.appendChild(div);
  });

  // add tile
  const add = document.createElement("button");
  add.type = "button";
  add.className = "bag-tile bag-add";
  add.innerHTML = `<span class="bag-name">＋</span>`;
  add.title = "Add item";
  add.addEventListener("click", () => addItem());
  grid.appendChild(add);
}

function addItem(){
  const label = prompt("New item name:");
  if (!label) return;
  const id = items.length ? Math.max(...items.map(x=>x.id))+1 : 1;
  items.push({ id, label: label.trim(), on:false });
  scheduleSave();
  render();
}

/* rename via long-press (220ms) */
function addRenameOnLongPress(el, it){
  let t=null, sx=0, sy=0;
  const PRESS=220, MOV=8;
  const start=(e)=>{ sx=e.clientX; sy=e.clientY; t=setTimeout(() => {
      const name = prompt("Rename item:", it.label);
      if (name!=null && name.trim()!==""){ it.label=name.trim(); scheduleSave(); render(); }
    }, PRESS);
  };
  const move=(e)=>{ if(!t) return; if(Math.abs(e.clientX-sx)>MOV||Math.abs(e.clientY-sy)>MOV){ clearTimeout(t); t=null; } };
  const end=()=>{ if(t){ clearTimeout(t); t=null; } };
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointermove", move);
  ["pointerup","pointercancel","lostpointercapture"].forEach(ev=> el.addEventListener(ev,end));
}

/* utils */
function escapeHtml(s){return String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

/* boot */
(async function init(){
  try { await loadRemote(); } catch(e){ console.warn("bag load fallback to local:", e.message); }
  render();
  subscribeRealtime();
})();
