/*  e  words.html -> title-only cards + slide-up editor, Supabase v2 client (separate table)
   Now with robust error surfacing + retries + 204-safe upsert + local cache.
*/

const SUPABASE_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SUPABASE_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false }
});

// ------------- DOM helpers -------------
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
};

// ------------- Global error surfacing (so iOS/Safari can’t hide it) -------------
(function () {
  const pop = (t, m) => console.warn(`[${t}]`, m);
  window.addEventListener('error', (e) => {
    const msg = e.error?.stack || e.message || String(e.error || e);
    pop('window.onerror', msg);
    alert('Script error: ' + msg);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const msg = (r && (r.stack || r.message)) || String(r);
    pop('unhandledrejection', msg);
    alert('Promise error: ' + msg);
  });
})();

// ------------- Local cache -------------
const CACHE_KEY = 'words:cards:v1';
const readCache  = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || []; } catch { return []; } };
const writeCache = (rows) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch {} };

// ------------- Retry + error formatting -------------
function formatSbError(err, ctx = '') {
  const code = err?.code ? ` [${err.code}]` : '';
  const details = err?.details ? ` — ${err.details}` : '';
  const hint = err?.hint ? ` — ${err.hint}` : '';
  return `${ctx}${code}: ${err?.message || String(err)}${details}${hint}`;
}

async function withRetry(fn, { tries = 3, baseDelay = 250, ctx = '' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      // do not retry on “hard” errors
      const hard = ['42501','PGRST301','PGRST116','23505','22P02']; // perms/RLS/no-row/unique/invalid
      if (hard.includes(err?.code)) break;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
  }
  throw new Error(formatSbError(lastErr, ctx));
}

function ensureScaffold() {
  // mount grid if missing
  let grid = document.querySelector('.card-grid');
  if (!grid) {
    grid = el('section', { className: 'card-grid' });
    document.body.insertBefore(grid, document.scripts[0]);
  }

  // FAB
  if (!$('.fab-add')) {
    const fab = el('button', { className: 'fab-add', title: 'Add word', innerHTML: '+' });
    fab.addEventListener('click', () => openSheetForNew());
    document.body.appendChild(fab);
  }

  // Backdrop
  if (!$('.sheet-backdrop')) {
    const backdrop = el('div', { className: 'sheet-backdrop' });
    backdrop.addEventListener('click', closeSheet);
    document.body.appendChild(backdrop);
  }

  // Sheet
  if (!$('.sheet')) {
    const sheet = el('div', { className: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-hidden': 'true' }, [
      el('div', { className: 'sheet-handle' }),
      el('div', { className: 'sheet-header' }, [
        el('h3', { className: 'sheet-title', textContent: 'Word' }),
        el('button', { className: 'sheet-close', innerHTML: '✕', title: 'Close' })
      ]),
      el('div', { className: 'sheet-body' }, [
        el('div', {}, [
          el('div', { className: 'label', textContent: 'Title' }),
          el('input', { type: 'text', id: 'cardTitle', placeholder: 'e.g., Vocabulary' })
        ]),
        el('div', {}, [
          el('div', { className: 'label', textContent: 'Content' }),
          el('textarea', { id: 'cardContent', placeholder: 'Write something…' })
        ])
      ]),
      el('div', { className: 'sheet-footer' }, [
        el('button', { className: 'btn secondary', id: 'deleteBtn', textContent: 'Delete' }),
        el('div', { style: 'flex:1' }),
        el('button', { className: 'btn secondary', id: 'cancelBtn', textContent: 'Cancel' }),
        el('button', { className: 'btn primary',   id: 'saveBtn',   textContent: 'Save' }),
      ])
    ]);
    document.body.appendChild(sheet);

    $('.sheet-close').addEventListener('click', closeSheet);
    $('#cancelBtn').addEventListener('click', closeSheet);
    $('#deleteBtn').addEventListener('click', onDelete);
    $('#saveBtn').addEventListener('click', onSave);
  }
}
ensureScaffold();

// ------------- State -------------
let state = {
  cards: [],
  editingId: null,
  channel: null
};

// ------------- Data -------------
async function loadCards() {
  // Remote first
  const { data, error } = await supabase
    .from('words_cards')                    // <-- separate table
    .select('*')
    .or('archived.is.null,archived.eq.false')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('loadCards error:', error);
    // fallback to cache
    state.cards = readCache();
    if (!state.cards.length) renderEmpty(`Failed to load: ${error.message}`);
    else renderCards();
    return;
  }
  state.cards = data || [];
  writeCache(state.cards);
  renderCards();
}

async function upsertCard(card) {
  const payload = {
    id: card.id ?? undefined,
    title: (card.title || '').trim() || 'Untitled',
    image_url: null,
    content: card.content ?? '',
    sort_order: card.sort_order ?? 0,
    archived: !!card.archived
  };

  // Try to get the row back; tolerate empty/204 then refetch
  const { data, error } = await withRetry(() =>
    supabase
      .from('words_cards')
      .upsert(payload, { defaultToNull: false })
      .select() // don't .single()
  , { tries: 3, baseDelay: 200, ctx: 'UPSERT words_cards' });

  if (error) throw error;

  let row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    // Fallback: re-fetch by id if we have it, else by title+content
    const ref = payload.id
      ? supabase.from('words_cards').select('*').eq('id', payload.id).maybeSingle()
      : supabase.from('words_cards')
          .select('*')
          .eq('title', payload.title)
          .eq('content', payload.content)
          .order('created_at', { ascending: false })
          .limit(1);

    const { data: refetch, error: err2 } = await ref;
    if (err2) throw err2;
    row = (Array.isArray(refetch) ? refetch[0] : refetch) || payload;
  }
  return row;
}

