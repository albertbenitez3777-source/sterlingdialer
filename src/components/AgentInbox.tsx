import { useState, useEffect, useCallback } from 'react';
import {
  Inbox, Phone, PhoneMissed, RefreshCw, CheckCircle2, Clock, AlertCircle,
  Search, ChevronDown, ChevronUp, User, MapPin, Mail, Hash, FileText,
  MessageSquare, Loader2, X, Filter, Calendar
} from 'lucide-react';
import { RecordingPlayer } from './RecordingPlayer';
import type { TransferAlert } from './IncomingCallAlert';
import { authFetch } from '@/utils/auth-fetch';

type InboxCategory = 'all' | 'active' | 'answered' | 'missed' | 'callbacks' | 'overdue' | 'completed' | 'unacknowledged';

const CATEGORY_CONFIG: { key: InboxCategory; label: string; icon: typeof Inbox }[] = [
  { key: 'all', label: 'All', icon: Inbox },
  { key: 'active', label: 'Incoming', icon: Phone },
  { key: 'answered', label: 'Answered', icon: CheckCircle2 },
  { key: 'missed', label: 'Missed', icon: PhoneMissed },
  { key: 'callbacks', label: 'Callbacks Due', icon: RefreshCw },
  { key: 'overdue', label: 'Overdue', icon: AlertCircle },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
  { key: 'unacknowledged', label: 'Unknown', icon: Clock },
];

function fmtPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length === 10) return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
  return phone;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

type InboxItem = TransferAlert & { sort_key: string };

