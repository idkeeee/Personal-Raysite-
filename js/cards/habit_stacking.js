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
    refreshHabitsButton: document.getElementById("refreshHabitsButton"),
    todayCompletedCount: document.getElementById("todayCompletedCount"),
    emptyState: document.getElementById("habitEmptyState"),
    stackList: document.getElementById("habitStackList"),
    pageStatus: document.getElementById("habitPageStatus"),

    modalBackdrop: document.getElementById("habitModalBackdrop"),
    modalClose: document.getElementById("habitModalClose"),
    modalKicker: document.getElementById("habitModalKicker"),
    modalTitle: document.getElementById("habitModalTitle"),
    form: document.getElementById("habitForm"),
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

function renderFormulaPreview()
{
    if (state.modalMode !== "stack")
    {
        els.formulaPreview.hidden = true;
        return;
    }

    const anchor = state.habits.find(habit => habit.id === state.preselectedAfterId);
    els.formulaAnchor.textContent = anchor?.habit_text || "...";
    els.formulaNew.textContent = els.textInput.value.trim() || "...";
    els.formulaPreview.hidden = false;
}

function makeButton(text, className, onClick, title = "")
{
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;

    if (title)
    {
        button.title = title;
    }

    button.addEventListener("click", onClick);
    return button;
}

function renderHabits()
{
    els.stackList.innerHTML = "";

    const stacks = groupedStacks();
    els.emptyState.hidden = stacks.length !== 0;

    stacks.forEach(function (stack, stackIndex)
    {
        const row = document.createElement("article");
        row.className = "habit-stack-row";

        const head = document.createElement("div");
        head.className = "habit-stack-row-head";

        const number = document.createElement("span");
        number.className = "habit-stack-number";
        number.textContent = `ROW ${String(stackIndex + 1).padStart(2, "0")}`;

        const doneCount = stack.filter(habitIsDoneToday).length;
        const summary = document.createElement("span");
        summary.className = "habit-stack-summary";
        summary.textContent = `${doneCount}/${stack.length} done today`;

        head.append(number, summary);

        const trackWrap = document.createElement("div");
        trackWrap.className = "habit-stack-track-wrap";

        const track = document.createElement("div");
        track.className = "habit-stack-track";

        stack.forEach(function (habit, habitIndex)
        {
            const box = document.createElement("div");
            box.className = "habit-box";
            box.classList.toggle("is-done", habitIsDoneToday(habit));

            const top = document.createElement("div");
            top.className = "habit-box-top";

            const stepBadge = document.createElement("span");
            stepBadge.className = "habit-step-badge";
            stepBadge.textContent = habitIsDoneToday(habit) ? "✓" : String(habitIndex + 1);

            const toggleDone = makeButton(
                habitIsDoneToday(habit) ? "Done" : "Do",
                "habit-done-button",
                function () { void setHabitDone(habit, !habitIsDoneToday(habit)); },
                habitIsDoneToday(habit) ? "Mark unfinished for today" : "Mark done for today"
            );

            const label = document.createElement("p");
            label.className = "habit-box-label";
            label.textContent = habit.habit_text;

            const actions = document.createElement("div");
            actions.className = "habit-box-actions";

            const edit = makeButton("Edit", "habit-mini-button", function ()
            {
                openEditModal(habit);
            });

            const remove = makeButton("Delete", "habit-mini-button delete", function ()
            {
                void deleteHabit(habit);
            });

            top.append(stepBadge, toggleDone);
            actions.append(edit, remove);
            box.append(top, label, actions);
            track.appendChild(box);

            if (habitIndex < stack.length - 1)
            {
                const arrow = document.createElement("div");
                arrow.className = "habit-arrow";
                arrow.setAttribute("aria-hidden", "true");
                arrow.textContent = "→";
                track.appendChild(arrow);
            }
        });

        const plusButton = makeButton(
            "+",
            "habit-plus-button",
            function () { openStackModal(stack[stack.length - 1]?.id || null); },
            `Add a new habit to the end of row ${stackIndex + 1}`
        );

        track.appendChild(plusButton);
        trackWrap.appendChild(track);
        row.append(head, trackWrap);
        els.stackList.appendChild(row);
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
        els.textInput.focus();
    }, 0);
}

function closeModal()
{
    els.modalBackdrop.hidden = true;
    document.body.style.overflow = "";
    state.editingId = null;
    state.preselectedAfterId = null;
    els.form.reset();
    els.formulaPreview.hidden = true;
}

function openAddModal()
{
    state.modalMode = "add";
    state.editingId = null;
    state.preselectedAfterId = null;

    els.modalKicker.textContent = "NEW ROW";
    els.modalTitle.textContent = "Add new stack";
    els.textLabel.textContent = "First habit in this row";
    els.textInput.placeholder = "e.g. Brush my teeth";
    els.textInput.value = "";
    els.formulaPreview.hidden = true;
    els.saveButton.textContent = "Add stack";

    openModal();
}

function openStackModal(afterId = null)
{
    if (state.habits.length === 0)
    {
        openAddModal();
        setPageStatus("Add the first row first, then you can grow it with the + button.", "success");
        return;
    }

    state.modalMode = "stack";
    state.editingId = null;
    state.preselectedAfterId = afterId;

    els.modalKicker.textContent = "STACK IT";
    els.modalTitle.textContent = "Add habit to this row";
    els.textLabel.textContent = "New habit";
    els.textInput.placeholder = "e.g. Drink one glass of water";
    els.textInput.value = "";
    els.saveButton.textContent = "Add habit";

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
        `Delete "${habit.habit_text}"?\n\nThe rest of the row will close the gap automatically.`
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
            setPageStatus(`New row started with "${text}".`, "success");
        }
        else if (state.modalMode === "stack")
        {
            const afterId = state.preselectedAfterId;

            if (!afterId)
            {
                throw new Error("Could not find the end of this habit row.");
            }

            const { error } = await supabaseClient.rpc("habit_stack_insert_after", {
                p_workspace_code: WORKSPACE_CODE,
                p_after_habit_id: afterId,
                p_habit_text: text
            });

            if (error) throw error;
            closeModal();
            await loadHabits({ silent: true });
            setPageStatus(`Added "${text}" to the row.`, "success");
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

    window.setInterval(renderHabits, 60 * 1000);
});
