import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { GlassCard } from '@/components/GlassCard';
import {
  TrendingUp, BarChart3, Clock, AlertTriangle, RefreshCw, Users, Zap, PhoneOff, Mic,
} from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? '';
const PROVIDER_URL = `${SUPABASE_URL}/functions/v1/wolf-provider`;

/* ── V2 types matching get_admin_chart_data_v2 RPC ───────────────── */
type HourlyRow = { hour_num: number; total_calls: number; live_humans: number; transfers: number; bridges: number; no_answers: number; human_rate: number };
type DailyRow = { day_date: string; day_name: string; attempts: number; live_humans: number; transfer_requested: number; talkroute_dialed: number; talkroute_voicemail: number; agent_answered: number; bridges: number; total_minutes: number };
type AgentRow = { agent_name: string; total_calls: number; live_humans: number; transfers: number; bridges: number; talkroute_vm: number; failed: number; bridge_rate: number };
type QualityAlerts = {
  stale_active_count: number; completed_in_live_violation: number;
  phone_only_pct: number; no_recording_pct: number;
  talkroute_dialed_no_answer: number; answer_no_bridge: number;
  retry_pool_remaining: number; retry_pool_total: number;
};
type ChartV2 = { hourly: HourlyRow[]; daily: DailyRow[]; per_agent: AgentRow[]; quality_alerts: QualityAlerts; timezone: string };

/* ── Colors ──────────────────────────────────────────────────────── */
const GOLD = '#d9aa57';
const SAGE = '#7a9b8e';
const RUST = '#c25e3a';
const STEEL = '#6b8ca8';
const TEAL = '#2dd4bf';
const AXES = '#5a665d';
const GRID = 'rgba(122,155,142,0.12)';

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label != null && <div className="chart-tip-label">{label}</div>}
      {payload.map((e, i) => (
        <div key={i} className="chart-tip-row" style={{ color: e.color }}>
          <span className="chart-tip-dot" style={{ background: e.color }} />
          {e.name}: <strong>{e.value}</strong>
        </div>
      ))}
    </div>
  );
}

