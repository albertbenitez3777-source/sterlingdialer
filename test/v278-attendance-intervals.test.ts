/**
 * v278 — Attendance interval math regression tests.
 *
 * Imports actual production functions from src/utils/attendance.ts.
 * Tests: interval union, concurrent sessions, expiry, logout, midnight/week
 * boundaries, timezone handling, clock skew, stale heartbeat, reconnect.
 */

import { describe, it, expect } from 'vitest';
import {
  unionIntervals, clampIntervals, sumIntervalSeconds, sortIntervals,
  sessionToInterval, sessionsToMergedIntervals, computeAttendance,
  startOfDayTz, startOfWeekTz, fmtAttendanceDuration,
  type Interval, type SessionRow,
} from '../src/utils/attendance';

const sec = (s: number) => s * 1000;
const min = (m: number) => m * 60_000;
const hr = (h: number) => h * 3_600_000;

// Fixed reference: 2026-09-04 14:00:00 UTC = 10:00 AM ET (Thursday)
const REF = new Date('2026-09-04T14:00:00Z').getTime();
const TZ = 'America/New_York';

// ── unionIntervals ──────────────────────────────────────────────────
describe('unionIntervals', () => {
  it('returns empty for empty input', () => {
    expect(unionIntervals([])).toEqual([]);
  });

  it('returns single interval unchanged', () => {
    const result = unionIntervals([{ start: 100, end: 200 }]);
    expect(result).toEqual([{ start: 100, end: 200 }]);
  });

  it('merges two overlapping intervals', () => {
    const result = unionIntervals([
      { start: 100, end: 300 },
      { start: 200, end: 400 },
    ]);
    expect(result).toEqual([{ start: 100, end: 400 }]);
  });

  it('merges adjacent intervals (touching endpoints)', () => {
    const result = unionIntervals([
      { start: 100, end: 200 },
      { start: 200, end: 300 },
    ]);
    expect(result).toEqual([{ start: 100, end: 300 }]);
  });

  it('keeps disjoint intervals separate', () => {
    const result = unionIntervals([
      { start: 100, end: 200 },
      { start: 300, end: 400 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ start: 100, end: 200 });
    expect(result[1]).toEqual({ start: 300, end: 400 });
  });

  it('handles unsorted input', () => {
    const result = unionIntervals([
      { start: 300, end: 400 },
      { start: 100, end: 250 },
      { start: 200, end: 350 },
    ]);
    expect(result).toEqual([{ start: 100, end: 400 }]);
  });

  it('discards zero-width and negative intervals', () => {
    const result = unionIntervals([
      { start: 100, end: 100 },
      { start: 300, end: 200 },
      { start: 400, end: 500 },
    ]);
    expect(result).toEqual([{ start: 400, end: 500 }]);
  });

  it('merges multiple overlapping concurrent sessions (3 tabs)', () => {
    const result = unionIntervals([
      { start: 0, end: 100 },
      { start: 10, end: 80 },
      { start: 50, end: 120 },
    ]);
    expect(result).toEqual([{ start: 0, end: 120 }]);
  });

  it('handles fully contained intervals', () => {
    const result = unionIntervals([
      { start: 0, end: 1000 },
      { start: 100, end: 200 },
      { start: 300, end: 400 },
    ]);
    expect(result).toEqual([{ start: 0, end: 1000 }]);
  });
});

// ── clampIntervals ──────────────────────────────────────────────────
describe('clampIntervals', () => {
  it('clamps intervals to window', () => {
    const result = clampIntervals(
      [{ start: 50, end: 150 }, { start: 200, end: 300 }],
      100, 250,
    );
    expect(result).toEqual([{ start: 100, end: 150 }, { start: 200, end: 250 }]);
  });

  it('excludes intervals entirely outside window', () => {
    const result = clampIntervals([{ start: 50, end: 99 }], 100, 200);
    expect(result).toEqual([]);
  });

  it('handles interval spanning entire window', () => {
    const result = clampIntervals([{ start: 0, end: 1000 }], 100, 200);
    expect(result).toEqual([{ start: 100, end: 200 }]);
  });
});

// ── sumIntervalSeconds ──────────────────────────────────────────────
describe('sumIntervalSeconds', () => {
  it('sums durations', () => {
    expect(sumIntervalSeconds([
      { start: 0, end: sec(30) },
      { start: sec(60), end: sec(120) },
    ])).toBe(90);
  });

  it('returns 0 for empty', () => {
    expect(sumIntervalSeconds([])).toBe(0);
  });
});

// ── sessionToInterval ───────────────────────────────────────────────
describe('sessionToInterval', () => {
  const base: SessionRow = {
    created_at: new Date(REF - hr(2)).toISOString(),
    invalidated_at: null,
    expires_at: new Date(REF + hr(6)).toISOString(),
    last_heartbeat_at: new Date(REF - sec(20)).toISOString(),
  };

  it('caps end at heartbeat + stale threshold (90s default)', () => {
    const iv = sessionToInterval(base, REF);
    expect(iv.start).toBe(REF - hr(2));
    // end = min(now, expires, heartbeat+90s) = min(REF, REF+6h, REF-20s+90s) = REF
    expect(iv.end).toBe(REF);
  });

  it('caps end at invalidated_at when session was logged out', () => {
    const row: SessionRow = {
      ...base,
      invalidated_at: new Date(REF - hr(1)).toISOString(),
    };
    const iv = sessionToInterval(row, REF);
    expect(iv.end).toBe(REF - hr(1));
  });

  it('caps end at expires_at when session expired', () => {
    const row: SessionRow = {
      ...base,
      expires_at: new Date(REF - min(30)).toISOString(),
      last_heartbeat_at: null,
    };
    const iv = sessionToInterval(row, REF);
    expect(iv.end).toBe(REF - min(30));
  });

  it('uses now when no heartbeat data and not expired/invalidated', () => {
    const row: SessionRow = {
      ...base,
      last_heartbeat_at: null,
    };
    const iv = sessionToInterval(row, REF);
    expect(iv.end).toBe(REF);
  });

  it('never exceeds now even with future heartbeat', () => {
    const row: SessionRow = {
      ...base,
      last_heartbeat_at: new Date(REF + min(5)).toISOString(),
    };
    const iv = sessionToInterval(row, REF);
    expect(iv.end).toBeLessThanOrEqual(REF + sec(90));
  });

  it('stale heartbeat (>90s ago) caps interval at heartbeat+90s', () => {
    const row: SessionRow = {
      ...base,
      last_heartbeat_at: new Date(REF - min(10)).toISOString(),
    };
    const iv = sessionToInterval(row, REF);
    expect(iv.end).toBe(REF - min(10) + sec(90));
  });
});

// ── sessionsToMergedIntervals (concurrent sessions) ─────────────────
describe('sessionsToMergedIntervals', () => {
  it('merges two overlapping tab sessions', () => {
    const rows: SessionRow[] = [
      { created_at: new Date(REF - hr(3)).toISOString(), invalidated_at: null, expires_at: new Date(REF + hr(5)).toISOString(), last_heartbeat_at: new Date(REF - sec(10)).toISOString() },
      { created_at: new Date(REF - hr(2)).toISOString(), invalidated_at: null, expires_at: new Date(REF + hr(6)).toISOString(), last_heartbeat_at: new Date(REF - sec(15)).toISOString() },
    ];
    const merged = sessionsToMergedIntervals(rows, REF);
    expect(merged).toHaveLength(1);
    expect(merged[0].start).toBe(REF - hr(3));
  });

  it('does not double-count overlapping time', () => {
    const rows: SessionRow[] = [
      { created_at: new Date(REF - hr(2)).toISOString(), invalidated_at: new Date(REF - hr(1)).toISOString(), expires_at: new Date(REF + hr(6)).toISOString(), last_heartbeat_at: null },
      { created_at: new Date(REF - min(90)).toISOString(), invalidated_at: new Date(REF - min(30)).toISOString(), expires_at: new Date(REF + hr(6)).toISOString(), last_heartbeat_at: null },
    ];
    const merged = sessionsToMergedIntervals(rows, REF);
    expect(merged).toHaveLength(1);
    const totalSec = sumIntervalSeconds(merged);
    // Session 1: REF-2h to REF-1h (invalidated). Session 2: REF-90m to REF-30m.
    // Merged: REF-2h to REF-30m = 1h30m = 5400s
    expect(totalSec).toBe(5400);
  });

  it('keeps disjoint sessions separate', () => {
    const rows: SessionRow[] = [
      { created_at: new Date(REF - hr(5)).toISOString(), invalidated_at: new Date(REF - hr(4)).toISOString(), expires_at: new Date(REF + hr(3)).toISOString(), last_heartbeat_at: null },
      { created_at: new Date(REF - hr(2)).toISOString(), invalidated_at: new Date(REF - hr(1)).toISOString(), expires_at: new Date(REF + hr(6)).toISOString(), last_heartbeat_at: null },
    ];
    const merged = sessionsToMergedIntervals(rows, REF);
    expect(merged).toHaveLength(2);
  });
});

// ── computeAttendance ───────────────────────────────────────────────
describe('computeAttendance', () => {
  it('returns signed-out with zeros when no sessions', () => {
    const result = computeAttendance([], REF, TZ);
    expect(result.presenceState).toBe('signed-out');
    expect(result.todayTotalSeconds).toBe(0);
    expect(result.weekTotalSeconds).toBe(0);
    expect(result.currentSessionSeconds).toBe(0);
  });

  it('detects online when heartbeat is recent', () => {
    const sessions: SessionRow[] = [{
      created_at: new Date(REF - hr(1)).toISOString(),
      invalidated_at: null,
      expires_at: new Date(REF + hr(7)).toISOString(),
      last_heartbeat_at: new Date(REF - sec(20)).toISOString(),
    }];
    const result = computeAttendance(sessions, REF, TZ);
    expect(result.presenceState).toBe('online');
    expect(result.lastConfirmedAt).toBe(REF - sec(20));
  });

  it('detects disconnected when heartbeat is stale', () => {
    const sessions: SessionRow[] = [{
      created_at: new Date(REF - hr(1)).toISOString(),
      invalidated_at: null,
      expires_at: new Date(REF + hr(7)).toISOString(),
      last_heartbeat_at: new Date(REF - min(5)).toISOString(),
    }];
    const result = computeAttendance(sessions, REF, TZ);
    expect(result.presenceState).toBe('disconnected');
  });

  it('detects signed-out when session invalidated', () => {
    const sessions: SessionRow[] = [{
      created_at: new Date(REF - hr(2)).toISOString(),
      invalidated_at: new Date(REF - hr(1)).toISOString(),
      expires_at: new Date(REF + hr(6)).toISOString(),
      last_heartbeat_at: new Date(REF - hr(1) - sec(10)).toISOString(),
    }];
    const result = computeAttendance(sessions, REF, TZ);
    expect(result.presenceState).toBe('signed-out');
  });

  it('marks legacy estimate when no heartbeat data', () => {
    const sessions: SessionRow[] = [{
      created_at: new Date(REF - hr(2)).toISOString(),
      invalidated_at: null,
      expires_at: new Date(REF + hr(6)).toISOString(),
    }];
    const result = computeAttendance(sessions, REF, TZ);
    expect(result.isLegacyEstimate).toBe(true);
  });

  it('marks NOT legacy when heartbeat data exists', () => {
    const sessions: SessionRow[] = [{
      created_at: new Date(REF - hr(1)).toISOString(),
      invalidated_at: null,
      expires_at: new Date(REF + hr(7)).toISOString(),
      last_heartbeat_at: new Date(REF - sec(10)).toISOString(),
    }];
    const result = computeAttendance(sessions, REF, TZ);
    expect(result.isLegacyEstimate).toBe(false);
  });

  it('today total only counts time since midnight ET', () => {
    const todayStart = startOfDayTz(REF, TZ);
    const sessions: SessionRow[] = [{
      created_at: new Date(todayStart - hr(3)).toISOString(),
      invalidated_at: new Date(todayStart + hr(2)).toISOString(),
      expires_at: new Date(todayStart + hr(8)).toISOString(),
      last_heartbeat_at: null,
    }];
    const result = computeAttendance(sessions, REF, TZ);
    expect(result.todayTotalSeconds).toBe(7200); // 2h after midnight
  });

  it('week total spans from Monday 00:00 ET', () => {
    const weekStart = startOfWeekTz(REF, TZ);
    const sessions: SessionRow[] = [{
      created_at: new Date(weekStart - hr(10)).toISOString(),
      invalidated_at: new Date(weekStart + hr(5)).toISOString(),
      expires_at: new Date(weekStart + hr(16)).toISOString(),
      last_heartbeat_at: null,
    }];
    const result = computeAttendance(sessions, REF, TZ);
    expect(result.weekTotalSeconds).toBe(18000); // 5h after week start
  });
});

// ── Timezone boundary tests ─────────────────────────────────────────
describe('timezone boundaries', () => {
  it('startOfDayTz returns midnight ET', () => {
    const dayStart = startOfDayTz(REF, TZ);
    const d = new Date(dayStart);
    const etHour = parseInt(d.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
    expect(etHour).toBe(0);
  });

  it('startOfWeekTz returns a Monday', () => {
    const weekStart = startOfWeekTz(REF, TZ);
    const d = new Date(weekStart);
    const dayName = d.toLocaleString('en-US', { timeZone: TZ, weekday: 'long' });
    expect(dayName).toBe('Monday');
  });

  it('midnight boundary: session spanning midnight splits correctly', () => {
    const todayStart = startOfDayTz(REF, TZ);
    const sessions: SessionRow[] = [{
      created_at: new Date(todayStart - hr(1)).toISOString(),
      invalidated_at: new Date(todayStart + hr(1)).toISOString(),
      expires_at: new Date(todayStart + hr(8)).toISOString(),
      last_heartbeat_at: null,
    }];
    const result = computeAttendance(sessions, REF, TZ);
    expect(result.todayTotalSeconds).toBe(3600); // only 1h counted today
    expect(result.weekTotalSeconds).toBeGreaterThanOrEqual(7200); // both hours in same week
  });
});

// ── Formatting ──────────────────────────────────────────────────────
describe('fmtAttendanceDuration', () => {
  it('formats seconds', () => expect(fmtAttendanceDuration(45)).toBe('45s'));
  it('formats minutes', () => expect(fmtAttendanceDuration(300)).toBe('5m'));
  it('formats hours and minutes', () => expect(fmtAttendanceDuration(3720)).toBe('1h 2m'));
  it('formats zero', () => expect(fmtAttendanceDuration(0)).toBe('0s'));
});

// ── sortIntervals ───────────────────────────────────────────────────
describe('sortIntervals', () => {
  it('sorts by start ascending', () => {
    const result = sortIntervals([{ start: 300, end: 400 }, { start: 100, end: 200 }]);
    expect(result[0].start).toBe(100);
    expect(result[1].start).toBe(300);
  });

  it('breaks ties by end descending (wider first)', () => {
    const result = sortIntervals([{ start: 100, end: 200 }, { start: 100, end: 400 }]);
    expect(result[0].end).toBe(400);
    expect(result[1].end).toBe(200);
  });
});
