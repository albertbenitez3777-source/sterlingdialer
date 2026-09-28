import { useEffect, useRef, useState } from 'react';
import { fmtDuration, fmtTime, initials, type AdminStats, type RosterAttendanceRow, PROVIDER_URL } from '@/app/shared';
import { monitoringRequest, costaRicaDay } from '@/modules/monitoring/api';
import { authFetch } from '@/utils/auth-fetch';

type AgentMonitor = {
  id: string; full_name: string; presence: string;
  current_login_seconds: number | null; logged_seconds: number;
  outbound_calls: number; outbound_answered: number;
  inbound_answered: number; transfers_received: number;
  transfers_answered: number; transfers_sent: number;
};

type MonitorReport = {
  server_now: string; agents: AgentMonitor[];
};

type OpsAgent = {
  id: string; full_name: string; status: string; selected: boolean;
  phone_ready: boolean; route_ready: boolean; zadarma_number: string;
  attempts: number; humans: number; transfers: number; incoming: number;
  answered: number; transfer_answers: number; voicemail_reached: number;
  messages: number; unheard: number; unheard_backlog: number; missed: number;
  callbacks: number; in_progress: number;
};

type OperationsOverview = {
  as_of: string;
  campaign: { state?: string; call_limit?: number; accepted?: number; concurrency?: number; started_at?: string };
  lines: { configured: number; effective: number; active: number; reserved: number; aged: number; hourly_target: number; minute_limit: number; recent_hour: number; recent_minute: number; pacing_allowance: number; available_slots: number; agent_slots: number; selected_agents: number; eligible_agents: number; blocking_reason: string | null };
  bland: { attempts: number; humans: number; transfers: number; destination_dialed: number; bridge_confirmed: number; in_progress: number; no_answer: number; customer_voicemail: number; failures: number; minutes: number; linked_received: number; linked_answered: number; linked_voicemail: number };
  agents: OpsAgent[];
};

type Props = {
  sessionToken: string;
  adminStats: AdminStats | null;
  rosterAttendance: RosterAttendanceRow[];
};

const AGENT_COLORS: Record<string, string> = {
  'James Spencer': '#3b82f6',
  'Erick Jackson': '#10b981',
  'Mark Carlson': '#f59e0b',
};

function agentColor(name: string): string {
  return AGENT_COLORS[name] || '#64748b';
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="ado-stat">
      <span className="ado-stat-label">{label}</span>
      <strong className="ado-stat-value">{value}</strong>
      {sub && <span className="ado-stat-sub">{sub}</span>}
    </div>
  );
}

