const SB_URL = window.SUPABASE_URL ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const supabaseClient = window.supabase.createClient(SB_URL, SB_ANON);

const WORKSPACE_CODE = "bagas-main-habit-stacking-v1";
const HABITS_TABLE = "habit_stacking_habits_shared";
const TIME_ZONE = "Asia/Shanghai";

const state = {
    habits: [],
    modalMode: "add",
    editingId: null,
    preselectedAfterId: null
};

const els = {
    addHabitButton: document.getElementById("addHabitButton"),
    stackHabitButton: document.getElementById("stackHabitButton"),
    refreshHabitsButton: document.getElementById("refreshHabitsButton"),
    todayCompletedCount: document.getElementById("todayCompletedCount"),
    emptyState: document.getElementById("habitEmptyState"),
    stackList: document.getElementById("habitStackList"),
    pageStatus: document.getElementById("habitPageStatus"),

    modalBackdrop: document.getElementById("habitModalBackdrop"),
    modal: document.getElementById("habitModal"),
    modalClose: document.getElementById("habitModalClose"),
    modalKicker: document.getElementById("habitModalKicker"),
    modalTitle: document.getElementById("habitModalTitle"),
    form: document.getElementById("habitForm"),
    afterField: document.getElementById("habitAfterField"),
    afterSelect: document.getElementById("habitAfterSelect"),
    textLabel: document.getElementById("habitTextLabel"),
    textInput: document.getElementById("habitTextInput"),
    formulaPreview: document.getElementById("habitFormulaPreview"),
    formulaAnchor: document.getElementById("habitFormulaAnchor"),
    formulaNew: document.getElementById("habitFormulaNew"),
    cancelButton: document.getElementById("habitCancelButton"),
    saveButton: document.getElementById("habitSaveButton")
};

function getTodayKey(date = new Date())
{
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const values = Object.fromEntries(
        parts
            .filter(part => part.type !== "literal")
            .map(part => [part.type, part.value])
    );

    return `${values.year}-${values.month}-${values.day}`;
}

function setPageStatus(text, kind = "")
{
    els.pageStatus.textContent = text;
    els.pageStatus.className = "habit-page-status";

    if (kind)
    {
        els.pageStatus.classList.add(`is-${kind}`);
    }
}

function normalizedHabits()
{
    return [...state.habits].sort(function (a, b)
    {
        const stackCompare = String(a.stack_id).localeCompare(String(b.stack_id));

        if (stackCompare !== 0)
        {
            return stackCompare;
        }

        return Number(a.sort_order) - Number(b.sort_order);
    });
}

function groupedStacks()
{
    const groups = new Map();

    for (const habit of normalizedHabits())
    {
        if (!groups.has(habit.stack_id))
        {
            groups.set(habit.stack_id, []);
        }

        groups.get(habit.stack_id).push(habit);
    }

    const result = [...groups.values()];

    result.sort(function (a, b)
    {
        const aTime = new Date(a[0]?.created_at || 0).getTime();
        const bTime = new Date(b[0]?.created_at || 0).getTime();
        return aTime - bTime;
    });

    return result;
}

function habitIsDoneToday(habit)
{
    return habit.last_completed_on === getTodayKey();
}

function renderTodayProgress()
{
    const total = state.habits.length;
    const done = state.habits.filter(habitIsDoneToday).length;
    els.todayCompletedCount.textContent = `${done} / ${total}`;
}

function renderAfterSelect(selectedId = null)
{
    els.afterSelect.innerHTML = "";

    for (const stack of groupedStacks())
    {
        stack.forEach(function (habit, index)
        {
            const option = document.createElement("option");
            option.value = habit.id;
            option.textContent = `${stack[0].habit_text}  ·  ${index + 1}. ${habit.habit_text}`;
            els.afterSelect.appendChild(option);
        });
    }

    const preferred = selectedId || state.preselectedAfterId;

    if (preferred && state.habits.some(habit => habit.id === preferred))
    {
        els.afterSelect.value = preferred;
    }
}

