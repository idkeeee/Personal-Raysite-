/* ===== Supabase ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);




/* ===== Calendar ===== */
const calendarScroll   = document.getElementById("calendarScroll");
const stickyMonthLabel = document.getElementById("stickyMonthLabel");
const jumpTodayBtn     = document.getElementById("jumpTodayBtn");
const prevActivityBtn  = document.getElementById("prevActivityBtn");
const nextActivityBtn  = document.getElementById("nextActivityBtn");
const forLoopBtn       = document.getElementById("forLoopBtn");
const forLoopOverlay   = document.getElementById("forLoopOverlay");
const forLoopCloseBtn  = document.getElementById("forLoopCloseBtn");
const forLoopForm      = document.getElementById("forLoopForm");
const forLoopTaskInput = document.getElementById("forLoopTaskInput");
const forLoopIntervalField = document.getElementById("forLoopIntervalField");
const forLoopIntervalInput = document.getElementById("forLoopIntervalInput");
const forLoopSelectionLabel = document.getElementById("forLoopSelectionLabel");
const forLoopPreview = document.getElementById("forLoopPreview");
const forLoopStatus = document.getElementById("forLoopStatus");
const forLoopBackBtn = document.getElementById("forLoopBackBtn");
const forLoopGenerateBtn = document.getElementById("forLoopGenerateBtn");
const forLoopOptionButtons = Array.from(document.querySelectorAll(".calendar_loop_option"));
const forLoopRulesList = document.getElementById("forLoopRulesList");
const forLoopRulesStatus = document.getElementById("forLoopRulesStatus");
const forLoopRefreshBtn = document.getElementById("forLoopRefreshBtn");

const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const today = new Date();
const todayDate = today.getDate();
const todayMonth = today.getMonth();
const todayYear = today.getFullYear();

let calendarNotes = {};
let activeEditor = null;
let monthBlocks = [];
let mobileModal = null;
let mobileModalTitle = null;
let mobileModalInput = null;
let mobileModalSaveBtn = null;
let mobileModalCancelBtn = null;
let mobileModalRecurring = null;
let mobileModalRecurringList = null;
let isSavingEditor = false;
let selectedLoopMode = null;
let isGeneratingLoop = false;
let recurringRules = [];
let recurringOccurrences = {};
let recurringStorageAvailable = true;
let recurringStorageError = "";
let isRefreshingLoops = false;

const MOBILE_BREAKPOINT = 700;

/*
    Pick your own weird code here.
    Same code on every device = same calendar.
*/
const CALENDAR_CODE = "bagas-main-calendar-v1";


/* ===== Notes storage ===== */
async function loadNotesFromSupabase()
{
    const { data, error } = await sb
        .from("calendar_notes_shared")
        .select("note_date, note_text")
        .eq("calendar_code", CALENDAR_CODE)
        .order("note_date", { ascending: true });

    if (error)
    {
        console.error("Failed to load calendar notes:", error);
        return {};
    }

    const notesObject = {};

    for (const row of data ?? [])
    {
        const text = (row.note_text ?? "").trim();

        if (text.length > 0)
        {
            notesObject[row.note_date] = row.note_text;
        }
    }

    return notesObject;
}

async function saveNoteToSupabase(dateKey, noteText)
{
    const { error } = await sb
        .from("calendar_notes_shared")
        .upsert(
            {
                calendar_code: CALENDAR_CODE,
                note_date: dateKey,
                note_text: noteText
            },
            {
                onConflict: "calendar_code,note_date"
            }
        );

    if (error)
    {
        console.error("Failed to save calendar note:", error);
        return false;
    }

    return true;
}

async function saveNotesBatchToSupabase(noteEntries)
{
    if (noteEntries.length === 0)
    {
        return true;
    }

    const rows = noteEntries.map(function (entry)
    {
        return {
            calendar_code: CALENDAR_CODE,
            note_date: entry.dateKey,
            note_text: entry.noteText
        };
    });

    const { error } = await sb
        .from("calendar_notes_shared")
        .upsert(rows, { onConflict: "calendar_code,note_date" });

    if (error)
    {
        console.error("Failed to save recurring calendar notes:", error);
        return false;
    }

    return true;
}


/* ===== Recurring-rule storage ===== */
async function loadRecurringRulesFromSupabase()
{
    const { data, error } = await sb
        .from("calendar_recurring_rules_shared")
        .select("id, task_text, repeat_mode, interval_days, is_active, created_at, updated_at")
        .eq("calendar_code", CALENDAR_CODE)
        .order("created_at", { ascending: true });

    if (error)
    {
        recurringStorageAvailable = false;
        recurringStorageError = error.message ?? "Recurring-rule tables are unavailable.";
        console.error("Failed to load recurring calendar rules:", error);
        return [];
    }

    recurringStorageAvailable = true;
    recurringStorageError = "";
    return data ?? [];
}

async function loadRecurringOccurrencesFromSupabase()
{
    if (!recurringStorageAvailable)
    {
        return {};
    }

    const rangeStart = `${todayYear - 1}-01-01`;
    const rangeEnd = `${todayYear + 1}-12-31`;

    const { data, error } = await sb
        .from("calendar_recurring_occurrences_shared")
        .select("rule_id, occurrence_date, task_text")
        .eq("calendar_code", CALENDAR_CODE)
        .gte("occurrence_date", rangeStart)
        .lte("occurrence_date", rangeEnd)
        .order("occurrence_date", { ascending: true });

    if (error)
    {
        recurringStorageAvailable = false;
        recurringStorageError = error.message ?? "Recurring-occurrence table is unavailable.";
        console.error("Failed to load recurring calendar occurrences:", error);
        return {};
    }

    const occurrenceObject = {};

    for (const row of data ?? [])
    {
        const taskText = String(row.task_text ?? "").trim();

        if (taskText.length === 0)
        {
            continue;
        }

        if (!occurrenceObject[row.occurrence_date])
        {
            occurrenceObject[row.occurrence_date] = [];
        }

        occurrenceObject[row.occurrence_date].push({
            ruleId: row.rule_id,
            taskText: taskText
        });
    }

    return occurrenceObject;
}

