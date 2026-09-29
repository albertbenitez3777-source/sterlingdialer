import { useEffect, useRef, useState } from 'react';
import { FEDERAL_ONE_V2_URL, type RosterAttendanceRow } from '@/app/shared';
import { authFetch } from '@/utils/auth-fetch';
import { monitoringRequest, costaRicaDay } from '@/modules/monitoring/api';

export type AgentMonitor = {
  id: string; full_name: string; presence: string;
  current_login_seconds: number | null; logged_seconds: number;
  outbound_calls: number; outbound_answered: number;
  inbound_answered: number; transfers_received: number;
  transfers_answered: number; transfers_sent: number;
};

export type MonitorReport = {
  server_now: string; agents: AgentMonitor[];
};

export type OpsAgent = {
  id: string; full_name: string; status: string; selected: boolean;
  phone_ready: boolean; route_ready: boolean; zadarma_number: string;
  attempts: number; humans: number; transfers: number; incoming: number;
  answered: number; transfer_answers: number; voicemail_reached: number;
  messages: number; unheard: number; unheard_backlog: number; missed: number;
  callbacks: number; in_progress: number;
};

export type OperationsOverview = {
  as_of: string;
  campaign: { state?: string; call_limit?: number | null; accepted?: number; concurrency?: number; started_at?: string };
  lines: { configured: number; effective: number; active: number; reserved: number; aged: number; hourly_target: number; minute_limit: number; recent_hour: number; recent_minute: number; pacing_allowance: number; available_slots: number; agent_slots: number; selected_agents: number; eligible_agents: number; blocking_reason: string | null };
  bland: { attempts: number; humans: number; transfers: number; destination_dialed: number; bridge_confirmed: number; in_progress: number; no_answer: number; customer_voicemail: number; failures: number; minutes: number; linked_received: number; linked_answered: number; linked_voicemail: number };
  agents: OpsAgent[];
};

const OPS_INTERVAL_MS = 30_000;
const MONITOR_INTERVAL_MS = 60_000;
const OPS_MAX_BACKOFF_MS = 60_000;
const MONITOR_MAX_BACKOFF_MS = 120_000;
const STALE_AFTER_MS = 90_000;

type SourceState<T> = {
  data: T | null;
  error: boolean;
  asOf: string | null;
};

function initState<T>(): SourceState<T> {
  return { data: null, error: false, asOf: null };
}

export type AdminDialerOverviewData = {
  report: MonitorReport | null;
  reportError: boolean;
  reportStale: boolean;
  monitorAsOf: string | null;
  ops: OperationsOverview | null;
  opsError: boolean;
  opsStale: boolean;
  opsAsOf: string | null;
  rosterAttendance: RosterAttendanceRow[];
};

export function useAdminDialerOverviewData(
  sessionToken: string,
  rosterAttendance: RosterAttendanceRow[],
): AdminDialerOverviewData {
  const [opsState, setOpsState] = useState<SourceState<OperationsOverview>>(initState);
  const [monState, setMonState] = useState<SourceState<MonitorReport>>(initState);
  const [reportStale, setReportStale] = useState(false);
  const [opsStale, setOpsStale] = useState(false);

  const opsAsOfRef = useRef<string | null>(null);
  const monAsOfRef = useRef<string | null>(null);
  opsAsOfRef.current = opsState.asOf;
  monAsOfRef.current = monState.asOf;

  const rosterRef = useRef(rosterAttendance);
  rosterRef.current = rosterAttendance;

  useEffect(() => {
    let stopped = false;
    let opsPending = false;
    let monPending = false;
    let opsTimer: ReturnType<typeof setTimeout> | undefined;
    let monTimer: ReturnType<typeof setTimeout> | undefined;
    let opsController: AbortController | undefined;
    let monController: AbortController | undefined;
    let opsFailures = 0;
    let monFailures = 0;

    const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const pollOps = async () => {
      if (stopped || opsPending) return;
      if (isHidden()) { opsTimer = setTimeout(pollOps, OPS_INTERVAL_MS); return; }
      opsPending = true;
      opsController = new AbortController();
      try {
        const result = await authFetch<OperationsOverview>(FEDERAL_ONE_V2_URL, {
          body: { action: 'operations_overview', session_token: sessionToken, window: 'today' },
          signal: opsController.signal,
          onUnauthorized: () => { /* session handled by workspace poll; never auto-logout here */ },
        });
        if (stopped || opsController.signal.aborted) return;
        if (result.ok && result.data?.lines) {
          opsFailures = 0;
          setOpsState({ data: result.data, error: false, asOf: result.data.as_of });
          setOpsStale(false);
        } else {
          opsFailures = Math.min(opsFailures + 1, 4);
          setOpsState(prev => ({ data: prev.data, error: true, asOf: prev.asOf }));
        }
      } catch {
        if (!stopped) {
          opsFailures = Math.min(opsFailures + 1, 4);
          setOpsState(prev => ({ data: prev.data, error: true, asOf: prev.asOf }));
        }
      } finally {
        opsPending = false;
        opsController = undefined;
        if (!stopped) {
          const backoff = Math.min(OPS_MAX_BACKOFF_MS, OPS_INTERVAL_MS * 2 ** opsFailures);
          opsTimer = setTimeout(pollOps, backoff);
        }
      }
    };

    const pollMon = async () => {
      if (stopped || monPending) return;
      if (isHidden()) { monTimer = setTimeout(pollMon, MONITOR_INTERVAL_MS); return; }
      monPending = true;
      monController = new AbortController();
      try {
        const day = costaRicaDay();
        const data = await monitoringRequest(sessionToken, { action: 'report', day }, monController.signal);
        if (stopped || monController.signal.aborted) return;
        monFailures = 0;
        setMonState({ data, error: false, asOf: data.server_now || new Date().toISOString() });
        setReportStale(false);
      } catch {
        if (!stopped) {
          monFailures = Math.min(monFailures + 1, 4);
          setMonState(prev => ({ data: prev.data, error: true, asOf: prev.asOf }));
        }
      } finally {
        monPending = false;
        monController = undefined;
        if (!stopped) {
          const backoff = Math.min(MONITOR_MAX_BACKOFF_MS, MONITOR_INTERVAL_MS * 2 ** monFailures);
          monTimer = setTimeout(pollMon, backoff);
        }
      }
    };

    void pollOps();
    void pollMon();

    const onVisible = () => {
      if (stopped || isHidden()) return;
      if (!opsPending) { clearTimeout(opsTimer); void pollOps(); }
      if (!monPending) { clearTimeout(monTimer); void pollMon(); }
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

    const staleTimer = setInterval(() => {
      if (stopped) return;
      const now = Date.now();
      if (opsAsOfRef.current && now - new Date(opsAsOfRef.current).getTime() > STALE_AFTER_MS) {
        setOpsStale(true);
      }
      if (monAsOfRef.current && now - new Date(monAsOfRef.current).getTime() > STALE_AFTER_MS) {
        setReportStale(true);
      }
    }, 10_000);

    return () => {
      stopped = true;
      clearTimeout(opsTimer);
      clearTimeout(monTimer);
      clearInterval(staleTimer);
      opsController?.abort();
      monController?.abort();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionToken]);

  return {
    report: monState.data,
    reportError: monState.error,
    reportStale,
    monitorAsOf: monState.asOf,
    ops: opsState.data,
    opsError: opsState.error,
    opsStale,
    opsAsOf: opsState.asOf,
    rosterAttendance: rosterRef.current,
  };
}
