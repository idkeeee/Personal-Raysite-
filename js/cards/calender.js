/* ===== Supabase ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);




/* ===== Calendar ===== */
const calendarScroll = document.getElementById("calendarScroll");

const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const today = new Date();
const todayDate = today.getDate();
const todayMonth = today.getMonth();
const todayYear = today.getFullYear();


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


function createWeekdaysRow()
{
    const weekdaysRow = document.createElement("div");
    weekdaysRow.classList.add("calendar_weekdays");

    for (const dayName of weekdayNames)
    {
        const day = document.createElement("div");
        day.textContent = dayName;
        weekdaysRow.appendChild(day);
    }

    return weekdaysRow;
}


function createMonthBlock(month, year)
{
    const monthBlock = document.createElement("section");
    monthBlock.classList.add("calendar_month_block");
    monthBlock.dataset.month = month;
    monthBlock.dataset.year = year;

    if (month === todayMonth && year === todayYear)
    {
        monthBlock.id = "currentMonthBlock";
    }

    const monthTitle = document.createElement("h2");
    monthTitle.classList.add("calendar_month_title");
    monthTitle.textContent = `${monthNames[month]} ${year}`;

    const weekdaysRow = createWeekdaysRow();

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

        grid.appendChild(dayCell);
    }

    monthBlock.appendChild(monthTitle);
    monthBlock.appendChild(weekdaysRow);
    monthBlock.appendChild(grid);

    return monthBlock;
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
            const monthBlock = createMonthBlock(month, year);
            calendarScroll.appendChild(monthBlock);
        }
    }

    const currentMonthBlock = document.getElementById("currentMonthBlock");

    if (currentMonthBlock)
    {
        currentMonthBlock.scrollIntoView({
            behavior: "instant",
            block: "start"
        });
    }
}

renderScrollableCalendar();