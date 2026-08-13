export type ScheduleStatus = "planned" | "completed";

export type ScheduleCategory =
  | "application"
  | "interview"
  | "portfolio"
  | "research"
  | "study"
  | "meeting"
  | "general";

export interface ScheduleItem {
  id: string;
  title: string;
  sourceText: string;
  scheduleDate: string;
  startAt: string | null;
  endAt: string | null;
  dueAt: string | null;
  durationMinutes: number;
  category: ScheduleCategory;
  scheduleType: "fixed" | "flexible";
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type ScheduleDraft = Omit<
  ScheduleItem,
  "id" | "status" | "createdAt" | "updatedAt" | "completedAt"
>;

export const CATEGORY_LABELS: Record<ScheduleCategory, string> = {
  application: "지원서",
  interview: "면접",
  portfolio: "포트폴리오",
  research: "공고 탐색",
  study: "학습",
  meeting: "약속",
  general: "기타",
};

export function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDaysToKey(key: string, amount: number) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}
