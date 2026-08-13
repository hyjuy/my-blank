"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { parseScheduleText } from "@/lib/parser";
import {
  addDaysToKey,
  CATEGORY_LABELS,
  dateFromKey,
  localDateKey,
  type ScheduleDraft,
  type ScheduleItem,
} from "@/lib/schedule";

type Toast = { message: string; undoItem?: ScheduleItem } | null;

const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "short",
  timeZone: "Asia/Seoul",
});
const CLOCK_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Seoul",
});
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Seoul",
});

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const data = (await response.json()) as T & { error?: string; signIn?: string };
  if (!response.ok) {
    const error = new Error(data.error ?? "요청을 처리하지 못했습니다.");
    Object.assign(error, { status: response.status, signIn: data.signIn });
    throw error;
  }
  return data;
}

function timeLabel(item: ScheduleItem | ScheduleDraft) {
  if (item.startAt) {
    const start = CLOCK_FORMAT.format(new Date(item.startAt));
    const end = item.endAt ? CLOCK_FORMAT.format(new Date(item.endAt)) : null;
    return end ? `${start}–${end}` : start;
  }
  if (item.dueAt) {
    const due = new Date(item.dueAt);
    return `마감 ${SHORT_DATE_FORMAT.format(due)} ${CLOCK_FORMAT.format(due)}`;
  }
  return `시간 미정 · 예상 ${item.durationMinutes}분`;
}

function overlapSet(items: ScheduleItem[]) {
  const timed = items.filter(
    (item) => item.status === "planned" && item.startAt && item.endAt,
  );
  const ids = new Set<string>();
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      if (
        new Date(timed[i].startAt!).getTime() < new Date(timed[j].endAt!).getTime() &&
        new Date(timed[j].startAt!).getTime() < new Date(timed[i].endAt!).getTime()
      ) {
        ids.add(timed[i].id);
        ids.add(timed[j].id);
      }
    }
  }
  return ids;
}