async function deleteCard(id) {
  const { error } = await supabase.from('words_cards').delete().eq('id', id);
  if (error) throw error;
}

// ------------- UI render -------------
function renderEmpty(msg = 'No cards yet. Tap + to add one!') {
  const grid = $('.card-grid');
  grid.innerHTML = '';
  grid.appendChild(el('div', { className: 'empty', textContent: msg }));
}

function renderCards() {
  const grid = $('.card-grid');
  grid.innerHTML = '';

  if (!state.cards.length) {
    renderEmpty();
    return;
  }

  for (const c of state.cards) {
    const card = el('article', { className: 'cards', 'data-id': c.id });
    const title = el('h1', { textContent: c.title || 'Untitled' });
    const contents = el('div', { className: 'card_contents' }, [title]);
    card.appendChild(contents);

    card.addEventListener('click', () => openSheetForEdit(c.id));
    grid.appendChild(card);
  }
}

// ------------- Sheet controls -------------
function openSheetForNew() {
  state.editingId = null;
  $('#cardTitle').value = '';
  $('#cardContent').value = '';
  $('#deleteBtn').style.display = 'none';
  $('.sheet-title').textContent = 'New Word';
  openSheet();
}

function openSheetForEdit(id) {
  const card = state.cards.find(x => x.id === id);
  if (!card) return;

  state.editingId = id;
  $('#cardTitle').value = card.title || '';
  $('#cardContent').value = card.content || '';
  $('#deleteBtn').style.display = 'inline-block';
  $('.sheet-title').textContent = 'Edit Word';
  openSheet();
}

function openSheet() {
  $('.sheet').classList.add('open');
  $('.sheet').setAttribute('aria-hidden', 'false');
  $('.sheet-backdrop').classList.add('show');
}
function closeSheet() {
  $('.sheet').classList.remove('open');
  $('.sheet').setAttribute('aria-hidden', 'true');
  $('.sheet-backdrop').classList.remove('show');
  state.editingId = null;
}

// ------------- Actions -------------
async function onSave() {
  const title = $('#cardTitle').value;
  const content = $('#cardContent').value;
  const btn = $('#saveBtn');

  let optimisticIndex = -1;
  let tempId = null;

  if (state.editingId) {
    optimisticIndex = state.cards.findIndex(c => c.id === state.editingId);
    if (optimisticIndex >= 0) state.cards[optimisticIndex] = { ...state.cards[optimisticIndex], title, content };
  } else {
    tempId = 'temp-' + Math.random().toString(36).slice(2);
    state.cards.unshift({
      id: tempId, title, content, image_url: null,
      sort_order: 0, archived: false, created_at: new Date().toISOString()
    });
    optimisticIndex = 0;
  }
  renderCards();

  btn.disabled = true; const prevText = btn.textContent; btn.textContent = 'Saving…';
  try {
    const saved = await upsertCard({ id: state.editingId || undefined, title, content });

    // replace the optimistic row (by tempId or by editingId)
    const idx = tempId
      ? state.cards.findIndex(c => c.id === tempId)
      : state.cards.findIndex(c => c.id === state.editingId);

    if (idx >= 0) state.cards[idx] = saved;
    writeCache(state.cards);
    closeSheet();
    renderCards();
  } catch (err) {
    console.error('save failed:', err);
    const offline = (navigator && navigator.onLine === false) ? ' (offline?)' : '';
    alert('Save failed' + offline + ':\n' + formatSbError(err, 'words_cards'));
    await loadCards(); // resync
  } finally {
    btn.disabled = false; btn.textContent = prevText;
  }
}

async function onDelete() {
  if (!state.editingId) return;
  if (!confirm('Delete this card?')) return;

  const id = state.editingId;
  const prev = [...state.cards];
  state.cards = state.cards.filter(c => c.id !== id);
  renderCards();
  closeSheet();

  try {
    await deleteCard(id);
    writeCache(state.cards);
  } catch (err) {
    console.error('delete failed:', err);
    alert('Delete failed:\n' + formatSbError(err, 'words_cards'));
    state.cards = prev;
    renderCards();
  }
}

// ------------- Live changes (dedupe by id) -------------
function subscribeRealtime() {
  try {
    if (state.channel) supabase.removeChannel(state.channel);
    state.channel = supabase
      .channel('words_cards_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'words_cards' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const row = payload.new;
          const i = state.cards.findIndex(c => c.id === row.id);
          if (i >= 0) state.cards[i] = row; else state.cards.unshift(row);
        } else if (payload.eventType === 'DELETE') {
          state.cards = state.cards.filter(c => c.id !== payload.old.id);
        }
        writeCache(state.cards);
        renderCards();
      })
      .subscribe();
  } catch (e) {
    console.warn('realtime subscribe failed', e);
  }
}

// ------------- Boot -------------
(async function boot() {
  await loadCards();
  subscribeRealtime();
})();
