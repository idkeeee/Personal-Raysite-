(function ()
{
    "use strict";

    const SUPABASE_URL = window.SUPABASE_URL ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
    const SUPABASE_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
    const TRACKER_CODE = "bagas-main-money-v1";
    const TIME_ZONE = "Asia/Shanghai";

    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: { persistSession: false }
    });

    const $ = (selector) => document.querySelector(selector);

    const elements = {
        todayDate: $("#moneyTodayDate"),
        budgetDisplay: $("#moneyBudgetDisplay"),
        budgetForm: $("#moneyBudgetForm"),
        budgetInput: $("#moneyBudgetInput"),
        reminderForm: $("#moneyReminderForm"),
        reminderOneInput: $("#moneyReminderOneInput"),
        reminderTwoInput: $("#moneyReminderTwoInput"),
        todaySpent: $("#moneyTodaySpent"),
        todayBalance: $("#moneyTodayBalance"),
        submittedBadge: $("#moneySubmittedBadge"),
        addForm: $("#moneyAddForm"),
        amountInput: $("#moneyAmountInput"),
        correctForm: $("#moneyCorrectForm"),
        correctInput: $("#moneyCorrectInput"),
        status: $("#moneyStatus"),
        yesterdayDelta: $("#moneyYesterdayDelta"),
        yesterdayMeta: $("#moneyYesterdayMeta"),
        weekDelta: $("#moneyWeekDelta"),
        weekMeta: $("#moneyWeekMeta"),
        monthDelta: $("#moneyMonthDelta"),
        monthMeta: $("#moneyMonthMeta"),
        historyList: $("#moneyHistoryList")
    };

    let loading = false;
    let reloadTimer = null;

    function formatMoney(value)
    {
        const number = Number(value) || 0;
        return `¥${number.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }

    function parseDateKey(dateKey)
    {
        const [year, month, day] = String(dateKey).split("-").map(Number);
        return new Date(Date.UTC(year, month - 1, day));
    }

    function dateKeyFromUtcDate(date)
    {
        return [
            date.getUTCFullYear(),
            String(date.getUTCMonth() + 1).padStart(2, "0"),
            String(date.getUTCDate()).padStart(2, "0")
        ].join("-");
    }

    function offsetDateKey(dateKey, dayOffset)
    {
        const date = parseDateKey(dateKey);
        date.setUTCDate(date.getUTCDate() + dayOffset);
        return dateKeyFromUtcDate(date);
    }

    function monthStartKey(dateKey)
    {
        const date = parseDateKey(dateKey);
        date.setUTCDate(1);
        return dateKeyFromUtcDate(date);
    }

    function weekStartKey(dateKey)
    {
        const date = parseDateKey(dateKey);
        const day = date.getUTCDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        date.setUTCDate(date.getUTCDate() + mondayOffset);
        return dateKeyFromUtcDate(date);
    }

    function getShanghaiTodayKey()
    {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(new Date());

        const values = Object.fromEntries(parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value]));

        return `${values.year}-${values.month}-${values.day}`;
    }

    function formatPrettyDate(dateKey)
    {
        return new Intl.DateTimeFormat("en-US", {
            timeZone: "UTC",
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric"
        }).format(parseDateKey(dateKey));
    }

    function formatMonth(dateKey)
    {
        return new Intl.DateTimeFormat("en-US", {
            timeZone: "UTC",
            month: "long",
            year: "numeric"
        }).format(parseDateKey(dateKey));
    }

    function setStatus(message = "", kind = "")
    {
        elements.status.textContent = message;
        elements.status.className = "money_status";
        if (kind) elements.status.classList.add(`is-${kind}`);
    }

    function setDeltaElement(element, amount)
    {
        const value = Number(amount) || 0;
        element.classList.remove("is-surplus", "is-debt", "is-even");

        if (value > 0.004)
        {
            element.textContent = `+${formatMoney(value)} surplus`;
            element.classList.add("is-surplus");
        }
        else if (value < -0.004)
        {
            element.textContent = `${formatMoney(Math.abs(value))} debt`;
            element.classList.add("is-debt");
        }
        else
        {
            element.textContent = `${formatMoney(0)} even`;
            element.classList.add("is-even");
        }
    }

    function sumRows(rows)
    {
        return rows.reduce((accumulator, row) => {
            accumulator.budget += Number(row.budget_snapshot) || 0;
            accumulator.spent += Number(row.spent_total) || 0;
            return accumulator;
        }, { budget: 0, spent: 0 });
    }

    function renderCurrent(settings, rows, history, todayKey)
    {
        const byDate = new Map(rows.map((row) => [String(row.record_date), row]));
        const todayRow = byDate.get(todayKey) ?? {
            budget_snapshot: Number(settings.daily_budget) || 0,
            spent_total: 0,
            submitted: false
        };

        const budget = Number(todayRow.budget_snapshot) || Number(settings.daily_budget) || 0;
        const spent = Number(todayRow.spent_total) || 0;
        const remaining = budget - spent;

        elements.todayDate.textContent = formatPrettyDate(todayKey);
        elements.budgetDisplay.textContent = formatMoney(settings.daily_budget);
        elements.budgetInput.placeholder = String(Number(settings.daily_budget) || 0);
        elements.reminderOneInput.value = String(settings.reminder_time_1 || "23:00").slice(0, 5);
        elements.reminderTwoInput.value = String(settings.reminder_time_2 || "23:30").slice(0, 5);
        elements.todaySpent.textContent = `${formatMoney(spent)} spent`;

        elements.todayBalance.className = "money_balance";
        if (remaining > 0.004)
        {
            elements.todayBalance.textContent = `${formatMoney(remaining)} remaining`;
            elements.todayBalance.classList.add("money_positive");
        }
        else if (remaining < -0.004)
        {
            elements.todayBalance.textContent = `${formatMoney(Math.abs(remaining))} over budget`;
            elements.todayBalance.classList.add("money_negative");
        }
        else
        {
            elements.todayBalance.textContent = "Exactly on budget";
            elements.todayBalance.classList.add("money_even");
        }

        elements.submittedBadge.textContent = todayRow.submitted ? "FILLED" : "NOT FILLED";
        elements.submittedBadge.className = `money_submit_badge ${todayRow.submitted ? "is-filled" : "is-missing"}`;

        const yesterdayKey = offsetDateKey(todayKey, -1);
        const yesterdayRow = byDate.get(yesterdayKey);

        if (yesterdayRow)
        {
            const yesterdayDelta = Number(yesterdayRow.budget_snapshot) - Number(yesterdayRow.spent_total);
            setDeltaElement(elements.yesterdayDelta, yesterdayDelta);
            elements.yesterdayMeta.textContent = yesterdayRow.submitted
                ? `${formatMoney(yesterdayRow.spent_total)} spent against ${formatMoney(yesterdayRow.budget_snapshot)}`
                : `Record wasn't filled · treating recorded spend as ${formatMoney(yesterdayRow.spent_total)}`;
        }
        else
        {
            elements.yesterdayDelta.className = "";
            elements.yesterdayDelta.textContent = "No data yet";
            elements.yesterdayMeta.textContent = "The tracker hasn't got yesterday in its pocket.";
        }

        const weekStart = weekStartKey(todayKey);
        const monthStart = monthStartKey(todayKey);
        const weekRows = rows.filter((row) => String(row.record_date) >= weekStart && String(row.record_date) <= todayKey);
        const monthRows = rows.filter((row) => String(row.record_date) >= monthStart && String(row.record_date) <= todayKey);

        const weekTotals = sumRows(weekRows);
        const monthTotals = sumRows(monthRows);

        setDeltaElement(elements.weekDelta, weekTotals.budget - weekTotals.spent);
        elements.weekMeta.textContent = `${formatMoney(weekTotals.spent)} spent / ${formatMoney(weekTotals.budget)} budget across ${weekRows.length} day${weekRows.length === 1 ? "" : "s"}`;

        setDeltaElement(elements.monthDelta, monthTotals.budget - monthTotals.spent);
        elements.monthMeta.textContent = `${formatMoney(monthTotals.spent)} spent / ${formatMoney(monthTotals.budget)} budget across ${monthRows.length} day${monthRows.length === 1 ? "" : "s"}`;

        renderHistory(history);
    }

    function renderHistory(history)
    {
        elements.historyList.innerHTML = "";

        if (!history.length)
        {
            const empty = document.createElement("div");
            empty.className = "money_history_empty";
            empty.textContent = "No completed month yet. Current-month data stays live above.";
            elements.historyList.appendChild(empty);
            return;
        }

        for (const row of history)
        {
            const item = document.createElement("article");
            item.className = "money_history_row";

            const month = document.createElement("div");
            month.className = "money_history_month";
            month.textContent = formatMonth(row.month_start);

            const spent = document.createElement("div");
            spent.className = "money_history_spent";
            spent.textContent = `${formatMoney(row.total_spent)} spent`;

            const delta = document.createElement("div");
            delta.className = "money_history_delta";
            const surplus = Number(row.surplus_debt) || 0;
            if (surplus > 0.004)
            {
                delta.textContent = `+${formatMoney(surplus)} surplus`;
                delta.classList.add("money_positive");
            }
            else if (surplus < -0.004)
            {
                delta.textContent = `${formatMoney(Math.abs(surplus))} debt`;
                delta.classList.add("money_negative");
            }
            else
            {
                delta.textContent = `${formatMoney(0)} even`;
                delta.classList.add("money_even");
            }

            item.append(month, spent, delta);
            elements.historyList.appendChild(item);
        }
    }

    async function loadMoney(options = {})
    {
        if (loading) return;
        loading = true;

        if (!options.silent) setStatus("Syncing Money Tracker...");

        const todayKey = getShanghaiTodayKey();
        const monthStart = monthStartKey(todayKey);
        const weekStart = weekStartKey(todayKey);
        const yesterdayKey = offsetDateKey(todayKey, -1);
        const rangeStart = [monthStart, weekStart, yesterdayKey].sort()[0];

        try
        {
            const prepareResult = await supabaseClient.rpc("money_prepare_tracker", {
                p_tracker_code: TRACKER_CODE,
                p_today: todayKey
            });

            if (prepareResult.error) throw prepareResult.error;

            const [settingsResult, dailyResult, historyResult] = await Promise.all([
                supabaseClient
                    .from("money_settings_shared")
                    .select("daily_budget, currency, timezone, reminder_time_1, reminder_time_2")
                    .eq("tracker_code", TRACKER_CODE)
                    .single(),
                supabaseClient
                    .from("money_daily_records_shared")
                    .select("record_date, budget_snapshot, spent_total, submitted, submitted_at")
                    .eq("tracker_code", TRACKER_CODE)
                    .gte("record_date", rangeStart)
                    .lte("record_date", todayKey)
                    .order("record_date", { ascending: true }),
                supabaseClient
                    .from("money_monthly_history_shared")
                    .select("month_start, total_spent, total_budget, surplus_debt, tracked_days")
                    .eq("tracker_code", TRACKER_CODE)
                    .order("month_start", { ascending: false })
                    .limit(24)
            ]);

            const error = settingsResult.error || dailyResult.error || historyResult.error;
            if (error) throw error;

            renderCurrent(
                settingsResult.data,
                dailyResult.data ?? [],
                historyResult.data ?? [],
                todayKey
            );

            if (!options.silent) setStatus("Synced.", "success");
        }
        catch (error)
        {
            console.error("Money Tracker load failed:", error);
            setStatus(`Money Tracker couldn't sync: ${error.message || error}`, "error");
        }
        finally
        {
            loading = false;
        }
    }

    async function runForm(button, operation, successMessage)
    {
        const previousText = button.textContent;
        button.disabled = true;
        button.textContent = "Saving...";
        setStatus("Saving...");

        try
        {
            await operation();
            setStatus(successMessage, "success");
            await loadMoney({ silent: true });
            if (typeof window.refreshCalendarNotifications === "function")
            {
                void window.refreshCalendarNotifications({ silent: true });
            }
        }
        catch (error)
        {
            console.error("Money Tracker save failed:", error);
            setStatus(`Save failed: ${error.message || error}`, "error");
        }
        finally
        {
            button.disabled = false;
            button.textContent = previousText;
        }
    }

    elements.budgetForm.addEventListener("submit", function (event)
    {
        event.preventDefault();
        const value = Number(elements.budgetInput.value);
        const button = elements.budgetForm.querySelector("button");

        if (!Number.isFinite(value) || value < 0)
        {
            setStatus("Give me a valid daily budget, chief.", "error");
            return;
        }

        runForm(button, async function ()
        {
            const { error } = await supabaseClient.rpc("money_set_daily_budget", {
                p_tracker_code: TRACKER_CODE,
                p_daily_budget: value,
                p_effective_date: getShanghaiTodayKey()
            });
            if (error) throw error;
            elements.budgetInput.value = "";
        }, `Daily budget is now ${formatMoney(value)} from today onward.`);
    });


    elements.reminderForm.addEventListener("submit", function (event)
    {
        event.preventDefault();

        const firstTime = String(elements.reminderOneInput.value || "").trim();
        const secondTime = String(elements.reminderTwoInput.value || "").trim();
        const button = elements.reminderForm.querySelector("button");

        if (!/^\d{2}:\d{2}$/.test(firstTime) || !/^\d{2}:\d{2}$/.test(secondTime))
        {
            setStatus("Pick both reminder times.", "error");
            return;
        }

        if (secondTime <= firstTime)
        {
            setStatus("Second reminder has to be later than the first one.", "error");
            return;
        }

        runForm(button, async function ()
        {
            const { error } = await supabaseClient.rpc("money_set_reminder_times", {
                p_tracker_code: TRACKER_CODE,
                p_reminder_time_1: `${firstTime}:00`,
                p_reminder_time_2: `${secondTime}:00`
            });

            if (error) throw error;
        }, `Reminder times saved: ${firstTime} and ${secondTime}.`);
    });

    elements.addForm.addEventListener("submit", function (event)
    {
        event.preventDefault();
        const value = Number(elements.amountInput.value);
        const button = elements.addForm.querySelector("button");

        if (!Number.isFinite(value) || value < 0)
        {
            setStatus("Spending amount has to be 0 or higher.", "error");
            return;
        }

        runForm(button, async function ()
        {
            const { error } = await supabaseClient.rpc("money_add_spending", {
                p_tracker_code: TRACKER_CODE,
                p_amount: value,
                p_record_date: getShanghaiTodayKey()
            });
            if (error) throw error;
            elements.amountInput.value = "";
        }, value === 0 ? "Today is marked filled at ¥0." : `${formatMoney(value)} added to today.`);
    });

    elements.correctForm.addEventListener("submit", function (event)
    {
        event.preventDefault();
        const value = Number(elements.correctInput.value);
        const button = elements.correctForm.querySelector("button");

        if (!Number.isFinite(value) || value < 0)
        {
            setStatus("Exact total has to be 0 or higher.", "error");
            return;
        }

        runForm(button, async function ()
        {
            const { error } = await supabaseClient.rpc("money_set_day_total", {
                p_tracker_code: TRACKER_CODE,
                p_total: value,
                p_record_date: getShanghaiTodayKey()
            });
            if (error) throw error;
            elements.correctInput.value = "";
        }, `Today's total corrected to ${formatMoney(value)}.`);
    });

    function scheduleReload()
    {
        window.clearTimeout(reloadTimer);
        reloadTimer = window.setTimeout(function ()
        {
            void loadMoney({ silent: true });
        }, 250);
    }

    try
    {
        supabaseClient
            .channel("money_tracker_changes")
            .on("postgres_changes", { event: "*", schema: "public", table: "money_settings_shared" }, scheduleReload)
            .on("postgres_changes", { event: "*", schema: "public", table: "money_daily_records_shared" }, scheduleReload)
            .on("postgres_changes", { event: "*", schema: "public", table: "money_monthly_history_shared" }, scheduleReload)
            .subscribe();
    }
    catch (error)
    {
        console.warn("Money Tracker realtime subscription unavailable:", error);
    }

    document.addEventListener("visibilitychange", function ()
    {
        if (!document.hidden) void loadMoney({ silent: true });
    });

    window.addEventListener("focus", function ()
    {
        void loadMoney({ silent: true });
    });

    void loadMoney();
})();
