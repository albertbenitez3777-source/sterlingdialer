/**
 * Attendance interval math — pure functions, no I/O.
 *
 * An "interval" is { start: number; end: number } where both are epoch-ms.
 * These utilities merge overlapping/adjacent intervals into a minimal union,
 * clamp them to day/week boundaries in a named timezone, and sum durations.
 */

// ── Types ───────────────────────────────────────────────────────────
export interface Interval {
  start: number; // epoch-ms
  end: number;   // epoch-ms
}

export type PresenceState = 'online' | 'disconnected' | 'signed-out' | 'unknown';

export interface AttendanceSummary {
  presenceState: PresenceState;
  lastConfirmedAt: number | null;     // epoch-ms of last heartbeat
  currentSessionSeconds: number;
  todayTotalSeconds: number;
  weekTotalSeconds: number;
  isLegacyEstimate: boolean;          // true when data predates heartbeat system
}

// ── Interval union ──────────────────────────────────────────────────

/** Sort intervals by start ascending, break ties by end descending. */
export function sortIntervals(intervals: Interval[]): Interval[] {
  return [...intervals].sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Merge overlapping/adjacent intervals into a minimal set.
 * Input does NOT need to be sorted — we sort internally.
 * Discards zero-width or negative intervals.
 */
export function unionIntervals(intervals: Interval[]): Interval[] {
  const valid = intervals.filter(i => i.end > i.start);
  if (valid.length === 0) return [];
  const sorted = sortIntervals(valid);
  const merged: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/** Clamp intervals to a [windowStart, windowEnd) range. */
export function clampIntervals(intervals: Interval[], windowStart: number, windowEnd: number): Interval[] {
  const result: Interval[] = [];
  for (const iv of intervals) {
    const s = Math.max(iv.start, windowStart);
    const e = Math.min(iv.end, windowEnd);
    if (e > s) result.push({ start: s, end: e });
  }
  return result;
}

/** Sum total milliseconds across intervals (assumes already merged). */
export function sumIntervalMs(intervals: Interval[]): number {
  let total = 0;
  for (const iv of intervals) total += iv.end - iv.start;
  return total;
}

/** Sum total seconds across intervals (assumes already merged). */
export function sumIntervalSeconds(intervals: Interval[]): number {
  return Math.floor(sumIntervalMs(intervals) / 1000);
}

// ── Timezone-aware day/week boundaries ──────────────────────────────

/**
 * Get the start-of-day in a named timezone as epoch-ms.
 * Uses Intl to find the local date parts, then reconstructs.
 */
export function startOfDayTz(epochMs: number, tz: string): number {
  const d = new Date(epochMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '01';
  const iso = `${get('year')}-${get('month')}-${get('day')}T00:00:00`;
  const midnight = new Date(iso);
  const offset = getTimezoneOffsetMs(midnight.getTime(), tz);
  return midnight.getTime() + offset;
}

/**
 * Get the start-of-week (Monday) in a named timezone as epoch-ms.
 */
export function startOfWeekTz(epochMs: number, tz: string): number {
  const dayStart = startOfDayTz(epochMs, tz);
  const d = new Date(dayStart);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short',
  }).formatToParts(d);
  const weekday = parts.find(p => p.type === 'weekday')?.value || 'Mon';
  const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const daysBack = dayMap[weekday] ?? 0;
  return dayStart - daysBack * 86400000;
}

function getTimezoneOffsetMs(epochMs: number, tz: string): number {
  const utcStr = new Date(epochMs).toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = new Date(epochMs).toLocaleString('en-US', { timeZone: tz });
  return new Date(utcStr).getTime() - new Date(tzStr).getTime();
}

// ── Session → Interval conversion ───────────────────────────────────

export interface SessionRow {
  created_at: string;          // ISO timestamp
  invalidated_at: string | null;
  expires_at: string;
  last_heartbeat_at?: string | null;
}

/**
 * Convert a session row to an interval.
 * End is the EARLIEST of: invalidated_at, expires_at, last_heartbeat_at + staleMs, now.
 * This prevents accruing time when the user is asleep/offline.
 */
export function sessionToInterval(
  row: SessionRow,
  nowMs: number,
  staleMs: number = 90_000,
): Interval {
  const start = new Date(row.created_at).getTime();
  let end = nowMs;

  if (row.invalidated_at) {
    end = Math.min(end, new Date(row.invalidated_at).getTime());
  }
  end = Math.min(end, new Date(row.expires_at).getTime());

  if (row.last_heartbeat_at) {
    const heartbeatCap = new Date(row.last_heartbeat_at).getTime() + staleMs;
    end = Math.min(end, heartbeatCap);
  }

  return { start, end };
}

/**
 * Convert a batch of session rows to merged intervals.
 * Handles overlapping sessions from multiple tabs/devices.
 */
export function sessionsToMergedIntervals(
  rows: SessionRow[],
  nowMs: number,
  staleMs?: number,
): Interval[] {
  const intervals = rows.map(r => sessionToInterval(r, nowMs, staleMs));
  return unionIntervals(intervals);
}

// ── Attendance computation ──────────────────────────────────────────

export function computeAttendance(
  sessions: SessionRow[],
  nowMs: number,
  tz: string,
  staleMs: number = 90_000,
): AttendanceSummary {
  const merged = sessionsToMergedIntervals(sessions, nowMs, staleMs);
  const dayStart = startOfDayTz(nowMs, tz);
  const dayEnd = dayStart + 86400000;
  const weekStart = startOfWeekTz(nowMs, tz);

  const todayIntervals = clampIntervals(merged, dayStart, dayEnd);
  const weekIntervals = clampIntervals(merged, weekStart, dayEnd);

  const activeSessions = sessions.filter(s => {
    if (s.invalidated_at) return false;
    if (new Date(s.expires_at).getTime() <= nowMs) return false;
    return true;
  });

  let presenceState: PresenceState = 'signed-out';
  let lastConfirmedAt: number | null = null;
  let currentSessionSeconds = 0;
  const hasHeartbeats = sessions.some(s => s.last_heartbeat_at);

  if (activeSessions.length > 0) {
    const latestHeartbeat = activeSessions
      .filter(s => s.last_heartbeat_at)
      .map(s => new Date(s.last_heartbeat_at!).getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    if (latestHeartbeat > 0) {
      lastConfirmedAt = latestHeartbeat;
      presenceState = (nowMs - latestHeartbeat <= staleMs) ? 'online' : 'disconnected';
    } else {
      presenceState = 'unknown';
    }

    const latestSession = activeSessions.reduce((a, b) =>
      new Date(a.created_at).getTime() > new Date(b.created_at).getTime() ? a : b
    );
    const iv = sessionToInterval(latestSession, nowMs, staleMs);
    currentSessionSeconds = Math.max(0, Math.floor((Math.min(iv.end, nowMs) - iv.start) / 1000));
  }

  return {
    presenceState,
    lastConfirmedAt,
    currentSessionSeconds,
    todayTotalSeconds: sumIntervalSeconds(todayIntervals),
    weekTotalSeconds: sumIntervalSeconds(weekIntervals),
    isLegacyEstimate: !hasHeartbeats,
  };
}

// ── Formatting helpers ──────────────────────────────────────────────

export function fmtAttendanceDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function presenceLabel(state: PresenceState): string {
  switch (state) {
    case 'online': return 'Online';
    case 'disconnected': return 'Disconnected';
    case 'signed-out': return 'Signed Out';
    case 'unknown': return 'Unknown';
  }
}

export function presenceColor(state: PresenceState): string {
  switch (state) {
    case 'online': return '#22c55e';
    case 'disconnected': return '#f59e0b';
    case 'signed-out': return '#6b7280';
    case 'unknown': return '#9ca3af';
  }
}