function InboxItemCard({
  item,
  isExpanded,
  onToggle,
  onAcknowledge,
  onCompleteCallback,
  sessionToken,
  onUnauthorized,
  providerUrl,
}: {
  item: InboxItem;
  isExpanded: boolean;
  onToggle: () => void;
  onAcknowledge: (id: string, outcome: string, notes: string) => Promise<boolean>;
  onCompleteCallback: (id: string, notes: string) => Promise<boolean>;
  sessionToken: string;
  onUnauthorized: () => void;
  providerUrl: string;
}) {
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState(item.agent_notes || '');
  const [error, setError] = useState<string | null>(null);
  const [callbackDate, setCallbackDate] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);

  const outcomeLabel = item.agent_outcome === 'answered' ? 'Answered'
    : item.agent_outcome === 'missed' ? 'Missed'
    : item.agent_outcome === 'callback_needed' ? 'Callback needed'
    : item.agent_outcome === 'unacknowledged' ? 'Outcome unknown'
    : 'Pending';

  const outcomeClass = item.agent_outcome === 'answered' ? 'inbox-outcome-answered'
    : item.agent_outcome === 'missed' ? 'inbox-outcome-missed'
    : item.agent_outcome === 'callback_needed' ? 'inbox-outcome-callback'
    : 'inbox-outcome-pending';

  const isOverdue = item.callback_at && !item.callback_completed && new Date(item.callback_at) < new Date();

  const handleAction = async (outcome: string) => {
    setSaving(true);
    setError(null);
    const ok = await onAcknowledge(item.id, outcome, notes);
    if (!ok) setError('Failed to save');
    setSaving(false);
  };

  const handleComplete = async () => {
    setSaving(true);
    setError(null);
    const ok = await onCompleteCallback(item.id, notes);
    if (!ok) setError('Failed to complete');
    setSaving(false);
  };

  const handleSchedule = async () => {
    if (!callbackDate || !callbackTime) return;
    setSaving(true);
    setError(null);
    try {
      const cbAt = new Date(`${callbackDate}T${callbackTime}`).toISOString();
      const result = await authFetch(providerUrl, {
        body: { action: 'schedule_alert_callback', session_token: sessionToken, alert_id: item.id, callback_at: cbAt, notes },
        onUnauthorized,
      });
      if (!result.ok) setError('Failed to schedule');
      else setShowSchedule(false);
    } catch {
      setError('Failed to schedule');
    }
    setSaving(false);
  };

  return (
    <div className={`inbox-item ${isExpanded ? 'inbox-item-expanded' : ''} ${isOverdue ? 'inbox-item-overdue' : ''}`}>
      <div className="inbox-item-header" onClick={onToggle}>
        <div className="inbox-item-left">
          <div className={`inbox-outcome-dot ${outcomeClass}`} />
          <div className="inbox-item-info">
            <div className="inbox-item-name">
              {item.consumer_name || 'Unmatched caller'}
              {item.consumer_phone && <span className="inbox-item-phone">{fmtPhone(item.consumer_phone)}</span>}
            </div>
            <div className="inbox-item-meta">
              <span className={outcomeClass}>{outcomeLabel}</span>
              {item.callback_at && !item.callback_completed && (
                <span className={`inbox-cb-badge ${isOverdue ? 'inbox-cb-overdue' : ''}`}>
                  <Calendar size={11} /> {isOverdue ? 'Overdue: ' : 'Due: '}{fmtDate(item.callback_at)}
                </span>
              )}
              {item.callback_completed && <span className="inbox-cb-done"><CheckCircle2 size={11} /> Callback completed</span>}
              <span className="inbox-item-time">{fmtDate(item.created_at)}</span>
              <span className="inbox-item-direction">{item.call_direction === 'inbound' ? 'Inbound' : 'Outbound'}</span>
            </div>
          </div>
        </div>
        <div className="inbox-item-right">
          {item.transfer_status === 'bridge_confirmed' && <span className="inbox-bridge-badge">Bridge</span>}
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {isExpanded && (
        <div className="inbox-item-body">
          {/* Client details */}
          <div className="inbox-client-details">
            {item.consumer_email && <div className="inbox-detail"><Mail size={13} />{item.consumer_email}</div>}
            {item.consumer_address && <div className="inbox-detail"><MapPin size={13} />{item.consumer_address}</div>}
            {item.consumer_account_ref && <div className="inbox-detail"><Hash size={13} />Ref: {item.consumer_account_ref}</div>}
            {item.consumer_extra && Object.entries(item.consumer_extra).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
              <div key={k} className="inbox-detail"><FileText size={13} />{k.replace(/_/g, ' ')}: {String(v)}</div>
            ))}
          </div>

          {/* Status timeline */}
          <div className="inbox-status-line">
            {['requested', 'destination_dialed', 'agent_answered', 'bridge_confirmed'].map(s => {
              const active = ['requested', 'destination_dialed', 'agent_answered', 'bridge_confirmed'].indexOf(s) <=
                ['requested', 'destination_dialed', 'agent_answered', 'bridge_confirmed'].indexOf(item.transfer_status);
              return <span key={s} className={`inbox-status-step ${active ? 'inbox-step-active' : ''}`}>{s.replace(/_/g, ' ')}</span>;
            })}
          </div>

          {/* Notes */}
          {item.agent_notes && (
            <div className="inbox-notes"><MessageSquare size={13} /> {item.agent_notes}</div>
          )}

          {/* Recording */}
          {(item.recording_url || item.call_id) && (
            <div className="inbox-recording">
              <RecordingPlayer url={item.recording_url || null} callId={item.call_id || undefined} sessionToken={sessionToken} onUnauthorized={onUnauthorized} />
            </div>
          )}

          {/* Transcript snippet */}
          {item.transcript && (
            <div className="inbox-transcript"><MessageSquare size={13} /> {item.transcript.slice(0, 300)}{item.transcript.length > 300 ? '...' : ''}</div>
          )}

          {error && <div className="inbox-error"><AlertCircle size={13} /> {error} <button onClick={() => setError(null)}><X size={11} /></button></div>}

          {/* Actions */}
          <div className="inbox-actions">
            <textarea className="inbox-notes-input" placeholder="Notes..." value={notes} onChange={e => setNotes(e.target.value)} rows={1} />

            {!item.agent_outcome && (
              <div className="inbox-action-btns">
                <button className="inbox-btn inbox-btn-answered" disabled={saving} onClick={() => handleAction('answered')}>
                  {saving ? <Loader2 size={14} className="ica-spin" /> : <Phone size={14} />} Answered
                </button>
                <button className="inbox-btn inbox-btn-missed" disabled={saving} onClick={() => handleAction('missed')}>
                  <PhoneMissed size={14} /> Missed
                </button>
                <button className="inbox-btn inbox-btn-callback" disabled={saving} onClick={() => setShowSchedule(!showSchedule)}>
                  <RefreshCw size={14} /> Callback
                </button>
              </div>
            )}

            {item.agent_outcome === 'callback_needed' && !item.callback_completed && (
              <div className="inbox-action-btns">
                <button className="inbox-btn inbox-btn-complete" disabled={saving} onClick={handleComplete}>
                  {saving ? <Loader2 size={14} className="ica-spin" /> : <CheckCircle2 size={14} />} Complete Callback
                </button>
                <button className="inbox-btn inbox-btn-reschedule" disabled={saving} onClick={() => setShowSchedule(!showSchedule)}>
                  <Calendar size={14} /> Reschedule
                </button>
              </div>
            )}

            {item.agent_outcome === 'missed' && !item.callback_at && (
              <button className="inbox-btn inbox-btn-callback" disabled={saving} onClick={() => setShowSchedule(!showSchedule)}>
                <RefreshCw size={14} /> Schedule Callback
              </button>
            )}

            {showSchedule && (
              <div className="inbox-schedule-form">
                <input type="date" value={callbackDate} onChange={e => setCallbackDate(e.target.value)} className="inbox-input" />
                <input type="time" value={callbackTime} onChange={e => setCallbackTime(e.target.value)} className="inbox-input" />
                <button className="inbox-btn inbox-btn-schedule" disabled={saving} onClick={handleSchedule}>
                  {saving ? <Loader2 size={14} className="ica-spin" /> : <Calendar size={14} />} Schedule
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface AgentInboxProps {
  sessionToken: string;
  onUnauthorized: () => void;
  providerUrl: string;
  agentId: string;
}

export function AgentInbox({ sessionToken, onUnauthorized, providerUrl, agentId }: AgentInboxProps) {
  const [category, setCategory] = useState<InboxCategory>('all');
  const [items, setItems] = useState<InboxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const result = await authFetch(providerUrl, {
        body: { action: 'get_agent_inbox', session_token: sessionToken, category },
        onUnauthorized,
      });
      if (result.ok && result.data) {
        const d = result.data as Record<string, unknown>;
        setItems(((d.items || []) as InboxItem[]));
        setTotal((d.total || 0) as number);
      }
    } catch { /* handled by authFetch */ }
    setLoading(false);
  }, [sessionToken, category, providerUrl, onUnauthorized]);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  useEffect(() => {
    const t = setInterval(loadInbox, 15000);
    return () => clearInterval(t);
  }, [loadInbox]);

  const handleAcknowledge = useCallback(async (alertId: string, outcome: string, notes: string) => {
    const result = await authFetch(providerUrl, {
      body: { action: 'acknowledge_alert', session_token: sessionToken, alert_id: alertId, outcome, notes },
      onUnauthorized,
    });
    if (result.ok) { loadInbox(); return true; }
    return false;
  }, [sessionToken, providerUrl, onUnauthorized, loadInbox]);

  const handleCompleteCallback = useCallback(async (alertId: string, notes: string) => {
    const result = await authFetch(providerUrl, {
      body: { action: 'complete_callback', session_token: sessionToken, alert_id: alertId, notes },
      onUnauthorized,
    });
    if (result.ok) { loadInbox(); return true; }
    return false;
  }, [sessionToken, providerUrl, onUnauthorized, loadInbox]);

  const filtered = searchQuery
    ? items.filter(i => {
        const q = searchQuery.toLowerCase();
        return (i.consumer_name || '').toLowerCase().includes(q) ||
               (i.consumer_phone || '').includes(q) ||
               (i.consumer_email || '').toLowerCase().includes(q) ||
               (i.consumer_account_ref || '').toLowerCase().includes(q);
      })
    : items;

  return (
    <div className="agent-inbox">
      <div className="inbox-header">
        <div className="inbox-header-left">
          <Inbox size={18} />
          <h3>Transfer Inbox</h3>
          {total > 0 && <span className="inbox-total-badge">{total}</span>}
        </div>
        <button className="inbox-refresh" onClick={loadInbox} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'ica-spin' : ''} />
        </button>
      </div>

      {/* Category tabs */}
      <div className="inbox-tabs">
        {CATEGORY_CONFIG.map(c => {
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              className={`inbox-tab ${category === c.key ? 'inbox-tab-active' : ''}`}
              onClick={() => setCategory(c.key)}
            >
              <Icon size={13} />
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="inbox-search">
        <Search size={14} />
        <input
          type="text"
          placeholder="Search by name, phone, email, or account..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {searchQuery && <button onClick={() => setSearchQuery('')}><X size={13} /></button>}
      </div>

      {/* Items */}
      <div className="inbox-list">
        {loading && items.length === 0 && (
          <div className="inbox-empty"><Loader2 size={20} className="ica-spin" /> Loading...</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="inbox-empty">
            <Inbox size={24} />
            <p>{searchQuery ? 'No results match your search' : 'No items in this category'}</p>
          </div>
        )}
        {filtered.map(item => (
          <InboxItemCard
            key={item.id}
            item={item}
            isExpanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onAcknowledge={handleAcknowledge}
            onCompleteCallback={handleCompleteCallback}
            sessionToken={sessionToken}
            onUnauthorized={onUnauthorized}
            providerUrl={providerUrl}
          />
        ))}
      </div>
    </div>
  );
}
