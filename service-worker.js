"use strict";

/*
  Lightweight service worker for the installed Ray home-screen web app.
  It deliberately does not cache the whole site, so GitHub Pages updates
  keep arriving normally. It also gives the app a worker foundation for
  future Web Push notifications.
*/
self.addEventListener("install", function ()
{
    self.skipWaiting();
});

self.addEventListener("activate", function (event)
{
    event.waitUntil(self.clients.claim());
});
