import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ChevronDown, ChevronRight, Clock, Flame, Phone, Send, Check, Bookmark,
  RefreshCw, AlertTriangle, Calendar, Radio, Archive, Mail,
} from 'lucide-react';
import { StatusPill, queueToPillVariant } from '@/components/StatusPill';
import { RecordingPlayer } from '@/components/RecordingPlayer';
import { formatPhone } from '@/utils/privacy';
import { authFetch } from '@/utils/auth-fetch';

// ── Types ──────────────────────────────────────────────────────────────
export type WorkspaceCall = {
  id: string; consumer_name: string; consumer_phone: string;
  consumer_address?: string; consumer_home_value?: string;
  consumer_income_range?: string; consumer_property_info?: string;
  consumer_custom_fields?: Record<string, unknown> | null;
  queue: string; transfer_status?: string;
  duration_seconds: number; ai_summary?: string; transcript?: string;
  recording_url?: string; is_completed?: boolean; created_at: string;
  call_direction?: string; callback_requested?: boolean;
  agent_disposition?: string; agent_notes?: string;
  transfer_failure_reason?: string; drop_reason?: string;
  talkroute_answered?: boolean; bridge_confirmed?: boolean;
  talkroute_voicemail?: boolean;
  originating_bland_number?: string; talkroute_destination?: string;
  day_label?: string;
};

export type WorkspaceData = {
  live_now: WorkspaceCall[];
  today_completed: WorkspaceCall[];
  yesterday: WorkspaceCall[];
  archive_page: WorkspaceCall[];
  archive_total: number;
  alerts: {
    stale_in_live: number; phone_only_pct: number;
    no_recording_pct: number; talkroute_no_answer: number;
    answer_no_bridge: number;
  };
  stats: Record<string, number>;
  boundaries: { timezone: string; today_start: string; yesterday_start: string; server_now: string };
};

export type WorkspaceTab = 'today' | 'yesterday' | 'archive';
export type OutcomeFilter = 'all' | 'transfers' | 'humans' | 'bridges' | 'callbacks' | 'failed';

export interface AgentWorkspaceViewProps {
  providerUrl: string;
  sessionToken: string;
  onUnauthorized: () => void;
  expandedCall: string | null;
  setExpandedCall: (id: string | null) => void;
  onPhoneClick: (name: string, phone: string) => void;
  onSaveTransfer?: (callId: string) => void;
  savingTransferIds?: Set<string>;
  selectedRedialIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onRedial: () => void;
  redialing: boolean;
  redialBatchId: string | null;
  redialTranscripts: { consumer_name: string; transcript: string; status: string }[];
  onCloseRedialPanel: () => void;
}

