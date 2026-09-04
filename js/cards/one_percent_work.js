const SB_URL = window.SUPABASE_URL ?? "https://ntlsmrzpatcultvsrpll.supabase.co";
const SB_ANON = window.SUPABASE_ANON ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bHNtcnpwYXRjdWx0dnNycGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDY0MDUsImV4cCI6MjA3NDAyMjQwNX0.5sggDXSK-ytAJqNpxfDAW2FI67Z2X3UADJjk0Rt_25g";
const supabaseClient = window.supabase.createClient(SB_URL, SB_ANON);

const WORKSPACE_CODE = "bagas-main-one-percent-v1";
const SETTINGS_TABLE = "one_percent_settings_shared";
const TODO_SLUGS = ["todo-daily", "todo-super", "todo-short", "todo-long", "todo-school"];

const SOURCE_LABELS = {
  "todo-daily": "Daily",
  "todo-super": "Super-short-term",
  "todo-short": "Short-term",
  "todo-long": "Long-term",
  "todo-school": "School-related"
};

const state = {
  lists: new Map(),
  versions: new Map(),
  saveTimers: new Map(),
  settings: null
};

const els = {
  doneButton: document.getElementById("onePercentDoneButton"),
  doneLabel: document.getElementById("onePercentDoneLabel"),
  doneHint: document.getElementById("onePercentDoneHint"),
  reminderForm: document.getElementById("onePercentReminderForm"),
  reminderEnabled: document.getElementById("onePercentReminderEnabled"),
  reminderStart: document.getElementById("onePercentReminderStart"),
  reminderEnd: document.getElementById("onePercentReminderEnd"),
  reminderSave: document.getElementById("onePercentReminderSave"),
  reminderStatus: document.getElementById("onePercentReminderStatus"),
  list: document.getElementById("onePercentTaskList"),
  empty: document.getElementById("onePercentEmpty"),
  pageStatus: document.getElementById("onePercentPageStatus")
};

