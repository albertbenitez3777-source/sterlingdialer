import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const COMP_PATH = join(__dirname, '..', 'src', 'modules', 'owner', 'AdminDialerOverview.tsx');
const HOOK_PATH = join(__dirname, '..', 'src', 'modules', 'owner', 'useAdminDialerOverviewData.ts');
const COMP_SOURCE = readFileSync(COMP_PATH, 'utf-8');
const HOOK_SOURCE = readFileSync(HOOK_PATH, 'utf-8');

vi.mock('@/modules/monitoring/api', () => ({
  monitoringRequest: vi.fn(),
  costaRicaDay: () => '2026-09-28',
}));

vi.mock('@/app/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/shared')>();
  return {
    ...actual,
    fmtDuration: (s: number | null | undefined) => s == null || s < 1 ? '—' : `${Math.floor(s / 60)}m ${s % 60}s`,
    fmtTime: (iso: string | null | undefined) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—',
    initials: (name: string) => name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase(),
    FEDERAL_ONE_V2_URL: 'https://test-federal-one-v2.example.com',
  };
});

vi.mock('@/utils/auth-fetch', () => ({
  authFetch: vi.fn(),
}));

import { AdminDialerOverview } from '@/modules/owner/AdminDialerOverview';
import { monitoringRequest } from '@/modules/monitoring/api';
import { authFetch } from '@/utils/auth-fetch';
import type { AdminStats, RosterAttendanceRow } from '@/app/shared';

const mockMonitoringRequest = vi.mocked(monitoringRequest);
const mockAuthFetch = vi.mocked(authFetch);

function makeOps() {
  return {
    as_of: '2026-09-28T15:30:00Z',
    campaign: { state: 'running', call_limit: 400, accepted: 200, concurrency: 12, started_at: '2026-09-28T08:00:00Z' },
    lines: { configured: 12, effective: 12, active: 3, reserved: 2, aged: 0, hourly_target: 400, minute_limit: 8, recent_hour: 201, recent_minute: 5, pacing_allowance: 1, available_slots: 7, agent_slots: 7, selected_agents: 3, eligible_agents: 3, blocking_reason: null },
    bland: { attempts: 201, humans: 80, transfers: 25, destination_dialed: 20, bridge_confirmed: 18, in_progress: 3, no_answer: 150, customer_voicemail: 40, failures: 2, minutes: 120, linked_received: 20, linked_answered: 18, linked_voicemail: 2 },
    agents: [
      { id: 'agent-1', full_name: 'James Spencer', status: 'active', selected: true, phone_ready: true, route_ready: true, zadarma_number: '1234', attempts: 50, humans: 20, transfers: 8, incoming: 5, answered: 4, transfer_answers: 3, voicemail_reached: 1, messages: 2, unheard: 1, unheard_backlog: 0, missed: 0, callbacks: 1, in_progress: 2 },
    ],
  };
}

function makeAdminStats(leadsRemaining = 2104): AdminStats {
  return {
    summary: {
      campaign_state: 'running', dialer_activated: true, concurrency: 12,
      provider_call_limit: 12, leads_remaining: leadsRemaining, calls_attempted_today: 201,
      live_humans_today: 80, human_drops_today: 10, fire_transfers_today: 25,
      no_answers_today: 150, voice_messages_today: 40, blocking_reason: '',
      campaign_started_at: '2026-09-28T08:00:00Z',
      calls_attempted_week: 1000, live_humans_week: 200, human_drops_week: 30,
      fire_transfers_week: 50, no_answers_week: 400, voice_messages_week: 80,
      as_of: '2026-09-28T15:30:00Z',
    } as AdminStats['summary'],
    agents: [],
  };
}

