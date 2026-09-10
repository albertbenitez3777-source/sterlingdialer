import { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, Search, RefreshCw, ChevronDown, ChevronUp, Phone, PhoneOff, Clock, Check, Calendar, AlertTriangle, X, MapPin, DollarSign, Home, FileText, Copy } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';
import { RecordingPlayer } from './RecordingPlayer';

type InboxItem = {
  id: string;
  call_id: string;
  status: string;
  consumer_name: string;
  consumer_phone: string;
  consumer_address: string | null;
  consumer_home_value: string | null;
  consumer_income_range: string | null;
  consumer_property_info: string | null;
  direction: string | null;
  transfer_requested: boolean;
  talkroute_leg_created: boolean;
  talkroute_answered: boolean;
  bridge_confirmed: boolean;
  outcome: string | null;
  notes: string | null;
  callback_at: string | null;
  callback_completed_at: string | null;
  recording_url: string | null;
  transcript: string | null;
  created_at: string;
  updated_at: string;
};

interface AgentInboxProps {
  sessionToken: string;
  onUnauthorized: () => void;
  providerUrl: string;
  agentId: string;
}

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'answered', label: 'Answered' },
  { id: 'missed', label: 'Missed' },
  { id: 'callback_needed', label: 'Callbacks' },
  { id: 'completed', label: 'Completed' },
] as const;

function fmtPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length === 10) return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
  return phone;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isOverdue(callbackAt: string | null): boolean {
  if (!callbackAt) return false;
  return new Date(callbackAt).getTime() < Date.now();
}

const STATUS_STEPS = ['transfer_requested', 'talkroute_leg_created', 'talkroute_answered', 'bridge_confirmed'] as const;

