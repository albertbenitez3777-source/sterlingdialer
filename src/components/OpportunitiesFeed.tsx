import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, PhoneCall,
  ChevronDown, ChevronUp, Clock, Phone, AlertCircle, Inbox, Filter,
  MapPin, DollarSign, Home, FileText, User, Bell, History,
} from 'lucide-react';
import { RecordingPlayer } from '@/components/RecordingPlayer';
import { authFetch } from '@/utils/auth-fetch';
import { formatPhone } from '@/utils/privacy';

export type OpportunityRecord = {
  id: string;
  lead_id?: string;
  consumer_name: string;
  consumer_phone: string;
  consumer_address?: string;
  consumer_home_value?: string;
  consumer_income_range?: string;
  consumer_property_info?: string;
  consumer_custom_fields?: Record<string, unknown>;
  queue: string;
  created_at: string;
  duration_seconds: number;
  ai_summary: string;
  transcript: string;
  recording_url: string | null;
  transfer_status: string | null;
  transfer_requested_at: string | null;
  talkroute_leg_created: boolean;
  talkroute_answered?: boolean;
  is_live_human: boolean;
  agent_disposition: string | null;
  callback_requested: boolean;
  bridge_confirmed_at: string | null;
  bridge_confirmed?: boolean;
  has_post_transfer_ai_speech?: boolean;
  human_agreed_transfer?: boolean;
  voicemail_status?: string;
  transfer_failure_reason?: string;
  agent_notes: string | null;
  is_completed: boolean;
  provider_call_id: string | null;
  primary_status: string;
  status_rank: number;
  agent_id?: string;
  call_history?: Array<{
    id: string;
    created_at: string;
    primary_status: string;
    queue: string;
    duration_seconds: number;
  }>;
};

type TabId = 'today' | 'week' | 'all';

interface OpportunitiesFeedProps {
  sessionToken: string;
  onUnauthorized: () => void;
  isOwner: boolean;
  onCallback: (name: string, phone: string) => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  bridge_confirmed: { label: 'Bridge Confirmed', color: 'green' },
  talkroute_answered: { label: 'Agent Answered', color: 'cyan' },
  talkroute_dialed: { label: 'Talkroute Dialed', color: 'blue' },
  transfer_requested: { label: 'Transfer Requested', color: 'amber' },
  live_human: { label: 'Live Human', color: 'green' },
  voicemail: { label: 'Voicemail', color: 'blue' },
  callback: { label: 'Callback Requested', color: 'amber' },
  no_answer: { label: 'No Answer', color: 'red' },
  pending: { label: 'Pending', color: 'blue' },
  failed: { label: 'Failed', color: 'red' },
};

