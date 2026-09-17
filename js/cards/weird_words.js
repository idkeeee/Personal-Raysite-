const SB_URL = window.SUPABASE_URL ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);

const WORDS_TABLE = "weird_words_shared";
const WORKSPACE_CODE = "bagas-main-weird-words-v1";

const state = {
    words: [],
    deck: [],
    index: 0,
    revealed: false,
    editingId: null
};

const els = {
    addButton: document.getElementById("wwAddButton"),
    card: document.getElementById("wwCard"),
    word: document.getElementById("wwWord"),
    definition: document.getElementById("wwDefinition"),
    cardHint: document.getElementById("wwCardHint"),
    counter: document.getElementById("wwCounter"),
    prevButton: document.getElementById("wwPrevButton"),
    revealButton: document.getElementById("wwRevealButton"),
    nextButton: document.getElementById("wwNextButton"),
    shuffleButton: document.getElementById("wwShuffleButton"),
    wordCount: document.getElementById("wwWordCount"),
    empty: document.getElementById("wwEmpty"),
    list: document.getElementById("wwList"),
    status: document.getElementById("wwStatus"),
    modalBackdrop: document.getElementById("wwModalBackdrop"),
    modalTitle: document.getElementById("wwModalTitle"),
    modalClose: document.getElementById("wwModalClose"),
    form: document.getElementById("wwForm"),
    wordInput: document.getElementById("wwWordInput"),
    definitionInput: document.getElementById("wwDefinitionInput"),
    cancelButton: document.getElementById("wwCancelButton"),
    saveButton: document.getElementById("wwSaveButton")
};

function setStatus(text, kind = "")
{
    els.status.textContent = text;
    els.status.className = "ww-status";
    if (kind) els.status.classList.add(`is-${kind}`);
}

function currentWord(){ return state.deck[state.index] ?? null; }

function rebuildDeck(preferredId = null)
{
    const currentId = preferredId || currentWord()?.id || null;
    state.deck = [...state.words];

    if (!state.deck.length)
    {
        state.index = 0;
        state.revealed = false;
        return;
    }

    const preferredIndex = currentId
        ? state.deck.findIndex(item => item.id === currentId)
        : -1;

    state.index = preferredIndex >= 0
        ? preferredIndex
        : Math.max(0, Math.min(state.index, state.deck.length - 1));
}

function renderCard()
{
    const item = currentWord();
    const hasWord = Boolean(item);

    els.counter.textContent = hasWord ? `${state.index + 1} / ${state.deck.length}` : "0 / 0";
    els.prevButton.disabled = !hasWord;
    els.nextButton.disabled = !hasWord;
    els.revealButton.disabled = !hasWord;
    els.shuffleButton.disabled = state.deck.length < 2;

    if (!item)
    {
        els.word.textContent = "No words yet";
        els.definition.textContent = "Add a weird word to start the deck.";
        els.definition.hidden = false;
        els.cardHint.textContent = "";
        els.revealButton.textContent = "Reveal";
        return;
    }

    els.word.textContent = item.word;
    els.definition.textContent = item.definition;
    els.definition.hidden = !state.revealed;
    els.cardHint.textContent = state.revealed
        ? "Tap again to hide definition"
        : "Tap to reveal definition";
    els.revealButton.textContent = state.revealed ? "Hide" : "Reveal";
}

function renderList()
{
    els.list.innerHTML = "";
    els.empty.hidden = state.words.length !== 0;
    els.wordCount.textContent = `${state.words.length} word${state.words.length === 1 ? "" : "s"}`;

    for (const item of state.words)
    {
        const row = document.createElement("article");
        row.className = "ww-list-item";

        const copy = document.createElement("div");
        copy.className = "ww-list-copy";

        const word = document.createElement("p");
        word.className = "ww-list-word";
        word.textContent = item.word;

        const definition = document.createElement("p");
        definition.className = "ww-list-definition";
        definition.textContent = item.definition;

        copy.append(word, definition);

        const actions = document.createElement("div");
        actions.className = "ww-list-actions";

        const study = document.createElement("button");
        study.type = "button";
        study.className = "ww-mini-button";
        study.textContent = "Study";
        study.addEventListener("click", function ()
        {
            rebuildDeck(item.id);
            state.revealed = false;
            renderCard();
            window.scrollTo({ top: 0, behavior: "smooth" });
        });

        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "ww-mini-button";
        edit.textContent = "Edit";
        edit.addEventListener("click", function (){ openEditModal(item); });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ww-mini-button delete";
        remove.textContent = "Delete";
        remove.addEventListener("click", function (){ void deleteWord(item); });

        actions.append(study, edit, remove);
        row.append(copy, actions);
        els.list.appendChild(row);
    }
}

function renderAll(){ renderCard(); renderList(); }

async function loadWords(options = {})
{
    if (!options.silent) setStatus("Syncing weird words...");

    try
    {
        const { data, error } = await sb
            .from(WORDS_TABLE)
            .select("id, workspace_code, word, definition, created_at, updated_at")
            .eq("workspace_code", WORKSPACE_CODE)
            .order("created_at", { ascending: true });

        if (error) throw error;

        state.words = data ?? [];
        rebuildDeck();
        renderAll();

        if (!options.silent)
        {
            setStatus(
                state.words.length
                    ? `${state.words.length} weird word${state.words.length === 1 ? "" : "s"} loaded.`
                    : "Ready for your first suspiciously obscure word.",
                "success"
            );
        }
    }
    catch (error)
    {
        console.error("Weird Words sync failed:", error);
        setStatus(`Weird Words couldn't sync: ${error.message || error}`, "error");
    }
}

