import { useState, useEffect, useCallback } from 'react';
import { Bell, ChevronDown, ChevronUp, RefreshCw, AlertTriangle } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';

type AgentAlertStats = {
  agent_id: string;
  agent_name: string;
  talkroute_number: string | null;
  total_alerts: number;
  active: number;
  answered: number;
  missed: number;
  callback_needed: number;
  completed: number;
  avg_response_seconds: number | null;
};

interface OwnerAlertOverviewProps {
  sessionToken: string;
  onUnauthorized: () => void;
  providerUrl: string;
}

export function OwnerAlertOverview({ sessionToken, onUnauthorized, providerUrl }: OwnerAlertOverviewProps) {
  const [expanded, setExpanded] = useState(true);
  const [stats, setStats] = useState<AgentAlertStats[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await authFetch(providerUrl, {
      body: { action: 'get_owner_alert_overview', session_token: sessionToken },
      onUnauthorized,
    });
    if (result.ok && result.data) {
      const d = result.data as Record<string, unknown>;
      setStats((d.agents || d.overview || []) as AgentAlertStats[]);
    }
    setLoading(false);
  }, [providerUrl, sessionToken, onUnauthorized]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const totalActive = stats.reduce((s, a) => s + (a.active || 0), 0);
  const totalMissed = stats.reduce((s, a) => s + (a.missed || 0), 0);
  const totalCallbacks = stats.reduce((s, a) => s + (a.callback_needed || 0), 0);

  return (
    <div className="owner-alerts-overview">
      <div className="oao-header" onClick={() => setExpanded(v => !v)}>
        <div className="oao-header-left">
          <Bell size={16} />
          <span style={{ fontWeight: 600 }}>Transfer Alerts</span>
          {totalActive > 0 && <span className="oao-badge oao-badge-warn">{totalActive} active</span>}
          {totalMissed > 0 && <span className="oao-badge oao-badge-danger">{totalMissed} missed</span>}
        </div>
        <div className="oao-header-right">
          <button className="oao-refresh" onClick={e => { e.stopPropagation(); setLoading(true); load(); }}>
            <RefreshCw size={14} className={loading ? 'ica-spin' : ''} />
          </button>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="oao-table-wrap">
          {stats.length === 0 && !loading ? (
            <div className="oao-empty">No transfer alert data yet</div>
          ) : (
            <table className="oao-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="oao-num">Total</th>
                  <th className="oao-num">Active</th>
                  <th className="oao-num">Answered</th>
                  <th className="oao-num">Missed</th>
                  <th className="oao-num">Callbacks</th>
                  <th className="oao-num">Avg Response</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(agent => {
                  const warn = (agent.missed || 0) >= 3 || (agent.callback_needed || 0) >= 3;
                  return (
                    <tr key={agent.agent_id} className={warn ? 'oao-row-warn' : ''}>
                      <td>
                        <div className="oao-agent-name">{agent.agent_name}</div>
                        {agent.talkroute_number && <div className="oao-agent-route">{agent.talkroute_number}</div>}
                      </td>
                      <td className="oao-num">{agent.total_alerts || 0}</td>
                      <td className="oao-num">
                        {(agent.active || 0) > 0
                          ? <span className="oao-cell-warn">{agent.active}</span>
                          : 0}
                      </td>
                      <td className="oao-num oao-answered">{agent.answered || 0}</td>
                      <td className="oao-num">
                        {(agent.missed || 0) > 0
                          ? <span className="oao-cell-danger">{agent.missed}</span>
                          : <span className="oao-missed">0</span>}
                      </td>
                      <td className="oao-num">
                        {(agent.callback_needed || 0) > 0
                          ? <span className="oao-cell-warn">{agent.callback_needed}</span>
                          : 0}
                      </td>
                      <td className="oao-num">
                        {agent.avg_response_seconds != null
                          ? `${Math.round(agent.avg_response_seconds)}s`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
