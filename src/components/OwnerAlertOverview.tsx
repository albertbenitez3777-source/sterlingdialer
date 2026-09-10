import { useState, useEffect, useCallback } from 'react';
import { Users, Phone, PhoneMissed, RefreshCw, AlertCircle, CheckCircle2, Clock, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';

type AgentOverview = {
  agent_id: string;
  agent_name: string;
  talkroute_number: string;
  alerts_24h: number;
  answered_24h: number;
  missed_24h: number;
  unacknowledged: number;
  callbacks_pending: number;
  callbacks_overdue: number;
  answered_all_time: number;
  missed_all_time: number;
  completed_callbacks: number;
};

export interface OwnerAlertOverviewProps {
  sessionToken: string;
  onUnauthorized: () => void;
  providerUrl: string;
}

export function OwnerAlertOverview({ sessionToken, onUnauthorized, providerUrl }: OwnerAlertOverviewProps) {
  const [agents, setAgents] = useState<AgentOverview[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await authFetch(providerUrl, {
        body: { action: 'get_owner_alert_overview', session_token: sessionToken },
        onUnauthorized,
      });
      if (result.ok && result.data) {
        const d = result.data as Record<string, unknown>;
        setAgents((d.overview || []) as AgentOverview[]);
      }
    } catch { /* handled */ }
    setLoading(false);
  }, [sessionToken, providerUrl, onUnauthorized]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const totalUnack = agents.reduce((s, a) => s + a.unacknowledged, 0);
  const totalOverdue = agents.reduce((s, a) => s + a.callbacks_overdue, 0);

  return (
    <div className="owner-alerts-overview">
      <div className="oao-header" onClick={() => setExpanded(!expanded)}>
        <div className="oao-header-left">
          <Users size={16} />
          <strong>Agent Transfer Inbox</strong>
          {totalUnack > 0 && <span className="oao-badge oao-badge-warn">{totalUnack} unacknowledged</span>}
          {totalOverdue > 0 && <span className="oao-badge oao-badge-danger">{totalOverdue} overdue</span>}
          {loading && <Loader2 size={14} className="ica-spin" />}
        </div>
        <div className="oao-header-right">
          <button className="oao-refresh" onClick={e => { e.stopPropagation(); load(); }}><RefreshCw size={14} /></button>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="oao-table-wrap">
          <table className="oao-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="oao-num">24h Alerts</th>
                <th className="oao-num"><Phone size={12} /> Answered</th>
                <th className="oao-num"><PhoneMissed size={12} /> Missed</th>
                <th className="oao-num"><Clock size={12} /> Unack</th>
                <th className="oao-num"><RefreshCw size={12} /> Callbacks</th>
                <th className="oao-num"><AlertCircle size={12} /> Overdue</th>
                <th className="oao-num"><CheckCircle2 size={12} /> All-time</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(a => (
                <tr key={a.agent_id} className={a.unacknowledged > 0 || a.callbacks_overdue > 0 ? 'oao-row-warn' : ''}>
                  <td>
                    <div className="oao-agent-name">{a.agent_name}</div>
                    {a.talkroute_number && <div className="oao-agent-route">{a.talkroute_number}</div>}
                  </td>
                  <td className="oao-num">{a.alerts_24h}</td>
                  <td className="oao-num oao-answered">{a.answered_24h}</td>
                  <td className="oao-num oao-missed">{a.missed_24h}</td>
                  <td className="oao-num">{a.unacknowledged > 0 ? <span className="oao-cell-warn">{a.unacknowledged}</span> : '0'}</td>
                  <td className="oao-num">{a.callbacks_pending}</td>
                  <td className="oao-num">{a.callbacks_overdue > 0 ? <span className="oao-cell-danger">{a.callbacks_overdue}</span> : '0'}</td>
                  <td className="oao-num">{a.answered_all_time} / {a.missed_all_time} / {a.completed_callbacks}</td>
                </tr>
              ))}
              {agents.length === 0 && !loading && (
                <tr><td colSpan={8} className="oao-empty">No agent data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
