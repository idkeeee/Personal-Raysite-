/* ===== Supabase ===== */
const SB_URL  = window.SUPABASE_URL  ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const sb = window.supabase.createClient(SB_URL, SB_ANON);




/* ===== Calendar DOM ===== */
const calendarGrid   = document.getElementById("calendarGrid");
const monthYearLabel = document.getElementById("monthYearLabel");
const prevMonthBtn   = document.getElementById("prevMonthBtn");
const nextMonthBtn   = document.getElementById("nextMonthBtn");

const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const today = new Date();

let currentMonth = today.getMonth();
let currentYear  = today.getFullYear();


function renderCalendar(month, year)
{
    calendarGrid.innerHTML = "";
    monthYearLabel.textContent = `${monthNames[month]} ${year}`;

    const firstDayIndex      = new Date(year, month, 1).getDay();
    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    const daysInPreviousMonth = new Date(year, month, 0).getDate();

    const totalCells = 42; // 6 rows x 7 columns

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
            displayDay === today.getDate() &&
            cellMonth === today.getMonth() &&
            cellYear === today.getFullYear();

        if (isToday)
        {
            dayCell.classList.add("calendar_day_today");
        }

        calendarGrid.appendChild(dayCell);
    }
}


prevMonthBtn.addEventListener("click", function ()
{
    currentMonth--;

    if (currentMonth < 0)
    {
        currentMonth = 11;
        currentYear--;
    }

    renderCalendar(currentMonth, currentYear);
});

nextMonthBtn.addEventListener("click", function ()
{
    currentMonth++;

    if (currentMonth > 11)
    {
        currentMonth = 0;
        currentYear++;
    }

    renderCalendar(currentMonth, currentYear);
});

renderCalendar(currentMonth, currentYear);