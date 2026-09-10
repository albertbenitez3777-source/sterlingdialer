import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Phone, PhoneIncoming, PhoneOff, PhoneMissed, Clock, User, MapPin,
  Mail, Hash, FileText, ArrowDownRight, ArrowUpRight, Volume2, VolumeX,
  X, ChevronDown, ChevronUp, MessageSquare, Copy, Check, AlertCircle,
  Loader2, RefreshCw
} from 'lucide-react';
import { RecordingPlayer } from './RecordingPlayer';

export type TransferAlert = {
  id: string;
  call_id: string | null;
  lead_id: string | null;
  consumer_name: string;
  consumer_phone: string;
  consumer_email: string;
  consumer_address: string;
  consumer_account_ref: string;
  consumer_extra: Record<string, unknown>;
  call_direction: string;
  transfer_reason: string;
  transfer_status: string;
  agent_outcome: string | null;
  agent_notes: string;
  callback_at: string | null;
  recording_url: string;
  transcript: string;
  previous_contacts: Array<Record<string, unknown>>;
  is_dismissed: boolean;
  created_at: string;
  updated_at: string;
  agent_name: string;
  agent_talkroute: string;
  elapsed_seconds: number;
};

export interface IncomingCallAlertProps {
  alerts: TransferAlert[];
  onAcknowledge: (alertId: string, outcome: string, notes: string) => Promise<boolean>;
  onScheduleCallback: (alertId: string, callbackAt: string, notes: string) => Promise<boolean>;
  onDismiss: (alertId: string) => void;
  sessionToken: string;
  onUnauthorized: () => void;
  agentName: string;
}

function fmtPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length === 10) return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
  return phone;
}

