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
let isSavingEditor = false;
let selectedLoopMode = null;
let isGeneratingLoop = false;

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


/* ===== Helpers ===== */
function formatDateKey(year, month, day)
{
    const mm = String(month + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
}

function getNote(dateKey)
{
    return (calendarNotes[dateKey] ?? "").trim();
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

            <textarea
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

        const noteText = getNote(dateKey);
        noteBlock.textContent = noteText;
        cell.classList.toggle("has-note", noteText.length > 0);
        cell.classList.remove("calendar_day_selected");
    });
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
        description: "The task will land on the final day of each month."
    },
    "month-start": {
        label: "Every start of month",
        description: "The task will land on the 1st of each month."
    },
    "half-month": {
        label: "Every half-month",
        description: "The task will land on the 1st and 15th of each month."
    },
    "custom": {
        label: "Custom interval",
        description: "The count restarts from the 1st of every month instead of cascading forever."
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
    forLoopGenerateBtn.textContent = "Generate 6 months";

    forLoopOptionButtons.forEach(function (button)
    {
        button.classList.remove("is-selected");
    });
}

async function openForLoopModal()
{
    await closeActiveEditor(true);
    resetLoopModal();
    forLoopOverlay.classList.add("is-open");
    forLoopOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("calendar_loop_open");

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

    forLoopPreview.textContent = `${dateKeys.length} date${dateKeys.length === 1 ? "" : "s"}: ${previewDates}${extraText}. Past dates are skipped.`;
}

function mergeRecurringTask(existingNote, taskText)
{
    const existing = String(existingNote ?? "").replace(/\r\n/g, "\n").trim();
    const task = String(taskText ?? "").replace(/\r\n/g, "\n").trim();

    if (existing.length === 0)
    {
        return task;
    }

    const existingBlocks = existing
        .split(/\n{2,}/)
        .map(function (block)
        {
            return block.trim();
        });

    if (existingBlocks.includes(task))
    {
        return existing;
    }

    return `${existing}\n\n${task}`;
}

async function generateRecurringTasks()
{
    if (isGeneratingLoop || !selectedLoopMode)
    {
        return;
    }

    const taskText = forLoopTaskInput.value.trim();

    if (taskText.length === 0)
    {
        setLoopStatus("Type the task first. The loop needs something to clone.", "error");
        forLoopTaskInput.focus();
        return;
    }

    let customInterval = null;

    if (selectedLoopMode === "custom")
    {
        customInterval = Number(forLoopIntervalInput.value);

        if (!Number.isInteger(customInterval) || customInterval < 1 || customInterval > 30)
        {
            setLoopStatus("Use a whole-number interval from 1 to 30 days.", "error");
            forLoopIntervalInput.focus();
            return;
        }
    }

    const dateKeys = getLoopDateKeys(selectedLoopMode, customInterval);

    if (dateKeys.length === 0)
    {
        setLoopStatus("That pattern did not create any future dates.", "error");
        return;
    }

    const changes = [];

    for (const dateKey of dateKeys)
    {
        const mergedText = mergeRecurringTask(calendarNotes[dateKey], taskText);

        if (mergedText !== (calendarNotes[dateKey] ?? "").trim())
        {
            changes.push({
                dateKey: dateKey,
                noteText: mergedText
            });
        }
    }

    if (changes.length === 0)
    {
        setLoopStatus("That exact task is already sitting on every generated date.", "success");
        return;
    }

    isGeneratingLoop = true;
    forLoopGenerateBtn.disabled = true;
    forLoopBackBtn.disabled = true;
    forLoopGenerateBtn.textContent = "Generating...";
    setLoopStatus(`Writing ${changes.length} calendar entr${changes.length === 1 ? "y" : "ies"}...`);

    const didSave = await saveNotesBatchToSupabase(changes);

    if (!didSave)
    {
        isGeneratingLoop = false;
        forLoopGenerateBtn.disabled = false;
        forLoopBackBtn.disabled = false;
        forLoopGenerateBtn.textContent = "Generate 6 months";
        setLoopStatus("The save failed, so nothing was changed. Try again.", "error");
        return;
    }

    for (const change of changes)
    {
        calendarNotes[change.dateKey] = change.noteText;
        refreshCellsForDate(change.dateKey);
    }

    updateActivityButtons();

    isGeneratingLoop = false;
    forLoopGenerateBtn.disabled = false;
    forLoopBackBtn.disabled = false;
    forLoopGenerateBtn.textContent = "Generate 6 months";
    setLoopStatus(`Done. Added the task to ${changes.length} date${changes.length === 1 ? "" : "s"}.`, "success");
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
        noteBlock.textContent = getNote(dateKey);
        dayCell.appendChild(noteBlock);

        if (getNote(dateKey).length > 0)
        {
            dayCell.classList.add("has-note");
        }

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
    const hasActivities = Object.values(calendarNotes).some(function (value)
    {
        return String(value).trim().length > 0;
    });

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
    generateRecurringTasks();
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
    renderScrollableCalendar();
}