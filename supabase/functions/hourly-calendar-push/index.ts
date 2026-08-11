import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

type MoneyDailyRow = {
  submitted: boolean | null;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  last_badge_count: number | null;
};

type PushFailure = {
  id: string;
  kind: string;
  statusCode?: number;
  message: string;
};

type PushDelivery = {
  id: string;
  kind: string;
  statusCode?: number;
  apnsId?: string;
};

const CALENDAR_CODE = Deno.env.get("RAY_CALENDAR_CODE") ?? "bagas-main-calendar-v1";
const MONEY_TRACKER_CODE = "bagas-main-money-v1";
const TIME_ZONE = Deno.env.get("RAY_TIME_ZONE") ?? "Asia/Shanghai";
const SITE_URL = "https://idkeeee.github.io/Personal-Raysite-/";
const CALENDAR_PUSH_TAG = "ray-hourly-calendar";
const MONEY_1100_TAG = "ray-money-1100";
const MONEY_1130_TAG = "ray-money-1130";

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
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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
  const minute = Number(values.minute);

  return {
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    year,
    month,
    day,
    hour,
    minute,
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

  if (rule.repeat_mode === "month-end") return day === daysInMonth;
  if (rule.repeat_mode === "month-start") return day === 1;
  if (rule.repeat_mode === "half-month") return day === 1 || day === 15;

  if (rule.repeat_mode === "custom") {
    const interval = Number(rule.interval_days);
    return Number.isInteger(interval) && interval >= 1 && day > 1 &&
      (day - 1) % interval === 0;
  }

  return false;
}