function elapsedStr(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const STATUS_LABELS: Record<string, string> = {
  requested: 'Transfer requested',
  destination_dialed: 'Destination dialed',
  agent_answered: 'Agent answered',
  bridge_confirmed: 'Bridge confirmed',
};

const STATUS_ORDER = ['requested', 'destination_dialed', 'agent_answered', 'bridge_confirmed'];

function StatusBadges({ status }: { status: string }) {
  const activeIdx = STATUS_ORDER.indexOf(status);
  return (
    <div className="ica-status-badges">
      {STATUS_ORDER.map((s, i) => (
        <div key={s} className={`ica-badge ${i <= activeIdx ? 'ica-badge-active' : 'ica-badge-inactive'}`}>
          {i <= activeIdx && <Check size={10} />}
          <span>{STATUS_LABELS[s]}</span>
        </div>
      ))}
    </div>
  );
}

function AlertCard({
  alert,
  onAcknowledge,
  onScheduleCallback,
  onDismiss,
  sessionToken,
  onUnauthorized,
  audioEnabled,
}: {
  alert: TransferAlert;
  onAcknowledge: IncomingCallAlertProps['onAcknowledge'];
  onScheduleCallback: IncomingCallAlertProps['onScheduleCallback'];
  onDismiss: (id: string) => void;
  sessionToken: string;
  onUnauthorized: () => void;
  audioEnabled: boolean;
}) {
  const [elapsed, setElapsed] = useState(alert.elapsed_seconds);
  const [expanded, setExpanded] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [showCallback, setShowCallback] = useState(false);
  const [callbackDate, setCallbackDate] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  const [copied, setCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playedRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (audioEnabled && !playedRef.current && !alert.agent_outcome) {
      playedRef.current = true;
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 400);
      } catch { /* audio not available */ }
    }
  }, [audioEnabled, alert.agent_outcome]);

  const handleAction = useCallback(async (outcome: string) => {
    setSaving(outcome);
    setError(null);
    try {
      const ok = await onAcknowledge(alert.id, outcome, notes);
      if (!ok) setError('Failed to save. Please try again.');
    } catch {
      setError('Failed to save. Please try again.');
    }
    setSaving(null);
  }, [alert.id, notes, onAcknowledge]);

  const handleSchedule = useCallback(async () => {
    if (!callbackDate || !callbackTime) { setError('Please select date and time'); return; }
    setSaving('callback');
    setError(null);
    const cbAt = new Date(`${callbackDate}T${callbackTime}`).toISOString();
    try {
      const ok = await onScheduleCallback(alert.id, cbAt, notes);
      if (!ok) setError('Failed to schedule. Please try again.');
      else setShowCallback(false);
    } catch {
      setError('Failed to schedule. Please try again.');
    }
    setSaving(null);
  }, [alert.id, callbackDate, callbackTime, notes, onScheduleCallback]);

  const handleCopy = () => {
    const parts = [alert.consumer_name, fmtPhone(alert.consumer_phone), alert.consumer_email, alert.consumer_address, alert.consumer_account_ref].filter(Boolean);
    navigator.clipboard.writeText(parts.join('\n')).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isInbound = alert.call_direction === 'inbound';
  const hasName = !!alert.consumer_name?.trim();

  return (
    <div className={`ica-card ${alert.agent_outcome ? 'ica-card-resolved' : 'ica-card-active'}`}>
      <audio ref={audioRef} />

      {/* Header */}
      <div className="ica-card-header">
        <div className="ica-header-left">
          <div className={`ica-pulse ${alert.agent_outcome ? 'ica-pulse-resolved' : ''}`}>
            {isInbound ? <PhoneIncoming size={18} /> : <ArrowDownRight size={18} />}
          </div>
          <div>
            <div className="ica-header-title">
              INCOMING CALL TO YOUR TALKROUTE
            </div>
            <div className="ica-header-sub">
              {alert.agent_name} &middot; {alert.agent_talkroute ? fmtPhone(alert.agent_talkroute) : 'Talkroute'}
              <span className="ica-direction">{isInbound ? 'Inbound' : 'Outbound transfer'}</span>
            </div>
          </div>
        </div>
        <div className="ica-header-right">
          <div className="ica-elapsed">
            <Clock size={13} />
            <span>{elapsedStr(elapsed)}</span>
          </div>
          <button className="ica-btn-icon" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {alert.agent_outcome && (
            <button className="ica-btn-icon ica-dismiss" onClick={() => onDismiss(alert.id)}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Status progression */}
      <StatusBadges status={alert.transfer_status} />

      {/* Client info */}
      <div className="ica-client">
        <div className="ica-client-primary">
          <User size={16} />
          <span className="ica-client-name">{hasName ? alert.consumer_name : 'Unmatched caller'}</span>
          <span className="ica-client-phone">{fmtPhone(alert.consumer_phone)}</span>
          <button className="ica-copy-btn" onClick={handleCopy} title="Copy client info">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>

        {expanded && (
          <div className="ica-client-details">
            {alert.consumer_email && (
              <div className="ica-detail-row"><Mail size={13} /><span>{alert.consumer_email}</span></div>
            )}
            {alert.consumer_address && (
              <div className="ica-detail-row"><MapPin size={13} /><span>{alert.consumer_address}</span></div>
            )}
            {alert.consumer_account_ref && (
              <div className="ica-detail-row"><Hash size={13} /><span>Ref: {alert.consumer_account_ref}</span></div>
            )}
            {alert.consumer_extra && Object.entries(alert.consumer_extra).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
              <div key={k} className="ica-detail-row"><FileText size={13} /><span>{k.replace(/_/g, ' ')}: {String(v)}</span></div>
            ))}
            {alert.transfer_reason && (
              <div className="ica-detail-row ica-reason"><ArrowUpRight size={13} /><span>Reason: {alert.transfer_reason}</span></div>
            )}
          </div>
        )}
      </div>

      {/* Previous contacts */}
      {expanded && alert.previous_contacts?.length > 0 && (
        <div className="ica-history">
          <div className="ica-history-title"><Clock size={13} /> Previous contacts ({alert.previous_contacts.length})</div>
          <div className="ica-history-list">
            {alert.previous_contacts.slice(0, 5).map((c, i) => (
              <div key={i} className="ica-history-item">
                <span>{new Date(String(c.created_at)).toLocaleDateString()}</span>
                <span className="ica-history-queue">{String(c.queue || c.disposition || 'call')}</span>
                {Number(c.duration_seconds) > 0 && <span>{Number(c.duration_seconds)}s</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recording */}
      {expanded && (alert.recording_url || alert.call_id) && (
        <div className="ica-recording">
          <RecordingPlayer
            url={alert.recording_url || null}
            callId={alert.call_id || undefined}
            sessionToken={sessionToken}
            onUnauthorized={onUnauthorized}
          />
        </div>
      )}

      {/* Transcript */}
      {expanded && alert.transcript && (
        <div className="ica-transcript">
          <div className="ica-transcript-title"><MessageSquare size={13} /> Transcript</div>
          <div className="ica-transcript-text">{alert.transcript.slice(0, 500)}{alert.transcript.length > 500 ? '...' : ''}</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="ica-error"><AlertCircle size={13} /> {error} <button onClick={() => setError(null)}><X size={12} /></button></div>
      )}

      {/* Agent actions */}
      {!alert.agent_outcome && (
        <div className="ica-actions">
          <textarea
            className="ica-notes"
            placeholder="Add notes (optional)..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={1}
            onFocus={e => { e.target.rows = 3; }}
            onBlur={e => { if (!e.target.value) e.target.rows = 1; }}
          />
          <div className="ica-action-buttons">
            <button
              className="ica-btn ica-btn-answered"
              disabled={!!saving}
              onClick={() => handleAction('answered')}
            >
              {saving === 'answered' ? <Loader2 size={16} className="ica-spin" /> : <Phone size={16} />}
              I ANSWERED
            </button>
            <button
              className="ica-btn ica-btn-missed"
              disabled={!!saving}
              onClick={() => handleAction('missed')}
            >
              {saving === 'missed' ? <Loader2 size={16} className="ica-spin" /> : <PhoneMissed size={16} />}
              I MISSED THIS CALL
            </button>
            <button
              className="ica-btn ica-btn-callback"
              disabled={!!saving}
              onClick={() => setShowCallback(!showCallback)}
            >
              {saving === 'callback_needed' ? <Loader2 size={16} className="ica-spin" /> : <RefreshCw size={16} />}
              CALLBACK NEEDED
            </button>
          </div>

          {showCallback && (
            <div className="ica-callback-form">
              <div className="ica-callback-inputs">
                <input type="date" value={callbackDate} onChange={e => setCallbackDate(e.target.value)} className="ica-input" />
                <input type="time" value={callbackTime} onChange={e => setCallbackTime(e.target.value)} className="ica-input" />
              </div>
              <button className="ica-btn ica-btn-schedule" disabled={!!saving} onClick={handleSchedule}>
                {saving === 'callback' ? <Loader2 size={14} className="ica-spin" /> : null}
                Schedule Callback
              </button>
            </div>
          )}
        </div>
      )}

      {/* Resolved badge */}
      {alert.agent_outcome && (
        <div className={`ica-resolved-badge ica-resolved-${alert.agent_outcome}`}>
          {alert.agent_outcome === 'answered' && <><Phone size={14} /> Agent-reported: Answered</>}
          {alert.agent_outcome === 'missed' && <><PhoneMissed size={14} /> Agent-reported: Missed</>}
          {alert.agent_outcome === 'callback_needed' && <><RefreshCw size={14} /> Callback scheduled{alert.callback_at ? ` for ${new Date(alert.callback_at).toLocaleString()}` : ''}</>}
          {alert.agent_outcome === 'unacknowledged' && <><AlertCircle size={14} /> Outcome unknown</>}
        </div>
      )}
    </div>
  );
}

export function IncomingCallAlert({
  alerts,
  onAcknowledge,
  onScheduleCallback,
  onDismiss,
  sessionToken,
  onUnauthorized,
  agentName,
}: IncomingCallAlertProps) {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(new Set());

  const handleDismiss = useCallback((id: string) => {
    setLocalDismissed(prev => new Set(prev).add(id));
    onDismiss(id);
  }, [onDismiss]);

  const activeAlerts = alerts.filter(a => !localDismissed.has(a.id) && (!a.agent_outcome || !a.is_dismissed));
  if (activeAlerts.length === 0) return null;

  return (
    <div className="ica-overlay">
      <div className="ica-container">
        <div className="ica-top-bar">
          <div className="ica-top-left">
            <PhoneIncoming size={18} />
            <strong>INCOMING TRANSFERS</strong>
            <span className="ica-alert-count">{activeAlerts.length}</span>
          </div>
          <button
            className={`ica-audio-toggle ${audioEnabled ? 'ica-audio-on' : ''}`}
            onClick={() => setAudioEnabled(!audioEnabled)}
            title={audioEnabled ? 'Disable call alerts' : 'Enable call alerts'}
          >
            {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{audioEnabled ? 'Alerts on' : 'Enable call alerts'}</span>
          </button>
        </div>

        <div className="ica-card-list">
          {activeAlerts.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onAcknowledge={onAcknowledge}
              onScheduleCallback={onScheduleCallback}
              onDismiss={handleDismiss}
              sessionToken={sessionToken}
              onUnauthorized={onUnauthorized}
              audioEnabled={audioEnabled}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