async function insertRecurringRule(ruleData)
{
    const { data, error } = await sb
        .from("calendar_recurring_rules_shared")
        .insert({
            calendar_code: CALENDAR_CODE,
            task_text: ruleData.taskText,
            repeat_mode: ruleData.repeatMode,
            interval_days: ruleData.intervalDays,
            is_active: true
        })
        .select("id, task_text, repeat_mode, interval_days, is_active, created_at, updated_at")
        .single();

    if (error)
    {
        console.error("Failed to create recurring calendar rule:", error);
        return null;
    }

    return data;
}

async function updateRecurringRuleState(ruleId, isActive)
{
    const { error } = await sb
        .from("calendar_recurring_rules_shared")
        .update({
            is_active: isActive,
            updated_at: new Date().toISOString()
        })
        .eq("id", ruleId)
        .eq("calendar_code", CALENDAR_CODE);

    if (error)
    {
        console.error("Failed to update recurring calendar rule:", error);
        return false;
    }

    return true;
}

async function upsertRecurringOccurrences(rows)
{
    if (rows.length === 0)
    {
        return true;
    }

    const { error } = await sb
        .from("calendar_recurring_occurrences_shared")
        .upsert(rows, { onConflict: "rule_id,occurrence_date" });

    if (error)
    {
        console.error("Failed to generate recurring calendar occurrences:", error);
        return false;
    }

    return true;
}

async function removeFutureRecurringOccurrences(ruleId)
{
    const todayKey = formatDateKey(todayYear, todayMonth, todayDate);

    const { error } = await sb
        .from("calendar_recurring_occurrences_shared")
        .delete()
        .eq("calendar_code", CALENDAR_CODE)
        .eq("rule_id", ruleId)
        .gt("occurrence_date", todayKey);

    if (error)
    {
        console.error("Failed to remove future recurring occurrences:", error);
        return false;
    }

    return true;
}