function Badge({ label, color }: { label: string; color: string }) {
  const colors: Record<string, string> = {
    green: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    blue: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    red: 'bg-red-500/20 text-red-300 border-red-500/30',
    cyan: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${colors[color] || colors.blue}`}>
      {label}
    </span>
  );
}

function formatET(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      hour12: true,
    });
  } catch { return iso; }
}

function PrimaryStatusBadge({ r }: { r: OpportunityRecord }) {
  const info = STATUS_LABELS[r.primary_status] || { label: r.primary_status.replace(/_/g, ' '), color: 'blue' };
  return <Badge label={info.label} color={info.color} />;
}

function FunnelBadges({ r }: { r: OpportunityRecord }) {
  const stages: { label: string; color: string }[] = [];
  if (r.bridge_confirmed || r.bridge_confirmed_at || (r.has_post_transfer_ai_speech && r.talkroute_answered))
    stages.push({ label: 'Bridge', color: 'green' });
  if (r.talkroute_answered && !stages.some(s => s.label === 'Bridge'))
    stages.push({ label: 'Answered', color: 'cyan' });
  if (r.talkroute_leg_created)
    stages.push({ label: 'Dialed', color: 'blue' });
  if (r.transfer_requested_at)
    stages.push({ label: 'Requested', color: 'amber' });
  if (r.transfer_failure_reason)
    stages.push({ label: 'Failed: ' + r.transfer_failure_reason.slice(0, 30), color: 'red' });
  if (stages.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      <span className="text-[9px] text-slate-500 uppercase mr-1">Funnel:</span>
      {stages.map(s => <Badge key={s.label} label={s.label} color={s.color} />)}
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="opp-detail-row">
      <Icon size={12} className="opp-detail-icon" />
      <span className="opp-detail-label">{label}</span>
      <span className="opp-detail-value">{value}</span>
    </div>
  );
}

export function OpportunitiesFeed({ sessionToken, onUnauthorized, isOwner, onCallback }: OpportunitiesFeedProps) {
  const [tab, setTab] = useState<TabId>('today');
  const [rows, setRows] = useState<OpportunityRecord[]>([]);
  const [counts, setCounts] = useState({ today: 0, week: 0, all: 0 });
  const [agents, setAgents] = useState<{ id: string; full_name: string }[]>([]);
  const [filterAgentId, setFilterAgentId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const lastFetchTs = useRef<string>('');
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const url = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/wolf-provider`;

  const fetchOpportunities = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const res = await authFetch<{
        opportunities: OpportunityRecord[];
        counts: { today: number; week: number; all: number };
        agents: { id: string; full_name: string }[];
        new_since_count?: number;
      }>(url, {
        onUnauthorized,
        body: {
          action: 'get_agent_opportunities',
          session_token: sessionToken,
          tab,
          ...(isOwner && filterAgentId ? { filter_agent_id: filterAgentId } : {}),
          ...(silent && lastFetchTs.current ? { since_ts: lastFetchTs.current } : {}),
        },
      });
      if (res.ok && res.data) {
        setRows(res.data.opportunities);
        setCounts(res.data.counts);
        if (res.data.agents?.length) setAgents(res.data.agents);
        if (res.data.opportunities.length > 0) {
          lastFetchTs.current = res.data.opportunities[0].created_at;
        }
        if (silent && res.data.new_since_count && res.data.new_since_count > 0) {
          setNewCount(n => n + res.data!.new_since_count!);
          try {
            if (!alertAudioRef.current) {
              alertAudioRef.current = new Audio('data:audio/wav;base64,UklGRl9vT19teleQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ==');
              alertAudioRef.current.volume = 0.3;
            }
            alertAudioRef.current.play().catch(() => {});
          } catch { /* audio play best-effort */ }
        }
      } else if (!res.loggedOut) {
        setError(res.error || 'Failed to load');
      }
    } catch {
      setError('Network error — check your connection');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [url, sessionToken, tab, filterAgentId, isOwner, onUnauthorized]);

  useEffect(() => {
    fetchOpportunities(false);
    intervalRef.current = setInterval(() => fetchOpportunities(true), 12_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchOpportunities]);

  const clearNew = () => setNewCount(0);

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'today', label: 'Today', count: counts.today },
    { id: 'week', label: 'This Week', count: counts.week },
    { id: 'all', label: 'All History', count: counts.all },
  ];

  return (
    <div className="opportunities-feed">
      {/* Header */}
      <div className="opp-header">
        <div className="opp-title-row">
          <Inbox size={20} className="text-cyan-400" />
          <h2 className="opp-title">Opportunities</h2>
          {newCount > 0 && (
            <button
              className="opp-new-badge"
              onClick={() => { clearNew(); fetchOpportunities(false); }}
              title="New activity — click to refresh"
            >
              <Bell size={12} />
              <span>{newCount} new</span>
            </button>
          )}
          <button
            className="opp-refresh-btn"
            onClick={() => { clearNew(); fetchOpportunities(true); }}
            disabled={refreshing}
            title="Refresh now"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {isOwner && agents.length > 0 && (
          <div className="opp-agent-filter">
            <Filter size={12} />
            <select
              value={filterAgentId}
              onChange={e => setFilterAgentId(e.target.value)}
              className="opp-agent-select"
            >
              <option value="">All Agents</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.full_name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="opp-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`opp-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => { setTab(t.id); clearNew(); }}
            >
              {t.label}
              <span className="opp-tab-count">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading && !rows.length ? (
        <div className="opp-empty"><RefreshCw size={20} className="animate-spin text-slate-500" /><span>Loading opportunities...</span></div>
      ) : error ? (
        <div className="opp-empty opp-error">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button className="opp-retry-btn" onClick={() => fetchOpportunities(false)}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="opp-empty"><Inbox size={24} className="text-slate-600" /><span>No opportunities yet for this period.</span></div>
      ) : (
        <div className="opp-list">
          {rows.map(r => {
            const isExpanded = expandedId === r.id;
            const hasHistory = r.call_history && r.call_history.length > 1;
            return (
              <div key={r.id} className={`opp-card ${isExpanded ? 'expanded' : ''}`}>
                <button className="opp-card-header" onClick={() => setExpandedId(isExpanded ? null : r.id)}>
                  <div className="opp-card-left">
                    <span className="opp-consumer-name">{r.consumer_name || 'Unknown'}</span>
                    <span className="opp-time"><Clock size={10} /> {formatET(r.created_at)}</span>
                  </div>
                  <div className="opp-card-center">
                    <PrimaryStatusBadge r={r} />
                    {hasHistory && (
                      <span className="opp-history-count" title={`${r.call_history!.length} calls for this lead`}>
                        <History size={10} /> {r.call_history!.length}
                      </span>
                    )}
                  </div>
                  <div className="opp-card-right">
                    {r.duration_seconds > 0 && <span className="opp-duration">{Math.ceil(r.duration_seconds / 60)}m</span>}
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="opp-card-body">
                    {/* Funnel stages (separate from primary status) */}
                    <FunnelBadges r={r} />

                    {/* Phone + callback */}
                    <div className="opp-phone-row">
                      <Phone size={12} />
                      <span className="opp-phone">{formatPhone(r.consumer_phone)}</span>
                      <button
                        className="opp-callback-btn"
                        onClick={() => onCallback(r.consumer_name, r.consumer_phone)}
                        title="Callback / Redial"
                      >
                        <PhoneCall size={12} /> Callback
                      </button>
                    </div>

                    {/* Full Client Profile */}
                    <div className="opp-profile">
                      <span className="opp-section-label"><User size={10} /> Full Client Profile</span>
                      <div className="opp-profile-grid">
                        <DetailRow icon={MapPin} label="Address" value={r.consumer_address} />
                        <DetailRow icon={Home} label="Home Value" value={r.consumer_home_value} />
                        <DetailRow icon={DollarSign} label="Income" value={r.consumer_income_range} />
                        <DetailRow icon={FileText} label="Property" value={r.consumer_property_info} />
                        {r.consumer_custom_fields && Object.keys(r.consumer_custom_fields).length > 0 && (
                          Object.entries(r.consumer_custom_fields).map(([k, v]) => (
                            <DetailRow key={k} icon={FileText} label={k} value={String(v)} />
                          ))
                        )}
                        {r.agent_disposition && <DetailRow icon={FileText} label="Disposition" value={r.agent_disposition} />}
                        {r.agent_notes && <DetailRow icon={FileText} label="Notes" value={r.agent_notes} />}
                      </div>
                    </div>

                    {/* AI Summary */}
                    {r.ai_summary && (
                      <div className="opp-section">
                        <span className="opp-section-label">AI Summary</span>
                        <p className="opp-summary-text">{r.ai_summary}</p>
                      </div>
                    )}

                    {/* Transcript preview */}
                    {r.transcript && (
                      <div className="opp-section">
                        <span className="opp-section-label">Transcript</span>
                        <p className="opp-transcript-text">{r.transcript.length > 500 ? r.transcript.slice(0, 500) + '...' : r.transcript}</p>
                      </div>
                    )}

                    {/* Recording */}
                    <div className="opp-section">
                      <span className="opp-section-label">Recording</span>
                      <RecordingPlayer
                        url={r.recording_url}
                        callId={r.id}
                        sessionToken={sessionToken}
                        onUnauthorized={onUnauthorized}
                      />
                    </div>

                    {/* Call History for this lead */}
                    {hasHistory && (
                      <div className="opp-section">
                        <button
                          className="opp-section-label opp-history-toggle"
                          onClick={() => setShowHistory(showHistory === r.id ? null : r.id)}
                        >
                          <History size={10} /> Call History ({r.call_history!.length} calls)
                          {showHistory === r.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        </button>
                        {showHistory === r.id && (
                          <div className="opp-history-list">
                            {r.call_history!.map(h => (
                              <div key={h.id} className="opp-history-item">
                                <span className="opp-time">{formatET(h.created_at)}</span>
                                <Badge
                                  label={(STATUS_LABELS[h.primary_status] || { label: h.primary_status }).label}
                                  color={(STATUS_LABELS[h.primary_status] || { color: 'blue' }).color}
                                />
                                {h.duration_seconds > 0 && <span className="opp-duration">{Math.ceil(h.duration_seconds / 60)}m</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