export function ScheduleApp({ initialNow }: { initialNow: string }) {
  const [now, setNow] = useState(() => new Date(initialNow));
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date(initialNow)));
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const today = localDateKey(now);
  const draft = useMemo(() => parseScheduleText(input || "일정", now), [input, now]);

  const loadItems = useCallback(async (date: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<{ items: ScheduleItem[] }>(
        `/api/events?date=${encodeURIComponent(date)}`,
      );
      setItems(data.items);
      setSignIn(null);
    } catch (caught) {
      const requestError = caught as Error & { status?: number; signIn?: string };
      setItems([]);
      setError(requestError.message);
      if (requestError.status === 401) setSignIn(requestError.signIn ?? "/signin-with-chatgpt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadItems(selectedDate), 0);
    return () => window.clearTimeout(timer);
  }, [loadItems, selectedDate]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const duplicateCount = useMemo(() => {
    if (!input.trim() || draft.scheduleDate !== selectedDate) return 0;
    return items.filter(
      (item) =>
        item.title.trim().toLocaleLowerCase("ko") ===
          draft.title.trim().toLocaleLowerCase("ko") &&
        (item.startAt ?? "") === (draft.startAt ?? ""),
    ).length;
  }, [draft, input, items, selectedDate]);

  const planned = useMemo(() => items.filter((item) => item.status === "planned"), [items]);
  const completed = useMemo(
    () => items.filter((item) => item.status === "completed"),
    [items],
  );
  const overlaps = useMemo(() => overlapSet(items), [items]);

  const focus = useMemo(() => {
    if (!planned.length) return { item: null, state: "empty" as const };
    if (selectedDate !== today) {
      return { item: planned[0], state: "selected" as const };
    }
    const timed = planned.filter((item) => item.startAt).sort((a, b) =>
      a.startAt!.localeCompare(b.startAt!),
    );
    const active = timed.find(
      (item) =>
        new Date(item.startAt!).getTime() <= now.getTime() &&
        (!item.endAt || new Date(item.endAt).getTime() > now.getTime()),
    );
    if (active) return { item: active, state: "active" as const };
    const missed = timed.filter(
      (item) => item.endAt && new Date(item.endAt).getTime() <= now.getTime(),
    );
    if (missed.length) return { item: missed[missed.length - 1], state: "missed" as const };
    const next = timed.find((item) => new Date(item.startAt!).getTime() > now.getTime());
    if (next) return { item: next, state: "next" as const };
    const anytime = planned.find((item) => !item.startAt);
    return { item: anytime ?? planned[0], state: "anytime" as const };
  }, [now, planned, selectedDate, today]);

  async function addDraft(schedule: ScheduleDraft) {
    const data = await apiRequest<{ item: ScheduleItem; duplicateCount: number }>(
      "/api/events",
      { method: "POST", body: JSON.stringify(schedule) },
    );
    if (schedule.scheduleDate === selectedDate) {
      setItems((current) => [...current, data.item]);
    } else {
      setSelectedDate(schedule.scheduleDate);
    }
    return data;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const data = await addDraft(parseScheduleText(input, new Date()));
      setInput("");
      setToast({
        message:
          data.duplicateCount > 0
            ? "중복 일정도 그대로 등록했습니다."
            : "일정을 등록했습니다.",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "등록하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(
    item: ScheduleItem,
    action: "complete" | "restore" | "delay30" | "tomorrow",
  ) {
    setError("");
    try {
      const data = await apiRequest<{ item: ScheduleItem }>("/api/events", {
        method: "PATCH",
        body: JSON.stringify({ id: item.id, action }),
      });
      if (data.item.scheduleDate === selectedDate) {
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === data.item.id ? data.item : currentItem,
          ),
        );
      } else {
        setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      }
      const messages = {
        complete: "완료했습니다. 오늘 한 일이 쌓였어요.",
        restore: "할 일로 되돌렸습니다.",
        delay30: "30분 뒤로 옮겼습니다.",
        tomorrow: "내일로 옮겼습니다.",
      };
      setToast({ message: messages[action] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "변경하지 못했습니다.");
    }
  }

  async function deleteItem(item: ScheduleItem) {
    setError("");
    try {
      await apiRequest<{ item: ScheduleItem }>(
        `/api/events?id=${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      setToast({ message: "일정을 삭제했습니다.", undoItem: item });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "삭제하지 못했습니다.");
    }
  }

  async function undoDelete(item: ScheduleItem) {
    const { id: _id, status: _status, createdAt: _createdAt, updatedAt: _updatedAt, completedAt: _completedAt, ...schedule } = item;
    void _id;
    void _status;
    void _createdAt;
    void _updatedAt;
    void _completedAt;
    try {
      await addDraft(schedule);
      setToast({ message: "삭제를 취소했습니다." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "복원하지 못했습니다.");
    }
  }

  const focusHeadings = {
    active: "지금 진행할 일정",
    missed: "지금 확인이 필요한 일정",
    next: "다음으로 할 일정",
    anytime: "지금 시작하기 좋은 일정",
    selected: "선택한 날짜의 첫 일정",
    empty: selectedDate === today ? "지금은 비어 있어요" : "등록된 일정이 없어요",
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="취준 일정 홈">
          <span className="brand-mark">J</span>
          <span>
            <strong>취준 일정</strong>
            <small>부담 없이, 지금 할 일 하나</small>
          </span>
        </a>
        <div className="live-clock" aria-label="현재 시각">
          <span className="live-dot" />
          {CLOCK_FORMAT.format(now)}
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">JOB SEEKER PLANNER · FREE MVP</p>
          <h1>복잡한 계획 말고,<br />지금 할 일만 선명하게.</h1>
          <p>형식 없이 한 줄로 적으세요. 날짜와 시간을 읽어 일정으로 정리합니다.</p>
        </div>

        <form className="quick-add" onSubmit={handleSubmit}>
          <label htmlFor="quick-input">한 줄 일정 등록</label>
          <div className="input-row">
            <input
              id="quick-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="예: 내일 오후 3시 A기업 자소서 1시간"
              maxLength={300}
              autoComplete="off"
            />
            <button type="submit" disabled={!input.trim() || saving}>
              {saving ? "저장 중" : "등록"}
            </button>
          </div>
          {input.trim() ? (
            <div className="parse-preview" aria-live="polite">
              <span className="preview-title">{draft.title}</span>
              <span>{DATE_FORMAT.format(dateFromKey(draft.scheduleDate))}</span>
              <span>{timeLabel(draft)}</span>
              <span>{CATEGORY_LABELS[draft.category]}</span>
              {duplicateCount > 0 ? (
                <span className="duplicate-note">같은 일정 {duplicateCount}개 있음 · 그래도 등록 가능</span>
              ) : null}
            </div>
          ) : (
            <p className="input-hint">날짜가 없으면 오늘, 시간이 없으면 ‘시간 미정’으로 저장됩니다.</p>
          )}
        </form>
      </section>

      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          {signIn ? <a href={signIn}>로그인하기</a> : <button onClick={() => void loadItems(selectedDate)}>다시 시도</button>}
        </div>
      ) : null}

      <section className="dashboard" aria-label="일정 대시보드">
        <div className="date-toolbar">
          <div>
            <p>{selectedDate === today ? "오늘" : "선택한 날짜"}</p>
            <h2>{DATE_FORMAT.format(dateFromKey(selectedDate))}</h2>
          </div>
          <div className="date-controls">
            <button aria-label="이전 날짜" onClick={() => setSelectedDate(addDaysToKey(selectedDate, -1))}>‹</button>
            <button className="today-button" onClick={() => setSelectedDate(today)}>오늘</button>
            <input
              type="date"
              value={selectedDate}
              aria-label="날짜 선택"
              onChange={(event) => setSelectedDate(event.target.value)}
            />
            <button aria-label="다음 날짜" onClick={() => setSelectedDate(addDaysToKey(selectedDate, 1))}>›</button>
          </div>
        </div>

        <div className="dashboard-grid">
          <section className={`focus-card focus-${focus.state}`}>
            <div className="focus-topline">
              <span>{focusHeadings[focus.state]}</span>
              {focus.item && overlaps.has(focus.item.id) ? <b>일정 겹침</b> : null}
            </div>
            {focus.item ? (
              <>
                <div className="focus-time">{timeLabel(focus.item)}</div>
                <h3>{focus.item.title}</h3>
                <p>{CATEGORY_LABELS[focus.item.category]} · {focus.item.scheduleType === "fixed" ? "시간 고정" : "유연한 일정"}</p>
                <div className="focus-actions">
                  <button className="primary-action" onClick={() => void updateItem(focus.item!, "complete")}>완료</button>
                  <button onClick={() => void updateItem(focus.item!, "delay30")}>30분 뒤</button>
                  <button onClick={() => void updateItem(focus.item!, "tomorrow")}>내일로</button>
                </div>
              </>
            ) : (
              <div className="empty-focus">
                <span>✓</span>
                <p>한 줄로 첫 일정을 등록해 보세요.<br />완벽한 계획보다 작은 시작이면 충분합니다.</p>
              </div>
            )}
          </section>

          <aside className="summary-card">
            <p className="card-label">오늘의 흐름</p>
            <div className="summary-stat"><strong>{planned.length}</strong><span>남은 일정</span></div>
            <div className="summary-stat"><strong>{completed.length}</strong><span>완료한 일정</span></div>
            <div className="summary-stat"><strong>{overlaps.size}</strong><span>겹치는 일정</span></div>
            <div className="progress-track" aria-label={`전체 ${items.length}개 중 ${completed.length}개 완료`}>
              <span style={{ width: `${items.length ? (completed.length / items.length) * 100 : 0}%` }} />
            </div>
            <small>중복·겹침은 막지 않고 눈에만 띄게 표시합니다.</small>
          </aside>
        </div>

        <section className="schedule-list-section">
          <div className="section-heading">
            <div>
              <p className="card-label">DAY PLAN</p>
              <h2>하루 일정</h2>
            </div>
            <span>{items.length}개</span>
          </div>

          {loading ? (
            <div className="loading-list" role="status">일정을 불러오는 중…</div>
          ) : items.length === 0 ? (
            <div className="empty-list">아직 일정이 없습니다. 위 입력창에 자연스럽게 한 줄로 적어보세요.</div>
          ) : (
            <div className="schedule-list">
              {items.map((item) => {
                const late =
                  item.status === "planned" &&
                  selectedDate === today &&
                  ((item.endAt && new Date(item.endAt) <= now) ||
                    (item.dueAt && new Date(item.dueAt) < now));
                return (
                  <article
                    className={`schedule-row ${item.status === "completed" ? "is-completed" : ""} ${late ? "is-late" : ""}`}
                    key={item.id}
                  >
                    <button
                      className="check-button"
                      aria-label={item.status === "completed" ? "완료 취소" : "완료"}
                      onClick={() => void updateItem(item, item.status === "completed" ? "restore" : "complete")}
                    >
                      {item.status === "completed" ? "✓" : ""}
                    </button>
                    <div className="row-time">
                      {item.startAt ? CLOCK_FORMAT.format(new Date(item.startAt)) : item.dueAt ? "마감" : "언제든"}
                    </div>
                    <div className="row-content">
                      <h3>{item.title}</h3>
                      <p>
                        {timeLabel(item)} · {CATEGORY_LABELS[item.category]}
                        {late ? " · 확인 필요" : ""}
                      </p>
                    </div>
                    <div className="row-badges">
                      {overlaps.has(item.id) ? <span className="overlap-badge">겹침</span> : null}
                      {item.scheduleType === "flexible" ? <span>유연</span> : null}
                    </div>
                    <details className="row-menu">
                      <summary aria-label="일정 메뉴">•••</summary>
                      <div>
                        {item.status === "planned" ? (
                          <>
                            <button onClick={() => void updateItem(item, "delay30")}>30분 뒤로</button>
                            <button onClick={() => void updateItem(item, "tomorrow")}>내일로 이동</button>
                          </>
                        ) : null}
                        <button className="danger-text" onClick={() => void deleteItem(item)}>삭제</button>
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>

      <footer>
        <span>취준 일정 MVP</span>
        <span>규칙 기반 한 줄 분석 · 사용자별 안전한 저장 · 무료 운영 구조</span>
      </footer>

      {toast ? (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undoItem ? <button onClick={() => void undoDelete(toast.undoItem!)}>되돌리기</button> : null}
          <button className="toast-close" aria-label="알림 닫기" onClick={() => setToast(null)}>×</button>
        </div>
      ) : null}
    </main>
  );
}