/* ===== Helpers ===== */
function formatDateKey(year, month, day)
{
    const mm = String(month + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
}

function refreshSiteNotificationCenter()
{
    if (typeof window.refreshCalendarNotifications === "function")
    {
        window.refreshCalendarNotifications({ silent: true });
    }
}

function getNote(dateKey)
{
    return (calendarNotes[dateKey] ?? "").trim();
}

function getRecurringTasks(dateKey)
{
    return recurringOccurrences[dateKey] ?? [];
}

function getDisplayNote(dateKey)
{
    const parts = [];
    const manualNote = getNote(dateKey);

    if (manualNote.length > 0)
    {
        parts.push(manualNote);
    }

    for (const occurrence of getRecurringTasks(dateKey))
    {
        parts.push(`↻ ${occurrence.taskText}`);
    }

    return parts.join("\n\n").trim();
}

function clearSelectedCells()
{
    document.querySelectorAll(".calendar_day_selected").forEach(function (cell)
    {
        cell.classList.remove("calendar_day_selected");
    });
}

function getCellTop(cell)
{
    const scrollRect = calendarScroll.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    return (cellRect.top - scrollRect.top) + calendarScroll.scrollTop;
}

function createTodayIcon()
{
    const icon = document.createElement("div");
    icon.classList.add("calendar_today_icon");

    icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M21 3L3 10.53L10.22 12.78L12.47 20L21 3Z"></path>
        </svg>
    `;

    return icon;
}

function isSmallScreen()
{
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function formatPrettyDate(dateKey)
{
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return date.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function ensureMobileModal()
{
    if (mobileModal)
    {
        return;
    }

    mobileModal = document.createElement("div");
    mobileModal.className = "calendar_mobile_overlay";

    mobileModal.innerHTML = `
        <div class="calendar_mobile_backdrop"></div>

        <div class="calendar_mobile_modal">
            <div class="calendar_mobile_modal_header">
                <h3 class="calendar_mobile_modal_title"></h3>
            </div>

            <section class="calendar_mobile_recurring" hidden>
                <div class="calendar_mobile_recurring_heading">
                    <strong>For Loop tasks</strong>
                    <span>Manage these from the For Loop button.</span>
                </div>
                <div class="calendar_mobile_recurring_list"></div>
            </section>

            <label class="calendar_mobile_manual_label" for="calendarMobileNoteInput">Manual note</label>
            <textarea
                id="calendarMobileNoteInput"
                class="calendar_mobile_modal_input"
                placeholder="Write something..."
            ></textarea>

            <div class="calendar_mobile_modal_actions">
                <button type="button" class="calendar_mobile_btn calendar_mobile_btn_ghost">
                    Cancel
                </button>

                <button type="button" class="calendar_mobile_btn calendar_mobile_btn_primary">
                    Save
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(mobileModal);

    mobileModalTitle = mobileModal.querySelector(".calendar_mobile_modal_title");
    mobileModalInput = mobileModal.querySelector(".calendar_mobile_modal_input");
    mobileModalRecurring = mobileModal.querySelector(".calendar_mobile_recurring");
    mobileModalRecurringList = mobileModal.querySelector(".calendar_mobile_recurring_list");

    const backdrop = mobileModal.querySelector(".calendar_mobile_backdrop");
    mobileModalCancelBtn = mobileModal.querySelector(".calendar_mobile_btn_ghost");
    mobileModalSaveBtn = mobileModal.querySelector(".calendar_mobile_btn_primary");
    const modalCard = mobileModal.querySelector(".calendar_mobile_modal");

    backdrop.addEventListener("click", function (event)
    {
        event.preventDefault();
    });

    mobileModalCancelBtn.addEventListener("click", async function ()
    {
        await closeActiveEditor(false);
    });

    mobileModalSaveBtn.addEventListener("click", async function ()
    {
        await closeActiveEditor(true);
    });

    mobileModalInput.addEventListener("keydown", function (event)
    {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
        {
            event.preventDefault();
            closeActiveEditor(true);
        }
        else if (event.key === "Escape")
        {
            event.preventDefault();
            closeActiveEditor(false);
        }
    });

    modalCard.addEventListener("click", function (event)
    {
        event.stopPropagation();
    });
}

function renderMobileRecurringTasks(dateKey)
{
    if (!mobileModalRecurring || !mobileModalRecurringList)
    {
        return;
    }

    const tasks = getRecurringTasks(dateKey);
    mobileModalRecurringList.replaceChildren();

    for (const occurrence of tasks)
    {
        const item = document.createElement("div");
        item.className = "calendar_mobile_recurring_item";
        item.textContent = `↻ ${occurrence.taskText}`;
        mobileModalRecurringList.appendChild(item);
    }

    mobileModalRecurring.hidden = tasks.length === 0;
}

function updateCellActivityClasses(cell, dateKey)
{
    const hasManualNote = getNote(dateKey).length > 0;
    const hasRecurringNote = getRecurringTasks(dateKey).length > 0;

    cell.classList.toggle("has-manual-note", hasManualNote);
    cell.classList.toggle("has-recurring-note", hasRecurringNote);
    cell.classList.toggle("has-note", hasManualNote || hasRecurringNote);
}

function openMobileEditorForCell(cell)
{
    const dateKey = cell.dataset.date;

    if (!dateKey)
    {
        return;
    }

    closeActiveEditor(true);
    clearSelectedCells();
    ensureMobileModal();

    cell.classList.add("calendar_day_selected");

    mobileModalTitle.textContent = formatPrettyDate(dateKey);
    renderMobileRecurringTasks(dateKey);
    mobileModalInput.value = getNote(dateKey);

    activeEditor = {
        mode: "mobile",
        cell: cell,
        dateKey: dateKey,
        input: mobileModalInput
    };

    mobileModal.classList.add("is-open");

    window.setTimeout(function ()
    {
        mobileModalInput.focus();
        mobileModalInput.setSelectionRange(
            mobileModalInput.value.length,
            mobileModalInput.value.length
        );
    }, 20);
}


/* ===== Note rendering ===== */
function refreshCellsForDate(dateKey)
{
    const allCells = document.querySelectorAll(".calendar_day");

    allCells.forEach(function (cell)
    {
        if (cell.dataset.date !== dateKey)
        {
            return;
        }

        const existingInput = cell.querySelector(".calendar_note_input");
        if (existingInput)
        {
            existingInput.remove();
        }

        let noteBlock = cell.querySelector(".calendar_day_note");

        if (!noteBlock)
        {
            noteBlock = document.createElement("div");
            noteBlock.classList.add("calendar_day_note");
            cell.appendChild(noteBlock);
        }

        const noteText = getDisplayNote(dateKey);
        noteBlock.textContent = noteText;
        updateCellActivityClasses(cell, dateKey);
        cell.classList.remove("calendar_day_selected");
    });
}

function refreshAllCalendarCells()
{
    const dateKeys = new Set();

    document.querySelectorAll(".calendar_day[data-date]").forEach(function (cell)
    {
        dateKeys.add(cell.dataset.date);
    });

    for (const dateKey of dateKeys)
    {
        refreshCellsForDate(dateKey);
    }
}

function openEditorForCell(cell)
{
    const dateKey = cell.dataset.date;

    if (!dateKey)
    {
        return;
    }

    if (activeEditor && activeEditor.cell === cell)
    {
        return;
    }

    if (isSmallScreen())
    {
        openMobileEditorForCell(cell);
        return;
    }

    closeActiveEditor(true);
    clearSelectedCells();

    cell.classList.add("calendar_day_selected");

    const oldNoteBlock = cell.querySelector(".calendar_day_note");
    const input = document.createElement("textarea");
    input.classList.add("calendar_note_input");
    input.placeholder = "Write something...";
    input.value = getNote(dateKey);

    if (oldNoteBlock)
    {
        oldNoteBlock.replaceWith(input);
    }
    else
    {
        cell.appendChild(input);
    }

    activeEditor = {
        mode: "desktop",
        cell: cell,
        dateKey: dateKey,
        input: input
    };

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener("click", function (event)
    {
        event.stopPropagation();
    });

    input.addEventListener("keydown", function (event)
    {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
        {
            event.preventDefault();
            closeActiveEditor(true);
        }
        else if (event.key === "Escape")
        {
            event.preventDefault();
            closeActiveEditor(false);
        }
    });

    input.addEventListener("blur", function ()
    {
        if (activeEditor && activeEditor.input === input)
        {
            closeActiveEditor(true);
        }
    });
}

async function closeActiveEditor(shouldSave)
{
    if (!activeEditor || isSavingEditor)
    {
        return;
    }

    const editor = activeEditor;
    const dateKey = editor.dateKey;
    const value = editor.input.value.trim();

    const hadOldNote = Object.prototype.hasOwnProperty.call(calendarNotes, dateKey);
    const oldValue = hadOldNote ? calendarNotes[dateKey] : "";

    if (!shouldSave)
    {
        activeEditor = null;

        if (editor.mode === "mobile" && mobileModal)
        {
            mobileModal.classList.remove("is-open");
        }

        refreshCellsForDate(dateKey);
        return;
    }

    isSavingEditor = true;

    if (editor.mode === "mobile" && mobileModalSaveBtn && mobileModalCancelBtn)
    {
        mobileModalSaveBtn.disabled = true;
        mobileModalCancelBtn.disabled = true;
        mobileModalSaveBtn.textContent = "Saving...";
    }

    if (value.length > 0)
    {
        calendarNotes[dateKey] = value;
    }
    else
    {
        delete calendarNotes[dateKey];
    }

    updateActivityButtons();
    refreshCellsForDate(dateKey);

    const didSave = await saveNoteToSupabase(dateKey, value);

    if (didSave)
    {
        activeEditor = null;

        if (editor.mode === "mobile" && mobileModal)
        {
            mobileModal.classList.remove("is-open");
        }

        refreshSiteNotificationCenter();
    }
    else
    {
        if (hadOldNote)
        {
            calendarNotes[dateKey] = oldValue;
        }
        else
        {
            delete calendarNotes[dateKey];
        }

        updateActivityButtons();
        refreshCellsForDate(dateKey);

        if (editor.mode === "mobile" && mobileModal)
        {
            activeEditor = editor;
            mobileModal.classList.add("is-open");
            window.alert("Save failed. Please try again.");
        }
        else
        {
            activeEditor = null;
        }
    }

    if (editor.mode === "mobile" && mobileModalSaveBtn && mobileModalCancelBtn)
    {
        mobileModalSaveBtn.disabled = false;
        mobileModalCancelBtn.disabled = false;
        mobileModalSaveBtn.textContent = "Save";
    }

    isSavingEditor = false;
}


/* ===== For Loop recurring-task maker ===== */
const LOOP_MONTHS_AHEAD = 6;

const loopModeDetails = {
    "month-end": {
        label: "Every end of month",
        description: "The task lands on the final day of each month."
    },
    "month-start": {
        label: "Every start of month",
        description: "The task lands on the 1st of each month."
    },
    "half-month": {
        label: "Every half-month",
        description: "The task lands on the 1st and 15th of each month."
    },
    "custom": {
        label: "Custom interval",
        description: "The count restarts after every month begins instead of cascading forever."
    }
};

function setLoopStatus(message, type = "")
{
    forLoopStatus.textContent = message;
    forLoopStatus.classList.remove("is-error", "is-success");

    if (type === "error")
    {
        forLoopStatus.classList.add("is-error");
    }
    else if (type === "success")
    {
        forLoopStatus.classList.add("is-success");
    }
}

function setRulesStatus(message, isError = false)
{
    forLoopRulesStatus.textContent = message;
    forLoopRulesStatus.classList.toggle("is-error", isError);
}

function resetLoopModal()
{
    selectedLoopMode = null;
    isGeneratingLoop = false;
    forLoopForm.hidden = true;
    forLoopTaskInput.value = "";
    forLoopIntervalInput.value = "";
    forLoopIntervalField.hidden = true;
    forLoopSelectionLabel.textContent = "";
    forLoopPreview.textContent = "";
    setLoopStatus("");
    forLoopGenerateBtn.disabled = false;
    forLoopBackBtn.disabled = false;
    forLoopGenerateBtn.textContent = "Create For Loop";

    forLoopOptionButtons.forEach(function (button)
    {
        button.classList.remove("is-selected");
    });
}

function formatLoopRuleSchedule(rule)
{
    if (rule.repeat_mode === "custom")
    {
        return `Every ${rule.interval_days} day${rule.interval_days === 1 ? "" : "s"} after each month starts`;
    }

    return loopModeDetails[rule.repeat_mode]?.label ?? "Unknown rhythm";
}

function renderRecurringRulesList()
{
    forLoopRulesList.innerHTML = "";

    if (!recurringStorageAvailable)
    {
        setRulesStatus("Run the included Supabase SQL setup first, then press Refresh.", true);
        return;
    }

    setRulesStatus(`${recurringRules.length} saved loop${recurringRules.length === 1 ? "" : "s"}.`);

    if (recurringRules.length === 0)
    {
        const empty = document.createElement("div");
        empty.className = "calendar_loop_empty";
        empty.textContent = "No loops yet. The machine is peacefully idle.";
        forLoopRulesList.appendChild(empty);
        return;
    }

    for (const rule of recurringRules)
    {
        const row = document.createElement("div");
        row.className = "calendar_loop_rule";
        row.classList.toggle("is-off", !rule.is_active);

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "calendar_loop_rule_toggle";
        toggle.classList.toggle("is-on", rule.is_active);
        toggle.dataset.ruleId = rule.id;
        toggle.dataset.ruleActive = String(rule.is_active);
        toggle.setAttribute("aria-pressed", String(rule.is_active));
        toggle.textContent = rule.is_active ? "ON" : "OFF";
        toggle.setAttribute("aria-label", `${rule.is_active ? "Turn off" : "Turn on"} ${rule.task_text}`);

        const text = document.createElement("div");
        text.className = "calendar_loop_rule_text";

        const task = document.createElement("div");
        task.className = "calendar_loop_rule_task";
        task.textContent = rule.task_text;

        const schedule = document.createElement("div");
        schedule.className = "calendar_loop_rule_schedule";
        schedule.textContent = `${formatLoopRuleSchedule(rule)} · ${rule.is_active ? "future runway enabled" : "future occurrences paused"}`;

        text.append(task, schedule);
        row.append(toggle, text);
        forLoopRulesList.appendChild(row);
    }
}

async function openForLoopModal()
{
    await closeActiveEditor(true);
    resetLoopModal();
    forLoopOverlay.classList.add("is-open");
    forLoopOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("calendar_loop_open");
    renderRecurringRulesList();
    refreshForLoops();

    window.setTimeout(function ()
    {
        forLoopOptionButtons[0]?.focus();
    }, 20);
}

function closeForLoopModal()
{
    if (isGeneratingLoop)
    {
        return;
    }

    forLoopOverlay.classList.remove("is-open");
    forLoopOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("calendar_loop_open");
    forLoopBtn.focus();
}

function selectLoopMode(mode)
{
    if (!loopModeDetails[mode])
    {
        return;
    }

    selectedLoopMode = mode;

    forLoopOptionButtons.forEach(function (button)
    {
        button.classList.toggle("is-selected", button.dataset.loopMode === mode);
    });

    const detail = loopModeDetails[mode];
    forLoopSelectionLabel.textContent = `${detail.label}: ${detail.description}`;
    forLoopIntervalField.hidden = mode !== "custom";
    forLoopForm.hidden = false;
    setLoopStatus("");
    updateLoopPreview();

    window.setTimeout(function ()
    {
        if (mode === "custom")
        {
            forLoopIntervalInput.focus();
        }
        else
        {
            forLoopTaskInput.focus();
        }
    }, 20);
}

function getMonthYearWithOffset(offset)
{
    const date = new Date(todayYear, todayMonth + offset, 1);

    return {
        year: date.getFullYear(),
        month: date.getMonth()
    };
}

function getLoopDateKeys(mode, customInterval)
{
    const dateKeys = [];
    const todayKey = formatDateKey(todayYear, todayMonth, todayDate);
    const loopEndDate = new Date(todayYear, todayMonth + LOOP_MONTHS_AHEAD, todayDate);
    const loopEndKey = formatDateKey(
        loopEndDate.getFullYear(),
        loopEndDate.getMonth(),
        loopEndDate.getDate()
    );

    for (let offset = 0; offset <= LOOP_MONTHS_AHEAD; offset++)
    {
        const { year, month } = getMonthYearWithOffset(offset);
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        let days = [];

        if (mode === "month-end")
        {
            days = [daysInMonth];
        }
        else if (mode === "month-start")
        {
            days = [1];
        }
        else if (mode === "half-month")
        {
            days = [1, 15];
        }
        else if (mode === "custom")
        {
            const interval = Number(customInterval);

            if (!Number.isInteger(interval) || interval < 1 || interval > 30)
            {
                return [];
            }

            for (let day = 1 + interval; day <= daysInMonth; day += interval)
            {
                days.push(day);
            }
        }

        for (const day of days)
        {
            const dateKey = formatDateKey(year, month, day);

            if (dateKey >= todayKey && dateKey <= loopEndKey)
            {
                dateKeys.push(dateKey);
            }
        }
    }

    return Array.from(new Set(dateKeys)).sort();
}

function buildOccurrenceRowsForRule(rule)
{
    const dateKeys = getLoopDateKeys(rule.repeat_mode, rule.interval_days);

    return dateKeys.map(function (dateKey)
    {
        return {
            rule_id: rule.id,
            calendar_code: CALENDAR_CODE,
            occurrence_date: dateKey,
            task_text: rule.task_text
        };
    });
}

async function syncActiveRecurringRules()
{
    if (!recurringStorageAvailable)
    {
        return false;
    }

    const rows = [];

    for (const rule of recurringRules)
    {
        if (rule.is_active)
        {
            rows.push(...buildOccurrenceRowsForRule(rule));
        }
    }

    return upsertRecurringOccurrences(rows);
}

async function reloadRecurringSystem(options = {})
{
    const shouldSync = options.syncActive !== false;
    const shouldRefreshCells = options.refreshCells !== false;

    recurringRules = await loadRecurringRulesFromSupabase();

    if (recurringStorageAvailable && shouldSync)
    {
        const didSync = await syncActiveRecurringRules();

        if (!didSync)
        {
            recurringStorageAvailable = false;
            recurringStorageError = "Could not generate the rolling recurring-task runway.";
        }
    }

    recurringOccurrences = await loadRecurringOccurrencesFromSupabase();

    if (shouldRefreshCells)
    {
        refreshAllCalendarCells();
        updateActivityButtons();
    }

    renderRecurringRulesList();
    refreshSiteNotificationCenter();
}

function formatCompactDate(dateKey)
{
    const [year, month, day] = dateKey.split("-").map(Number);

    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function updateLoopPreview()
{
    if (!selectedLoopMode)
    {
        forLoopPreview.textContent = "";
        return;
    }

    if (selectedLoopMode === "custom")
    {
        const interval = Number(forLoopIntervalInput.value);

        if (!Number.isInteger(interval) || interval < 1 || interval > 30)
        {
            forLoopPreview.textContent = "Enter a whole number from 1 to 30 to preview the dates.";
            return;
        }
    }

    const dateKeys = getLoopDateKeys(selectedLoopMode, forLoopIntervalInput.value);

    if (dateKeys.length === 0)
    {
        forLoopPreview.textContent = "No future dates were produced.";
        return;
    }

    const previewDates = dateKeys.slice(0, 8).map(formatCompactDate).join(", ");
    const remainingCount = Math.max(dateKeys.length - 8, 0);
    const extraText = remainingCount > 0 ? `, plus ${remainingCount} more` : "";

    forLoopPreview.textContent = `${dateKeys.length} rolling date${dateKeys.length === 1 ? "" : "s"}: ${previewDates}${extraText}. The runway refills whenever the calendar opens.`;
}

async function createRecurringRule()
{
    if (isGeneratingLoop || !selectedLoopMode)
    {
        return;
    }

    if (!recurringStorageAvailable)
    {
        setLoopStatus("Run the included Supabase SQL setup first, then press Refresh.", "error");
        return;
    }

    const taskText = forLoopTaskInput.value.trim();

    if (taskText.length === 0)
    {
        setLoopStatus("Type the task first. The loop needs something to repeat.", "error");
        forLoopTaskInput.focus();
        return;
    }

    let intervalDays = null;

    if (selectedLoopMode === "custom")
    {
        intervalDays = Number(forLoopIntervalInput.value);

        if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 30)
        {
            setLoopStatus("Use a whole-number interval from 1 to 30 days.", "error");
            forLoopIntervalInput.focus();
            return;
        }
    }

    isGeneratingLoop = true;
    forLoopGenerateBtn.disabled = true;
    forLoopBackBtn.disabled = true;
    forLoopGenerateBtn.textContent = "Creating...";
    setLoopStatus("Saving the rule and filling its six-month runway...");

    const newRule = await insertRecurringRule({
        taskText: taskText,
        repeatMode: selectedLoopMode,
        intervalDays: intervalDays
    });

    if (!newRule)
    {
        isGeneratingLoop = false;
        forLoopGenerateBtn.disabled = false;
        forLoopBackBtn.disabled = false;
        forLoopGenerateBtn.textContent = "Create For Loop";
        setLoopStatus("The rule could not be saved. Check the SQL setup and try again.", "error");
        return;
    }

    const didGenerate = await upsertRecurringOccurrences(buildOccurrenceRowsForRule(newRule));

    if (!didGenerate)
    {
        await updateRecurringRuleState(newRule.id, false);
        isGeneratingLoop = false;
        forLoopGenerateBtn.disabled = false;
        forLoopBackBtn.disabled = false;
        forLoopGenerateBtn.textContent = "Create For Loop";
        setLoopStatus("The rule saved, but its dates failed to generate. It was switched off for safety.", "error");
        await reloadRecurringSystem({ syncActive: false });
        return;
    }

    await reloadRecurringSystem({ syncActive: false });

    isGeneratingLoop = false;
    forLoopGenerateBtn.disabled = false;
    forLoopBackBtn.disabled = false;
    forLoopGenerateBtn.textContent = "Create For Loop";
    forLoopTaskInput.value = "";
    setLoopStatus("Created. It now syncs across devices and refills its rolling runway automatically.", "success");
}

async function toggleRecurringRule(ruleId, shouldActivate, button)
{
    button.disabled = true;
    button.textContent = "...";
    setRulesStatus(shouldActivate ? "Turning the loop on..." : "Pausing future occurrences...");

    const didUpdate = await updateRecurringRuleState(ruleId, shouldActivate);

    if (!didUpdate)
    {
        button.disabled = false;
        renderRecurringRulesList();
        setRulesStatus("That switch failed. Try again.", true);
        return;
    }

    if (shouldActivate)
    {
        const rule = recurringRules.find(function (item)
        {
            return item.id === ruleId;
        });

        if (rule)
        {
            rule.is_active = true;
            const didGenerate = await upsertRecurringOccurrences(buildOccurrenceRowsForRule(rule));

            if (!didGenerate)
            {
                await updateRecurringRuleState(ruleId, false);
                setRulesStatus("The loop could not refill its dates, so it was left off.", true);
                await reloadRecurringSystem({ syncActive: false });
                return;
            }
        }
    }
    else
    {
        const didRemove = await removeFutureRecurringOccurrences(ruleId);

        if (!didRemove)
        {
            await updateRecurringRuleState(ruleId, true);
            setRulesStatus("Future dates could not be removed, so the loop stayed on.", true);
            await reloadRecurringSystem({ syncActive: false });
            return;
        }
    }

    await reloadRecurringSystem({ syncActive: false });
    setRulesStatus(shouldActivate ? "Loop resumed." : "Loop paused. Past occurrences were kept.");
}

async function refreshForLoops()
{
    if (isRefreshingLoops)
    {
        return;
    }

    isRefreshingLoops = true;
    forLoopRefreshBtn.disabled = true;
    forLoopRefreshBtn.textContent = "Refreshing...";
    setRulesStatus("Checking Supabase and refilling active runways...");

    await reloadRecurringSystem({ syncActive: true });

    isRefreshingLoops = false;
    forLoopRefreshBtn.disabled = false;
    forLoopRefreshBtn.textContent = "Refresh";

    if (recurringStorageAvailable)
    {
        setRulesStatus(`${recurringRules.length} saved loop${recurringRules.length === 1 ? "" : "s"}. Everything is synced.`);
    }
    else
    {
        setRulesStatus("Run the included Supabase SQL setup first, then press Refresh.", true);
    }
}

/* ===== Calendar creation ===== */
function createMonthBlock(month, year)
{
    const monthBlock = document.createElement("section");
    monthBlock.classList.add("calendar_month_block");
    monthBlock.dataset.month = String(month);
    monthBlock.dataset.year = String(year);
    monthBlock.dataset.label = `${monthNames[month]} ${year}`;

    if (month === todayMonth && year === todayYear)
    {
        monthBlock.id = "currentMonthBlock";
    }

    const anchor = document.createElement("div");
    anchor.classList.add("calendar_month_anchor");
    monthBlock.appendChild(anchor);

    const grid = document.createElement("div");
    grid.classList.add("calendar_grid");

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    const daysInPreviousMonth = new Date(year, month, 0).getDate();
    const totalCells = 42;

    for (let i = 0; i < totalCells; i++)
    {
        const dayCell = document.createElement("div");
        dayCell.classList.add("calendar_day");

        const dayNumber = document.createElement("div");
        dayNumber.classList.add("calendar_day_number");

        let displayDay;
        let cellMonth = month;
        let cellYear = year;
        let isOtherMonth = false;

        if (i < firstDayIndex)
        {
            displayDay = daysInPreviousMonth - firstDayIndex + i + 1;
            cellMonth = month - 1;
            isOtherMonth = true;
        }
        else if (i >= firstDayIndex + daysInCurrentMonth)
        {
            displayDay = i - (firstDayIndex + daysInCurrentMonth) + 1;
            cellMonth = month + 1;
            isOtherMonth = true;
        }
        else
        {
            displayDay = i - firstDayIndex + 1;
        }

        if (cellMonth < 0)
        {
            cellMonth = 11;
            cellYear--;
        }
        else if (cellMonth > 11)
        {
            cellMonth = 0;
            cellYear++;
        }

        const dateKey = formatDateKey(cellYear, cellMonth, displayDay);

        dayCell.dataset.date = dateKey;
        dayCell.dataset.isCanonical = String(!isOtherMonth);

        dayNumber.textContent = displayDay;
        dayCell.appendChild(dayNumber);

        if (isOtherMonth)
        {
            dayCell.classList.add("calendar_day_other_month");
        }

        const isToday =
            displayDay === todayDate &&
            cellMonth === todayMonth &&
            cellYear === todayYear;

        if (isToday)
        {
            dayCell.classList.add("calendar_day_today");
            dayCell.appendChild(createTodayIcon());
        }

        const noteBlock = document.createElement("div");
        noteBlock.classList.add("calendar_day_note");
        noteBlock.textContent = getDisplayNote(dateKey);
        dayCell.appendChild(noteBlock);

        updateCellActivityClasses(dayCell, dateKey);

        dayCell.addEventListener("click", function ()
        {
            openEditorForCell(dayCell);
        });

        grid.appendChild(dayCell);
    }

    monthBlock.appendChild(grid);
    return monthBlock;
}

function updateStickyMonthLabel()
{
    const canonicalCells = Array.from(
        calendarScroll.querySelectorAll('.calendar_day[data-is-canonical="true"]')
    );

    const stickyTop = document.querySelector(".calendar_sticky_top");
    const stickyBottom = stickyTop
        ? stickyTop.getBoundingClientRect().bottom
        : 0;

    let firstVisibleCell = null;

    for (const cell of canonicalCells)
    {
        const rect = cell.getBoundingClientRect();

        if (rect.bottom > stickyBottom + 4)
        {
            firstVisibleCell = cell;
            break;
        }
    }

    if (!firstVisibleCell)
    {
        return;
    }

    const [year, month] = firstVisibleCell.dataset.date.split("-").map(Number);
    stickyMonthLabel.textContent = `${monthNames[month - 1]} ${year}`;
}


function jumpToCurrentMonth(smooth = true)
{
    const currentMonthBlock = document.getElementById("currentMonthBlock");

    if (!currentMonthBlock)
    {
        return;
    }

    const stickyTop = document.querySelector(".calendar_sticky_top");
    const stickyHeight = stickyTop ? stickyTop.offsetHeight : 0;
    const targetTop = Math.max(currentMonthBlock.offsetTop - stickyHeight - 8, 0);

    calendarScroll.scrollTo({
        top: targetTop,
        behavior: smooth ? "smooth" : "auto"
    });

    updateStickyMonthLabel();
}
function renderScrollableCalendar()
{
    calendarScroll.innerHTML = "";

    const startYear = todayYear - 1;
    const endYear = todayYear + 1;

    for (let year = startYear; year <= endYear; year++)
    {
        for (let month = 0; month < 12; month++)
        {
            calendarScroll.appendChild(createMonthBlock(month, year));
        }
    }

    monthBlocks = Array.from(calendarScroll.querySelectorAll(".calendar_month_block"));

    jumpToCurrentMonth(false);
    updateStickyMonthLabel();
    updateActivityButtons();
}


/* ===== Navigation ===== */
function getCanonicalCellByDate(dateKey)
{
    const allCells = document.querySelectorAll('.calendar_day[data-is-canonical="true"]');

    for (const cell of allCells)
    {
        if (cell.dataset.date === dateKey)
        {
            return cell;
        }
    }

    return null;
}

function scrollToCell(cell, smooth = true)
{
    if (!cell)
    {
        return;
    }

    const stickyTop = document.querySelector(".calendar_sticky_top");
    const stickyHeight = stickyTop ? stickyTop.offsetHeight : 0;
    const targetTop = Math.max(getCellTop(cell) - stickyHeight - 20, 0);

    calendarScroll.scrollTo({
        top: targetTop,
        behavior: smooth ? "smooth" : "auto"
    });

    cell.classList.add("calendar_day_jump_target");

    window.setTimeout(function ()
    {
        cell.classList.remove("calendar_day_jump_target");
    }, 1300);
}

function jumpToToday(smooth = true)
{
    closeActiveEditor(true);

    const todayKey = formatDateKey(todayYear, todayMonth, todayDate);
    const todayCell = getCanonicalCellByDate(todayKey);

    if (todayCell)
    {
        scrollToCell(todayCell, smooth);
    }
}

function getRequestedDateFromUrl()
{
    const requestedDate = new URLSearchParams(window.location.search).get("date");

    if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate))
    {
        return null;
    }

    const [year, month, day] = requestedDate.split("-").map(Number);
    const parsedDate = new Date(year, month - 1, day);

    const isRealDate =
        parsedDate.getFullYear() === year &&
        parsedDate.getMonth() === month - 1 &&
        parsedDate.getDate() === day;

    return isRealDate ? requestedDate : null;
}