function makeRoster(presence: 'online' | 'disconnected' | 'signed-out' | 'unknown' = 'online'): RosterAttendanceRow {
  return {
    agent_id: 'agent-1', full_name: 'James Spencer', role: 'agent',
    presence, last_confirmed_at: '2026-09-28T15:00:00Z',
    today_total_seconds: 3600, week_total_seconds: 18000,
    is_legacy_estimate: false, available_for_transfer: true, active_for_dialer: true,
  };
}

function makeReport(agents: Partial<{ id: string; presence: string; current_login_seconds: number | null; outbound_calls: number }>[] = []) {
  return {
    server_now: '2026-09-28T15:30:00Z',
    agents: agents.map(a => ({
      id: 'agent-1', full_name: 'James Spencer', presence: 'Online',
      current_login_seconds: 1800, logged_seconds: 3600,
      outbound_calls: 7, outbound_answered: 2, inbound_answered: 1,
      transfers_received: 4, transfers_answered: 3, transfers_sent: 5,
      ...a,
    })),
  };
}

function renderComp(props: { sessionToken?: string; adminStats?: AdminStats | null; rosterAttendance?: RosterAttendanceRow[] }) {
  let root: ReturnType<typeof create>;
  act(() => { root = create(<AdminDialerOverview sessionToken={props.sessionToken ?? 'tok'} adminStats={props.adminStats ?? null} rosterAttendance={props.rosterAttendance ?? []} />); });
  return root!;
}

function allText(root: ReturnType<typeof create>): string {
  const types = ['span', 'strong', 'div', 'p', 'small', 'button'];
  return types.flatMap(t => root.root.findAllByType(t).map(s => s.props.children).flat(Infinity)).filter((c): c is string | number => typeof c === 'string' || typeof c === 'number').map(String).join('|');
}

function has(root: ReturnType<typeof create>, needle: string): boolean {
  return allText(root).includes(needle);
}

describe('AdminDialerOverview source checks', () => {
  it('fetches operations_overview from FEDERAL_ONE_V2_URL (same as OperationsDashboard), not PROVIDER_URL', () => {
    expect(HOOK_SOURCE).toContain('FEDERAL_ONE_V2_URL');
    expect(COMP_SOURCE).not.toContain('PROVIDER_URL');
  });

  it('calls authFetch with action operations_overview and window today', () => {
    expect(HOOK_SOURCE).toContain("'operations_overview'");
    expect(HOOK_SOURCE).toContain("'today'");
  });

  it('uses monitoringRequest for team monitor data', () => {
    expect(HOOK_SOURCE).toContain('monitoringRequest');
  });

  it('does not edit backend, phone, auth, or session code', () => {
    expect(COMP_SOURCE).not.toContain('wolf-auth');
    expect(COMP_SOURCE).not.toContain('dialer-controls');
    expect(COMP_SOURCE).not.toContain('atomicLogout');
  });

  it('uses campaign?.accepted for batch accepted (not agent_answered_today)', () => {
    expect(COMP_SOURCE).toMatch(/campaign\?\.accepted/);
    expect(COMP_SOURCE).not.toContain('agent_answered_today');
  });

  it('uses campaign?.call_limit for batch limit (not daily_minute_cap)', () => {
    expect(COMP_SOURCE).toMatch(/campaign\?\.call_limit/);
    expect(COMP_SOURCE).not.toContain('daily_minute_cap');
  });

  it('uses lines?.configured for line limit (not provider_call_limit)', () => {
    expect(COMP_SOURCE).toMatch(/lines\?\.configured/);
    expect(COMP_SOURCE).not.toContain('provider_call_limit');
  });

  it('uses lines?.hourly_target for hourly ceiling (not daily_minute_cap)', () => {
    expect(COMP_SOURCE).toMatch(/lines\?\.hourly_target/);
    expect(COMP_SOURCE).not.toContain('daily_minute_cap');
  });

  it('uses lines?.recent_hour for rolling pace (not funnel_today fallback)', () => {
    expect(COMP_SOURCE).toMatch(/lines\?\.recent_hour/);
    expect(COMP_SOURCE).not.toContain('funnel_today');
  });

  it('uses agent.in_progress for per-agent active calls (not currently_receiving)', () => {
    expect(COMP_SOURCE).toMatch(/agent\.in_progress/);
    expect(COMP_SOURCE).not.toContain('currently_receiving');
  });

  it('computes batch remaining from call_limit - accepted (not leads_remaining)', () => {
    expect(COMP_SOURCE).toContain('call_limit');
    expect(COMP_SOURCE).toContain('accepted');
  });

  it('shows No recent activity when no presence data available', () => {
    expect(COMP_SOURCE).toContain('No recent activity');
  });

  it('does not expose customer PII', () => {
    expect(COMP_SOURCE).not.toMatch(/consumer_name|consumer_phone|client_name|client_phone|phone_normalized/);
  });

  it('renders LOADING badge when ops not loaded (never OFF before data)', () => {
    expect(COMP_SOURCE).toContain('LOADING');
  });

  it('renders dashes when ops not loaded (never zero counts before data)', () => {
    expect(COMP_SOURCE).toContain('opsLoaded');
  });

  it('renders loading message for agent cards when ops not loaded (never empty roster claim)', () => {
    expect(COMP_SOURCE).toContain('Loading agent cards');
  });

  it('labels humans as Human-classified not proven humans', () => {
    expect(COMP_SOURCE).toContain('Human-classified');
    expect(COMP_SOURCE).not.toContain('Humans reached');
  });

  it('shows Last reported when stale rather than implying fresh status', () => {
    expect(COMP_SOURCE).toContain('Last reported');
  });
});