function fmtHour(h: number) { return h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`; }

/* ── Quality alert cards ──────────────────────────────────────────── */
function QualityAlertCards({ alerts }: { alerts: QualityAlerts }) {
  const items: { icon: React.ReactNode; label: string; value: string; warn: boolean }[] = [];

  if (alerts.stale_active_count > 0) items.push({ icon: <Clock size={14} />, label: 'Stale Active Calls', value: `${alerts.stale_active_count}`, warn: true });
  if (alerts.talkroute_dialed_no_answer > 0) items.push({ icon: <PhoneOff size={14} />, label: 'Talkroute No-Answer', value: `${alerts.talkroute_dialed_no_answer}`, warn: alerts.talkroute_dialed_no_answer > 3 });
  if (alerts.answer_no_bridge > 0) items.push({ icon: <Zap size={14} />, label: 'Answered, No Bridge', value: `${alerts.answer_no_bridge}`, warn: true });
  if (alerts.no_recording_pct > 30) items.push({ icon: <Mic size={14} />, label: 'Missing Recordings', value: `${alerts.no_recording_pct}%`, warn: alerts.no_recording_pct > 60 });
  if (alerts.phone_only_pct > 50) items.push({ icon: <Users size={14} />, label: 'Phone-Only Contacts', value: `${alerts.phone_only_pct}%`, warn: false });

  const retryPct = alerts.retry_pool_total > 0 ? Math.round(100 * (alerts.retry_pool_total - alerts.retry_pool_remaining) / alerts.retry_pool_total) : 0;
  if (alerts.retry_pool_total > 0) items.push({ icon: <RefreshCw size={14} />, label: 'Retry Progress', value: `${retryPct}% (${alerts.retry_pool_remaining} left)`, warn: false });

  if (items.length === 0) return null;

  return (
    <div className="qa-grid">
      {items.map((it, i) => (
        <div key={i} className={`qa-card${it.warn ? ' qa-warn' : ''}`}>
          <div className="qa-card-icon">{it.icon}</div>
          <div className="qa-card-body">
            <div className="qa-card-value">{it.value}</div>
            <div className="qa-card-label">{it.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   AdminCharts — main export (uses get_admin_chart_data_v2)
   ═══════════════════════════════════════════════════════════════════ */
export function AdminCharts({ sessionToken, onUnauthorized }: { sessionToken: string; onUnauthorized: () => void }) {
  const [data, setData] = useState<ChartV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async (token: string) => {
    setLoading(true);
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_admin_chart_data_v2', session_token: token },
        onUnauthorized,
      });
      if (result.ok && result.data) {
        setData(result.data as ChartV2);
        setErr('');
      } else {
        setErr(result.error || 'Failed to load charts');
      }
    } catch { setErr('Network error loading charts'); }
    finally { setLoading(false); }
  }, [onUnauthorized]);

  useEffect(() => { if (sessionToken) load(sessionToken); }, [sessionToken, load]);
  useEffect(() => {
    if (!sessionToken) return;
    const iv = setInterval(() => load(sessionToken), 30000);
    return () => clearInterval(iv);
  }, [sessionToken, load]);

  if (loading && !data) {
    return (
      <div className="chart-loading">
        <RefreshCw size={16} className="ws-spin" /> Loading charts...
      </div>
    );
  }
  if (err && !data) return <div className="chart-error"><AlertTriangle size={14} /> {err}</div>;
  if (!data) return null;

  const hourlyData = data.hourly.map(r => ({
    label: fmtHour(r.hour_num), calls: r.total_calls, transfers: r.transfers, bridges: r.bridges, humans: r.live_humans,
  }));
  const dailyData = data.daily.map(r => ({
    label: r.day_name, attempts: r.attempts, bridges: r.bridges, answered: r.agent_answered,
    talkroute: r.talkroute_dialed, trVM: r.talkroute_voicemail, minutes: r.total_minutes,
  }));
  const agentData = data.per_agent.filter(a => a.total_calls > 0);

  return (
    <div className="v2-charts">
      {/* Quality alerts */}
      {data.quality_alerts && <QualityAlertCards alerts={data.quality_alerts} />}

      {/* Hourly funnel */}
      <GlassCard hoverLift className="panel chart-panel">
        <div className="panel-heading">
          <div><div className="eyebrow"><TrendingUp size={12} /> HOURLY FUNNEL</div><h3>Today by Hour</h3></div>
        </div>
        {hourlyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={hourlyData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="g-calls" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GOLD} stopOpacity={0.3} /><stop offset="100%" stopColor={GOLD} stopOpacity={0.02} /></linearGradient>
                <linearGradient id="g-bridges" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={TEAL} stopOpacity={0.3} /><stop offset="100%" stopColor={TEAL} stopOpacity={0.02} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="label" stroke={AXES} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis stroke={AXES} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="calls" stroke={GOLD} strokeWidth={2} fill="url(#g-calls)" name="Calls" />
              <Area type="monotone" dataKey="transfers" stroke={RUST} strokeWidth={1.5} fill="none" name="Transfers" />
              <Area type="monotone" dataKey="bridges" stroke={TEAL} strokeWidth={2} fill="url(#g-bridges)" name="Bridges" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div className="empty-state">No call data for today yet.</div>}
      </GlassCard>

      {/* Daily trend */}
      <GlassCard hoverLift className="panel chart-panel">
        <div className="panel-heading">
          <div><div className="eyebrow"><Clock size={12} /> DAILY TREND</div><h3>This Week</h3></div>
        </div>
        {dailyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dailyData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="label" stroke={AXES} fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke={AXES} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(217,170,87,0.06)' }} />
              <Bar dataKey="attempts" fill={STEEL} radius={[3, 3, 0, 0]} name="Attempts" opacity={0.5} />
              <Bar dataKey="answered" fill={SAGE} radius={[3, 3, 0, 0]} name="Agent Answered" />
              <Bar dataKey="bridges" fill={TEAL} radius={[3, 3, 0, 0]} name="Bridges" />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="empty-state">No weekly data yet.</div>}
      </GlassCard>

      {/* Per-agent delivery */}
      <GlassCard hoverLift className="panel chart-panel">
        <div className="panel-heading">
          <div><div className="eyebrow"><BarChart3 size={12} /> PER-AGENT DELIVERY</div><h3>Agent Performance This Week</h3></div>
        </div>
        {agentData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={agentData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="agent_name" stroke={AXES} fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke={AXES} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(217,170,87,0.06)' }} />
                <Bar dataKey="transfers" fill={RUST} radius={[3, 3, 0, 0]} name="Transfers" />
                <Bar dataKey="bridges" fill={TEAL} radius={[3, 3, 0, 0]} name="Bridges" />
                <Bar dataKey="failed" fill="#6b7280" radius={[3, 3, 0, 0]} name="Failed" />
              </BarChart>
            </ResponsiveContainer>
            <div className="agent-rate-strip">
              {agentData.map((a, i) => (
                <div key={i} className="agent-rate-card">
                  <div className="agent-rate-name">{a.agent_name}</div>
                  <div className="agent-rate-val">{a.bridge_rate ?? 0}%</div>
                  <div className="agent-rate-label">bridge rate</div>
                </div>
              ))}
            </div>
          </>
        ) : <div className="empty-state">No agent calls this week.</div>}
      </GlassCard>
    </div>
  );
}
