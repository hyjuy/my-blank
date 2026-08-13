import {
  localDateKey,
  type ScheduleCategory,
  type ScheduleDraft,
} from "./schedule";

type DateMatch = { date: Date; matched: string };
type TimeMatch = {
  hour: number;
  minute: number;
  endHour?: number;
  endMinute?: number;
  matched: string;
};

const DAY_INDEX: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

function atStartOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function safeDate(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function extractDate(text: string, now: Date): DateMatch | null {
  const today = atStartOfDay(now);

  if (/모레/.test(text)) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    return { date, matched: "모레" };
  }
  if (/내일/.test(text)) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    return { date, matched: "내일" };
  }
  if (/오늘/.test(text)) return { date: today, matched: "오늘" };

  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const date = safeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (date) return { date, matched: iso[0] };
  }

  const korean = text.match(/(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) {
    let year = korean[1] ? Number(korean[1]) : now.getFullYear();
    const month = Number(korean[2]);
    const day = Number(korean[3]);
    let date = safeDate(year, month, day);
    if (date && !korean[1] && date < today) {
      year += 1;
      date = safeDate(year, month, day);
    }
    if (date) return { date, matched: korean[0] };
  }

  const slash = text.match(/(?:^|\s)(\d{1,2})[/.](\d{1,2})(?:일)?(?=\s|$)/);
  if (slash) {
    let year = now.getFullYear();
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    let date = safeDate(year, month, day);
    if (date && date < today) {
      year += 1;
      date = safeDate(year, month, day);
    }
    if (date) return { date, matched: slash[0].trim() };
  }

  const weekday = text.match(/(다음\s*주\s*)?([월화수목금토일])(?:요일)?/);
  if (weekday) {
    const target = DAY_INDEX[weekday[2]];
    let distance = (target - today.getDay() + 7) % 7;
    if (weekday[1]) distance += 7;
    const date = new Date(today);
    date.setDate(date.getDate() + distance);
    return { date, matched: weekday[0] };
  }

  return null;
}

function applyPeriod(hour: number, period?: string) {
  if (!period) return hour >= 1 && hour <= 6 ? hour + 12 : hour;
  if (period === "오후" || period === "저녁" || period === "밤") {
    return hour < 12 ? hour + 12 : hour;
  }
  if (period === "오전" || period === "아침" || period === "새벽") {
    return hour === 12 ? 0 : hour;
  }
  return hour;
}

function extractTime(text: string): TimeMatch | null {
  const range = text.match(
    /(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})(?::(\d{2})|시(?!간)\s*(\d{1,2})?분?)?\s*(?:부터|~|〜|-)\s*(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})(?::(\d{2})|시(?!간)\s*(\d{1,2})?분?)?/,
  );
  if (range && (range[0].includes(":") || range[0].includes("시"))) {
    const startHour = applyPeriod(Number(range[2]), range[1]);
    const endHour = applyPeriod(Number(range[6]), range[5] ?? range[1]);
    const startMinute = Number(range[3] ?? range[4] ?? 0);
    const endMinute = Number(range[7] ?? range[8] ?? 0);
    if (startHour < 24 && endHour < 24 && startMinute < 60 && endMinute < 60) {
      return {
        hour: startHour,
        minute: startMinute,
        endHour,
        endMinute,
        matched: range[0],
      };
    }
  }

  const single = text.match(
    /(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})(?::(\d{2})|시(?!간)(?:\s*(\d{1,2})분?)?)/,
  );
  if (!single) return null;
  const hour = applyPeriod(Number(single[2]), single[1]);
  const minute = Number(single[3] ?? single[4] ?? 0);
  if (hour >= 24 || minute >= 60) return null;
  return { hour, minute, matched: single[0] };
}

function extractDuration(text: string) {
  const hours = text.match(/(\d+(?:\.\d+)?)\s*시간(?:\s*(반))?/);
  if (hours) {
    return Math.max(10, Math.round(Number(hours[1]) * 60 + (hours[2] ? 30 : 0)));
  }
  const minutes = text.match(/(\d{1,3})\s*분(?:\s*(?:동안|하기))?/);
  if (minutes) return Math.max(10, Math.min(480, Number(minutes[1])));
  return 30;
}

function categoryOf(text: string): ScheduleCategory {
  if (/면접|인터뷰/.test(text)) return "interview";
  if (/자소서|지원서|입사지원|서류|제출/.test(text)) return "application";
  if (/포트폴리오|포폴/.test(text)) return "portfolio";
  if (/공고|기업\s*조사|채용/.test(text)) return "research";
  if (/코테|코딩\s*테스트|시험|인적성|자격증|공부|학습/.test(text)) return "study";
  if (/스터디|상담|멘토|미팅|약속/.test(text)) return "meeting";
  return "general";
}

function cleanTitle(
  original: string,
  dateMatch: DateMatch | null,
  timeMatch: TimeMatch | null,
) {
  let title = original;
  for (const matched of [dateMatch?.matched, timeMatch?.matched]) {
    if (matched) title = title.replace(matched, " ");
  }
  title = title
    .replace(/\d+(?:\.\d+)?\s*시간\s*반?/g, " ")
    .replace(/\d{1,3}\s*분\s*(?:동안|하기)?/g, " ")
    .replace(/(?:까지|마감|제출)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,·/\-~]+|[,·/\-~]+$/g, "")
    .trim();
  return title || original.trim();
}

export function parseScheduleText(text: string, now = new Date()): ScheduleDraft {
  const sourceText = text.trim().slice(0, 300);
  const dateMatch = extractDate(sourceText, now);
  const timeMatch = extractTime(sourceText);
  const isDeadline = /까지|마감|제출/.test(sourceText);
  const targetDate = dateMatch?.date ?? atStartOfDay(now);
  let durationMinutes = extractDuration(sourceText);

  let startAt: string | null = null;
  let endAt: string | null = null;
  let dueAt: string | null = null;

  if (timeMatch) {
    const start = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      timeMatch.hour,
      timeMatch.minute,
    );

    if (isDeadline) {
      dueAt = start.toISOString();
    } else {
      startAt = start.toISOString();
      let end: Date;
      if (timeMatch.endHour !== undefined && timeMatch.endMinute !== undefined) {
        end = new Date(
          targetDate.getFullYear(),
          targetDate.getMonth(),
          targetDate.getDate(),
          timeMatch.endHour,
          timeMatch.endMinute,
        );
        if (end <= start) end.setDate(end.getDate() + 1);
        durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
      } else {
        end = new Date(start.getTime() + durationMinutes * 60000);
      }
      endAt = end.toISOString();
    }
  } else if (isDeadline && dateMatch) {
    const due = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      18,
      0,
    );
    dueAt = due.toISOString();
  }

  const scheduleDate = isDeadline
    ? localDateKey(atStartOfDay(now))
    : localDateKey(targetDate);
  const category = categoryOf(sourceText);
  const scheduleType =
    !isDeadline &&
    (Boolean(timeMatch) || /면접|시험|인적성|코테|스터디|상담|미팅/.test(sourceText))
      ? "fixed"
      : "flexible";

  return {
    title: cleanTitle(sourceText, dateMatch, timeMatch).slice(0, 120),
    sourceText,
    scheduleDate,
    startAt,
    endAt,
    dueAt,
    durationMinutes,
    category,
    scheduleType,
  };
}