export function AdminDialerOverview({ sessionToken, adminStats, rosterAttendance }: Props) {
  const [report, setReport] = useState<MonitorReport | null>(null);
  const [reportError, setReportError] = useState(false);
  const [ops, setOps] = useState<OperationsOverview | null>(null);
  const [opsError, setOpsError] = useState(false);
  const [monitorAsOf, setMonitorAsOf] = useState<string | null>(null);
  const abortedRef = useRef(false);

  useEffect(() => {
    abortedRef.current = false;
    let timer: ReturnType<typeof setTimeout>;
    let monPending = false;
    let opsPending = false;

    const pollMon = async () => {
      if (abortedRef.current || monPending) return;
      monPending = true;
      try {
        const day = costaRicaDay();
        const data = await monitoringRequest(sessionToken, { action: 'report', day });
        if (abortedRef.current) return;
        setReport(data);
        setMonitorAsOf(data.server_now || new Date().toISOString());
        setReportError(false);
      } catch {
        if (!abortedRef.current) setReportError(true);
      } finally {
        monPending = false;
      }
    };

    const pollOps = async () => {
      if (abortedRef.current || opsPending) return;
      opsPending = true;
      try {
        const result = await authFetch<OperationsOverview>(PROVIDER_URL, {
          body: { action: 'operations_overview', session_token: sessionToken, window: 'today' },
        });
        if (abortedRef.current) return;
        if (result.ok && result.data?.lines) {
          setOps(result.data);
          setOpsError(false);
        } else {
          setOpsError(true);
        }
      } catch {
        if (!abortedRef.current) setOpsError(true);
      } finally {
        opsPending = false;
      }
    };

    const pollAll = async () => {
      await Promise.all([pollMon(), pollOps()]);
      if (!abortedRef.current) timer = setTimeout(pollAll, 30000);
    };
    void pollAll();
    return () => {
      abortedRef.current = true;
      clearTimeout(timer);
    };
  }, [sessionToken]);

  const campaign = ops?.campaign;
  const lines = ops?.lines;
  const bland = ops?.bland;
  const opsAgents = ops?.agents ?? [];

  const dialerOn = campaign?.state === 'running';
  const activeCalls = lines?.active ?? 0;
  const reservedSlots = lines?.reserved ?? 0;
  const configuredLimit = lines?.configured;
  const callsToday = bland?.attempts;
  const batchAccepted = campaign?.accepted ?? 0;
  const batchLimit = campaign?.call_limit;
  const batchRemaining = batchLimit != null ? Math.max(0, batchLimit - batchAccepted) : null;
  const recentHour = lines?.recent_hour;
  const hourlyTarget = lines?.hourly_target;
  const minuteLimit = lines?.minute_limit;
  const newLeads = adminStats?.summary.leads_remaining;

  const activeOpsAgents = opsAgents.filter(a => a.status === 'active');

  return (
    <section className="ado-overview" aria-label="Dialer overview">
      <div className="ado-strip">
        <div className="ado-strip-section">
          <div className={`ado-dialer-badge ${dialerOn ? 'on' : 'off'}`}>
            <span className="ado-dialer-dot" />
            <strong>{dialerOn ? 'DIALER ON' : 'DIALER OFF'}</strong>
          </div>
        </div>
        <div className="ado-strip-section">
          <Stat label="Active calls" value={activeCalls} sub="provider-accepted" />
          <Stat label="Reserved slots" value={reservedSlots} sub="not accepted" />
          <Stat label="Line limit" value={configuredLimit ?? '—'} sub="configured" />
          <Stat label="Calls today" value={callsToday ?? '—'} sub="outbound accepted" />
        </div>
        <div className="ado-strip-section">
          <Stat label="Batch accepted" value={batchAccepted} sub="this run" />
          <Stat label="Batch limit" value={batchLimit ?? '—'} sub="call ceiling" />
          <Stat label="Attempts left in batch" value={batchRemaining ?? '—'} />
        </div>
        <div className="ado-strip-section">
          <Stat label="Last-hour pace" value={recentHour ?? '—'} sub="rolling 60 min" />
          <Stat label="Hourly ceiling" value={hourlyTarget ?? '—'} sub="target / hr" />
          <Stat label="Minute limit" value={minuteLimit ?? '—'} sub="max new starts" />
        </div>
        {newLeads != null && (
          <div className="ado-strip-section ado-latest">
            <span className="ado-stat-label">New leads</span>
            <strong className="ado-stat-value">{newLeads}</strong>
          </div>
        )}
      </div>

      <div className="ado-timestamps">
        {ops && <span>Operations updated {fmtTime(ops.as_of)}</span>}
        {monitorAsOf && <span>Team monitor updated {fmtTime(monitorAsOf)}</span>}
        {opsError && <span className="ado-stale">Operations data is stale — retrying</span>}
        {reportError && <span className="ado-stale">Team monitor data is stale — retrying</span>}
        {!ops && !opsError && <span className="ado-stale">Operations data loading…</span>}
      </div>

      <div className="ado-agent-cards">
        {activeOpsAgents.map(agent => {
          const monAgent = report?.agents.find(a => a.id === agent.id);
          const roster = rosterAttendance.find(r => r.agent_id === agent.id);
          const hasPresence = monAgent || roster;
          const online = monAgent ? monAgent.presence !== 'Not reporting' : roster?.presence === 'online';
          const color = agentColor(agent.full_name);
          const sessionDur = monAgent?.current_login_seconds;
          const manualCalls = monAgent?.outbound_calls ?? 0;
          const activeNow = agent.in_progress;

          return (
            <div key={agent.id} className="ado-agent-card" style={{ borderTopColor: color }}>
              <div className="ado-agent-header">
                <span className="ado-agent-avatar" style={{ background: color, color: '#102132' }}>
                  {initials(agent.full_name)}
                </span>
                <div>
                  <strong className="ado-agent-name">{agent.full_name}</strong>
                  <span className={`ado-agent-login ${online ? 'online' : 'offline'}`}>
                    {!hasPresence ? 'No recent activity' : online ? '● Logged in' : '○ Not logged in'}
                  </span>
                </div>
              </div>
              <div className="ado-agent-session">
                <span className="ado-stat-label">Session</span>
                <strong>{report ? (online ? fmtDuration(sessionDur) : 'Not logged in') : 'Unknown'}</strong>
              </div>
              <div className="ado-agent-metrics">
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Dialer attempts</span>
                  <strong>{agent.attempts}</strong>
                </div>
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Active calls</span>
                  <strong>{activeNow}</strong>
                </div>
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Humans reached</span>
                  <strong>{agent.humans}</strong>
                </div>
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Transfers requested</span>
                  <strong>{agent.transfers}</strong>
                </div>
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Transfer answers</span>
                  <strong>{agent.transfer_answers}</strong>
                </div>
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Manual phone calls</span>
                  <strong>{manualCalls}</strong>
                </div>
              </div>
            </div>
          );
        })}
        {activeOpsAgents.length === 0 && (
          <div className="ado-empty">No active agents on the roster.</div>
        )}
      </div>
    </section>
  );
}
