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
    const cancelBtn = mobileModal.querySelector(".calendar_mobile_btn_ghost");
    const saveBtn = mobileModal.querySelector(".calendar_mobile_btn_primary");
    const modalCard = mobileModal.querySelector(".calendar_mobile_modal");

    backdrop.addEventListener("click", function (event)
    {
        event.preventDefault();
    });

    cancelBtn.addEventListener("click", function ()
    {
        closeActiveEditor(false);
    });

    saveBtn.addEventListener("click", function ()
    {
        closeActiveEditor(true);
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
    if (!activeEditor)
    {
        return;
    }

    const editor = activeEditor;
    activeEditor = null;

    const dateKey = editor.dateKey;
    const value = editor.input.value.trim();

    if (editor.mode === "mobile" && mobileModal)
    {
        mobileModal.classList.remove("is-open");
    }

    if (shouldSave)
    {
        const didSave = await saveNoteToSupabase(dateKey, value);

        if (didSave)
        {
            if (value.length > 0)
            {
                calendarNotes[dateKey] = value;
            }
            else
            {
                delete calendarNotes[dateKey];
            }

            updateActivityButtons();
        }
    }

    refreshCellsForDate(dateKey);
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
    if (monthBlocks.length === 0)
    {
        return;
    }

    const referenceTop = calendarScroll.scrollTop + 20;
    let activeBlock = monthBlocks[0];

    for (const block of monthBlocks)
    {
        if (block.offsetTop <= referenceTop)
        {
            activeBlock = block;
        }
        else
        {
            break;
        }
    }

    stickyMonthLabel.textContent = activeBlock.dataset.label;
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

    jumpToToday(false);
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