function countUndismissedCalendarNotifications(
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
    if (noteText) notificationKeys.push(`manual:${hashString(noteText)}`);
  }

  const recurringKeys = new Map<string, string>();

  for (const row of occurrenceRows) {
    const taskText = String(row.task_text ?? "").trim();
    if (!taskText) continue;

    const mapKey = row.rule_id ? `rule-${row.rule_id}` : `text-${taskText}`;
    const dismissIdentity = row.rule_id ? String(row.rule_id) : hashString(taskText);

    recurringKeys.set(
      mapKey,
      `recurring:${dismissIdentity}:${hashString(taskText)}`,
    );
  }

  for (const rule of activeRules) {
    if (!rule.is_active || !ruleOccursOnDate(rule, year, month, day)) continue;

    const taskText = String(rule.task_text ?? "").trim();
    if (!taskText) continue;

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

function moneyUrl(): string {
  return `${SITE_URL}html/cards/money_tracker.html`;
}

function makePayload(
  title: string,
  body: string,
  badgeCount: number,
  tag: string,
  url: string,
  dateKey: string,
): string {
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title,
      body,
      navigate: url,
      tag,
      silent: false,
      app_badge: String(Math.max(0, badgeCount)),
    },

    // Legacy fields for Ray's service-worker fallback.
    title,
    body,
    badgeCount: Math.max(0, badgeCount),
    tag,
    url,
    date: dateKey,
    timeZone: TIME_ZONE,
  });
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

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
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
  const isEmptyPayloadTest = requestBody.emptyTest === true;
  const forcedMoneyTest = requestBody.moneyTest === "11:00" || requestBody.moneyTest === "11:30"
    ? String(requestBody.moneyTest)
    : "";
  const scheduledMoneySlot = requestBody.money_reminder_slot === "11:30" ? "11:30" : "";

  const now = new Date();
  const zoned = getZonedDateParts(now, TIME_ZONE);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  // This creates today's tiny budget-snapshot row and compacts old months.
  const moneyPrepareResult = await supabase.rpc("money_prepare_tracker", {
    p_tracker_code: MONEY_TRACKER_CODE,
    p_today: zoned.dateKey,
  });
  const moneyStoreAvailable = !moneyPrepareResult.error;

  const [
    manualResult,
    occurrenceResult,
    rulesResult,
    dismissalResult,
    subscriptionsResult,
    moneyResult,
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
    moneyStoreAvailable
      ? supabase
        .from("money_daily_records_shared")
        .select("submitted")
        .eq("tracker_code", MONEY_TRACKER_CODE)
        .eq("record_date", zoned.dateKey)
        .limit(1)
      : Promise.resolve({ data: [], error: moneyPrepareResult.error }),
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
      error: "One or more core Supabase queries failed.",
      details: queryErrors.map((error) => error?.message ?? String(error)),
      moneyWarning: moneyPrepareResult.error?.message ?? moneyResult.error?.message ?? null,
    }, 500);
  }

  const subscriptions = (subscriptionsResult.data ?? []) as PushSubscriptionRow[];

  const calendarCount = countUndismissedCalendarNotifications(
    (manualResult.data ?? []) as CalendarNoteRow[],
    (occurrenceResult.data ?? []) as OccurrenceRow[],
    (rulesResult.data ?? []) as RuleRow[],
    (dismissalResult.data ?? []) as DismissalRow[],
    zoned.year,
    zoned.month,
    zoned.day,
  );

  const moneyRow = ((moneyResult.data ?? []) as MoneyDailyRow[])[0] ?? null;
  const moneySubmitted = Boolean(moneyRow?.submitted);
  const moneyMissing = moneyStoreAvailable && !moneyResult.error && !moneySubmitted;
  const moneyBadgeDue = moneyMissing && zoned.hour >= 11;
  const badgeCount = calendarCount + (moneyBadgeDue ? 1 : 0);

  let moneyReminderSlot = "";

  if (forcedMoneyTest) {
    moneyReminderSlot = forcedMoneyTest;
  } else if (!isTest && !isEmptyPayloadTest && scheduledMoneySlot) {
    moneyReminderSlot = scheduledMoneySlot;
  } else if (
    !isTest &&
    !isEmptyPayloadTest &&
    zoned.hour === 11 &&
    zoned.minute < 30
  ) {
    // The existing top-of-hour cron becomes the first 11:00 Money Tracker check.
    moneyReminderSlot = "11:00";
  }

  const moneyReminderDue = Boolean(forcedMoneyTest) || (moneyMissing && Boolean(moneyReminderSlot));

  if (subscriptions.length === 0) {
    return jsonResponse({
      ok: true,
      test: isTest,
      emptyTest: isEmptyPayloadTest,
      moneyTest: forcedMoneyTest || null,
      date: zoned.dateKey,
      localHour: zoned.hour,
      localMinute: zoned.minute,
      timeZone: TIME_ZONE,
      calendarCount,
      moneySubmitted,
      moneyReminderSlot: moneyReminderSlot || null,
      badgeCount,
      subscriptions: 0,
      sent: 0,
      skipped: 0,
      message: "No enabled push subscriptions yet.",
      moneyWarning: moneyPrepareResult.error?.message ?? moneyResult.error?.message ?? null,
    });
  }

  let sent = 0;
  let skipped = 0;
  let disabled = 0;
  const failures: PushFailure[] = [];
  const deliveries: PushDelivery[] = [];

  async function sendOne(
    subscription: PushSubscriptionRow,
    kind: string,
    payload: string | null,
    topic: string,
  ): Promise<boolean> {
    try {
      const pushResult = await webpush.sendNotification(
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
          topic,
          ...(payload === null ? {} : { contentEncoding: "aes128gcm" }),
        },
      );

      sent += 1;
      deliveries.push({
        id: subscription.id,
        kind,
        statusCode: Number(pushResult?.statusCode) || undefined,
        apnsId: String(pushResult?.headers?.["apns-id"] || "") || undefined,
      });

      return true;
    } catch (error) {
      const pushError = error as {
        statusCode?: number;
        body?: string;
        message?: string;
      };
      const statusCode = Number(pushError?.statusCode) || undefined;
      const message = String(
        pushError?.body || pushError?.message || "Unknown push failure",
      ).slice(0, 500);

      failures.push({
        id: subscription.id,
        kind,
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
          p_error: `${kind}: ${message}`,
        });
      }

      return false;
    }
  }

  for (const subscription of subscriptions) {
    const previousCount = Math.max(0, Number(subscription.last_badge_count) || 0);
    let sentForSubscription = false;

    if (isEmptyPayloadTest) {
      sentForSubscription = await sendOne(
        subscription,
        "empty-test",
        null,
        "ray-empty-test",
      ) || sentForSubscription;
    } else if (isTest) {
      const body = `Push test passed. ${calendarCount} calendar task${calendarCount === 1 ? "" : "s"} currently remain today.`;
      sentForSubscription = await sendOne(
        subscription,
        "calendar-test",
        makePayload(
          "Ray push test",
          body,
          badgeCount,
          "ray-push-test",
          calendarUrl(zoned.dateKey),
          zoned.dateKey,
        ),
        "ray-push-test",
      ) || sentForSubscription;
    } else {
      if (moneyReminderDue) {
        const isSecondNag = moneyReminderSlot === "11:30";
        const moneyBody = isSecondNag
          ? "DUDE, FILL YOUR DAILY SPENDING PENDEJO"
          : "ay yo, you havent filled ur spendings record yet";
        const moneyTag = isSecondNag ? MONEY_1130_TAG : MONEY_1100_TAG;

        sentForSubscription = await sendOne(
          subscription,
          `money-${moneyReminderSlot || "test"}`,
          makePayload(
            "Ray · Money Tracker",
            moneyBody,
            Math.max(1, badgeCount),
            moneyTag,
            moneyUrl(),
            zoned.dateKey,
          ),
          moneyTag,
        ) || sentForSubscription;
      }

      const calendarPushDue = calendarCount > 0;
      const allClearDue = calendarCount === 0 && !moneyBadgeDue && previousCount > 0;

      if (calendarPushDue || allClearDue) {
        const body = calendarPushDue
          ? moneyBadgeDue
            ? `You have ${calendarCount} calendar task${calendarCount === 1 ? "" : "s"} remaining, and today's spending record is still unfilled.`
            : `You have ${calendarCount} calendar task${calendarCount === 1 ? "" : "s"} remaining today.`
          : "All clear. No Ray notifications remain today.";

        sentForSubscription = await sendOne(
          subscription,
          calendarPushDue ? "calendar-hourly" : "all-clear",
          makePayload(
            "Ray",
            body,
            badgeCount,
            CALENDAR_PUSH_TAG,
            calendarUrl(zoned.dateKey),
            zoned.dateKey,
          ),
          CALENDAR_PUSH_TAG,
        ) || sentForSubscription;
      }
    }

    if (!sentForSubscription) {
      skipped += 1;
      continue;
    }

    if (!failures.some((failure) => failure.id === subscription.id)) {
      await supabase
        .from("calendar_push_subscriptions_shared")
        .update({
          last_badge_count: badgeCount,
          last_sent_at: now.toISOString(),
          last_error: null,
          failure_count: 0,
          updated_at: now.toISOString(),
        })
        .eq("id", subscription.id);
    }
  }

  return jsonResponse({
    ok: failures.length === 0,
    test: isTest,
    emptyTest: isEmptyPayloadTest,
    moneyTest: forcedMoneyTest || null,
    date: zoned.dateKey,
    localHour: zoned.hour,
    localMinute: zoned.minute,
    timeZone: TIME_ZONE,
    calendarCount,
    moneySubmitted,
    moneyMissing,
    moneyReminderSlot: moneyReminderSlot || null,
    badgeCount,
    subscriptions: subscriptions.length,
    sent,
    skipped,
    disabled,
    deliveries,
    failures,
    moneyWarning: moneyPrepareResult.error?.message ?? moneyResult.error?.message ?? null,
  }, failures.length === 0 ? 200 : 207);
});
