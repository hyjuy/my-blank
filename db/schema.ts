import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const schedules = sqliteTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    sourceText: text("source_text").notNull().default(""),
    scheduleDate: text("schedule_date").notNull(),
    startAt: text("start_at"),
    endAt: text("end_at"),
    dueAt: text("due_at"),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    category: text("category").notNull().default("general"),
    scheduleType: text("schedule_type").notNull().default("flexible"),
    status: text("status").notNull().default("planned"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("schedules_user_day_status_idx").on(
      table.userId,
      table.scheduleDate,
      table.status,
    ),
    index("schedules_user_start_idx").on(table.userId, table.startAt),
  ],
);
