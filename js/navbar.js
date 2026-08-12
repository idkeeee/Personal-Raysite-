(function ()
{
    "use strict";

    const navbarScriptUrl = new URL(
        document.currentScript?.src ?? "js/navbar.js",
        document.baseURI
    );
    const appRootUrl = new URL("../", navbarScriptUrl);

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
    const MONEY_TRACKER_CODE = "bagas-main-money-v1";
    const MONEY_DAILY_TABLE = "money_daily_records_shared";
    const MONEY_SETTINGS_TABLE = "money_settings_shared";
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const SWIPE_CLEAR_THRESHOLD = 76;
    const SWIPE_MAX_DISTANCE = 126;
    const APP_BADGE_SERVICE_WORKER_VERSION = "3";
    const VAPID_PUBLIC_KEY = "BOZxsHa3g2oBVzf3lO_zuVWreO-VhHAiAFSrBOMHuhi3xmcH5MvGEAH6RccWiBOj7wem0EPSOejS3mMJQgQPcX4";
    const SAVE_PUSH_SUBSCRIPTION_RPC = "save_calendar_push_subscription";
    const DISABLE_PUSH_SUBSCRIPTION_RPC = "disable_calendar_push_subscription";

    let client = null;
    let isLoading = false;
    let lastRenderedCount = 0;
    let currentNotifications = [];
    let currentDateKey = "";
    let currentHadPartialError = false;
    let dismissalStoreAvailable = true;
    let serviceWorkerRegistrationPromise = null;

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
            return null;
        }

        if (!serviceWorkerRegistrationPromise)
        {
            serviceWorkerRegistrationPromise = (async function ()
            {
                const serviceWorkerUrl = new URL(
                    `service-worker.js?v=${APP_BADGE_SERVICE_WORKER_VERSION}`,
                    appRootUrl
                );

                const registration = await navigator.serviceWorker.register(
                    serviceWorkerUrl.href,
                    { scope: appRootUrl.pathname }
                );

                await navigator.serviceWorker.ready;
                return registration;
            })().catch(function (error)
            {
                serviceWorkerRegistrationPromise = null;
                console.warn("Ray app service worker could not register:", error);
                return null;
            });
        }

        return serviceWorkerRegistrationPromise;
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

    function urlBase64ToUint8Array(value)
    {
        const padding = "=".repeat((4 - value.length % 4) % 4);
        const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
        const rawData = window.atob(base64);
        return Uint8Array.from(rawData, function (character)
        {
            return character.charCodeAt(0);
        });
    }

    function supportsHourlyPushReminders()
    {
        return (
            isStandaloneWebApp()
            && "serviceWorker" in navigator
            && "PushManager" in window
            && "Notification" in window
        );
    }

    async function savePushSubscription(subscription)
    {
        const supabaseClient = getClient();

        if (!supabaseClient)
        {
            throw new Error("Supabase is unavailable.");
        }

        const serialized = subscription.toJSON();
        const endpoint = String(serialized.endpoint ?? "");
        const p256dh = String(serialized.keys?.p256dh ?? "");
        const auth = String(serialized.keys?.auth ?? "");

        if (!endpoint || !p256dh || !auth)
        {
            throw new Error("The push subscription is missing required keys.");
        }

        const { error } = await supabaseClient.rpc(SAVE_PUSH_SUBSCRIPTION_RPC, {
            p_calendar_code: CALENDAR_CODE,
            p_endpoint: endpoint,
            p_p256dh: p256dh,
            p_auth: auth,
            p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
            p_user_agent: navigator.userAgent
        });

        if (error)
        {
            throw error;
        }
    }

    async function disablePushSubscription(subscription)
    {
        const supabaseClient = getClient();

        if (!supabaseClient)
        {
            throw new Error("Supabase is unavailable.");
        }

        const { error } = await supabaseClient.rpc(DISABLE_PUSH_SUBSCRIPTION_RPC, {
            p_calendar_code: CALENDAR_CODE,
            p_endpoint: subscription.endpoint
        });

        if (error)
        {
            throw error;
        }

        await subscription.unsubscribe();
    }

    function setupHourlyReminderButton()
    {
        if (!toolbar || !isStandaloneWebApp())
        {
            return;
        }

        const reminderButton = document.createElement("button");
        reminderButton.className = "notification_refresh_button notification_hourly_button";
        reminderButton.type = "button";
        reminderButton.textContent = "Checking hourly...";
        reminderButton.disabled = true;
        reminderButton.setAttribute("aria-label", "Configure hourly calendar push reminders");
        refreshButton.before(reminderButton);

        let currentSubscription = null;
        let buttonBusy = false;

        function setButtonState(state)
        {
            reminderButton.classList.toggle("is-enabled", state === "enabled");
            reminderButton.classList.toggle("is-error", state === "error");

            if (state === "enabled")
            {
                reminderButton.textContent = "Hourly: ON";
                reminderButton.disabled = false;
                reminderButton.title = "Tap to turn off hourly calendar push reminders.";
                reminderButton.setAttribute("aria-label", "Hourly calendar reminders are on. Tap to turn them off.");
                return;
            }

            if (state === "blocked")
            {
                reminderButton.textContent = "Push blocked";
                reminderButton.disabled = true;
                reminderButton.title = "Turn on notifications for Ray in iPhone Settings.";
                return;
            }

            if (state === "unsupported")
            {
                reminderButton.textContent = "Push unavailable";
                reminderButton.disabled = true;
                reminderButton.title = "Hourly reminders require the installed Home Screen web app.";
                return;
            }

            if (state === "error")
            {
                reminderButton.textContent = "Setup failed";
                reminderButton.disabled = false;
                reminderButton.title = "The push setup could not reach Supabase. Run the hourly-push SQL and try again.";
                return;
            }

            reminderButton.textContent = "Enable hourly";
            reminderButton.disabled = false;
            reminderButton.title = "Receive a visible reminder every hour while calendar tasks remain.";
            reminderButton.setAttribute("aria-label", "Enable hourly calendar push reminders");
        }

        async function refreshReminderState()
        {
            if (buttonBusy)
            {
                return;
            }

            if (!supportsHourlyPushReminders())
            {
                setButtonState("unsupported");
                return;
            }

            if (Notification.permission === "denied")
            {
                setButtonState("blocked");
                return;
            }

            const registration = await registerAppServiceWorker();

            if (!registration)
            {
                setButtonState("unsupported");
                return;
            }

            try
            {
                currentSubscription = await registration.pushManager.getSubscription();

                if (currentSubscription)
                {
                    setButtonState("enabled");

                    /*
                        Re-save an existing subscription when the app opens. Push services
                        can rotate subscription details, and this keeps Supabase fresh.
                    */
                    savePushSubscription(currentSubscription).catch(function (error)
                    {
                        console.warn("Could not refresh the hourly push subscription:", error);
                    });
                }
                else
                {
                    setButtonState("disabled");
                }
            }
            catch (error)
            {
                console.warn("Could not inspect the hourly push subscription:", error);
                setButtonState("error");
            }
        }

        reminderButton.addEventListener("click", async function ()
        {
            if (buttonBusy)
            {
                return;
            }

            buttonBusy = true;
            reminderButton.disabled = true;
            reminderButton.classList.remove("is-error");
            reminderButton.textContent = currentSubscription ? "Turning off..." : "Connecting...";

            try
            {
                const registration = await registerAppServiceWorker();

                if (!registration)
                {
                    throw new Error("Service worker registration failed.");
                }

                currentSubscription = await registration.pushManager.getSubscription();

                if (currentSubscription)
                {
                    await disablePushSubscription(currentSubscription);
                    currentSubscription = null;
                    setButtonState("disabled");
                    return;
                }

                if (Notification.permission !== "granted")
                {
                    const permission = await Notification.requestPermission();

                    if (permission !== "granted")
                    {
                        setButtonState(permission === "denied" ? "blocked" : "disabled");
                        return;
                    }
                }

                const newSubscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                });

                try
                {
                    await savePushSubscription(newSubscription);
                }
                catch (error)
                {
                    await newSubscription.unsubscribe().catch(function () {});
                    throw error;
                }

                currentSubscription = newSubscription;
                setButtonState("enabled");
                void syncHomeScreenBadge(lastRenderedCount);
            }
            catch (error)
            {
                console.error("Hourly push reminder setup failed:", error);
                currentSubscription = null;
                setButtonState("error");
            }
            finally
            {
                buttonBusy = false;
            }
        });

        window.addEventListener("pageshow", refreshReminderState);
        document.addEventListener("visibilitychange", function ()
        {
            if (!document.hidden)
            {
                refreshReminderState();
            }
        });

        refreshReminderState();
    }

    function setupLocalNotificationTestButton()
    {
        if (!toolbar || !isStandaloneWebApp() || !("Notification" in window))
        {
            return;
        }

        const testButton = document.createElement("button");
        testButton.className = "notification_refresh_button notification_local_test_button";
        testButton.type = "button";
        testButton.textContent = "Test local";
        testButton.title = "Display a notification directly from this iPhone, without Supabase or Apple Web Push.";
        testButton.setAttribute("aria-label", "Test local Ray notification display");
        refreshButton.before(testButton);

        let busy = false;

        testButton.addEventListener("click", async function ()
        {
            if (busy)
            {
                return;
            }

            busy = true;
            testButton.disabled = true;
            testButton.textContent = "Testing...";

            try
            {
                if (Notification.permission !== "granted")
                {
                    const permission = await Notification.requestPermission();

                    if (permission !== "granted")
                    {
                        throw new Error(`Notification permission is ${permission}.`);
                    }
                }

                const registration = await registerAppServiceWorker();

                if (!registration)
                {
                    throw new Error("Service worker registration is unavailable.");
                }

                const iconUrl = new URL("assets/app-icons/ray-fire-192.png", appRootUrl).href;

                await registration.showNotification("Ray local test", {
                    body: "If you can see this, iPhone + service worker notification display works.",
                    icon: iconUrl,
                    tag: `ray-local-test-${Date.now()}`,
                    renotify: true,
                    data: {
                        url: appRootUrl.href,
                        badgeCount: lastRenderedCount
                    }
                });

                testButton.textContent = "Local sent";
                testButton.title = "A local test notification was requested from this device.";

                window.setTimeout(function ()
                {
                    testButton.textContent = "Test local";
                    testButton.title = "Display a notification directly from this iPhone, without Supabase or Apple Web Push.";
                }, 2500);
            }
            catch (error)
            {
                console.error("Local Ray notification test failed:", error);
                testButton.textContent = "Local failed";
                testButton.title = String(error?.message || error || "Local notification test failed.");

                window.setTimeout(function ()
                {
                    testButton.textContent = "Test local";
                }, 3500);
            }
            finally
            {
                busy = false;
                testButton.disabled = false;
            }
        });
    }


    function setupPushEventDiagnosticButton()
    {
        if (!toolbar || !isStandaloneWebApp() || !("serviceWorker" in navigator))
        {
            return;
        }

        const diagnosticButton = document.createElement("button");
        diagnosticButton.className = "notification_refresh_button notification_push_diag_button";
        diagnosticButton.type = "button";
        diagnosticButton.textContent = "Push log";
        diagnosticButton.title = "Show whether a remote Web Push event actually reached this iPhone.";
        diagnosticButton.setAttribute("aria-label", "Show remote push diagnostic log");
        refreshButton.before(diagnosticButton);

        async function askServiceWorker(type)
        {
            const registration = await registerAppServiceWorker();

            if (!registration)
            {
                throw new Error("Service worker registration is unavailable.");
            }

            const worker =
                registration.active
                || navigator.serviceWorker.controller
                || registration.waiting
                || registration.installing;

            if (!worker)
            {
                throw new Error("No active Ray service worker was found.");
            }

            return new Promise(function (resolve, reject)
            {
                const channel = new MessageChannel();
                const timer = window.setTimeout(function ()
                {
                    reject(new Error("The service worker did not answer in time."));
                }, 5000);

                channel.port1.onmessage = function (event)
                {
                    window.clearTimeout(timer);
                    resolve(event.data || {});
                };

                worker.postMessage({ type }, [channel.port2]);
            });
        }

        diagnosticButton.addEventListener("click", async function ()
        {
            diagnosticButton.disabled = true;
            diagnosticButton.textContent = "Reading...";

            try
            {
                const result = await askServiceWorker("RAY_GET_PUSH_DEBUG");
                const entries = Array.isArray(result.entries) ? result.entries : [];

                if (entries.length === 0)
                {
                    window.alert(
                        "Ray Push Log\n\n" +
                        "No remote push event has been recorded by this iPhone yet.\n\n" +
                        "If Supabase says sent: 1 / statusCode: 201 after a remote test, " +
                        "but this log stays empty, the push is not reaching Ray's service worker."
                    );
                }
                else
                {
                    const lines = entries.slice(-12).map(function (entry)
                    {
                        const stamp = String(entry.stamp || "");
                        const kind = String(entry.kind || "unknown");
                        let extra = "";

                        if (entry.details && typeof entry.details === "object")
                        {
                            if ("hasData" in entry.details)
                            {
                                extra += ` | data=${entry.details.hasData ? "yes" : "no"}`;
                            }

                            if (entry.details.payloadMode)
                            {
                                extra += ` | ${entry.details.payloadMode}`;
                            }

                            if (entry.details.message)
                            {
                                extra += ` | ${entry.details.message}`;
                            }
                        }

                        return `${stamp}\n${kind}${extra}`;
                    });

                    window.alert(
                        "Ray Push Log\n\n" +
                        lines.join("\n\n")
                    );
                }
            }
            catch (error)
            {
                window.alert(
                    "Ray Push Log\n\nCould not read the service-worker log:\n" +
                    String(error?.message || error)
                );
            }
            finally
            {
                diagnosticButton.disabled = false;
                diagnosticButton.textContent = "Push log";
            }
        });
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


    function timeHasBeenReached(date, timeValue)
    {
        const normalized = String(timeValue || "23:00").slice(0, 5);
        const [hour, minute] = normalized.split(":").map(Number);

        if (!Number.isInteger(hour) || !Number.isInteger(minute))
        {
            return false;
        }

        return (date.getHours() * 60 + date.getMinutes()) >= (hour * 60 + minute);
    }

    function buildNotifications(manualRows, occurrenceRows, activeRules, dismissedKeys, date, moneyRow, moneySettings, moneyAvailable)
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

        const moneyReminderTimeReached = timeHasBeenReached(date, moneySettings?.reminder_time_1 || "23:00");
        const moneySubmitted = Boolean(moneyRow?.submitted);

        if (moneyAvailable && moneyReminderTimeReached && !moneySubmitted)
        {
            notifications.push({
                id: "money-daily-spending",
                dismissKey: "money:daily-spending",
                type: "money",
                sourceLabel: "From card: Money Tracker",
                kindLabel: "Daily spending",
                text: "Today’s spending record still hasn’t been filled.",
                href: "html/cards/money_tracker.html",
                footerText: "Tap to fill today’s spending"
            });
        }

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
        item.href = notification.href ?? `html/cards/calender.html?date=${encodeURIComponent(dateKey)}`;

        const topLine = document.createElement("div");
        topLine.className = "notification_item_topline";

        const source = document.createElement("span");
        source.className = "notification_source";
        source.textContent = notification.sourceLabel ?? "From card: Calender";

        const kind = document.createElement("span");
        kind.className = "notification_kind";
        kind.textContent = notification.kindLabel;

        const text = document.createElement("p");
        text.className = "notification_item_text";
        text.textContent = notification.text;

        const footer = document.createElement("div");
        footer.className = "notification_item_footer";
        footer.textContent = notification.footerText ?? "Tap to jump to today in Calender";

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
            status.textContent = "Checking today’s notifications...";
        }

        const supabaseClient = getClient();

        if (!supabaseClient)
        {
            list.innerHTML = "";
            setBadge(0);
            summary.textContent = "Notifications unavailable";
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
            const [manualResult, occurrenceResult, rulesResult, dismissalResult, moneyResult, moneySettingsResult] = await Promise.all([
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
                    .eq("notification_date", dateKey),
                supabaseClient
                    .from(MONEY_DAILY_TABLE)
                    .select("submitted")
                    .eq("tracker_code", MONEY_TRACKER_CODE)
                    .eq("record_date", dateKey)
                    .limit(1),
                supabaseClient
                    .from(MONEY_SETTINGS_TABLE)
                    .select("reminder_time_1, reminder_time_2")
                    .eq("tracker_code", MONEY_TRACKER_CODE)
                    .limit(1)
            ]);

            const manualRows = manualResult.error ? [] : (manualResult.data ?? []);
            const occurrenceRows = occurrenceResult.error ? [] : (occurrenceResult.data ?? []);
            const activeRules = rulesResult.error ? [] : (rulesResult.data ?? []);
            const dismissalRows = dismissalResult.error ? [] : (dismissalResult.data ?? []);
            const moneyRow = moneyResult.error ? null : (moneyResult.data?.[0] ?? null);
            const moneySettings = moneySettingsResult.error ? null : (moneySettingsResult.data?.[0] ?? null);
            const moneyAvailable = !moneyResult.error && !moneySettingsResult.error;
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
            const hadPartialError = Boolean(manualResult.error || occurrenceResult.error || rulesResult.error || moneyResult.error || moneySettingsResult.error);

            if (allFailed)
            {
                throw new Error("All calendar notification queries failed.");
            }

            if (dismissalResult.error)
            {
                console.warn("Notification dismissals are unavailable until the SQL update is run:", dismissalResult.error);
            }

            const notifications = buildNotifications(manualRows, occurrenceRows, activeRules, dismissedKeys, now, moneyRow, moneySettings, moneyAvailable);
            renderNotifications(notifications, dateKey, hadPartialError);
        }
        catch (error)
        {
            console.error("Failed to load calendar notifications:", error);
            list.innerHTML = "";
            currentNotifications = [];
            currentDateKey = dateKey;
            setBadge(0);
            summary.textContent = "Could not check notifications";
            status.hidden = false;
            status.className = "notification_status is-error";
            status.textContent = "The notification center could not reach Ray’s notification sources. Check your connection and press Refresh.";
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
    setupHourlyReminderButton();
    setupLocalNotificationTestButton();
    setupPushEventDiagnosticButton();
    loadCalendarNotifications();
})();