function InboxItemCard({
  item, providerUrl, sessionToken, onUnauthorized, onRefresh,
}: {
  item: InboxItem;
  providerUrl: string;
  sessionToken: string;
  onUnauthorized: () => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [cbDate, setCbDate] = useState('');
  const [cbTime, setCbTime] = useState('');
  const [copied, setCopied] = useState(false);

  const handleAction = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    setSubmitting(true);
    setError(null);
    const result = await authFetch(providerUrl, {
      body: { action, session_token: sessionToken, alert_id: item.id, notes, ...extra },
      onUnauthorized,
    });
    if (result.ok) { onRefresh(); }
    else { setError(result.error || 'Action failed'); }
    setSubmitting(false);
  }, [providerUrl, sessionToken, onUnauthorized, item.id, notes, onRefresh]);

  const handleSchedule = useCallback(async () => {
    if (!cbDate || !cbTime) return;
    const iso = new Date(`${cbDate}T${cbTime}`).toISOString();
    await handleAction('schedule_alert_callback', { callback_at: iso });
    setShowSchedule(false);
  }, [cbDate, cbTime, handleAction]);

  const handleComplete = useCallback(async () => {
    await handleAction('complete_callback');
  }, [handleAction]);

  const copyPhone = () => {
    navigator.clipboard.writeText(item.consumer_phone).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const overdue = item.status === 'callback_needed' && isOverdue(item.callback_at);
  const outcomeDotClass = item.outcome === 'answered' ? 'inbox-outcome-answered'
    : item.outcome === 'missed' ? 'inbox-outcome-missed'
    : item.status === 'callback_needed' ? 'inbox-outcome-callback'
    : 'inbox-outcome-pending';

  return (
    <div className={`inbox-item ${overdue ? 'inbox-item-overdue' : ''}`}>
      <div className="inbox-item-header" onClick={() => setExpanded(v => !v)}>
        <div className="inbox-item-left">
          <span className={`inbox-outcome-dot ${outcomeDotClass}`} />
          <div className="inbox-item-info">
            <div className="inbox-item-name">
              {item.consumer_name || 'Unknown'}
              {item.bridge_confirmed && <span className="inbox-bridge-badge">BRIDGED</span>}
            </div>
            <div className="inbox-item-phone">{fmtPhone(item.consumer_phone)}</div>
            <div className="inbox-item-meta">
              <span className="inbox-item-time">{timeAgo(item.created_at)}</span>
              {item.direction && <span className="inbox-item-direction">{item.direction}</span>}
            </div>
          </div>
        </div>
        <div className="inbox-item-right">
          {item.status === 'callback_needed' && item.callback_at && (
            item.callback_completed_at
              ? <span className="inbox-cb-done"><Check size={12} /> Done</span>
              : <span className={`inbox-cb-badge ${overdue ? 'inbox-cb-overdue' : ''}`}>
                  <Calendar size={12} />
                  {overdue ? 'OVERDUE' : new Date(item.callback_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
          )}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="inbox-item-body">
          <div className="inbox-client-details">
            {item.consumer_address && (
              <div className="inbox-detail"><MapPin size={13} /><span>{item.consumer_address}</span></div>
            )}
            {item.consumer_home_value && (
              <div className="inbox-detail"><Home size={13} /><span>Home: {item.consumer_home_value}</span></div>
            )}
            {item.consumer_income_range && (
              <div className="inbox-detail"><DollarSign size={13} /><span>Income: {item.consumer_income_range}</span></div>
            )}
            {item.consumer_property_info && (
              <div className="inbox-detail"><FileText size={13} /><span>{item.consumer_property_info}</span></div>
            )}
            <div className="inbox-detail">
              <Phone size={13} />
              <span>{fmtPhone(item.consumer_phone)}</span>
              <button style={{ background: 'none', border: 'none', color: copied ? '#22c55e' : 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 0 }} onClick={copyPhone}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          <div className="inbox-status-line">
            {STATUS_STEPS.map(step => (
              <span key={step} className={`inbox-status-step ${item[step] ? 'inbox-step-active' : ''}`}>
                {item[step] && <Check size={9} style={{ marginRight: 2 }} />}
                {step.replace(/_/g, ' ')}
              </span>
            ))}
          </div>

          {item.notes && <div className="inbox-notes"><FileText size={12} /> {item.notes}</div>}

          {item.recording_url && (
            <div className="inbox-recording">
              <RecordingPlayer url={item.recording_url} />
            </div>
          )}

          {item.transcript && (
            <div className="inbox-transcript"><FileText size={12} /><span>{item.transcript.slice(0, 300)}{item.transcript.length > 300 ? '...' : ''}</span></div>
          )}

          {error && (
            <div className="inbox-error">
              <AlertTriangle size={12} /><span>{error}</span>
              <button onClick={() => setError(null)}><X size={12} /></button>
            </div>
          )}

          <div className="inbox-actions">
            {(item.status === 'active' || !item.outcome) && (
              <>
                <textarea
                  className="inbox-notes-input"
                  placeholder="Notes..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                />
                <div className="inbox-action-btns">
                  <button className="inbox-btn inbox-btn-answered" disabled={submitting} onClick={() => handleAction('acknowledge_alert', { outcome: 'answered' })}>
                    {submitting ? <RefreshCw size={12} className="ica-spin" /> : <Phone size={12} />} Answered
                  </button>
                  <button className="inbox-btn inbox-btn-missed" disabled={submitting} onClick={() => handleAction('acknowledge_alert', { outcome: 'missed' })}>
                    <PhoneOff size={12} /> Missed
                  </button>
                  <button className="inbox-btn inbox-btn-callback" disabled={submitting} onClick={() => setShowSchedule(v => !v)}>
                    <Clock size={12} /> Callback
                  </button>
                </div>
              </>
            )}

            {item.status === 'callback_needed' && !item.callback_completed_at && (
              <div className="inbox-action-btns">
                <button className="inbox-btn inbox-btn-complete" disabled={submitting} onClick={handleComplete}>
                  <Check size={12} /> Complete Callback
                </button>
                <button className="inbox-btn inbox-btn-reschedule" disabled={submitting} onClick={() => setShowSchedule(v => !v)}>
                  <Calendar size={12} /> Reschedule
                </button>
              </div>
            )}

            {showSchedule && (
              <div className="inbox-schedule-form">
                <input type="date" className="inbox-input" value={cbDate} onChange={e => setCbDate(e.target.value)} />
                <input type="time" className="inbox-input" value={cbTime} onChange={e => setCbTime(e.target.value)} />
                <button className="inbox-btn-schedule" disabled={submitting || !cbDate || !cbTime} onClick={handleSchedule}>
                  {submitting ? <RefreshCw size={12} className="ica-spin" /> : <Calendar size={12} />} Schedule
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentInbox({ sessionToken, onUnauthorized, providerUrl, agentId }: AgentInboxProps) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>('all');
  const [search, setSearch] = useState('');
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const result = await authFetch(providerUrl, {
      body: { action: 'get_agent_inbox', session_token: sessionToken, category: tab, limit: 50, offset: 0 },
      onUnauthorized,
    });
    if (result.ok && result.data) {
      const d = result.data as Record<string, unknown>;
      setItems((d.items || d.inbox || []) as InboxItem[]);
    }
    setLoading(false);
  }, [providerUrl, sessionToken, tab, onUnauthorized]);

  useEffect(() => {
    setLoading(true);
    load();
    refreshTimer.current = setInterval(load, 15000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [load]);

  const filtered = search
    ? items.filter(i =>
        i.consumer_name?.toLowerCase().includes(search.toLowerCase()) ||
        i.consumer_phone?.includes(search)
      )
    : items;

  return (
    <div className="agent-inbox">
      <div className="inbox-header">
        <div className="inbox-header-left">
          <Inbox size={18} />
          <h3>Transfer Inbox</h3>
          {items.length > 0 && <span className="inbox-total-badge">{items.length}</span>}
        </div>
        <button className="inbox-refresh" onClick={() => { setLoading(true); load(); }} title="Refresh">
          <RefreshCw size={16} className={loading ? 'ica-spin' : ''} />
        </button>
      </div>

      <div className="inbox-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`inbox-tab ${tab === t.id ? 'inbox-tab-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="inbox-search">
        <Search size={14} />
        <input placeholder="Search by name or phone..." value={search} onChange={e => setSearch(e.target.value)} />
        {search && <button onClick={() => setSearch('')}><X size={14} /></button>}
      </div>

      <div className="inbox-list">
        {filtered.length === 0 && !loading && (
          <div className="inbox-empty">
            <Inbox size={32} />
            <span>{search ? 'No results match your search' : 'No items in this category'}</span>
          </div>
        )}
        {loading && filtered.length === 0 && (
          <div className="inbox-empty">
            <RefreshCw size={24} className="ica-spin" />
            <span>Loading...</span>
          </div>
        )}
        {filtered.map(item => (
          <InboxItemCard
            key={item.id}
            item={item}
            providerUrl={providerUrl}
            sessionToken={sessionToken}
            onUnauthorized={onUnauthorized}
            onRefresh={load}
          />
        ))}
      </div>
    </div>
  );
}
