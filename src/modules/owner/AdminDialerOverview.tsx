import { useEffect, useRef, useState } from 'react';
import { fmtDuration, fmtTime, initials, type AdminStats, type RosterAttendanceRow } from '@/app/shared';
import { monitoringRequest, costaRicaDay } from '@/modules/monitoring/api';

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

type Props = {
  sessionToken: string;
  adminStats: AdminStats | null;
  rosterAttendance: RosterAttendanceRow[];
  onUnauthorized: () => void;
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

export function AdminDialerOverview({ sessionToken, adminStats, rosterAttendance, onUnauthorized }: Props) {
  const [report, setReport] = useState<MonitorReport | null>(null);
  const [reportError, setReportError] = useState(false);
  const [statsAsOf, setStatsAsOf] = useState<string | null>(null);
  const [monitorAsOf, setMonitorAsOf] = useState<string | null>(null);
  const abortedRef = useRef(false);

  useEffect(() => {
    abortedRef.current = false;
    let timer: ReturnType<typeof setTimeout>;
    let pending = false;

    const poll = async () => {
      if (abortedRef.current || pending) return;
      pending = true;
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
        pending = false;
      }
      if (!abortedRef.current) timer = setTimeout(poll, 30000);
    };
    void poll();
    return () => {
      abortedRef.current = true;
      clearTimeout(timer);
    };
  }, [sessionToken]);

  useEffect(() => {
    if (adminStats?.summary.as_of) setStatsAsOf(adminStats.summary.as_of);
  }, [adminStats?.summary.as_of]);

  const summary = adminStats?.summary;
  const agents = adminStats?.agents ?? [];
  const activeAgents = agents.filter(a => a.status === 'active' && !a.role?.includes('owner') && !a.role?.includes('archived'));

  const dialerOn = summary?.campaign_state === 'running';
  const callsToday = summary?.calls_attempted_today;
  const lineLimit = summary?.provider_call_limit;
  const activeCalls = summary?.active_call_count;
  const reservedCalls = summary?.reserved_call_count;
  const acceptedAwaiting = (activeCalls ?? 0) + (reservedCalls ?? 0);
  const leadsRemaining = summary?.leads_remaining;
  const batchAccepted = summary?.agent_answered_today;
  const batchLimit = summary?.daily_minute_cap;
  const remainingAttempts = leadsRemaining;
  const hourlyPace = summary?.funnel_today?.calls_attempted;
  const hourlyCeiling = summary?.daily_minute_cap;

  const lastAcceptedTime = agents
    .map(a => a.last_call_time)
    .filter((t): t is string => !!t)
    .sort()
    .slice(-1)[0];
  const lastAcceptedAgent = agents.find(a => a.last_call_time === lastAcceptedTime)?.full_name;

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
          <Stat label="Accepted calls awaiting" value={acceptedAwaiting > 0 ? acceptedAwaiting : '0'} />
          <Stat label="Line limit" value={lineLimit ?? '—'} sub="configured" />
          <Stat label="Calls placed today" value={callsToday ?? '—'} sub="Costa Rica day" />
        </div>
        <div className="ado-strip-section">
          <Stat label="Batch accepted" value={batchAccepted ?? '—'} />
          <Stat label="Batch limit" value={batchLimit ? `${batchLimit} min` : '—'} sub="daily cap" />
          <Stat label="Remaining attempts" value={remainingAttempts ?? '—'} />
        </div>
        <div className="ado-strip-section">
          <Stat label="Last-hour pace" value={hourlyPace ?? '—'} sub="calls in funnel today" />
          <Stat label="Hourly ceiling" value={hourlyCeiling ? `${hourlyCeiling} min` : '—'} sub="daily cap" />
        </div>
        {(lastAcceptedTime || lastAcceptedAgent) && (
          <div className="ado-strip-section ado-latest">
            <span className="ado-stat-label">Latest accepted</span>
            <strong className="ado-stat-value">
              {lastAcceptedAgent ?? '—'}
              {lastAcceptedTime && ` · ${fmtTime(lastAcceptedTime)}`}
            </strong>
          </div>
        )}
      </div>

      <div className="ado-timestamps">
        {statsAsOf && <span>Dialer stats updated {fmtTime(statsAsOf)}</span>}
        {monitorAsOf && <span>Team monitor updated {fmtTime(monitorAsOf)}</span>}
        {reportError && <span className="ado-stale">Team monitor data is stale — retrying</span>}
        {!adminStats && <span className="ado-stale">Dialer stats loading…</span>}
      </div>

      <div className="ado-agent-cards">
        {activeAgents.map(agent => {
          const monAgent = report?.agents.find(a => a.id === agent.id);
          const roster = rosterAttendance.find(r => r.agent_id === agent.id);
          const online = monAgent && monAgent.presence !== 'Not reporting';
          const color = agentColor(agent.full_name);
          const sessionDur = monAgent?.current_login_seconds;
          const transfersRequested = agent.transfers_requested_today ?? 0;
          const transfersReached = agent.talkroute_leg_created_today ?? 0;
          const transfersConfirmed = agent.bridge_confirmed_today ?? 0;
          const manualCalls = monAgent?.outbound_calls ?? 0;
          const activeNow = agent.currently_receiving;

          return (
            <div key={agent.id} className="ado-agent-card" style={{ borderTopColor: color }}>
              <div className="ado-agent-header">
                <span className="ado-agent-avatar" style={{ background: color, color: '#102132' }}>
                  {initials(agent.full_name)}
                </span>
                <div>
                  <strong className="ado-agent-name">{agent.full_name}</strong>
                  <span className={`ado-agent-login ${online ? 'online' : 'offline'}`}>
                    {!report ? '—' : online ? '● Logged in' : '○ Not logged in'}
                  </span>
                </div>
              </div>
              <div className="ado-agent-session">
                <span className="ado-stat-label">Session</span>
                <strong>{report ? (online ? fmtDuration(sessionDur) : 'Not logged in') : '—'}</strong>
              </div>
              <div className="ado-agent-metrics">
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Dialer attempts today</span>
                  <strong>{agent.outbound_attempts_today}</strong>
                </div>
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Active call</span>
                  <strong>{activeNow ? 'Yes' : 'No'}</strong>
                </div>
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Transfers requested</span>
                  <strong>{transfersRequested}</strong>
                </div>
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Transfers reached</span>
                  <strong>{transfersReached}</strong>
                </div>
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Confirmed pickups</span>
                  <strong>{transfersConfirmed}</strong>
                </div>
                <div className="ado-agent-metric">
                  <span className="ado-stat-label">Manual phone calls</span>
                  <strong>{manualCalls}</strong>
                </div>
              </div>
            </div>
          );
        })}
        {activeAgents.length === 0 && (
          <div className="ado-empty">No active agents on the roster.</div>
        )}
      </div>
    </section>
  );
}
