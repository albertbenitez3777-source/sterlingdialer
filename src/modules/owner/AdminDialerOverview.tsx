import { fmtDuration, fmtTime, initials, type AdminStats, type RosterAttendanceRow } from '@/app/shared';
import {
  useAdminDialerOverviewData,
  type AgentMonitor,
  type MonitorReport,
  type OperationsOverview,
  type OpsAgent,
} from './useAdminDialerOverviewData';

type Props = {
  sessionToken: string;
  adminStats: AdminStats | null;
  rosterAttendance: RosterAttendanceRow[];
};

const AGENT_COLORS: Record<string, string> = {
  'James Spencer': '#3b82f6',
  'Todd Sloane': '#10b981',
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
  const {
    report, reportError, reportStale, monitorAsOf,
    ops, opsError, opsStale,
  } = useAdminDialerOverviewData(sessionToken, rosterAttendance);

  const opsLoaded = !!ops;
  const campaign = ops?.campaign;
  const lines = ops?.lines;
  const bland = ops?.bland;
  const opsAgents = ops?.agents;

  const dash = (v: number | undefined | null): string | number =>
    !opsLoaded ? '—' : v == null ? '—' : v;

  const dialerLabel = !opsLoaded ? 'LOADING' : campaign?.state === 'running' ? 'DIALER ON' : 'DIALER OFF';
  const dialerClass = !opsLoaded ? 'off' : campaign?.state === 'running' ? 'on' : 'off';

  const activeCalls = dash(lines?.active);
  const reservedSlots = dash(lines?.reserved);
  const configuredLimit = dash(lines?.configured);
  const callsToday = dash(bland?.attempts);
  const batchAccepted = dash(campaign?.accepted);
  const continuous = campaign?.call_limit === null;
  const batchLimit = dash(campaign?.call_limit);
  const batchRemaining = !opsLoaded || campaign?.call_limit == null ? '—' : Math.max(0, (campaign.call_limit ?? 0) - (campaign.accepted ?? 0));
  const recentHour = dash(lines?.recent_hour);
  const hourlyTarget = dash(lines?.hourly_target);
  const minuteLimit = dash(lines?.minute_limit);
  const newLeads = adminStats?.summary.leads_remaining;

  const activeOpsAgents = opsAgents?.filter(a => a.status === 'active') ?? [];

  return (
    <section className="ado-overview" aria-label="Dialer overview">
      <div className="ado-strip">
        <div className="ado-strip-section">
          <div className={`ado-dialer-badge ${dialerClass}`}>
            <span className="ado-dialer-dot" />
            <strong>{dialerLabel}</strong>
          </div>
        </div>
        <div className="ado-strip-section">
          <Stat label="Active calls" value={activeCalls} sub="provider-accepted" />
          <Stat label="Reserved slots" value={reservedSlots} sub="not accepted" />
          <Stat label="Line limit" value={configuredLimit} sub="configured" />
          <Stat label="Calls today" value={callsToday} sub="outbound accepted" />
        </div>
        <div className="ado-strip-section">
          <Stat label={continuous ? 'Calls this run' : 'Batch accepted'} value={batchAccepted} sub="outbound accepted" />
          <Stat label={continuous ? 'Run mode' : 'Batch limit'} value={continuous ? 'Until stopped' : batchLimit} sub={continuous ? 'all eligible leads' : 'call ceiling'} />
          {!continuous && <Stat label="Attempts left in batch" value={batchRemaining} />}
        </div>
        <div className="ado-strip-section">
          <Stat label="Last-hour pace" value={recentHour} sub="rolling 60 min" />
          <Stat label="Hourly ceiling" value={hourlyTarget} sub="target / hr" />
          <Stat label="Minute limit" value={minuteLimit} sub="max new starts" />
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
        {opsError && ops && <span className="ado-stale">Operations data is stale — retrying</span>}
        {opsError && !ops && <span className="ado-stale">Operations data unavailable — retrying</span>}
        {reportError && <span className="ado-stale">Team monitor data is stale — retrying</span>}
        {!ops && !opsError && <span className="ado-stale">Operations data loading…</span>}
      </div>

      <div className="ado-agent-cards">
        {opsLoaded && activeOpsAgents.map(agent => {
          const monAgent = report?.agents.find(a => a.id === agent.id);
          const roster = rosterAttendance.find(r => r.agent_id === agent.id);
          const hasPresence = monAgent || roster;
          const online = monAgent ? monAgent.presence !== 'Not reporting' : roster?.presence === 'online';
          const color = agentColor(agent.full_name);
          const sessionDur = monAgent?.current_login_seconds;
          const manualCalls = monAgent?.outbound_calls ?? 0;
          const activeNow = agent.in_progress;

          // When data is stale, show "Last reported" instead of implying live status.
          const presenceLabel = !hasPresence
            ? 'No recent activity'
            : reportStale || opsStale
              ? (online ? 'Last reported online' : 'Last reported offline')
              : (online ? 'Logged in' : 'Not logged in');

          return (
            <div key={agent.id} className="ado-agent-card" style={{ borderTopColor: color }}>
              <div className="ado-agent-header">
                <span className="ado-agent-avatar" style={{ background: color, color: '#102132' }}>
                  {initials(agent.full_name)}
                </span>
                <div>
                  <strong className="ado-agent-name">{agent.full_name}</strong>
                  <span className={`ado-agent-login ${online ? 'online' : 'offline'}`}>
                    {!hasPresence ? 'No recent activity' : online ? `Last reported online` : 'Not logged in'}
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
                  <span className="ado-stat-label">Human-classified calls</span>
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
        {opsLoaded && activeOpsAgents.length === 0 && (
          <div className="ado-empty">No active agents on the roster.</div>
        )}
        {!opsLoaded && (
          <div className="ado-empty">{opsError ? 'Operations data unavailable — agent cards will appear after a successful refresh.' : 'Loading agent cards…'}</div>
        )}
      </div>
    </section>
  );
}
