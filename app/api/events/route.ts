import { env } from "cloudflare:workers";
import type { ScheduleDraft, ScheduleItem } from "@/lib/schedule";

const SELECT_COLUMNS = `
  id, title, source_text AS sourceText, schedule_date AS scheduleDate,
  start_at AS startAt, end_at AS endAt, due_at AS dueAt,
  duration_minutes AS durationMinutes, category, schedule_type AS scheduleType,
  status, created_at AS createdAt, updated_at AS updatedAt,
  completed_at AS completedAt
`;

let schemaReady: Promise<unknown> | null = null;

function ensureSchema() {
  schemaReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_text TEXT NOT NULL DEFAULT '',
      schedule_date TEXT NOT NULL,
      start_at TEXT,
      end_at TEXT,
      due_at TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      category TEXT NOT NULL DEFAULT 'general',
      schedule_type TEXT NOT NULL DEFAULT 'flexible',
      status TEXT NOT NULL DEFAULT 'planned',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )`),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS schedules_user_day_status_idx ON schedules (user_id, schedule_date, status)",
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS schedules_user_start_idx ON schedules (user_id, start_at)",
    ),
  ]).catch((error: unknown) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function userIdFrom(request: Request) {
  const userId = request.headers.get("oai-authenticated-user-id");
  if (userId) return userId;
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local-demo-user";
  return null;
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function authError() {
  return Response.json(
    { error: "로그인이 필요합니다.", signIn: "/signin-with-chatgpt?return_to=%2F" },
    { status: 401 },
  );
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "일정을 처리하지 못했습니다.";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET(request: Request) {
  const userId = userIdFrom(request);
  if (!userId) return authError();
  try {
    await ensureSchema();
    const searchParams = new URL(request.url).searchParams;
    const date = searchParams.get("date");
    if (isDateKey(date)) {
      const result = await env.DB.prepare(
        `SELECT ${SELECT_COLUMNS} FROM schedules
         WHERE user_id = ? AND schedule_date = ?
         ORDER BY status ASC, CASE WHEN start_at IS NULL THEN 1 ELSE 0 END,
                  start_at ASC, created_at ASC`,
      )
        .bind(userId, date)
        .all<ScheduleItem>();
      return Response.json({ items: result.results ?? [] });
    }

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!isDateKey(from) || !isDateKey(to) || from > to) {
      return Response.json({ error: "올바른 날짜 범위가 필요합니다." }, { status: 400 });
    }

    const maximumTo = new Date(`${from}T00:00:00Z`);
    maximumTo.setUTCDate(maximumTo.getUTCDate() + 366);
    if (to > maximumTo.toISOString().slice(0, 10)) {
      return Response.json({ error: "조회 기간은 1년 이내여야 합니다." }, { status: 400 });
    }

    const result = await env.DB.prepare(
      `SELECT ${SELECT_COLUMNS} FROM schedules
       WHERE user_id = ? AND schedule_date BETWEEN ? AND ?
       ORDER BY schedule_date ASC, status ASC,
                CASE WHEN start_at IS NULL THEN 1 ELSE 0 END,
                start_at ASC, created_at ASC`,
    )
      .bind(userId, from, to)
      .all<ScheduleItem>();
    return Response.json({ items: result.results ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const userId = userIdFrom(request);
  if (!userId) return authError();
  try {
    await ensureSchema();
    const payload = (await request.json()) as Partial<ScheduleDraft>;
    const title = payload.title?.trim().slice(0, 120) ?? "";
    const sourceText = payload.sourceText?.trim().slice(0, 300) ?? title;
    if (!title || !isDateKey(payload.scheduleDate)) {
      return Response.json({ error: "제목과 날짜가 필요합니다." }, { status: 400 });
    }
    if (
      !isIsoOrNull(payload.startAt) ||
      !isIsoOrNull(payload.endAt) ||
      !isIsoOrNull(payload.dueAt)
    ) {
      return Response.json({ error: "시간 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const duration = Math.max(10, Math.min(480, Number(payload.durationMinutes) || 30));
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const duplicate = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM schedules
       WHERE user_id = ? AND schedule_date = ?
       AND lower(trim(title)) = lower(trim(?))
       AND COALESCE(start_at, '') = COALESCE(?, '')`,
    )
      .bind(userId, payload.scheduleDate, title, payload.startAt)
      .first<{ count: number }>();

    await env.DB.prepare(
      `INSERT INTO schedules (
        id, user_id, title, source_text, schedule_date, start_at, end_at,
        due_at, duration_minutes, category, schedule_type, status,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, NULL)`,
    )
      .bind(
        id,
        userId,
        title,
        sourceText,
        payload.scheduleDate,
        payload.startAt,
        payload.endAt,
        payload.dueAt,
        duration,
        payload.category ?? "general",
        payload.scheduleType ?? "flexible",
        now,
        now,
      )
      .run();

    const item = await env.DB.prepare(
      `SELECT ${SELECT_COLUMNS} FROM schedules WHERE id = ? AND user_id = ?`,
    )
      .bind(id, userId)
      .first<ScheduleItem>();
    return Response.json(
      { item, duplicateCount: Number(duplicate?.count ?? 0) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const userId = userIdFrom(request);
  if (!userId) return authError();
  try {
    await ensureSchema();
    const payload = (await request.json()) as {
      id?: string;
      action?: "complete" | "restore" | "delay30" | "tomorrow";
    };
    if (!payload.id || !payload.action) {
      return Response.json({ error: "일정과 변경 방식이 필요합니다." }, { status: 400 });
    }
    const current = await env.DB.prepare(
      `SELECT ${SELECT_COLUMNS} FROM schedules WHERE id = ? AND user_id = ?`,
    )
      .bind(payload.id, userId)
      .first<ScheduleItem>();
    if (!current) return Response.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });

    const now = new Date();
    let status = current.status;
    let completedAt = current.completedAt;
    let startAt = current.startAt;
    let endAt = current.endAt;
    let dueAt = current.dueAt;
    let scheduleDate = current.scheduleDate;

    if (payload.action === "complete") {
      status = "completed";
      completedAt = now.toISOString();
    } else if (payload.action === "restore") {
      status = "planned";
      completedAt = null;
    } else if (payload.action === "delay30") {
      const base = startAt
        ? new Date(startAt)
        : new Date(Math.ceil(now.getTime() / 1800000) * 1800000);
      if (startAt) base.setMinutes(base.getMinutes() + 30);
      const originalLength =
        startAt && endAt
          ? Math.max(10, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000)
          : current.durationMinutes;
      const end = new Date(base.getTime() + originalLength * 60000);
      startAt = base.toISOString();
      endAt = end.toISOString();
      scheduleDate = localDateFromDate(base);
    } else if (payload.action === "tomorrow") {
      const [year, month, day] = scheduleDate.split("-").map(Number);
      scheduleDate = new Date(Date.UTC(year, month - 1, day + 1))
        .toISOString()
        .slice(0, 10);
      const shift = (value: string | null) => {
        if (!value) return null;
        const shifted = new Date(value);
        shifted.setDate(shifted.getDate() + 1);
        return shifted.toISOString();
      };
      startAt = shift(startAt);
      endAt = shift(endAt);
      dueAt = shift(dueAt);
    }

    await env.DB.prepare(
      `UPDATE schedules SET status = ?, completed_at = ?, start_at = ?, end_at = ?,
       due_at = ?, schedule_date = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
      .bind(
        status,
        completedAt,
        startAt,
        endAt,
        dueAt,
        scheduleDate,
        now.toISOString(),
        current.id,
        userId,
      )
      .run();

    const item = await env.DB.prepare(
      `SELECT ${SELECT_COLUMNS} FROM schedules WHERE id = ? AND user_id = ?`,
    )
      .bind(current.id, userId)
      .first<ScheduleItem>();
    return Response.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const userId = userIdFrom(request);
  if (!userId) return authError();
  try {
    await ensureSchema();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "일정 ID가 필요합니다." }, { status: 400 });
    const item = await env.DB.prepare(
      `SELECT ${SELECT_COLUMNS} FROM schedules WHERE id = ? AND user_id = ?`,
    )
      .bind(id, userId)
      .first<ScheduleItem>();
    if (!item) return Response.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });
    await env.DB.prepare("DELETE FROM schedules WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .run();
    return Response.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}

function localDateFromDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
