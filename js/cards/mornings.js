// ---- Supabase config ----
  const SUPABASE_URL = "https://ntlsmrzpatcultvsrpll.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
  const LIST_SLUG = "ray-mornings";


    // Realtime client (keeps your current REST helpers untouched)
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    // Local “version” of last write we made (to ignore our own events)
    let lastSeenVersion = 0;
//


// REST helper
  async function sbFetch(path, options = {}) 
  {
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...options.headers,
    };
    const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
    if (!res.ok) throw new Error(await res.text());
    return res;
  }
//


// realtime subscription
  function subscribeRealtime() 
  {
    const channel = sb
      .channel('tasklists-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_lists',
          filter: `slug=eq.${LIST_SLUG}`,
        },
        (payload) => {
          const row = payload.new || payload.old;
          // read version if present
          const incomingVersion = row?.data?.version ?? 0;

          // Ignore events we just wrote ourselves
          if (incomingVersion && incomingVersion <= lastSeenVersion) return;

          // Pull fresh data + render
          loadTasks().then(render);
        }
      )
      .subscribe();

    // Clean up on leave
    window.addEventListener('beforeunload', () => {
      sb.removeChannel(channel);
    });
  }
//

// ---- DOM ----
const STORAGE_FALLBACK = 'morningTasks_v1'; // offline cache
const taskBody = document.getElementById('taskBody');
const addBtn   = document.getElementById('addTaskBtn');

let tasks = []; // [{id:number, text:string}]

// ---- remote load/save with local fallback ----
async function loadTasks() 
{
  try {
    const res = await sbFetch(`/rest/v1/task_lists?slug=eq.${LIST_SLUG}&select=data`);
    const rows = await res.json();
    const blob = rows?.[0]?.data ?? [];
    // accept both old and new formats
    tasks = Array.isArray(blob) ? blob : (blob.payload ?? []);
    localStorage.setItem(STORAGE_FALLBACK, JSON.stringify(tasks));
  } catch (e) {
    const raw = localStorage.getItem(STORAGE_FALLBACK);
    tasks = raw ? JSON.parse(raw) : [];
    console.warn('Using local cache (offline?):', e);
  }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveTasks, 300);
}

async function saveTasks() 
{
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
    console.warn('Save failed (offline?):', e);
  }
}

// ---- render ----
function render() {
  taskBody.innerHTML = '';

  tasks.forEach((t, idx) => {
    const tr = document.createElement('tr');
    tr.style.position = 'relative';

    // NO
    const tdNo = document.createElement('td');
    tdNo.textContent = String(idx + 1);
    tr.appendChild(tdNo);

    // Task input (now also holds the minus button)
    const tdTask = document.createElement('td');
    tdTask.className = 'task-td';         // <-- add this
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-input';
    input.value = t.text || '';
    input.placeholder = 'Type your task…';
    input.dataset.id = String(t.id);
    tdTask.appendChild(input);

    // Minus button lives inside the task cell
    const btn = document.createElement('button');
    btn.className = 'delete-btn';
    btn.textContent = '–';
    btn.title = 'Delete task';
    btn.dataset.id = String(t.id);
    tdTask.appendChild(btn);

    tr.appendChild(tdTask);

    // Status (placeholder)
    const tdStatus = document.createElement('td');
    tdStatus.textContent = '—';
    tdStatus.style.opacity = 0.75;
    tr.appendChild(tdStatus);
    taskBody.appendChild(tr);   

  });
}

// ---- interactions ----
  function addTask() 
  {                 // ➕
    const nextId = tasks.length ? Math.max(...tasks.map(t => t.id)) + 1 : 1;
    tasks.push({ id: nextId, text: '' });
    render();
    scheduleSave();
    const lastInput = taskBody.querySelector('tr:last-child .task-input');
    if (lastInput) lastInput.focus();
  }

  function onTaskEdit(e) 
  {            // ⌨️
    if (!(e.target instanceof HTMLInputElement)) return;
    if (!e.target.classList.contains('task-input')) return;
    const id = Number(e.target.dataset.id);
    const t = tasks.find(x => x.id === id);
    if (t) {
      t.text = e.target.value;
      scheduleSave();
    }
  }

  function onDeleteClick(e) 
  {         // 💥
    const btn = e.target.closest('.delete-btn');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    tasks = tasks.filter(t => t.id !== id);
    render();
    scheduleSave();
  }

  // ---- init (await load THEN render) ----
  (async function init() 
  {
    await loadTasks();
    render();
    subscribeRealtime(); // <-- start listening
  })();

  addBtn.addEventListener('click', addTask);
  taskBody.addEventListener('input', onTaskEdit);
  taskBody.addEventListener('click', onDeleteClick);
//
