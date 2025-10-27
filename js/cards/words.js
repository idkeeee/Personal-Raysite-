/* words.html -> title-only cards + slide-up editor, Supabase v2 client (separate table) */

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
};

// ------------- Data -------------
async function loadCards() {
  const { data, error } = await supabase
    .from('words_cards')                    // <-- separate table
    .select('*')
    .eq('archived', false)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('loadCards error:', error);
    renderEmpty(`Failed to load: ${error.message}`);
    return;
  }
  state.cards = data || [];
  renderCards();
}

async function upsertCard(card) {
  const payload = {
    id: card.id ?? undefined,
    title: (card.title || '').trim() || 'Untitled',
    image_url: null,                 // unused
    content: card.content ?? '',
    sort_order: card.sort_order ?? 0,
    archived: !!card.archived
  };
  const { data, error } = await supabase.from('words_cards').upsert(payload).select().single();
  if (error) throw error;
  return data;
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

  // optimistic update
  if (state.editingId) {
    const idx = state.cards.findIndex(c => c.id === state.editingId);
    if (idx >= 0) {
      state.cards[idx] = { ...state.cards[idx], title, content };
      renderCards();
    }
  } else {
    const tempId = 'temp-' + Math.random().toString(36).slice(2);
    state.cards.unshift({
      id: tempId, title, content, image_url: null,
      sort_order: 0, archived: false, created_at: new Date().toISOString()
    });
    renderCards();
  }

  try {
    const saved = await upsertCard({
      id: state.editingId || undefined,
      title, content
    });

    const idx = state.cards.findIndex(c => c.id === (state.editingId || state.cards[0]?.id));
    if (idx >= 0) state.cards[idx] = saved;
    closeSheet();
    renderCards();
  } catch (err) {
    console.error('save failed:', err);
    alert('Save failed: ' + err.message);
    await loadCards();
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
  } catch (err) {
    console.error('delete failed:', err);
    alert('Delete failed: ' + err.message);
    state.cards = prev;
    renderCards();
  }
}

// ------------- Live changes (optional) -------------
function subscribeRealtime() {
  try {
    supabase
      .channel('words_cards_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'words_cards' }, payload => {
        if (payload.eventType === 'INSERT') {
          state.cards.push(payload.new);
        } else if (payload.eventType === 'UPDATE') {
          const i = state.cards.findIndex(c => c.id === payload.new.id);
          if (i >= 0) state.cards[i] = payload.new;
        } else if (payload.eventType === 'DELETE') {
          state.cards = state.cards.filter(c => c.id !== payload.old.id);
        }
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
