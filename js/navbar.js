(function ()
{
    "use strict";

    const badge = document.getElementById("notificationBadge");
    const menuButton = document.getElementById("notificationMenuButton");
    const list = document.getElementById("notificationList");
    const status = document.getElementById("notificationStatus");
    const summary = document.getElementById("notificationSummary");
    const dateLabel = document.getElementById("notificationDateLabel");
    const refreshButton = document.getElementById("notificationRefreshButton");
    const calendarLink = document.getElementById("notificationCalendarLink");

    if (!badge || !menuButton || !list || !status || !summary || !dateLabel || !refreshButton || !calendarLink)
    {
        return;
    }

    const SUPABASE_URL = window.SUPABASE_URL ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
    const SUPABASE_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
    const CALENDAR_CODE = "bagas-main-calendar-v1";
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

    let client = null;
    let isLoading = false;
    let lastRenderedCount = 0;

    function getLocalDateKey(date = new Date())
    {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function formatTodayLabel(date = new Date())
    {
        return new Intl.DateTimeFormat(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric"
        }).format(date);
    }

    function getClient()
    {
        if (client)
        {
            return client;
        }

        if (!window.supabase || typeof window.supabase.createClient !== "function")
        {
            return null;
        }

        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });

        return client;
    }

    function ruleOccursOnDate(rule, date)
    {
        const day = date.getDate();
        const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

        if (rule.repeat_mode === "month-end")
        {
            return day === daysInMonth;
        }

        if (rule.repeat_mode === "month-start")
        {
            return day === 1;
        }

        if (rule.repeat_mode === "half-month")
        {
            return day === 1 || day === 15;
        }

        if (rule.repeat_mode === "custom")
        {
            const interval = Number(rule.interval_days);
            return Number.isInteger(interval) && interval >= 1 && day > 1 && (day - 1) % interval === 0;
        }

        return false;
    }

    function buildNotifications(manualRows, occurrenceRows, activeRules, date)
    {
        const notifications = [];

        for (const row of manualRows)
        {
            const noteText = String(row.note_text ?? "").trim();

            if (noteText.length > 0)
            {
                notifications.push({
                    id: `manual-${getLocalDateKey(date)}`,
                    type: "manual",
                    kindLabel: "Calendar note",
                    text: noteText
                });
            }
        }

        const recurringByKey = new Map();

        for (const row of occurrenceRows)
        {
            const taskText = String(row.task_text ?? "").trim();

            if (taskText.length === 0)
            {
                continue;
            }

            const key = row.rule_id ? `rule-${row.rule_id}` : `text-${taskText}`;
            recurringByKey.set(key, {
                id: key,
                type: "recurring",
                kindLabel: "↻ For Loop",
                text: taskText
            });
        }

        /*
            A loop can still be due today even if its six-month occurrence runway
            has not been refilled yet. Calculate today's active rules directly so
            the notification badge never silently misses one.
        */
        for (const rule of activeRules)
        {
            if (!ruleOccursOnDate(rule, date))
            {
                continue;
            }

            const taskText = String(rule.task_text ?? "").trim();

            if (taskText.length === 0)
            {
                continue;
            }

            const key = `rule-${rule.id}`;

            if (!recurringByKey.has(key))
            {
                recurringByKey.set(key, {
                    id: key,
                    type: "recurring",
                    kindLabel: "↻ For Loop",
                    text: taskText
                });
            }
        }

        notifications.push(...recurringByKey.values());
        return notifications;
    }

    function setBadge(count)
    {
        lastRenderedCount = count;
        badge.hidden = count === 0;
        badge.textContent = count > 99 ? "99+" : String(count);

        if (count === 0)
        {
            menuButton.setAttribute("aria-label", "Open notification center. No notifications today.");
        }
        else
        {
            menuButton.setAttribute(
                "aria-label",
                `Open notification center. ${count} notification${count === 1 ? "" : "s"} today.`
            );
        }
    }

    function createNotificationElement(notification, dateKey)
    {
        const item = document.createElement("a");
        item.className = "notification_item";
        item.href = `html/cards/calender.html?date=${encodeURIComponent(dateKey)}`;

        const topLine = document.createElement("div");
        topLine.className = "notification_item_topline";

        const source = document.createElement("span");
        source.className = "notification_source";
        source.textContent = "From card: Calender";

        const kind = document.createElement("span");
        kind.className = "notification_kind";
        kind.textContent = notification.kindLabel;

        const text = document.createElement("p");
        text.className = "notification_item_text";
        text.textContent = notification.text;

        const footer = document.createElement("div");
        footer.className = "notification_item_footer";
        footer.textContent = "Tap to jump to today in Calender";

        topLine.append(source, kind);
        item.append(topLine, text, footer);
        return item;
    }

    function renderNotifications(notifications, dateKey, hadPartialError)
    {
        list.innerHTML = "";
        calendarLink.href = `html/cards/calender.html?date=${encodeURIComponent(dateKey)}`;
        setBadge(notifications.length);

        if (notifications.length === 0)
        {
            status.hidden = false;
            status.className = "notification_status is-empty";
            status.textContent = hadPartialError
                ? "No tasks were found, but part of the calendar could not be checked. Try Refresh."
                : "Nothing scheduled for today. The dashboard is suspiciously peaceful.";
            summary.textContent = "0 notifications";
            return;
        }

        status.hidden = true;
        status.className = "notification_status";

        for (const notification of notifications)
        {
            list.appendChild(createNotificationElement(notification, dateKey));
        }

        const countText = `${notifications.length} notification${notifications.length === 1 ? "" : "s"}`;
        summary.textContent = hadPartialError ? `${countText} · partial sync` : countText;
    }

    async function loadCalendarNotifications(options = {})
    {
        if (isLoading)
        {
            return;
        }

        isLoading = true;
        refreshButton.disabled = true;
        refreshButton.textContent = "Checking...";

        const now = new Date();
        const dateKey = getLocalDateKey(now);
        dateLabel.textContent = formatTodayLabel(now);
        calendarLink.href = `html/cards/calender.html?date=${encodeURIComponent(dateKey)}`;

        if (!options.silent || lastRenderedCount === 0)
        {
            status.hidden = false;
            status.className = "notification_status";
            status.textContent = "Checking today’s Calender tasks...";
        }

        const supabaseClient = getClient();

        if (!supabaseClient)
        {
            list.innerHTML = "";
            setBadge(0);
            summary.textContent = "Calendar unavailable";
            status.hidden = false;
            status.className = "notification_status is-error";
            status.textContent = "Supabase did not load, so today’s notifications could not be checked.";
            refreshButton.disabled = false;
            refreshButton.textContent = "Refresh";
            isLoading = false;
            return;
        }

        try
        {
            const [manualResult, occurrenceResult, rulesResult] = await Promise.all([
                supabaseClient
                    .from("calendar_notes_shared")
                    .select("note_text")
                    .eq("calendar_code", CALENDAR_CODE)
                    .eq("note_date", dateKey),
                supabaseClient
                    .from("calendar_recurring_occurrences_shared")
                    .select("rule_id, task_text")
                    .eq("calendar_code", CALENDAR_CODE)
                    .eq("occurrence_date", dateKey),
                supabaseClient
                    .from("calendar_recurring_rules_shared")
                    .select("id, task_text, repeat_mode, interval_days, is_active")
                    .eq("calendar_code", CALENDAR_CODE)
                    .eq("is_active", true)
            ]);

            const manualRows = manualResult.error ? [] : (manualResult.data ?? []);
            const occurrenceRows = occurrenceResult.error ? [] : (occurrenceResult.data ?? []);
            const activeRules = rulesResult.error ? [] : (rulesResult.data ?? []);

            const allFailed = Boolean(manualResult.error && occurrenceResult.error && rulesResult.error);
            const hadPartialError = Boolean(manualResult.error || occurrenceResult.error || rulesResult.error);

            if (allFailed)
            {
                throw new Error("All calendar notification queries failed.");
            }

            const notifications = buildNotifications(manualRows, occurrenceRows, activeRules, now);
            renderNotifications(notifications, dateKey, hadPartialError);
        }
        catch (error)
        {
            console.error("Failed to load calendar notifications:", error);
            list.innerHTML = "";
            setBadge(0);
            summary.textContent = "Could not check Calender";
            status.hidden = false;
            status.className = "notification_status is-error";
            status.textContent = "The notification center could not reach the calendar. Check your connection and press Refresh.";
        }
        finally
        {
            refreshButton.disabled = false;
            refreshButton.textContent = "Refresh";
            isLoading = false;
        }
    }

    refreshButton.addEventListener("click", function ()
    {
        loadCalendarNotifications();
    });

    menuButton.addEventListener("click", function ()
    {
        loadCalendarNotifications({ silent: true });
    });

    window.addEventListener("focus", function ()
    {
        loadCalendarNotifications({ silent: true });
    });

    document.addEventListener("visibilitychange", function ()
    {
        if (!document.hidden)
        {
            loadCalendarNotifications({ silent: true });
        }
    });

    window.setInterval(function ()
    {
        loadCalendarNotifications({ silent: true });
    }, REFRESH_INTERVAL_MS);

    window.refreshCalendarNotifications = loadCalendarNotifications;
    loadCalendarNotifications();
})();