function jumpToRequestedDateFromUrl()
{
    const requestedDate = getRequestedDateFromUrl();

    if (!requestedDate)
    {
        return false;
    }

    const requestedCell = getCanonicalCellByDate(requestedDate);

    if (!requestedCell)
    {
        return false;
    }

    scrollToCell(requestedCell, false);
    return true;
}


function getActivityCells()
{
    const cells = Array.from(
        document.querySelectorAll('.calendar_day.has-note[data-is-canonical="true"]')
    );

    cells.sort(function (a, b)
    {
        return getCellTop(a) - getCellTop(b);
    });

    return cells;
}

function jumpToActivity(direction)
{
    closeActiveEditor(true);

    const activityCells = getActivityCells();

    if (activityCells.length === 0)
    {
        return;
    }

    const referenceTop = calendarScroll.scrollTop + (calendarScroll.clientHeight * 0.35);

    if (direction === "next")
    {
        const nextCell =
            activityCells.find(function (cell)
            {
                return getCellTop(cell) > referenceTop + 8;
            }) ?? activityCells[activityCells.length - 1];

        scrollToCell(nextCell, true);
    }
    else
    {
        const prevCells = [...activityCells].reverse();

        const prevCell =
            prevCells.find(function (cell)
            {
                return getCellTop(cell) < referenceTop - 8;
            }) ?? activityCells[0];

        scrollToCell(prevCell, true);
    }
}