function renderFormulaPreview()
{
    if (state.modalMode !== "stack")
    {
        els.formulaPreview.hidden = true;
        return;
    }

    const anchor = state.habits.find(habit => habit.id === els.afterSelect.value);
    els.formulaAnchor.textContent = anchor?.habit_text || "...";
    els.formulaNew.textContent = els.textInput.value.trim() || "...";
    els.formulaPreview.hidden = false;
}

function renderHabits()
{
    els.stackList.innerHTML = "";

    const stacks = groupedStacks();
    els.emptyState.hidden = stacks.length !== 0;

    stacks.forEach(function (stack, stackIndex)
    {
        const card = document.createElement("article");
        card.className = "habit-stack-card";

        const header = document.createElement("div");
        header.className = "habit-stack-header";

        const headerCopy = document.createElement("div");
        headerCopy.className = "habit-stack-header-copy";

        const stackNumber = document.createElement("span");
        stackNumber.className = "habit-stack-number";
        stackNumber.textContent = `STACK ${String(stackIndex + 1).padStart(2, "0")}`;

        const title = document.createElement("p");
        title.className = "habit-stack-title";
        title.textContent = stack[0]?.habit_text || "Habit stack";

        headerCopy.append(stackNumber, title);

        const doneCount = stack.filter(habitIsDoneToday).length;
        const progress = document.createElement("span");
        progress.className = "habit-stack-progress";
        progress.textContent = `${doneCount}/${stack.length} today`;

        header.append(headerCopy, progress);

        const chain = document.createElement("div");
        chain.className = "habit-chain";

        stack.forEach(function (habit, habitIndex)
        {
            if (habitIndex > 0)
            {
                const connector = document.createElement("div");
                connector.className = "habit-connector";
                connector.setAttribute("aria-hidden", "true");
                chain.appendChild(connector);
            }

            const row = document.createElement("div");
            row.className = "habit-row";
            row.classList.toggle("is-done", habitIsDoneToday(habit));

            const check = document.createElement("button");
            check.type = "button";
            check.className = "habit-check";
            check.textContent = habitIsDoneToday(habit) ? "✓" : String(habitIndex + 1);
            check.title = habitIsDoneToday(habit)
                ? "Mark unfinished for today"
                : "Mark done for today";

            check.addEventListener("click", function ()
            {
                void setHabitDone(habit, !habitIsDoneToday(habit));
            });

            const copy = document.createElement("div");
            copy.className = "habit-row-copy";

            const label = document.createElement("p");
            label.className = "habit-row-label";
            label.textContent = habit.habit_text;

            const cue = document.createElement("p");
            cue.className = "habit-row-cue";
            cue.textContent = habitIndex === 0
                ? "Anchor habit"
                : `After: ${stack[habitIndex - 1].habit_text}`;

            copy.append(label, cue);

            const actions = document.createElement("div");
            actions.className = "habit-row-actions";

            const stackAfter = document.createElement("button");
            stackAfter.type = "button";
            stackAfter.className = "habit-icon-button stack-after";
            stackAfter.textContent = "+ Stack";
            stackAfter.title = `Stack a new habit after "${habit.habit_text}"`;
            stackAfter.addEventListener("click", function ()
            {
                openStackModal(habit.id);
            });

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "habit-icon-button";
            edit.textContent = "Edit";
            edit.addEventListener("click", function ()
            {
                openEditModal(habit);
            });

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "habit-icon-button delete";
            remove.textContent = "Delete";
            remove.addEventListener("click", function ()
            {
                void deleteHabit(habit);
            });

            actions.append(stackAfter, edit, remove);
            row.append(check, copy, actions);
            chain.appendChild(row);
        });

        card.append(header, chain);
        els.stackList.appendChild(card);
    });

    renderTodayProgress();
}

