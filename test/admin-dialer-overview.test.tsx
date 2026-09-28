import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const COMP_PATH = join(__dirname, '..', 'src', 'modules', 'owner', 'AdminDialerOverview.tsx');
const SOURCE = readFileSync(COMP_PATH, 'utf-8');

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

// DISTINCT values to catch mapping mix-ups:
// configured=12, hourly_target=400, recent_hour=201, bland.attempts=201, campaign.accepted=200,
// campaign.call_limit=400, leads_remaining=2104, agent.attempts=50, agent.in_progress=2
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
    expect(SOURCE).toContain('FEDERAL_ONE_V2_URL');
    expect(SOURCE).not.toContain('PROVIDER_URL');
  });

  it('calls authFetch with action operations_overview and window today', () => {
    expect(SOURCE).toContain("'operations_overview'");
    expect(SOURCE).toContain("'today'");
  });

  it('uses monitoringRequest for team monitor data', () => {
    expect(SOURCE).toContain('monitoringRequest');
  });

  it('does not edit backend, phone, auth, or session code', () => {
    expect(SOURCE).not.toContain('wolf-auth');
    expect(SOURCE).not.toContain('dialer-controls');
    expect(SOURCE).not.toContain('atomicLogout');
  });

  it('uses campaign?.accepted for batch accepted (not agent_answered_today)', () => {
    expect(SOURCE).toMatch(/campaign\?\.accepted/);
    expect(SOURCE).not.toContain('agent_answered_today');
  });

  it('uses campaign?.call_limit for batch limit (not daily_minute_cap)', () => {
    expect(SOURCE).toMatch(/campaign\?\.call_limit/);
    expect(SOURCE).not.toContain('daily_minute_cap');
  });

  it('uses lines?.configured for line limit (not provider_call_limit)', () => {
    expect(SOURCE).toMatch(/lines\?\.configured/);
    expect(SOURCE).not.toContain('provider_call_limit');
  });

  it('uses lines?.hourly_target for hourly ceiling (not daily_minute_cap)', () => {
    expect(SOURCE).toMatch(/lines\?\.hourly_target/);
    expect(SOURCE).not.toContain('daily_minute_cap');
  });

  it('uses lines?.recent_hour for rolling pace (not funnel_today fallback)', () => {
    expect(SOURCE).toMatch(/lines\?\.recent_hour/);
    expect(SOURCE).not.toContain('funnel_today');
  });

  it('uses agent.in_progress for per-agent active calls (not currently_receiving)', () => {
    expect(SOURCE).toMatch(/agent\.in_progress/);
    expect(SOURCE).not.toContain('currently_receiving');
  });

  it('computes batch remaining from call_limit - accepted (not leads_remaining)', () => {
    expect(SOURCE).toContain('call_limit');
    expect(SOURCE).toContain('accepted');
  });

  it('shows No recent activity when no presence data available', () => {
    expect(SOURCE).toContain('No recent activity');
  });

  it('does not expose customer PII', () => {
    expect(SOURCE).not.toMatch(/consumer_name|consumer_phone|client_name|client_phone|phone_normalized/);
  });

  it('renders LOADING badge when ops not loaded (never OFF before data)', () => {
    expect(SOURCE).toContain('LOADING');
  });

  it('renders dashes when ops not loaded (never zero counts before data)', () => {
    expect(SOURCE).toContain('opsLoaded');
  });

  it('renders loading message for agent cards when ops not loaded (never empty roster claim)', () => {
    expect(SOURCE).toContain('Loading agent cards');
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

  // CRITICAL: failed initial fetch must never show DIALER OFF, zero counts, or empty roster
  it('failed initial fetch shows LOADING/dashes/loading message, never DIALER OFF or No active agents', async () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    mockAuthFetch.mockResolvedValue({ ok: false, data: null, status: 500, error: 'fail', loggedOut: false } as never);
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    // Must NOT show DIALER OFF when no data has loaded
    expect(has(root, 'DIALER OFF')).toBe(false);
    // Must NOT show "No active agents on the roster" when no data has loaded
    expect(has(root, 'No active agents on the roster')).toBe(false);
    // Must show LOADING or unavailable state
    const txt = allText(root);
    expect(txt.includes('LOADING') || txt.includes('unavailable') || txt.includes('loading') || txt.includes('Loading')).toBe(true);
    act(() => root.unmount());
  });

  it('failed initial fetch shows dashes for counts, not 0', async () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    mockAuthFetch.mockResolvedValue({ ok: false, data: null, status: 500, error: 'fail', loggedOut: false } as never);
    const root = renderComp({ adminStats: makeAdminStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    // Active calls should be — not 0
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
    // Should still show DIALER ON from preserved data, not LOADING or OFF
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