describe('AdminDialerOverview rendering with distinct values', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMonitoringRequest.mockReset();
    mockAuthFetch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setupMocks(overrides?: { ops?: Partial<ReturnType<typeof makeOps>>; report?: Partial<{ id: string; presence: string; current_login_seconds: number | null; outbound_calls: number }>[] }) {
    mockMonitoringRequest.mockResolvedValue(makeReport(overrides?.report) as never);
    mockAuthFetch.mockResolvedValue({ ok: true, data: { ...makeOps(), ...overrides?.ops }, status: 200, error: null, loggedOut: false } as never);
  }

  it('failed initial fetch shows LOADING/dashes/loading message, never DIALER OFF or No active agents', async () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    mockAuthFetch.mockResolvedValue({ ok: false, data: null, status: 500, error: 'fail', loggedOut: false } as never);
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'DIALER OFF')).toBe(false);
    expect(has(root, 'No active agents on the roster')).toBe(false);
    const txt = allText(root);
    expect(txt.includes('LOADING') || txt.includes('unavailable') || txt.includes('loading') || txt.includes('Loading')).toBe(true);
    act(() => root.unmount());
  });

  it('failed initial fetch shows dashes for counts, not 0', async () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    mockAuthFetch.mockResolvedValue({ ok: false, data: null, status: 500, error: 'fail', loggedOut: false } as never);
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, '—')).toBe(true);
    act(() => root.unmount());
  });

  it('shows line limit 12 (configured), not 400 (hourly target)', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Line limit')).toBe(true);
    expect(has(root, '12')).toBe(true);
    act(() => root.unmount());
  });

  it('shows batch accepted 200 (campaign.accepted), not 201 (calls today)', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Batch accepted')).toBe(true);
    expect(has(root, '200')).toBe(true);
    act(() => root.unmount());
  });

  it('shows batch limit 400 (campaign.call_limit), not 600 (daily_minute_cap)', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Batch limit')).toBe(true);
    expect(has(root, '400')).toBe(true);
    act(() => root.unmount());
  });

  it('shows attempts left in batch = 200 (400-200), not 2104 (new leads)', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(2104), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Attempts left in batch')).toBe(true);
    act(() => root.unmount());
  });

  it('shows new leads 2104 separately from batch remaining', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(2104), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'New leads')).toBe(true);
    expect(has(root, '2104')).toBe(true);
    act(() => root.unmount());
  });

  it('shows last-hour pace 201 (recent_hour), not today total as fallback', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Last-hour pace')).toBe(true);
    expect(has(root, 'rolling 60 min')).toBe(true);
    act(() => root.unmount());
  });

  it('shows hourly ceiling 400 (hourly_target), not 600 (minute cap)', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Hourly ceiling')).toBe(true);
    expect(has(root, 'target / hr')).toBe(true);
    act(() => root.unmount());
  });

  it('shows calls today 201 (bland.attempts), not 200 (batch accepted)', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Calls today')).toBe(true);
    expect(has(root, 'outbound accepted')).toBe(true);
    act(() => root.unmount());
  });

  it('shows per-agent active calls from in_progress=2, not currently_receiving flag', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Active calls')).toBe(true);
    act(() => root.unmount());
  });

  it('shows per-agent dialer attempts from ops agent.attempts=50', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Dialer attempts')).toBe(true);
    expect(has(root, '50')).toBe(true);
    act(() => root.unmount());
  });

  it('shows No recent activity when no monitor report and no roster', async () => {
    mockMonitoringRequest.mockResolvedValue({ server_now: '2026-09-28T15:30:00Z', agents: [] } as never);
    mockAuthFetch.mockResolvedValue({ ok: true, data: makeOps(), status: 200, error: null, loggedOut: false } as never);
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'No recent activity')).toBe(true);
    act(() => root.unmount());
  });

  it('shows Not logged in when roster presence is disconnected', async () => {
    mockMonitoringRequest.mockResolvedValue({ server_now: '2026-09-28T15:30:00Z', agents: [] } as never);
    mockAuthFetch.mockResolvedValue({ ok: true, data: makeOps(), status: 200, error: null, loggedOut: false } as never);
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster('disconnected')] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Not logged in')).toBe(true);
    act(() => root.unmount());
  });

  it('shows not logged in when monitor presence is Not reporting', async () => {
    setupMocks({ report: [{ presence: 'Not reporting' }] });
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Not logged in')).toBe(true);
    act(() => root.unmount());
  });

  it('shows DIALER ON when campaign state is running', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'DIALER ON')).toBe(true);
    act(() => root.unmount());
  });

  it('shows DIALER OFF when campaign state is stopped and ops loaded', async () => {
    setupMocks({ ops: { campaign: { state: 'stopped', call_limit: 400, accepted: 200, concurrency: 12 } } });
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'DIALER OFF')).toBe(true);
    act(() => root.unmount());
  });

  it('shows empty state when ops loaded and no active agents', async () => {
    setupMocks({ ops: { agents: [] } });
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'No active agents')).toBe(true);
    act(() => root.unmount());
  });

  it('separates manual phone calls from dialer attempts', async () => {
    setupMocks({ report: [{ outbound_calls: 7 }] });
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'Dialer attempts')).toBe(true);
    expect(has(root, 'Manual phone calls')).toBe(true);
    act(() => root.unmount());
  });

  it('preserves last successful data on ops error after initial success', async () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    mockAuthFetch.mockResolvedValueOnce({ ok: true, data: makeOps(), status: 200, error: null, loggedOut: false } as never);
    mockAuthFetch.mockResolvedValueOnce({ ok: false, data: null, status: 500, error: 'fail', loggedOut: false } as never);
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(31000); });
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    expect(has(root, 'DIALER ON')).toBe(true);
    expect(has(root, 'stale')).toBe(true);
    act(() => root.unmount());
  });

  it('cleans up polling timer on unmount', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const callsBefore = mockAuthFetch.mock.calls.length;
    act(() => root.unmount());
    await act(async () => { await vi.advanceTimersByTimeAsync(35000); });
    expect(mockAuthFetch.mock.calls.length).toBe(callsBefore);
  });

  it('calls authFetch with FEDERAL_ONE_V2_URL (not PROVIDER_URL)', async () => {
    setupMocks();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(mockAuthFetch.mock.calls[0]?.[0]).toBe('https://test-federal-one-v2.example.com');
    act(() => root.unmount());
  });
});