async function loadHabits(options = {})
{
    if (!options.silent)
    {
        setPageStatus("Syncing your habit stacks...");
    }

    try
    {
        const { data, error } = await supabaseClient
            .from(HABITS_TABLE)
            .select("id, workspace_code, stack_id, habit_text, sort_order, last_completed_on, created_at, updated_at")
            .eq("workspace_code", WORKSPACE_CODE)
            .order("created_at", { ascending: true });

        if (error) throw error;

        state.habits = data ?? [];
        renderHabits();

        if (!options.silent)
        {
            setPageStatus(
                state.habits.length
                    ? `${state.habits.length} habit${state.habits.length === 1 ? "" : "s"} loaded.`
                    : "Ready for your first stack.",
                "success"
            );
        }
    }
    catch (error)
    {
        console.error("Habit Stacking sync failed:", error);
        setPageStatus(`Habit Stacking couldn't sync: ${error.message || error}`, "error");
    }
}

function openModal()
{
    els.modalBackdrop.hidden = false;
    document.body.style.overflow = "hidden";

    window.setTimeout(function ()
    {
        if (state.modalMode === "stack")
        {
            els.afterSelect.focus();
        }
        else
        {
            els.textInput.focus();
        }
    }, 0);
}

function closeModal()
{
    els.modalBackdrop.hidden = true;
    document.body.style.overflow = "";
    state.editingId = null;
    state.preselectedAfterId = null;
    els.form.reset();
    els.afterField.hidden = true;
    els.formulaPreview.hidden = true;
}

function openAddModal()
{
    state.modalMode = "add";
    state.editingId = null;
    state.preselectedAfterId = null;

    els.modalKicker.textContent = "NEW STACK";
    els.modalTitle.textContent = "Add new habit";
    els.textLabel.textContent = "Anchor habit";
    els.textInput.placeholder = "e.g. Brush my teeth";
    els.textInput.value = "";
    els.afterField.hidden = true;
    els.formulaPreview.hidden = true;
    els.saveButton.textContent = "Add habit";

    openModal();
}

function openStackModal(afterId = null)
{
    if (state.habits.length === 0)
    {
        openAddModal();
        setPageStatus("Add an anchor habit first, then you can stack onto it.", "success");
        return;
    }

    state.modalMode = "stack";
    state.editingId = null;
    state.preselectedAfterId = afterId;

    els.modalKicker.textContent = "STACK IT";
    els.modalTitle.textContent = "Stack new habit";
    els.textLabel.textContent = "Then I will...";
    els.textInput.placeholder = "e.g. Drink one glass of water";
    els.textInput.value = "";
    els.afterField.hidden = false;
    els.saveButton.textContent = "Stack habit";

    renderAfterSelect(afterId);
    renderFormulaPreview();
    openModal();
}

function openEditModal(habit)
{
    state.modalMode = "edit";
    state.editingId = habit.id;
    state.preselectedAfterId = null;

    els.modalKicker.textContent = "EDIT";
    els.modalTitle.textContent = "Rename habit";
    els.textLabel.textContent = "Habit";
    els.textInput.placeholder = "Habit name";
    els.textInput.value = habit.habit_text;
    els.afterField.hidden = true;
    els.formulaPreview.hidden = true;
    els.saveButton.textContent = "Save changes";

    openModal();
}

async function setHabitDone(habit, finished)
{
    try
    {
        const { error } = await supabaseClient.rpc("habit_stack_set_completed", {
            p_workspace_code: WORKSPACE_CODE,
            p_habit_id: habit.id,
            p_completed: finished,
            p_today: getTodayKey()
        });

        if (error) throw error;

        habit.last_completed_on = finished ? getTodayKey() : null;
        renderHabits();

        setPageStatus(
            finished ? `Done: ${habit.habit_text}` : `Unchecked: ${habit.habit_text}`,
            "success"
        );
    }
    catch (error)
    {
        console.error("Habit completion update failed:", error);
        setPageStatus(`Could not update habit: ${error.message || error}`, "error");
    }
}

