import { createClient } from "npm:@supabase/supabase-js@2";
import { sendNotification, WebPushError } from "npm:web-push-neo@0.1.2";

type CalendarNoteRow = {
  note_text: string | null;
};

type OccurrenceRow = {
  rule_id: string | null;
  task_text: string | null;
};

type RuleRow = {
  id: string;
  task_text: string | null;
  repeat_mode: string;
  interval_days: number | null;
  is_active: boolean;
};

type DismissalRow = {
  notification_key: string | null;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  last_badge_count: number | null;
};

const CALENDAR_CODE = Deno.env.get("RAY_CALENDAR_CODE") ?? "bagas-main-calendar-v1";
const TIME_ZONE = Deno.env.get("RAY_TIME_ZONE") ?? "Asia/Shanghai";
const SITE_URL = "https://idkeeee.github.io/Personal-Raysite-/";
const PUSH_TAG = "ray-hourly-calendar";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function getZonedDateParts(date: Date, timeZone: string): {
  dateKey: string;
  year: number;
  month: number;
  day: number;
  hour: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);

  return {
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    year,
    month,
    day,
    hour,
  };
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function ruleOccursOnDate(
  rule: RuleRow,
  year: number,
  month: number,
  day: number,
): boolean {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (rule.repeat_mode === "month-end") {
    return day === daysInMonth;
  }

  if (rule.repeat_mode === "month-start") {
    return day === 1;
  }

  if (rule.repeat_mode === "half-month") {
    return day === 1 || day === 15;
  }

  if (rule.repeat_mode === "custom") {
    const interval = Number(rule.interval_days);
    return Number.isInteger(interval) && interval >= 1 && day > 1 &&
      (day - 1) % interval === 0;
  }

  return false;
}

function countUndismissedNotifications(
  manualRows: CalendarNoteRow[],
  occurrenceRows: OccurrenceRow[],
  activeRules: RuleRow[],
  dismissalRows: DismissalRow[],
  year: number,
  month: number,
  day: number,
): number {
  const notificationKeys: string[] = [];

  for (const row of manualRows) {
    const noteText = String(row.note_text ?? "").trim();

    if (noteText) {
      notificationKeys.push(`manual:${hashString(noteText)}`);
    }
  }

  const recurringKeys = new Map<string, string>();

  for (const row of occurrenceRows) {
    const taskText = String(row.task_text ?? "").trim();

    if (!taskText) {
      continue;
    }

    const mapKey = row.rule_id ? `rule-${row.rule_id}` : `text-${taskText}`;
    const dismissIdentity = row.rule_id ? String(row.rule_id) : hashString(taskText);

    recurringKeys.set(
      mapKey,
      `recurring:${dismissIdentity}:${hashString(taskText)}`,
    );
  }

  for (const rule of activeRules) {
    if (!rule.is_active || !ruleOccursOnDate(rule, year, month, day)) {
      continue;
    }

    const taskText = String(rule.task_text ?? "").trim();

    if (!taskText) {
      continue;
    }

    const mapKey = `rule-${rule.id}`;

    if (!recurringKeys.has(mapKey)) {
      recurringKeys.set(
        mapKey,
        `recurring:${rule.id}:${hashString(taskText)}`,
      );
    }
  }

  notificationKeys.push(...recurringKeys.values());

  const dismissedKeys = new Set(
    dismissalRows
      .map((row) => String(row.notification_key ?? ""))
      .filter(Boolean),
  );

  return notificationKeys.filter((key) => !dismissedKeys.has(key)).length;
}