function openAddModal()
{
    state.editingId = null;
    els.modalTitle.textContent = "Add new word";
    els.wordInput.value = "";
    els.definitionInput.value = "";
    els.saveButton.textContent = "Save word";
    els.modalBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => els.wordInput.focus(), 0);
}

function openEditModal(item)
{
    state.editingId = item.id;
    els.modalTitle.textContent = "Edit word";
    els.wordInput.value = item.word;
    els.definitionInput.value = item.definition;
    els.saveButton.textContent = "Save changes";
    els.modalBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => els.wordInput.focus(), 0);
}

function closeModal()
{
    els.modalBackdrop.hidden = true;
    document.body.style.overflow = "";
    state.editingId = null;
    els.form.reset();
}

async function deleteWord(item)
{
    if (!window.confirm(`Delete "${item.word}"?`)) return;

    try
    {
        const { error } = await sb.rpc("weird_words_delete", {
            p_workspace_code: WORKSPACE_CODE,
            p_word_id: item.id
        });

        if (error) throw error;

        state.words = state.words.filter(word => word.id !== item.id);
        rebuildDeck();
        state.revealed = false;
        renderAll();
        setStatus(`Deleted "${item.word}".`, "success");
    }
    catch (error)
    {
        console.error("Weird Words delete failed:", error);
        setStatus(`Could not delete word: ${error.message || error}`, "error");
    }
}

els.form.addEventListener("submit", async function (event)
{
    event.preventDefault();

    const word = els.wordInput.value.trim();
    const definition = els.definitionInput.value.trim();

    if (!word || !definition)
    {
        setStatus("Word and definition are both required.", "error");
        return;
    }

    const oldText = els.saveButton.textContent;
    els.saveButton.disabled = true;
    els.saveButton.textContent = "Saving...";

    try
    {
        if (state.editingId)
        {
            const { error } = await sb.rpc("weird_words_update", {
                p_workspace_code: WORKSPACE_CODE,
                p_word_id: state.editingId,
                p_word: word,
                p_definition: definition
            });

            if (error) throw error;
            setStatus(`Updated "${word}".`, "success");
        }
        else
        {
            const { error } = await sb.rpc("weird_words_add", {
                p_workspace_code: WORKSPACE_CODE,
                p_word: word,
                p_definition: definition
            });

            if (error) throw error;
            setStatus(`Added "${word}".`, "success");
        }

        closeModal();
        await loadWords({ silent: true });
    }
    catch (error)
    {
        console.error("Weird Words save failed:", error);
        setStatus(`Could not save word: ${error.message || error}`, "error");
    }
    finally
    {
        els.saveButton.disabled = false;
        els.saveButton.textContent = oldText;
    }
});

function toggleReveal()
{
    if (!currentWord()) return;
    state.revealed = !state.revealed;
    renderCard();
}

els.card.addEventListener("click", toggleReveal);
els.revealButton.addEventListener("click", toggleReveal);

els.prevButton.addEventListener("click", function ()
{
    if (!state.deck.length) return;
    state.index = (state.index - 1 + state.deck.length) % state.deck.length;
    state.revealed = false;
    renderCard();
});

els.nextButton.addEventListener("click", function ()
{
    if (!state.deck.length) return;
    state.index = (state.index + 1) % state.deck.length;
    state.revealed = false;
    renderCard();
});

els.shuffleButton.addEventListener("click", function ()
{
    for (let i = state.deck.length - 1; i > 0; i--)
    {
        const j = Math.floor(Math.random() * (i + 1));
        [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
    }

    state.index = 0;
    state.revealed = false;
    renderCard();
});

els.addButton.addEventListener("click", openAddModal);
els.modalClose.addEventListener("click", closeModal);
els.cancelButton.addEventListener("click", closeModal);

els.modalBackdrop.addEventListener("click", function (event)
{
    if (event.target === els.modalBackdrop) closeModal();
});

document.addEventListener("keydown", function (event)
{
    if (event.key === "Escape" && !els.modalBackdrop.hidden) closeModal();

    if (els.modalBackdrop.hidden)
    {
        if (event.key === "ArrowLeft") els.prevButton.click();
        if (event.key === "ArrowRight") els.nextButton.click();

        if (event.key === " " || event.key === "Enter")
        {
            event.preventDefault();
            toggleReveal();
        }
    }
});

function subscribeRealtime()
{
    const channel = sb
        .channel("weird-words-live")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: WORDS_TABLE,
                filter: `workspace_code=eq.${WORKSPACE_CODE}`
            },
            function (){ void loadWords({ silent: true }); }
        )
        .subscribe();

    window.addEventListener("beforeunload", function (){ sb.removeChannel(channel); });
}

document.addEventListener("DOMContentLoaded", async function ()
{
    await loadWords();
    subscribeRealtime();

    window.addEventListener("focus", function (){ void loadWords({ silent: true }); });
});
