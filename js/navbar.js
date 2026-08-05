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
    const toolbar = document.querySelector(".notification_toolbar");

    if (!badge || !menuButton || !list || !status || !summary || !dateLabel || !refreshButton || !calendarLink)
    {
        return;
    }

    const SUPABASE_URL = window.SUPABASE_URL ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
    const SUPABASE_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
    const CALENDAR_CODE = "bagas-main-calendar-v1";
    const DISMISSALS_TABLE = "calendar_notification_dismissals_shared";
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const SWIPE_CLEAR_THRESHOLD = 76;
    const SWIPE_MAX_DISTANCE = 126;
    const APP_BADGE_SERVICE_WORKER_VERSION = "1";

    let client = null;
    let isLoading = false;
    let lastRenderedCount = 0;
    let currentNotifications = [];
    let currentDateKey = "";
    let currentHadPartialError = false;
    let dismissalStoreAvailable = true;

    function isStandaloneWebApp()
    {
        return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    }

    function supportsHomeScreenBadge()
    {
        return typeof navigator.setAppBadge === "function";
    }

    async function registerAppServiceWorker()
    {
        if (!("serviceWorker" in navigator))
        {
            return;
        }

        try
        {
            const serviceWorkerUrl = new URL(
                `service-worker.js?v=${APP_BADGE_SERVICE_WORKER_VERSION}`,
                document.baseURI
            );
            const scopeUrl = new URL("./", document.baseURI);

            await navigator.serviceWorker.register(serviceWorkerUrl.href, {
                scope: scopeUrl.pathname
            });
        }
        catch (error)
        {
            console.warn("Ray app service worker could not register:", error);
        }
    }

    async function syncHomeScreenBadge(count)
    {
        if (!supportsHomeScreenBadge())
        {
            return;
        }

        try
        {
            const safeCount = Math.max(0, Math.floor(Number(count) || 0));

            if (safeCount > 0)
            {
                await navigator.setAppBadge(safeCount);
            }
            else if (typeof navigator.clearAppBadge === "function")
            {
                await navigator.clearAppBadge();
            }
            else
            {
                await navigator.setAppBadge(0);
            }
        }
        catch (error)
        {
            console.warn("Could not update the home-screen app badge:", error);
        }
    }

    function setupBadgePermissionButton()
    {
        if (!toolbar || !isStandaloneWebApp() || !supportsHomeScreenBadge() || !("Notification" in window))
        {
            return;
        }

        const permissionButton = document.createElement("button");
        permissionButton.className = "notification_refresh_button notification_badge_permission_button";
        permissionButton.type = "button";
        permissionButton.textContent = "Enable badge";
        permissionButton.setAttribute("aria-label", "Enable the notification count on the Ray app icon");
        refreshButton.before(permissionButton);

        function refreshPermissionButton()
        {
            if (Notification.permission === "granted")
            {
                permissionButton.hidden = true;
                void syncHomeScreenBadge(lastRenderedCount);
                return;
            }

            permissionButton.hidden = false;

            if (Notification.permission === "denied")
            {
                permissionButton.textContent = "Badge blocked";
                permissionButton.disabled = true;
                permissionButton.title = "Turn on notifications and badges for Ray in iPhone Settings.";
                return;
            }

            permissionButton.textContent = "Enable badge";
            permissionButton.disabled = false;
            permissionButton.title = "Allow iOS to show the red notification count on this app icon.";
        }

        permissionButton.addEventListener("click", async function ()
        {
            permissionButton.disabled = true;
            permissionButton.textContent = "Asking...";

            try
            {
                await Notification.requestPermission();
            }
            catch (error)
            {
                console.warn("Notification permission request failed:", error);
            }

            refreshPermissionButton();
        });

        window.addEventListener("pageshow", refreshPermissionButton);
        refreshPermissionButton();
    }

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

    function hashString(value)
    {
        let hash = 2166136261;

        for (let index = 0; index < value.length; index += 1)
        {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0).toString(36);
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

    function buildNotifications(manualRows, occurrenceRows, activeRules, dismissedKeys, date)
    {
        const notifications = [];
        const dateKey = getLocalDateKey(date);

        for (const row of manualRows)
        {
            const noteText = String(row.note_text ?? "").trim();

            if (noteText.length > 0)
            {
                const contentHash = hashString(noteText);
                notifications.push({
                    id: `manual-${contentHash}`,
                    dismissKey: `manual:${contentHash}`,
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

            const mapKey = row.rule_id ? `rule-${row.rule_id}` : `text-${taskText}`;
            const dismissIdentity = row.rule_id ? String(row.rule_id) : hashString(taskText);
            recurringByKey.set(mapKey, {
                id: mapKey,
                dismissKey: `recurring:${dismissIdentity}:${hashString(taskText)}`,
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

            const mapKey = `rule-${rule.id}`;

            if (!recurringByKey.has(mapKey))
            {
                recurringByKey.set(mapKey, {
                    id: mapKey,
                    dismissKey: `recurring:${rule.id}:${hashString(taskText)}`,
                    type: "recurring",
                    kindLabel: "↻ For Loop",
                    text: taskText
                });
            }
        }

        notifications.push(...recurringByKey.values());

        return notifications.filter(function (notification)
        {
            const storageKey = `${dateKey}:${notification.dismissKey}`;
            return !dismissedKeys.has(storageKey) && !dismissedKeys.has(notification.dismissKey);
        });
    }

    function setBadge(count)
    {
        lastRenderedCount = count;
        badge.hidden = count === 0;
        badge.textContent = count > 99 ? "99+" : String(count);
        void syncHomeScreenBadge(count);

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

    function updateNotificationSummary()
    {
        const count = currentNotifications.length;
        const countText = `${count} notification${count === 1 ? "" : "s"}`;
        summary.textContent = currentHadPartialError ? `${countText} · partial sync` : countText;
        setBadge(count);

        if (count === 0)
        {
            status.hidden = false;
            status.className = "notification_status is-empty";
            status.textContent = "Nothing scheduled for today. The dashboard is suspiciously peaceful.";
        }
    }

    function showDismissError(message)
    {
        status.hidden = false;
        status.className = "notification_status is-error";
        status.textContent = message;
    }

    async function dismissNotification(notification, dateKey, shell, clearButton)
    {
        if (shell.dataset.dismissing === "true")
        {
            return;
        }

        shell.dataset.dismissing = "true";

        if (clearButton)
        {
            clearButton.disabled = true;
            clearButton.textContent = "Clearing...";
        }

        const supabaseClient = getClient();

        if (!supabaseClient)
        {
            shell.dataset.dismissing = "false";
            shell.classList.remove("is-swipe-ready");
            showDismissError("Could not clear that notification because Supabase is unavailable.");
            return;
        }

        try
        {
            const { error } = await supabaseClient
                .from(DISMISSALS_TABLE)
                .upsert({
                    calendar_code: CALENDAR_CODE,
                    notification_date: dateKey,
                    notification_key: notification.dismissKey,
                    dismissed_at: new Date().toISOString()
                }, {
                    onConflict: "calendar_code,notification_date,notification_key"
                });

            if (error)
            {
                throw error;
            }

            dismissalStoreAvailable = true;
            shell.classList.add("is-clearing");

            window.setTimeout(function ()
            {
                shell.remove();
                currentNotifications = currentNotifications.filter(function (item)
                {
                    return item.id !== notification.id;
                });
                updateNotificationSummary();
            }, 190);
        }
        catch (error)
        {
            console.error("Failed to clear notification:", error);
            shell.dataset.dismissing = "false";
            shell.classList.remove("is-swipe-ready");

            const notificationItem = shell.querySelector(".notification_item");
            if (notificationItem)
            {
                notificationItem.style.removeProperty("transform");
                notificationItem.style.removeProperty("transition");
            }

            if (clearButton)
            {
                clearButton.disabled = false;
                clearButton.textContent = "Clear";
            }

            const message = dismissalStoreAvailable
                ? "That notification refused to clear. Check your connection and try again."
                : "Clearing needs the new notification-dismissals SQL update in Supabase.";
            showDismissError(message);
        }
    }

    function enableSwipeToClear(shell, item, notification, dateKey, clearButton)
    {
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let isHorizontalSwipe = false;
        let suppressClick = false;

        function resetSwipe()
        {
            item.style.transition = "transform 160ms ease";
            item.style.transform = "translateX(0)";
            shell.classList.remove("is-swipe-ready");
            pointerId = null;
            isHorizontalSwipe = false;

            window.setTimeout(function ()
            {
                item.style.removeProperty("transition");
                item.style.removeProperty("transform");
            }, 170);
        }

        item.addEventListener("pointerdown", function (event)
        {
            if (event.pointerType === "mouse" || shell.dataset.dismissing === "true")
            {
                return;
            }

            pointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            currentX = startX;
            isHorizontalSwipe = false;
            suppressClick = false;
            item.setPointerCapture(pointerId);
        });

        item.addEventListener("pointermove", function (event)
        {
            if (event.pointerId !== pointerId)
            {
                return;
            }

            currentX = event.clientX;
            const deltaX = currentX - startX;
            const deltaY = event.clientY - startY;

            if (!isHorizontalSwipe)
            {
                if (Math.abs(deltaX) < 8)
                {
                    return;
                }

                if (Math.abs(deltaY) > Math.abs(deltaX))
                {
                    pointerId = null;
                    return;
                }

                isHorizontalSwipe = true;
            }

            if (deltaX >= 0)
            {
                item.style.transform = "translateX(0)";
                return;
            }

            suppressClick = true;
            const distance = Math.max(-SWIPE_MAX_DISTANCE, deltaX);
            item.style.transition = "none";
            item.style.transform = `translateX(${distance}px)`;
            shell.classList.toggle("is-swipe-ready", Math.abs(distance) >= SWIPE_CLEAR_THRESHOLD);
        });

        function finishSwipe(event)
        {
            if (event.pointerId !== pointerId)
            {
                return;
            }

            const distance = currentX - startX;

            if (isHorizontalSwipe && distance <= -SWIPE_CLEAR_THRESHOLD)
            {
                suppressClick = true;
                item.style.transition = "transform 170ms ease";
                item.style.transform = "translateX(-105%)";
                dismissNotification(notification, dateKey, shell, clearButton);
            }
            else
            {
                resetSwipe();
            }

            pointerId = null;
        }

        item.addEventListener("pointerup", finishSwipe);
        item.addEventListener("pointercancel", resetSwipe);
        item.addEventListener("click", function (event)
        {
            if (suppressClick)
            {
                event.preventDefault();
                event.stopPropagation();
                suppressClick = false;
            }
        }, true);
    }

    function createNotificationElement(notification, dateKey)
    {
        const shell = document.createElement("article");
        shell.className = "notification_swipe_shell";
        shell.dataset.notificationId = notification.id;

        const swipeAction = document.createElement("div");
        swipeAction.className = "notification_swipe_action";
        swipeAction.setAttribute("aria-hidden", "true");
        swipeAction.textContent = "Clear";

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

        const clearButton = document.createElement("button");
        clearButton.className = "notification_clear_button";
        clearButton.type = "button";
        clearButton.textContent = "Clear";
        clearButton.setAttribute("aria-label", `Clear notification: ${notification.text}`);
        clearButton.title = dismissalStoreAvailable
            ? "Hide this notification for today"
            : "Run the notification-dismissals SQL update first";

        clearButton.addEventListener("click", function (event)
        {
            event.preventDefault();
            event.stopPropagation();
            dismissNotification(notification, dateKey, shell, clearButton);
        });

        topLine.append(source, kind);
        item.append(topLine, text, footer);
        shell.append(swipeAction, item, clearButton);
        enableSwipeToClear(shell, item, notification, dateKey, clearButton);
        return shell;
    }

    function renderNotifications(notifications, dateKey, hadPartialError)
    {
        list.innerHTML = "";
        calendarLink.href = `html/cards/calender.html?date=${encodeURIComponent(dateKey)}`;
        currentNotifications = notifications;
        currentDateKey = dateKey;
        currentHadPartialError = hadPartialError;
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

        updateNotificationSummary();
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
            const [manualResult, occurrenceResult, rulesResult, dismissalResult] = await Promise.all([
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
                    .eq("is_active", true),
                supabaseClient
                    .from(DISMISSALS_TABLE)
                    .select("notification_key, notification_date")
                    .eq("calendar_code", CALENDAR_CODE)
                    .eq("notification_date", dateKey)
            ]);

            const manualRows = manualResult.error ? [] : (manualResult.data ?? []);
            const occurrenceRows = occurrenceResult.error ? [] : (occurrenceResult.data ?? []);
            const activeRules = rulesResult.error ? [] : (rulesResult.data ?? []);
            const dismissalRows = dismissalResult.error ? [] : (dismissalResult.data ?? []);
            dismissalStoreAvailable = !dismissalResult.error;

            const dismissedKeys = new Set();
            for (const row of dismissalRows)
            {
                const key = String(row.notification_key ?? "");
                const dismissedDate = String(row.notification_date ?? dateKey);

                if (key.length > 0)
                {
                    dismissedKeys.add(key);
                    dismissedKeys.add(`${dismissedDate}:${key}`);
                }
            }

            const allFailed = Boolean(manualResult.error && occurrenceResult.error && rulesResult.error);
            const hadPartialError = Boolean(manualResult.error || occurrenceResult.error || rulesResult.error);

            if (allFailed)
            {
                throw new Error("All calendar notification queries failed.");
            }

            if (dismissalResult.error)
            {
                console.warn("Notification dismissals are unavailable until the SQL update is run:", dismissalResult.error);
            }

            const notifications = buildNotifications(manualRows, occurrenceRows, activeRules, dismissedKeys, now);
            renderNotifications(notifications, dateKey, hadPartialError);
        }
        catch (error)
        {
            console.error("Failed to load calendar notifications:", error);
            list.innerHTML = "";
            currentNotifications = [];
            currentDateKey = dateKey;
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
    void registerAppServiceWorker();
    setupBadgePermissionButton();
    loadCalendarNotifications();
})();