async function deleteHabit(habit)
{
    const okay = window.confirm(
        `Delete "${habit.habit_text}"?\n\nThe rest of its stack will close the gap automatically.`
    );

    if (!okay) return;

    try
    {
        const { error } = await supabaseClient.rpc("habit_stack_delete", {
            p_workspace_code: WORKSPACE_CODE,
            p_habit_id: habit.id
        });

        if (error) throw error;

        await loadHabits({ silent: true });
        setPageStatus(`Deleted "${habit.habit_text}".`, "success");
    }
    catch (error)
    {
        console.error("Habit delete failed:", error);
        setPageStatus(`Could not delete habit: ${error.message || error}`, "error");
    }
}

els.form.addEventListener("submit", async function (event)
{
    event.preventDefault();

    const text = els.textInput.value.trim();

    if (!text)
    {
        els.textInput.focus();
        return;
    }

    const previousText = els.saveButton.textContent;
    els.saveButton.disabled = true;
    els.saveButton.textContent = "Saving...";

    try
    {
        if (state.modalMode === "add")
        {
            const { error } = await supabaseClient.rpc("habit_stack_add_root", {
                p_workspace_code: WORKSPACE_CODE,
                p_habit_text: text
            });

            if (error) throw error;
            closeModal();
            await loadHabits({ silent: true });
            setPageStatus(`New stack started with "${text}".`, "success");
        }
        else if (state.modalMode === "stack")
        {
            const afterId = els.afterSelect.value;

            if (!afterId)
            {
                throw new Error("Pick the habit this should come after.");
            }

            const { error } = await supabaseClient.rpc("habit_stack_insert_after", {
                p_workspace_code: WORKSPACE_CODE,
                p_after_habit_id: afterId,
                p_habit_text: text
            });

            if (error) throw error;
            closeModal();
            await loadHabits({ silent: true });
            setPageStatus(`Stacked "${text}".`, "success");
        }
        else if (state.modalMode === "edit")
        {
            const { error } = await supabaseClient.rpc("habit_stack_rename", {
                p_workspace_code: WORKSPACE_CODE,
                p_habit_id: state.editingId,
                p_habit_text: text
            });

            if (error) throw error;
            closeModal();
            await loadHabits({ silent: true });
            setPageStatus("Habit renamed.", "success");
        }
    }
    catch (error)
    {
        console.error("Habit save failed:", error);
        setPageStatus(`Could not save habit: ${error.message || error}`, "error");
    }
    finally
    {
        els.saveButton.disabled = false;
        els.saveButton.textContent = previousText;
    }
});

els.addHabitButton.addEventListener("click", openAddModal);
els.stackHabitButton.addEventListener("click", function () { openStackModal(); });
els.refreshHabitsButton.addEventListener("click", function () { void loadHabits(); });
els.modalClose.addEventListener("click", closeModal);
els.cancelButton.addEventListener("click", closeModal);

els.modalBackdrop.addEventListener("click", function (event)
{
    if (event.target === els.modalBackdrop)
    {
        closeModal();
    }
});

document.addEventListener("keydown", function (event)
{
    if (event.key === "Escape" && !els.modalBackdrop.hidden)
    {
        closeModal();
    }
});

els.afterSelect.addEventListener("change", renderFormulaPreview);
els.textInput.addEventListener("input", renderFormulaPreview);

function subscribeRealtime()
{
    const channel = supabaseClient
        .channel("habit-stacking-live")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: HABITS_TABLE,
                filter: `workspace_code=eq.${WORKSPACE_CODE}`
            },
            function ()
            {
                void loadHabits({ silent: true });
            }
        )
        .subscribe();

    window.addEventListener("beforeunload", function ()
    {
        supabaseClient.removeChannel(channel);
    });
}

document.addEventListener("DOMContentLoaded", async function ()
{
    await loadHabits();
    subscribeRealtime();

    window.addEventListener("focus", function ()
    {
        void loadHabits({ silent: true });
    });

    document.addEventListener("visibilitychange", function ()
    {
        if (!document.hidden)
        {
            void loadHabits({ silent: true });
        }
    });

    // Midnight needs no destructive reset. Completion is date-based,
    // so yesterday's checks simply stop matching today's date.
    window.setInterval(renderHabits, 60 * 1000);
});