function updateActivityButtons()
{
    const hasManualActivities = Object.values(calendarNotes).some(function (value)
    {
        return String(value).trim().length > 0;
    });

    const hasRecurringActivities = Object.values(recurringOccurrences).some(function (items)
    {
        return Array.isArray(items) && items.length > 0;
    });

    const hasActivities = hasManualActivities || hasRecurringActivities;
    prevActivityBtn.disabled = !hasActivities;
    nextActivityBtn.disabled = !hasActivities;
}


/* ===== Events ===== */
forLoopBtn.addEventListener("click", function ()
{
    openForLoopModal();
});

forLoopCloseBtn.addEventListener("click", function ()
{
    closeForLoopModal();
});

forLoopOverlay.querySelectorAll("[data-loop-close]").forEach(function (element)
{
    element.addEventListener("click", function ()
    {
        closeForLoopModal();
    });
});

forLoopOptionButtons.forEach(function (button)
{
    button.addEventListener("click", function ()
    {
        selectLoopMode(button.dataset.loopMode);
    });
});

forLoopBackBtn.addEventListener("click", function ()
{
    selectedLoopMode = null;
    forLoopForm.hidden = true;
    forLoopIntervalField.hidden = true;
    forLoopPreview.textContent = "";
    setLoopStatus("");

    forLoopOptionButtons.forEach(function (button)
    {
        button.classList.remove("is-selected");
    });

    forLoopOptionButtons[0]?.focus();
});