function calendarUrl(dateKey: string): string {
  return `${SITE_URL}html/cards/calender.html?date=${encodeURIComponent(dateKey)}`;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Use POST." }, 405);
  }

  const expectedCronSecret = Deno.env.get("RAY_PUSH_CRON_SECRET") ?? "";
  const suppliedCronSecret = request.headers.get("x-ray-cron-secret") ?? "";

  if (
    !expectedCronSecret ||
    !suppliedCronSecret ||
    !constantTimeEqual(expectedCronSecret, suppliedCronSecret)
  ) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? SITE_URL;

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !vapidPublicKey ||
    !vapidPrivateKey
  ) {
    return jsonResponse({
      error: "Missing Edge Function secrets.",
      required: [
        "VAPID_PUBLIC_KEY",
        "VAPID_PRIVATE_KEY",
        "VAPID_SUBJECT",
        "RAY_PUSH_CRON_SECRET",
      ],
    }, 500);
  }

  let requestBody: Record<string, unknown> = {};

  try {
    requestBody = await request.json();
  } catch {
    requestBody = {};
  }

  const isTest = requestBody.test === true;
  const now = new Date();
  const zoned = getZonedDateParts(now, TIME_ZONE);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const [
    manualResult,
    occurrenceResult,
    rulesResult,
    dismissalResult,
    subscriptionsResult,
  ] = await Promise.all([
    supabase
      .from("calendar_notes_shared")
      .select("note_text")
      .eq("calendar_code", CALENDAR_CODE)
      .eq("note_date", zoned.dateKey),
    supabase
      .from("calendar_recurring_occurrences_shared")
      .select("rule_id, task_text")
      .eq("calendar_code", CALENDAR_CODE)
      .eq("occurrence_date", zoned.dateKey),
    supabase
      .from("calendar_recurring_rules_shared")
      .select("id, task_text, repeat_mode, interval_days, is_active")
      .eq("calendar_code", CALENDAR_CODE)
      .eq("is_active", true),
    supabase
      .from("calendar_notification_dismissals_shared")
      .select("notification_key")
      .eq("calendar_code", CALENDAR_CODE)
      .eq("notification_date", zoned.dateKey),
    supabase
      .from("calendar_push_subscriptions_shared")
      .select("id, endpoint, p256dh, auth, last_badge_count")
      .eq("calendar_code", CALENDAR_CODE)
      .eq("enabled", true),
  ]);

  const queryErrors = [
    manualResult.error,
    occurrenceResult.error,
    rulesResult.error,
    dismissalResult.error,
    subscriptionsResult.error,
  ].filter(Boolean);

  if (queryErrors.length > 0) {
    return jsonResponse({
      error: "One or more Supabase queries failed.",
      details: queryErrors.map((error) => error?.message ?? String(error)),
    }, 500);
  }

  const subscriptions =
    (subscriptionsResult.data ?? []) as PushSubscriptionRow[];

  if (subscriptions.length === 0) {
    return jsonResponse({
      ok: true,
      date: zoned.dateKey,
      timeZone: TIME_ZONE,
      notificationCount: 0,
      subscriptions: 0,
      sent: 0,
      skipped: 0,
      message: "No enabled push subscriptions yet.",
    });
  }

  const notificationCount = countUndismissedNotifications(
    (manualResult.data ?? []) as CalendarNoteRow[],
    (occurrenceResult.data ?? []) as OccurrenceRow[],
    (rulesResult.data ?? []) as RuleRow[],
    (dismissalResult.data ?? []) as DismissalRow[],
    zoned.year,
    zoned.month,
    zoned.day,
  );

  let sent = 0;
  let skipped = 0;
  let disabled = 0;
  const failures: Array<{ id: string; statusCode?: number; message: string }> = [];

  for (const subscription of subscriptions) {
    const previousCount = Math.max(
      0,
      Number(subscription.last_badge_count) || 0,
    );

    const shouldSend = isTest || notificationCount > 0 || previousCount > 0;

    if (!shouldSend) {
      skipped += 1;
      continue;
    }

    const body = isTest
      ? `Push test passed. ${notificationCount} calendar task${notificationCount === 1 ? "" : "s"} currently remain today.`
      : notificationCount > 0
      ? `You have ${notificationCount} calendar task${notificationCount === 1 ? "" : "s"} remaining today.`
      : "All clear. No calendar tasks remain today.";

    const payload = JSON.stringify({
      title: isTest ? "Ray push test" : "Ray",
      body,
      badgeCount: notificationCount,
      tag: PUSH_TAG,
      url: calendarUrl(zoned.dateKey),
      date: zoned.dateKey,
      timeZone: TIME_ZONE,
    });

    try {
      await sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        payload,
        {
          vapidDetails: {
            subject: vapidSubject,
            publicKey: vapidPublicKey,
            privateKey: vapidPrivateKey,
          },
          TTL: 3700,
          urgency: "high",
          topic: PUSH_TAG,
          signal: AbortSignal.timeout(25000),
        },
      );

      sent += 1;

      await supabase
        .from("calendar_push_subscriptions_shared")
        .update({
          last_badge_count: notificationCount,
          last_sent_at: now.toISOString(),
          last_error: null,
          failure_count: 0,
          updated_at: now.toISOString(),
        })
        .eq("id", subscription.id);
    } catch (error) {
      const pushError = error as WebPushError | Error;
      const statusCode = error instanceof WebPushError
        ? error.statusCode
        : undefined;
      const message = String(
        error instanceof WebPushError
          ? error.body || error.message
          : pushError.message || "Unknown push failure",
      ).slice(0, 500);

      failures.push({
        id: subscription.id,
        statusCode,
        message,
      });

      if (statusCode === 404 || statusCode === 410) {
        disabled += 1;

        await supabase
          .from("calendar_push_subscriptions_shared")
          .update({
            enabled: false,
            last_error: `Push endpoint expired (${statusCode}).`,
            failure_count: 0,
            updated_at: now.toISOString(),
          })
          .eq("id", subscription.id);
      } else {
        await supabase.rpc("increment_calendar_push_failure", {
          p_subscription_id: subscription.id,
          p_error: message,
        });
      }
    }
  }

  return jsonResponse({
    ok: failures.length === 0,
    test: isTest,
    date: zoned.dateKey,
    localHour: zoned.hour,
    timeZone: TIME_ZONE,
    notificationCount,
    subscriptions: subscriptions.length,
    sent,
    skipped,
    disabled,
    failures,
  }, failures.length === 0 ? 200 : 207);
});