function shanghaiDateKey(date = new Date())
{
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function getRowsFromData(data)
{
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function activeTasks()
{
  const tasks = [];

  for (const slug of TODO_SLUGS)
  {
    const rows = state.lists.get(slug) ?? [];

    for (const row of rows)
    {
      if (row?.one_percent !== true) continue;

      const text = String(row.text || "").trim();
      if (!text) continue;

      tasks.push({ slug, row, text });
    }
  }

  return tasks;
}

function renderDoneState()
{
  const done = state.settings?.finished_on === shanghaiDateKey();

  els.doneButton.classList.toggle("is-finished", done);
  els.doneLabel.textContent = done ? "FINISHED ✓" : "UNFINISHED";
  els.doneHint.textContent = done
    ? "Today's 1% is done. Tomorrow resets automatically."
    : "Tap when you've done enough for today";

  els.doneButton.setAttribute(
    "aria-label",
    done ? "Mark today's 1 percent as unfinished" : "Mark today's 1 percent as finished"
  );
}

function renderReminderSettings()
{
  const settings = state.settings ?? {};

  els.reminderEnabled.checked = settings.reminders_enabled !== false;
  els.reminderStart.value = String(settings.reminder_start || "09:00").slice(0, 5);
  els.reminderEnd.value = String(settings.reminder_end || "22:00").slice(0, 5);

  els.reminderStatus.textContent = els.reminderEnabled.checked
    ? `Hourly nags allowed from ${els.reminderStart.value} to ${els.reminderEnd.value}.`
    : "1% hourly reminders are off.";

  els.reminderStatus.className = "one-percent-reminder-status";
}

function renderTasks()
{
  els.list.innerHTML = "";
  const tasks = activeTasks();
  els.empty.hidden = tasks.length !== 0;

  for (const task of tasks)
  {
    const card = document.createElement("article");
    card.className = "one-percent-task";

    const main = document.createElement("div");
    main.className = "one-percent-task-main";

    const copy = document.createElement("div");

    const title = document.createElement("h3");
    title.className = "one-percent-task-title";
    title.textContent = task.text;

    const source = document.createElement("p");
    source.className = "one-percent-task-source";
    source.textContent = `From To-Do List · ${SOURCE_LABELS[task.slug] || task.slug}`;

    copy.append(title, source);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "one-percent-notes-toggle";
    toggle.textContent = "Notes ▸";

    const notes = document.createElement("div");
    notes.className = "one-percent-task-notes";

    const label = document.createElement("label");
    label.textContent = "Extra notes";

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Progress notes, next tiny step, whatever helps tomorrow-you...";
    textarea.value = String(task.row.one_percent_notes || "");

    const saved = document.createElement("span");
    saved.className = "one-percent-task-save-state";
    saved.textContent = "Saved with the original To-Do task.";

    textarea.addEventListener("input", function ()
    {
      task.row.one_percent_notes = textarea.value;
      saved.textContent = "Saving...";
      scheduleListSave(task.slug, saved);
    });

    toggle.addEventListener("click", function ()
    {
      const open = card.classList.toggle("is-open");
      toggle.textContent = open ? "Notes ▾" : "Notes ▸";

      if (open)
      {
        window.setTimeout(() => textarea.focus(), 0);
      }
    });

    notes.append(label, textarea, saved);
    main.append(copy, toggle);
    card.append(main, notes);
    els.list.appendChild(card);
  }
}

async function saveList(slug, savedIndicator = null)
{
  const rows = state.lists.get(slug) ?? [];
  const version = Date.now();
  state.versions.set(slug, version);

  const { error } = await supabaseClient
    .from("todo_lists")
    .upsert(
      { slug, data: rows, version, updated_at: new Date().toISOString() },
      { onConflict: "slug" }
    );

  if (savedIndicator)
  {
    savedIndicator.textContent = error ? "Could not save notes." : "Saved.";
  }

  if (error) throw error;
}

function scheduleListSave(slug, savedIndicator)
{
  const oldTimer = state.saveTimers.get(slug);
  if (oldTimer) clearTimeout(oldTimer);

  state.saveTimers.set(
    slug,
    window.setTimeout(async function ()
    {
      try
      {
        await saveList(slug, savedIndicator);
      }
      catch (error)
      {
        console.error("1% notes save failed:", error);
        savedIndicator.textContent = "Save failed.";
      }
    }, 450)
  );
}

async function loadTodoLists()
{
  const { data, error } = await supabaseClient
    .from("todo_lists")
    .select("slug, data, version")
    .in("slug", TODO_SLUGS);

  if (error) throw error;

  const bySlug = new Map((data ?? []).map(row => [row.slug, row]));

  for (const slug of TODO_SLUGS)
  {
    const remote = bySlug.get(slug);
    state.lists.set(slug, getRowsFromData(remote?.data));
    state.versions.set(slug, Number(remote?.version) || 0);
  }
}

async function loadSettings()
{
  const { data, error } = await supabaseClient
    .from(SETTINGS_TABLE)
    .select("finished_on, reminders_enabled, reminder_start, reminder_end, timezone")
    .eq("workspace_code", WORKSPACE_CODE)
    .limit(1);

  if (error) throw error;

  state.settings = data?.[0] ?? {
    finished_on: null,
    reminders_enabled: true,
    reminder_start: "09:00",
    reminder_end: "22:00",
    timezone: "Asia/Shanghai"
  };
}

async function loadEverything()
{
  els.pageStatus.textContent = "Syncing 1% Work...";
  els.pageStatus.className = "one-percent-page-status";

  try
  {
    await Promise.all([loadTodoLists(), loadSettings()]);
    renderDoneState();
    renderReminderSettings();
    renderTasks();

    const count = activeTasks().length;
    els.pageStatus.textContent = `${count} project${count === 1 ? "" : "s"} linked from To-Do List.`;
  }
  catch (error)
  {
    console.error("1% Work sync failed:", error);
    els.pageStatus.textContent = `1% Work couldn't sync: ${error.message || error}`;
    els.pageStatus.className = "one-percent-page-status is-error";
  }
}

els.doneButton.addEventListener("click", async function ()
{
  const currentlyDone = state.settings?.finished_on === shanghaiDateKey();
  els.doneButton.disabled = true;

  try
  {
    const { error } = await supabaseClient.rpc("set_one_percent_today_finished", {
      p_workspace_code: WORKSPACE_CODE,
      p_finished: !currentlyDone,
      p_today: shanghaiDateKey()
    });

    if (error) throw error;

    state.settings.finished_on = currentlyDone ? null : shanghaiDateKey();
    renderDoneState();

    els.pageStatus.textContent = currentlyDone
      ? "Today's 1% is unfinished again."
      : "Done for today. Tiny brick successfully laid.";
    els.pageStatus.className = "one-percent-page-status is-success";

    if (typeof window.refreshCalendarNotifications === "function")
    {
      void window.refreshCalendarNotifications({ silent: true });
    }
  }
  catch (error)
  {
    console.error("1% status update failed:", error);
    els.pageStatus.textContent = `Could not update today's 1%: ${error.message || error}`;
    els.pageStatus.className = "one-percent-page-status is-error";
  }
  finally
  {
    els.doneButton.disabled = false;
  }
});

els.reminderForm.addEventListener("submit", async function (event)
{
  event.preventDefault();

  const start = String(els.reminderStart.value || "");
  const end = String(els.reminderEnd.value || "");

  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end))
  {
    els.reminderStatus.textContent = "Pick valid start and end times.";
    els.reminderStatus.className = "one-percent-reminder-status is-error";
    return;
  }

  if (start === end)
  {
    els.reminderStatus.textContent = "Start and end time need to be different.";
    els.reminderStatus.className = "one-percent-reminder-status is-error";
    return;
  }

  const oldText = els.reminderSave.textContent;
  els.reminderSave.disabled = true;
  els.reminderSave.textContent = "Saving...";
  els.reminderStatus.textContent = "Saving reminder window...";
  els.reminderStatus.className = "one-percent-reminder-status";

  try
  {
    const { error } = await supabaseClient.rpc("save_one_percent_settings", {
      p_workspace_code: WORKSPACE_CODE,
      p_reminders_enabled: els.reminderEnabled.checked,
      p_reminder_start: `${start}:00`,
      p_reminder_end: `${end}:00`,
      p_timezone: "Asia/Shanghai"
    });

    if (error) throw error;

    state.settings.reminders_enabled = els.reminderEnabled.checked;
    state.settings.reminder_start = start;
    state.settings.reminder_end = end;
    renderReminderSettings();

    els.reminderStatus.textContent = els.reminderEnabled.checked
      ? `Saved. Hourly reminders can fire from ${start} to ${end}.`
      : "Saved. 1% hourly reminders are off.";
    els.reminderStatus.className = "one-percent-reminder-status is-success";

    if (typeof window.refreshCalendarNotifications === "function")
    {
      void window.refreshCalendarNotifications({ silent: true });
    }
  }
  catch (error)
  {
    console.error("1% reminder settings save failed:", error);
    els.reminderStatus.textContent = `Could not save reminder window: ${error.message || error}`;
    els.reminderStatus.className = "one-percent-reminder-status is-error";
  }
  finally
  {
    els.reminderSave.disabled = false;
    els.reminderSave.textContent = oldText;
  }
});

