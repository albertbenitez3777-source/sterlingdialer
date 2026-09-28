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
  };
});

import { AdminDialerOverview } from '@/modules/owner/AdminDialerOverview';
import { monitoringRequest } from '@/modules/monitoring/api';
import type { AdminStats, RosterAttendanceRow } from '@/app/shared';

const mockMonitoringRequest = vi.mocked(monitoringRequest);

function makeAgent(overrides: Partial<AdminStats['agents'][0]> = {}): AdminStats['agents'][0] {
  return {
    id: 'agent-1', full_name: 'James Spencer', role: 'agent', status: 'active',
    active_for_dialer: true, dialer_concurrency: 1,
    bland_number: '1234', talkroute_number: '5678', transfer_certified: true,
    outbound_attempts_today: 42, live_humans: 10, human_drops: 2, fire_transfers: 5,
    no_answers: 20, voice_messages: 5, pending_calls: 0, currently_receiving: false,
    last_call_time: '2026-09-28T15:00:00Z',
    outbound_attempts_week: 100, live_humans_week: 30, human_drops_week: 5,
    fire_transfers_week: 10, no_answers_week: 40, voice_messages_week: 10,
    transfers_requested_today: 5, talkroute_leg_created_today: 4, bridge_confirmed_today: 3,
    ...overrides,
  };
}

function makeStats(overrides: Partial<AdminStats> = {}): AdminStats {
  return {
    summary: {
      campaign_state: 'running', dialer_activated: true, concurrency: 3,
      provider_call_limit: 5, leads_remaining: 500, calls_attempted_today: 320,
      live_humans_today: 80, human_drops_today: 10, fire_transfers_today: 25,
      no_answers_today: 150, voice_messages_today: 40, blocking_reason: '',
      campaign_started_at: '2026-09-28T08:00:00Z',
      calls_attempted_week: 1000, live_humans_week: 200, human_drops_week: 30,
      fire_transfers_week: 50, no_answers_week: 400, voice_messages_week: 80,
      active_call_count: 2, reserved_call_count: 1,
      agent_answered_today: 60, daily_minute_cap: 600,
      funnel_today: { calls_attempted: 320, live_humans_reached: 80, transfers_requested: 25,
        talkroute_answered: 20, bridge_confirmed: 18, likely_real_conversation: 15,
        total_minutes: 120, productive_minutes: 60, wasted_minutes: 30, machine_minutes: 10,
        avg_ai_leg_seconds: 45, machines_detected: 40, avg_machine_seconds: 20,
        no_answer_count: 150, human_drop_count: 10, voice_message_count: 40,
        fire_transfer_count: 25, pending_count: 0 },
      as_of: '2026-09-28T15:30:00Z',
    } as AdminStats['summary'],
    agents: [makeAgent()],
    ...overrides,
  };
}

function makeRoster(overrides: Partial<RosterAttendanceRow> = {}): RosterAttendanceRow {
  return {
    agent_id: 'agent-1', full_name: 'James Spencer', role: 'agent',
    presence: 'online', last_confirmed_at: '2026-09-28T15:00:00Z',
    today_total_seconds: 3600, week_total_seconds: 18000,
    is_legacy_estimate: false, available_for_transfer: true, active_for_dialer: true,
    ...overrides,
  };
}