const TZ = 'America/New_York';
function fmtTimeET(iso: string): string { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }); }
function fmtDur(s: number): string { if (!s || s < 1) return '--'; const m = Math.floor(s / 60); const sec = s % 60; return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`; }
function initials(name: string): string { if (!name) return '?'; return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }

function matchesFilter(call: WorkspaceCall, filter: OutcomeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'transfers') return call.queue === 'fire_transfer' || call.queue === 'human_drop';
  if (filter === 'humans') return call.queue === 'human_drop';
  if (filter === 'bridges') return call.bridge_confirmed === true;
  if (filter === 'callbacks') return call.callback_requested === true;
  if (filter === 'failed') return !!call.transfer_failure_reason || !!call.drop_reason;
  return true;
}

/* ── Call Card ─────────────────────────────────────────────────────── */
function CallBadges({ call, isLive }: { call: WorkspaceCall; isLive?: boolean }) {
  return (
    <div className="ws-badges">
      {isLive && <span className="ws-badge ws-badge-live">LIVE</span>}
      {call.queue === 'fire_transfer' && <span className="ws-badge ws-badge-fire">TRANSFER</span>}
      {call.queue === 'human_drop' && <span className="ws-badge ws-badge-human">HUMAN</span>}
      {call.queue === 'voice_message' && <span className="ws-badge ws-badge-vm">VM</span>}
      {call.queue === 'no_answer' && <span className="ws-badge ws-badge-na">NO ANS</span>}
      {call.bridge_confirmed && <span className="ws-badge ws-badge-bridge">BRIDGED</span>}
      {call.talkroute_voicemail && <span className="ws-badge ws-badge-trvm">TR VM</span>}
      {call.callback_requested && <span className="ws-badge ws-badge-cb">CALLBACK</span>}
      {call.transfer_failure_reason && <span className="ws-badge ws-badge-fail">FAILED</span>}
      {call.is_completed && !isLive && <span className="ws-badge ws-badge-done">DONE</span>}
    </div>
  );
}

function CallRow({ call, expanded, onToggle, onPhoneClick, onSave, saving, selectable, selected, onToggleSelect, isLive, sessionToken, onUnauthorized }: {
  call: WorkspaceCall; expanded: boolean; onToggle: () => void;
  onPhoneClick: (n: string, p: string) => void;
  onSave?: (id: string) => void; saving?: boolean;
  selectable?: boolean; selected?: boolean; onToggleSelect?: () => void;
  isLive?: boolean; sessionToken: string; onUnauthorized: () => void;
}) {
  const isHot = call.queue === 'fire_transfer' || call.queue === 'human_drop';
  return (
    <div className={`ws-call-card${isLive ? ' ws-live-card' : ''}${isHot ? ' ws-hot-card' : ''}${selected ? ' ws-selected' : ''}`}>
      <div className="ws-call-header" onClick={onToggle}>
        {selectable && (
          <button className={`ws-check${selected ? ' ws-checked' : ''}`}
            onClick={e => { e.stopPropagation(); onToggleSelect?.(); }}>
            {selected && <Check size={12} />}
          </button>
        )}
        <div className={`ws-avatar${isHot ? ' ws-avatar-hot' : ''}`}>{initials(call.consumer_name)}</div>
        <div className="ws-call-info">
          <div className="ws-call-name">{call.consumer_name || formatPhone(call.consumer_phone)}</div>
          <div className="ws-call-meta">
            <button className="ws-phone-link" onClick={e => { e.stopPropagation(); onPhoneClick(call.consumer_name, call.consumer_phone); }}>
              <Phone size={10} /> {formatPhone(call.consumer_phone)}
            </button>
            <span className="ws-call-time">{fmtTimeET(call.created_at)}</span>
          </div>
        </div>
        <div className="ws-call-right">
          <CallBadges call={call} isLive={isLive} />
          <span className="ws-dur">{fmtDur(call.duration_seconds)}</span>
          {isHot && onSave && (
            <button className="ws-save-btn" onClick={e => { e.stopPropagation(); onSave(call.id); }} disabled={saving}>
              {saving ? <RefreshCw size={11} className="ws-spin" /> : <Bookmark size={11} />}
            </button>
          )}
          {isHot && (
            <button className="ws-elizabeth-btn" onClick={e => { e.stopPropagation(); onPhoneClick(call.consumer_name, call.consumer_phone); }}>
              <Send size={11} />
            </button>
          )}
          <ChevronDown size={14} className={expanded ? 'ws-chev-up' : ''} />
        </div>
      </div>
      {expanded && (
        <div className="ws-call-detail">
          {call.consumer_custom_fields && typeof call.consumer_custom_fields === 'object' && 'email' in call.consumer_custom_fields && Boolean(call.consumer_custom_fields.email) && (
            <div className="ws-detail-row ws-detail-email"><Mail size={12} /><span>Email</span><strong>{String(call.consumer_custom_fields.email)}</strong></div>
          )}
          {call.consumer_address && <div className="ws-detail-row"><span>Address</span><strong>{call.consumer_address}</strong></div>}
          {call.consumer_income_range && <div className="ws-detail-row"><span>Income</span><strong>{call.consumer_income_range}</strong></div>}
          {call.consumer_home_value && <div className="ws-detail-row"><span>Home Value</span><strong>{call.consumer_home_value}</strong></div>}
          {call.consumer_property_info && <div className="ws-detail-row"><span>Property</span><strong>{call.consumer_property_info}</strong></div>}
          {call.transfer_status && call.transfer_status !== 'none' && <div className="ws-detail-row"><span>Transfer</span><StatusPill variant={queueToPillVariant(call.transfer_status)}>{call.transfer_status.replace(/_/g, ' ')}</StatusPill></div>}
          {call.callback_requested && <div className="ws-detail-row"><span>Callback</span><strong className="ws-cb-flag">Requested</strong></div>}
          {call.agent_notes && <div className="ws-detail-row"><span>Notes</span><strong>{call.agent_notes}</strong></div>}
          {call.agent_disposition && <div className="ws-detail-row"><span>Disposition</span><strong>{call.agent_disposition}</strong></div>}
          {call.transfer_failure_reason && <div className="ws-detail-row ws-detail-warn"><AlertTriangle size={12} /><span>Failure</span><strong>{call.transfer_failure_reason}</strong></div>}
          {call.ai_summary && <div className="ws-detail-section"><div className="ws-detail-label">AI SUMMARY</div><p>{call.ai_summary}</p></div>}
          {call.transcript && <div className="ws-detail-section"><div className="ws-detail-label">TRANSCRIPT</div><div className="ws-transcript">{call.transcript}</div></div>}
          <RecordingPlayer url={call.recording_url} callId={call.id} sessionToken={sessionToken} onUnauthorized={onUnauthorized} />
        </div>
      )}
    </div>
  );
}

/* ── Collapsible Bucket ───────────────────────────────────────────── */
function BucketSection({ title, icon, calls, filter, defaultOpen, expandedCall, setExpandedCall, onPhoneClick, onSave, savingIds, selectable, selectedIds, onToggleSelect, sessionToken, onUnauthorized, isLive }: {
  title: string; icon: React.ReactNode;
  calls: WorkspaceCall[]; filter: OutcomeFilter; defaultOpen?: boolean;
  expandedCall: string | null; setExpandedCall: (id: string | null) => void;
  onPhoneClick: (n: string, p: string) => void;
  onSave?: (id: string) => void; savingIds?: Set<string>;
  selectable?: boolean; selectedIds?: Set<string>; onToggleSelect?: (id: string) => void;
  sessionToken: string; onUnauthorized: () => void; isLive?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const filtered = calls.filter(c => matchesFilter(c, filter));
  if (calls.length === 0 && !isLive) return null;
  return (
    <div className={`ws-bucket${isLive ? ' ws-bucket-live' : ''}`}>
      <button className="ws-bucket-header" onClick={() => setOpen(!open)}>
        <div className="ws-bucket-left">{icon}<span className="ws-bucket-title">{title}</span><span className="ws-bucket-count">{filtered.length}</span></div>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div className="ws-bucket-body">
          {filtered.length === 0 ? (
            <div className="ws-empty">{isLive ? 'No active calls right now.' : `No calls${filter !== 'all' ? ' matching filter' : ''}.`}</div>
          ) : filtered.map(call => (
            <CallRow key={call.id} call={call}
              expanded={expandedCall === call.id}
              onToggle={() => setExpandedCall(expandedCall === call.id ? null : call.id)}
              onPhoneClick={onPhoneClick}
              onSave={onSave} saving={savingIds?.has(call.id)}
              selectable={selectable && (call.queue === 'fire_transfer' || call.queue === 'human_drop')}
              selected={selectedIds?.has(call.id)} onToggleSelect={() => onToggleSelect?.(call.id)}
              isLive={isLive} sessionToken={sessionToken} onUnauthorized={onUnauthorized}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   AgentWorkspaceView — main export
   ═══════════════════════════════════════════════════════════════════ */
export function AgentWorkspaceView({
  providerUrl, sessionToken, onUnauthorized,
  expandedCall, setExpandedCall, onPhoneClick,
  onSaveTransfer, savingTransferIds, selectedRedialIds, onToggleSelect,
  onRedial, redialing, redialBatchId, redialTranscripts, onCloseRedialPanel,
}: AgentWorkspaceViewProps) {

  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [archiveOffset, setArchiveOffset] = useState(0);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('today');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');
  const pollingRef = useRef(false);
  const archivePollingRef = useRef(false);
  const mountedRef = useRef(true);

  const fetchWorkspace = useCallback(async (offset: number, isArchiveOnly?: boolean) => {
    const ref = isArchiveOnly ? archivePollingRef : pollingRef;
    if (ref.current) return;
    ref.current = true;
    try {
      const result = await authFetch(providerUrl, {
        body: { action: 'get_agent_workspace', session_token: sessionToken, archive_offset: offset },
        onUnauthorized,
      });
      if (result.ok && result.data && mountedRef.current) {
        setData(result.data as WorkspaceData);
        setLoading(false);
      }
    } catch { /* authFetch handles 401 */ }
    finally { ref.current = false; }
  }, [providerUrl, sessionToken, onUnauthorized]);

  // Live + today: 3s refresh
  useEffect(() => {
    mountedRef.current = true;
    fetchWorkspace(archiveOffset);
    const fast = setInterval(() => fetchWorkspace(archiveOffset), 3000);
    return () => { mountedRef.current = false; clearInterval(fast); };
  }, [fetchWorkspace, archiveOffset]);

  const handleArchivePage = (newOffset: number) => {
    setArchiveOffset(newOffset);
    fetchWorkspace(newOffset, true);
  };

  if (!data) {
    return loading ? (
      <div className="ws-loading"><RefreshCw size={20} className="ws-spin" /> Loading workspace...</div>
    ) : null;
  }

  const stats = data.stats;
  const alerts = data.alerts;

  const hasAlerts = alerts && (alerts.stale_in_live > 0 || alerts.talkroute_no_answer > 3 || alerts.answer_no_bridge > 0 || alerts.no_recording_pct > 60);

  const tabs: { key: WorkspaceTab; label: string; count: number }[] = [
    { key: 'today', label: 'Today', count: data.live_now.length + data.today_completed.length },
    { key: 'yesterday', label: 'Yesterday', count: data.yesterday.length },
    { key: 'archive', label: 'Archive', count: data.archive_total },
  ];

  const filters: { key: OutcomeFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'transfers', label: 'Transfers' },
    { key: 'bridges', label: 'Bridges' },
    { key: 'callbacks', label: 'Callbacks' },
    { key: 'failed', label: 'Failed' },
  ];

  return (
    <div className="ws-container">
      {/* Stats strip */}
      <div className="ws-stat-strip">
        <div className="ws-stat ws-stat-hot"><Radio size={14} /><strong>{stats?.active_calls_now ?? 0}</strong><span>ACTIVE NOW</span></div>
        <div className="ws-stat"><Flame size={14} /><strong>{stats?.fire_transfers ?? 0}</strong><span>TRANSFERS</span></div>
        <div className="ws-stat"><Phone size={14} /><strong>{stats?.live_humans ?? 0}</strong><span>HUMANS</span></div>
        <div className="ws-stat"><strong>{stats?.bridges_today ?? 0}</strong><span>BRIDGES</span></div>
        <div className="ws-stat"><strong>{stats?.today_total ?? 0}</strong><span>TOTAL TODAY</span></div>
      </div>

      {/* Redial bar */}
      {selectedRedialIds.size > 0 && (
        <div className="ws-redial-bar">
          <span>{selectedRedialIds.size} of 3 selected for power dial</span>
          <button className="ws-redial-btn" onClick={onRedial} disabled={redialing}>
            {redialing ? <><RefreshCw size={13} className="ws-spin" /> Dialing...</> : <><Phone size={13} /> Power Dial</>}
          </button>
        </div>
      )}

      {/* Redial transcript panel */}
      {redialBatchId && redialTranscripts.length > 0 && (
        <div className="ws-redial-results">
          <div className="ws-redial-results-header">
            <strong>Power Dial Results</strong>
            <button onClick={onCloseRedialPanel}>&times;</button>
          </div>
          {redialTranscripts.map((t, i) => (
            <div key={i} className="ws-redial-result-row">
              <span className="ws-redial-name">{t.consumer_name}</span>
              <span className={`ws-badge ws-badge-${t.status === 'completed' ? 'done' : 'na'}`}>{t.status}</span>
              {t.transcript && <p className="ws-redial-transcript">{t.transcript.slice(0, 200)}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Alerts */}
      {hasAlerts && (
        <div className="ws-alerts">
          <AlertTriangle size={14} />
          <div className="ws-alerts-list">
            {alerts.stale_in_live > 0 && <span>{alerts.stale_in_live} stale call{alerts.stale_in_live > 1 ? 's' : ''} stuck in live queue</span>}
            {alerts.talkroute_no_answer > 3 && <span>{alerts.talkroute_no_answer} Talkroute calls unanswered today</span>}
            {alerts.answer_no_bridge > 0 && <span>{alerts.answer_no_bridge} answered but not bridged</span>}
            {alerts.no_recording_pct > 60 && <span>{Math.round(alerts.no_recording_pct)}% of calls missing recordings</span>}
          </div>
        </div>
      )}

      {/* LIVE NOW -- always visible at top */}
      <BucketSection
        title="LIVE NOW" icon={<Radio size={14} className="ws-pulse" />}
        calls={data.live_now} filter={outcomeFilter}
        defaultOpen={true} isLive
        expandedCall={expandedCall} setExpandedCall={setExpandedCall}
        onPhoneClick={onPhoneClick} onSave={onSaveTransfer} savingIds={savingTransferIds}
        selectable selectedIds={selectedRedialIds} onToggleSelect={onToggleSelect}
        sessionToken={sessionToken} onUnauthorized={onUnauthorized}
      />

      {/* Tab bar */}
      <div className="ws-tab-bar">
        <div className="ws-tabs">
          {tabs.map(t => (
            <button key={t.key} className={`ws-tab${activeTab === t.key ? ' ws-tab-active' : ''}`}
              onClick={() => setActiveTab(t.key)}>
              {t.label} <span className="ws-tab-count">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="ws-filters">
          {filters.map(f => (
            <button key={f.key} className={`ws-filter${outcomeFilter === f.key ? ' ws-filter-active' : ''}`}
              onClick={() => setOutcomeFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'today' && (
        <BucketSection
          title="TODAY COMPLETED" icon={<Clock size={14} />}
          calls={data.today_completed} filter={outcomeFilter}
          defaultOpen={true}
          expandedCall={expandedCall} setExpandedCall={setExpandedCall}
          onPhoneClick={onPhoneClick} onSave={onSaveTransfer} savingIds={savingTransferIds}
          selectable selectedIds={selectedRedialIds} onToggleSelect={onToggleSelect}
          sessionToken={sessionToken} onUnauthorized={onUnauthorized}
        />
      )}

      {activeTab === 'yesterday' && (
        <BucketSection
          title="YESTERDAY" icon={<Calendar size={14} />}
          calls={data.yesterday} filter={outcomeFilter}
          defaultOpen={true}
          expandedCall={expandedCall} setExpandedCall={setExpandedCall}
          onPhoneClick={onPhoneClick}
          sessionToken={sessionToken} onUnauthorized={onUnauthorized}
        />
      )}

      {activeTab === 'archive' && (
        <div className="ws-archive-section">
          <div className="ws-archive-info"><Archive size={13} /> Showing {Math.min(data.archive_page.length, 50)} of {data.archive_total} older calls</div>
          {data.archive_page.length === 0 ? (
            <div className="ws-empty">No archived calls.</div>
          ) : data.archive_page.map(call => (
            <CallRow key={call.id} call={call}
              expanded={expandedCall === call.id}
              onToggle={() => setExpandedCall(expandedCall === call.id ? null : call.id)}
              onPhoneClick={onPhoneClick} sessionToken={sessionToken} onUnauthorized={onUnauthorized}
            />
          ))}
          {data.archive_total > 50 && (
            <div className="ws-archive-pager">
              {archiveOffset > 0 && <button className="ws-page-btn" onClick={() => handleArchivePage(archiveOffset - 50)}>Previous</button>}
              {archiveOffset + 50 < data.archive_total && <button className="ws-page-btn" onClick={() => handleArchivePage(archiveOffset + 50)}>Next 50</button>}
            </div>
          )}
        </div>
      )}

      <div className="ws-tz-footer">All times Eastern ({data.boundaries?.timezone || TZ})</div>
    </div>
  );
}