forLoopIntervalInput.addEventListener("input", function ()
{
    setLoopStatus("");
    updateLoopPreview();
});

forLoopTaskInput.addEventListener("input", function ()
{
    setLoopStatus("");
});

forLoopForm.addEventListener("submit", function (event)
{
    event.preventDefault();
    createRecurringRule();
});

forLoopRulesList.addEventListener("click", function (event)
{
    const button = event.target.closest(".calendar_loop_rule_toggle");

    if (!button)
    {
        return;
    }

    const ruleId = button.dataset.ruleId;
    const isActive = button.dataset.ruleActive === "true";
    toggleRecurringRule(ruleId, !isActive, button);
});

forLoopRefreshBtn.addEventListener("click", function ()
{
    refreshForLoops();
});

document.addEventListener("keydown", function (event)
{
    if (event.key === "Escape" && forLoopOverlay.classList.contains("is-open"))
    {
        event.preventDefault();
        closeForLoopModal();
    }
});

jumpTodayBtn.addEventListener("click", function ()
{
    jumpToToday(true);
});

prevActivityBtn.addEventListener("click", function ()
{
    jumpToActivity("prev");
});

nextActivityBtn.addEventListener("click", function ()
{
    jumpToActivity("next");
});

calendarScroll.addEventListener("scroll", function ()
{
    updateStickyMonthLabel();
});


/* ===== Init ===== */
initCalendar();

async function initCalendar()
{
    calendarNotes = await loadNotesFromSupabase();
    recurringRules = await loadRecurringRulesFromSupabase();

    if (recurringStorageAvailable)
    {
        await syncActiveRecurringRules();
        recurringOccurrences = await loadRecurringOccurrencesFromSupabase();
    }

    renderScrollableCalendar();
    renderRecurringRulesList();

    window.requestAnimationFrame(function ()
    {
        jumpToRequestedDateFromUrl();
    });
}