function makeReport(agents: Partial<{ id: string; full_name: string; presence: string; current_login_seconds: number | null; logged_seconds: number; outbound_calls: number; outbound_answered: number; inbound_answered: number; transfers_received: number; transfers_answered: number; transfers_sent: number }>[] = []) {
  return {
    server_now: '2026-09-28T15:30:00Z',
    agents: agents.map(a => ({
      id: 'agent-1', full_name: 'James Spencer', presence: 'Online',
      current_login_seconds: 1800, logged_seconds: 3600,
      outbound_calls: 3, outbound_answered: 2, inbound_answered: 1,
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

function text(root: ReturnType<typeof create>): string {
  const types = ['span', 'strong', 'div', 'p', 'small', 'button'];
  return types.flatMap(t => root.root.findAllByType(t).map(s => s.props.children).flat(Infinity)).filter((c): c is string => typeof c === 'string').join('|');
}

function hasText(root: ReturnType<typeof create>, needle: string): boolean {
  return text(root).includes(needle);
}

describe('AdminDialerOverview source checks', () => {
  it('separates manual phone calls from dialer attempts', () => {
    expect(SOURCE).toContain('outbound_attempts_today');
    expect(SOURCE).toContain('outbound_calls');
    expect(SOURCE).toContain('Manual phone calls');
    expect(SOURCE).toContain('Dialer attempts today');
  });

  it('does not call loadAdminStats or dialer-controls endpoint', () => {
    expect(SOURCE).not.toContain('loadAdminStats');
    expect(SOURCE).not.toContain('DIALER_CONTROLS_URL');
    expect(SOURCE).not.toContain('get_live_status');
    expect(SOURCE).not.toContain('get_admin_stats');
  });

  it('uses monitoringRequest (federal-one-monitoring) for team data', () => {
    expect(SOURCE).toContain('monitoringRequest');
  });

  it('does not edit backend, phone, auth, or session code', () => {
    expect(SOURCE).not.toContain('wolf-auth');
    expect(SOURCE).not.toContain('wolf-provider');
    expect(SOURCE).not.toContain('dialer-controls');
    expect(SOURCE).not.toContain('session_token');
    expect(SOURCE).not.toContain('atomicLogout');
  });

  it('preserves last successful data on error (does not clear report on catch)', () => {
    expect(SOURCE).toMatch(/catch\s*\{[^}]*setReportError/);
    expect(SOURCE).not.toMatch(/catch\s*\{[^}]*setReport\(null\)/);
  });

  it('shows stale indicator without zeroing out data', () => {
    expect(SOURCE).toContain('ado-stale');
    expect(SOURCE).toContain('Team monitor data is stale');
  });

  it('handles unknown/stale presence via roster fallback', () => {
    expect(SOURCE).toContain('Not reporting');
    expect(SOURCE).toContain("roster?.presence === 'online'");
  });

  it('does not expose customer names or phone numbers', () => {
    expect(SOURCE).not.toMatch(/consumer_name|consumer_phone|client_name|client_phone|phone_normalized/);
  });
});

describe('AdminDialerOverview rendering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMonitoringRequest.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading state when adminStats is null', async () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const root = renderComp({ adminStats: null });
    expect(hasText(root, 'Dialer stats loading')).toBe(true);
    act(() => root.unmount());
  });

  it('renders dialer ON badge when campaign is running', () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const root = renderComp({ adminStats: makeStats() });
    expect(hasText(root, 'DIALER ON')).toBe(true);
    act(() => root.unmount());
  });

  it('renders dialer OFF badge when campaign is stopped', () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const root = renderComp({ adminStats: makeStats({ summary: { ...makeStats().summary, campaign_state: 'stopped' } as AdminStats['summary'] }) });
    expect(hasText(root, 'DIALER OFF')).toBe(true);
    act(() => root.unmount());
  });

  it('shows active calls and reserved slots separately (not summed as accepted)', () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const root = renderComp({ adminStats: makeStats(), rosterAttendance: [makeRoster()] });
    expect(hasText(root, 'Active calls')).toBe(true);
    expect(hasText(root, 'Reserved slots')).toBe(true);
    expect(hasText(root, 'Accepted calls awaiting')).toBe(false);
    act(() => root.unmount());
  });

  it('shows line limit separately from calls placed today', () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const root = renderComp({ adminStats: makeStats(), rosterAttendance: [makeRoster()] });
    expect(hasText(root, 'Line limit')).toBe(true);
    expect(hasText(root, 'Calls placed today')).toBe(true);
    act(() => root.unmount());
  });

  it('shows batch accepted and batch limit separately', () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const root = renderComp({ adminStats: makeStats(), rosterAttendance: [makeRoster()] });
    expect(hasText(root, 'Batch accepted')).toBe(true);
    expect(hasText(root, 'Batch limit')).toBe(true);
    act(() => root.unmount());
  });

  it('shows attempts left in batch (not remaining leads)', () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const root = renderComp({ adminStats: makeStats(), rosterAttendance: [makeRoster()] });
    expect(hasText(root, 'Attempts left in batch')).toBe(true);
    expect(hasText(root, 'Remaining attempts')).toBe(false);
    act(() => root.unmount());
  });

  it('separates manual phone calls from dialer attempts in agent card', () => {
    mockMonitoringRequest.mockResolvedValue(makeReport([{ outbound_calls: 7 }]) as never);
    const root = renderComp({ adminStats: makeStats(), rosterAttendance: [makeRoster()] });
    expect(hasText(root, 'Dialer attempts today')).toBe(true);
    expect(hasText(root, 'Manual phone calls')).toBe(true);
    act(() => root.unmount());
  });

  it('preserves last successful report on monitoring error', async () => {
    const goodReport = makeReport([{ outbound_calls: 7 }]);
    mockMonitoringRequest.mockResolvedValueOnce(goodReport as never);
    mockMonitoringRequest.mockRejectedValueOnce(new Error('network') as never);
    const root = renderComp({ adminStats: makeStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(mockMonitoringRequest).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(31000); });
    expect(mockMonitoringRequest).toHaveBeenCalledTimes(2);
    expect(hasText(root, 'stale')).toBe(true);
    expect(hasText(root, 'Manual phone calls')).toBe(true);
    act(() => root.unmount());
  });

  it('uses roster presence fallback when monitor report has not loaded', async () => {
    mockMonitoringRequest.mockResolvedValue({ server_now: '2026-09-28T15:30:00Z', agents: [] } as never);
    const root = renderComp({ adminStats: makeStats(), rosterAttendance: [makeRoster({ presence: 'online' })] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(hasText(root, 'Logged in')).toBe(true);
    act(() => root.unmount());
  });

  it('shows not logged in when roster presence is disconnected and no monitor agent', async () => {
    mockMonitoringRequest.mockResolvedValue({ server_now: '2026-09-28T15:30:00Z', agents: [] } as never);
    const root = renderComp({ adminStats: makeStats(), rosterAttendance: [makeRoster({ presence: 'disconnected' })] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(hasText(root, 'Not logged in')).toBe(true);
    act(() => root.unmount());
  });

  it('shows not logged in when monitor presence is Not reporting', async () => {
    mockMonitoringRequest.mockResolvedValue(makeReport([{ presence: 'Not reporting' }]) as never);
    const root = renderComp({ adminStats: makeStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(hasText(root, 'Not logged in')).toBe(true);
    act(() => root.unmount());
  });

  it('excludes owner and archived agents from agent cards', () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const stats = makeStats({
      agents: [
        makeAgent({ id: 'agent-1', full_name: 'James Spencer', role: 'agent' }),
        makeAgent({ id: 'owner-1', full_name: 'Owner Bob', role: 'owner' }),
        makeAgent({ id: 'archived-1', full_name: 'Old Agent', role: 'archived', status: 'archived' }),
      ],
    });
    const root = renderComp({ adminStats: stats, rosterAttendance: [makeRoster()] });
    expect(hasText(root, 'James Spencer')).toBe(true);
    expect(hasText(root, 'Owner Bob')).toBe(false);
    expect(hasText(root, 'Old Agent')).toBe(false);
    act(() => root.unmount());
  });

  it('shows empty state when no active agents', () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const root = renderComp({ adminStats: makeStats({ agents: [] }), rosterAttendance: [] });
    expect(hasText(root, 'No active agents')).toBe(true);
    act(() => root.unmount());
  });

  it('shows latest accepted call agent', () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const stats = makeStats({
      agents: [
        makeAgent({ id: 'agent-1', full_name: 'James Spencer', last_call_time: '2026-09-28T14:00:00Z' }),
        makeAgent({ id: 'agent-2', full_name: 'Erick Jackson', last_call_time: '2026-09-28T15:00:00Z' }),
      ],
    });
    const root = renderComp({ adminStats: stats, rosterAttendance: [] });
    expect(hasText(root, 'Erick Jackson')).toBe(true);
    expect(hasText(root, 'Latest accepted')).toBe(true);
    act(() => root.unmount());
  });

  it('cleans up polling timer on unmount', async () => {
    mockMonitoringRequest.mockResolvedValue(makeReport() as never);
    const root = renderComp({ adminStats: makeStats(), rosterAttendance: [makeRoster()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const callsBefore = mockMonitoringRequest.mock.calls.length;
    act(() => root.unmount());
    await act(async () => { await vi.advanceTimersByTimeAsync(35000); });
    expect(mockMonitoringRequest.mock.calls.length).toBe(callsBefore);
  });
});