function subscribeRealtime()
{
  const todoChannel = supabaseClient
    .channel("one-percent-todo-links")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "todo_lists" },
      function (payload)
      {
        const row = payload.new || payload.old;
        if (!row || !TODO_SLUGS.includes(row.slug)) return;

        const version = Number(row.version) || 0;
        if (version && version <= (state.versions.get(row.slug) || 0)) return;

        state.lists.set(row.slug, getRowsFromData(row.data));
        state.versions.set(row.slug, version);
        renderTasks();
      }
    )
    .subscribe();

  const settingsChannel = supabaseClient
    .channel("one-percent-settings")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: SETTINGS_TABLE,
        filter: `workspace_code=eq.${WORKSPACE_CODE}`
      },
      function (payload)
      {
        if (!payload.new) return;
        state.settings = payload.new;
        renderDoneState();
        renderReminderSettings();
      }
    )
    .subscribe();

  window.addEventListener("beforeunload", function ()
  {
    supabaseClient.removeChannel(todoChannel);
    supabaseClient.removeChannel(settingsChannel);
  });
}

document.addEventListener("DOMContentLoaded", async function ()
{
  await loadEverything();
  subscribeRealtime();

  window.addEventListener("focus", function ()
  {
    void loadEverything();
  });

  document.addEventListener("visibilitychange", function ()
  {
    if (!document.hidden)
    {
      void loadEverything();
    }
  });

  window.setInterval(renderDoneState, 60 * 1000);
});
