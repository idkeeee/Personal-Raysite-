"use strict";

const APP_ROOT = "/Personal-Raysite-/";
const APP_ICON = `${APP_ROOT}assets/app-icons/ray-fire-192.png`;
const DEFAULT_OPEN_URL = `${APP_ROOT}`;

const PUSH_DEBUG_CACHE = "ray-push-debug-v1";
const PUSH_DEBUG_PREFIX = `${APP_ROOT}__ray_push_debug__/`;

async function writePushDebug(kind, details = {})
{
    try
    {
        const cache = await caches.open(PUSH_DEBUG_CACHE);
        const stamp = new Date().toISOString();
        const key = `${PUSH_DEBUG_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;

        await cache.put(
            new Request(new URL(key, self.location.origin).href),
            new Response(JSON.stringify({
                stamp,
                kind,
                details
            }), {
                headers: {
                    "content-type": "application/json"
                }
            })
        );

        const keys = await cache.keys();

        if (keys.length > 30)
        {
            for (const request of keys.slice(0, keys.length - 30))
            {
                await cache.delete(request);
            }
        }
    }
    catch (error)
    {
        console.warn("Ray push diagnostic log failed:", error);
    }
}

async function readPushDebug()
{
    const cache = await caches.open(PUSH_DEBUG_CACHE);
    const keys = await cache.keys();
    const entries = [];

    for (const request of keys)
    {
        try
        {
            const response = await cache.match(request);

            if (response)
            {
                entries.push(await response.json());
            }
        }
        catch (error)
        {
            entries.push({
                stamp: new Date().toISOString(),
                kind: "debug-read-error",
                details: {
                    message: String(error?.message || error)
                }
            });
        }
    }

    return entries
        .sort((a, b) => String(a.stamp).localeCompare(String(b.stamp)))
        .slice(-20);
}

async function clearPushDebug()
{
    await caches.delete(PUSH_DEBUG_CACHE);
}

self.addEventListener("install", function ()
{
    self.skipWaiting();
});

self.addEventListener("activate", function (event)
{
    event.waitUntil(self.clients.claim());
});

async function updateAppBadge(count)
{
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));

    try
    {
        if (safeCount > 0 && typeof self.navigator.setAppBadge === "function")
        {
            await self.navigator.setAppBadge(safeCount);
        }
        else if (safeCount === 0 && typeof self.navigator.clearAppBadge === "function")
        {
            await self.navigator.clearAppBadge();
        }
        else if (typeof self.navigator.setAppBadge === "function")
        {
            await self.navigator.setAppBadge(0);
        }
    }
    catch (error)
    {
        console.warn("Ray service worker could not update the app badge:", error);
    }
}

self.addEventListener("push", function (event)
{
    event.waitUntil((async function ()
    {
        let payload = {};
        let payloadMode = "empty";

        try
        {
            if (event.data)
            {
                payload = event.data.json();
                payloadMode = "json";
            }
        }
        catch (error)
        {
            payloadMode = "text-fallback";

            payload = {
                title: "Ray",
                body: event.data ? event.data.text() : "Calendar reminder"
            };
        }

        await writePushDebug("push-event-received", {
            hasData: Boolean(event.data),
            payloadMode
        });

        const title = String(payload.title || "Ray");
        const badgeCount = Math.max(0, Math.floor(Number(payload.badgeCount) || 0));
        const openUrl = String(payload.url || DEFAULT_OPEN_URL);

        const options = {
            body: String(payload.body || "Open Ray to check today’s calendar."),
            icon: APP_ICON,
            tag: String(payload.tag || `ray-hourly-calendar-${Date.now()}`),
            renotify: true,
            data: {
                url: openUrl,
                badgeCount
            }
        };

        try
        {
            await self.registration.showNotification(title, options);

            await writePushDebug("notification-show-success", {
                title,
                body: options.body,
                badgeCount
            });
        }
        catch (error)
        {
            await writePushDebug("notification-show-failure", {
                message: String(error?.message || error)
            });

            throw error;
        }

        try
        {
            await updateAppBadge(badgeCount);

            await writePushDebug("badge-update-finished", {
                badgeCount
            });
        }
        catch (error)
        {
            await writePushDebug("badge-update-failure", {
                message: String(error?.message || error)
            });
        }
    })());
});

self.addEventListener("message", function (event)
{
    const message = event.data || {};

    if (message.type === "RAY_GET_PUSH_DEBUG")
    {
        event.waitUntil((async function ()
        {
            const entries = await readPushDebug();

            if (event.ports && event.ports[0])
            {
                event.ports[0].postMessage({
                    ok: true,
                    entries
                });
            }
        })());

        return;
    }

    if (message.type === "RAY_CLEAR_PUSH_DEBUG")
    {
        event.waitUntil((async function ()
        {
            await clearPushDebug();

            if (event.ports && event.ports[0])
            {
                event.ports[0].postMessage({
                    ok: true
                });
            }
        })());
    }
});

self.addEventListener("notificationclick", function (event)
{
    event.notification.close();

    const requestedUrl = new URL(
        event.notification.data?.url || DEFAULT_OPEN_URL,
        self.location.origin
    ).href;

    event.waitUntil((async function ()
    {
        const clientList = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true
        });

        for (const client of clientList)
        {
            if ("focus" in client)
            {
                if ("navigate" in client && client.url !== requestedUrl)
                {
                    await client.navigate(requestedUrl);
                }

                return client.focus();
            }
        }

        if (self.clients.openWindow)
        {
            return self.clients.openWindow(requestedUrl);
        }

        return undefined;
    })());
});