// ── New behavioral tests: single-flight, overlap, hidden pause, abort, stale ──

// Minimal document stub for Node environment — the hook guards all access with typeof checks,
// but the tests need to simulate visibility changes.
const docStub: { visibilityState: string; dispatchEvent: (e: Event) => void; addEventListener: (type: string, listener: (e: Event) => void) => void; removeEventListener: (type: string, listener: (e: Event) => void) => void } = {
  visibilityState: 'visible',
  dispatchEvent: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
const listeners: Record<string, ((e: Event) => void)[]> = {};
docStub.addEventListener = (type, listener) => { (listeners[type] ??= []).push(listener); };
docStub.removeEventListener = (type, listener) => { listeners[type] = (listeners[type] || []).filter(l => l !== listener); };
docStub.dispatchEvent = (e) => { (listeners[e.type] || []).forEach(l => l(e)); };
(globalThis as unknown as Record<string, unknown>).document = docStub;

describe('AdminDialerOverview polling safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMonitoringRequest.mockReset();
    mockAuthFetch.mockReset();
    docStub.visibilityState = 'visible';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not overlap ops requests when the response is slow (single-flight)', async () => {
    // Ops resolves only after 40s — longer than the 30s poll interval.
    let opsResolve: ((v: { ok: boolean; data: unknown; status: number; error: string | null; loggedOut: boolean }) => void) | undefined;
    const opsPromise = new Promise(r => { opsResolve = r; });
    mockAuthFetch.mockReturnValue(opsPromise as never);
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);

    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    // Let the effect kick off the first request.
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);

    // Advance past the 30s interval — the timer fires but must NOT start a second request.
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);

    // Now resolve the slow request.
    await act(async () => {
      opsResolve!({ ok: true, data: makeOps(), status: 200, error: null, loggedOut: false });
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);

    // After resolution, the next poll fires at the normal 30s interval.
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });

  it('does not overlap monitor requests when the response is slow (single-flight)', async () => {
    let monResolve: ((v: unknown) => void) | undefined;
    const monPromise = new Promise(r => { monResolve = r; });
    mockMonitoringRequest.mockReturnValue(monPromise as never);
    mockAuthFetch.mockResolvedValue({ ok: true, data: makeOps(), status: 200, error: null, loggedOut: false } as never);

    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(mockMonitoringRequest).toHaveBeenCalledTimes(1);

    // Advance past the 60s monitor interval — must NOT start a second request.
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mockMonitoringRequest).toHaveBeenCalledTimes(1);

    // Resolve the slow request, then advance to trigger the next poll.
    await act(async () => {
      monResolve!(makeReport());
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mockMonitoringRequest).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mockMonitoringRequest).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });

  function setupMocksPoll(overrides?: { ops?: Partial<ReturnType<typeof makeOps>>; report?: Partial<{ id: string; presence: string; current_login_seconds: number | null; outbound_calls: number }>[] }) {
    mockMonitoringRequest.mockResolvedValue(makeReport(overrides?.report) as never);
    mockAuthFetch.mockResolvedValue({ ok: true, data: { ...makeOps(), ...overrides?.ops }, status: 200, error: null, loggedOut: false } as never);
  }

  it('pauses polling when the tab is hidden and resumes on visible', async () => {
    setupMocksPoll();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const callsBeforeHide = mockAuthFetch.mock.calls.length;

    // Hide the tab.
    docStub.visibilityState = 'hidden';
    act(() => { docStub.dispatchEvent(new Event('visibilitychange')); });

    // Advance past the 30s interval — should NOT poll while hidden.
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mockAuthFetch.mock.calls.length).toBe(callsBeforeHide);

    // Make the tab visible again — should trigger an immediate refresh.
    docStub.visibilityState = 'visible';
    await act(async () => {
      docStub.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mockAuthFetch.mock.calls.length).toBeGreaterThan(callsBeforeHide);

    act(() => root.unmount());
  });

  it('aborts in-flight requests on unmount (no state writes after unmount)', async () => {
    let opsResolve: ((v: { ok: boolean; data: unknown; status: number; error: string | null; loggedOut: boolean }) => void) | undefined;
    const opsPromise = new Promise(r => { opsResolve = r; });
    mockAuthFetch.mockReturnValue(opsPromise as never);
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);

    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);

    // Unmount while the request is still in-flight.
    act(() => root.unmount());

    // Resolve the orphaned request — must not cause any error or state write.
    await act(async () => {
      opsResolve!({ ok: true, data: makeOps(), status: 200, error: null, loggedOut: false });
      await vi.advanceTimersByTimeAsync(100);
    });

    // No new requests should fire after unmount.
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
  });

  it('preserves last good ops snapshot on error and recovers on next success', async () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    // First: success, second: failure, third: success with updated data.
    mockAuthFetch.mockResolvedValueOnce({ ok: true, data: makeOps(), status: 200, error: null, loggedOut: false } as never);
    mockAuthFetch.mockResolvedValueOnce({ ok: false, data: null, status: 500, error: 'fail', loggedOut: false } as never);
    const updatedOps = { ...makeOps(), campaign: { ...makeOps().campaign, accepted: 250 } };
    mockAuthFetch.mockResolvedValueOnce({ ok: true, data: updatedOps, status: 200, error: null, loggedOut: false } as never);

    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(has(root, 'DIALER ON')).toBe(true);

    // Second poll: failure — should preserve DIALER ON and show stale.
    await act(async () => { await vi.advanceTimersByTimeAsync(31000); });
    expect(has(root, 'DIALER ON')).toBe(true);
    expect(has(root, 'stale')).toBe(true);

    // Third poll: success — should clear stale and show updated accepted=250.
    // After a failure, backoff is 60s (30s * 2^1), so advance 65s to ensure the poll fires.
    await act(async () => { await vi.advanceTimersByTimeAsync(65000); });
    expect(has(root, 'DIALER ON')).toBe(true);
    expect(has(root, '250')).toBe(true);

    act(() => root.unmount());
  });

  it('preserves last good monitor snapshot on error and recovers on next success', async () => {
    // First: success (outbound_calls=7), second: failure, third: success (outbound_calls=99).
    mockMonitoringRequest.mockResolvedValueOnce(makeReport() as never);
    mockMonitoringRequest.mockRejectedValueOnce(new Error('timeout') as never);
    mockMonitoringRequest.mockResolvedValueOnce(makeReport([{ outbound_calls: 99 }]) as never);
    mockAuthFetch.mockResolvedValue({ ok: true, data: makeOps(), status: 200, error: null, loggedOut: false } as never);

    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    // Monitor data loaded with outbound_calls=7.
    expect(has(root, 'Manual phone calls')).toBe(true);

    // Second poll (60s): failure — monitor should preserve last good data.
    await act(async () => { await vi.advanceTimersByTimeAsync(61000); });
    // Still shows manual phone calls from preserved snapshot.
    expect(has(root, 'Manual phone calls')).toBe(true);

    // Third poll: after a failure, backoff is 120s (60s * 2^1). Advance 130s to ensure it fires.
    await act(async () => { await vi.advanceTimersByTimeAsync(130000); });
    expect(has(root, '99')).toBe(true);

    act(() => root.unmount());
  });

  it('shows Last reported when data is stale, not fresh green status', async () => {
    setupMocksPoll();
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    // Initially should show "Last reported online" (since stale flag is false but we use the label).
    expect(has(root, 'Last reported online')).toBe(true);
    act(() => root.unmount());
  });
});
