import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Clock, Copy, X, Volume2, VolumeX, ChevronDown, ChevronUp, MapPin, DollarSign, Home, FileText, Check, AlertTriangle, RefreshCw, Calendar } from 'lucide-react';
import { RecordingPlayer } from './RecordingPlayer';

export type TransferAlert = {
  id: string;
  call_id: string;
  agent_id: string;
  status: 'active' | 'acknowledged' | 'callback_needed' | 'completed';
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
  transfer_requested_at: string | null;
  talkroute_leg_created_at: string | null;
  talkroute_answered_at: string | null;
  bridge_confirmed_at: string | null;
  outcome: string | null;
  notes: string | null;
  callback_at: string | null;
  callback_completed_at: string | null;
  recording_url: string | null;
  transcript: string | null;
  created_at: string;
  updated_at: string;
};

interface IncomingCallAlertProps {
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

function elapsed(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const STATUS_STEPS = ['transfer_requested', 'talkroute_leg_created', 'talkroute_answered', 'bridge_confirmed'] as const;
const STEP_LABELS: Record<string, string> = {
  transfer_requested: 'Transfer',
  talkroute_leg_created: 'Leg Created',
  talkroute_answered: 'Answered',
  bridge_confirmed: 'Bridged',
};

function AlertCard({
  alert, onAcknowledge, onScheduleCallback, onDismiss,
}: {
  alert: TransferAlert;
  onAcknowledge: IncomingCallAlertProps['onAcknowledge'];
  onScheduleCallback: IncomingCallAlertProps['onScheduleCallback'];
  onDismiss: IncomingCallAlertProps['onDismiss'];
}) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCallback, setShowCallback] = useState(false);
  const [callbackDate, setCallbackDate] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [elapsedStr, setElapsedStr] = useState(elapsed(alert.created_at));
  const [copied, setCopied] = useState(false);

  const resolved = alert.status !== 'active';

  useEffect(() => {
    if (resolved) return;
    const t = setInterval(() => setElapsedStr(elapsed(alert.created_at)), 1000);
    return () => clearInterval(t);
  }, [alert.created_at, resolved]);

  const handleAcknowledge = useCallback(async (outcome: string) => {
    setSubmitting(true);
    setError(null);
    const ok = await onAcknowledge(alert.id, outcome, notes);
    if (!ok) setError('Failed to save — please try again');
    setSubmitting(false);
  }, [alert.id, notes, onAcknowledge]);

  const handleSchedule = useCallback(async () => {
    if (!callbackDate || !callbackTime) return;
    setSubmitting(true);
    setError(null);
    const iso = new Date(`${callbackDate}T${callbackTime}`).toISOString();
    const ok = await onScheduleCallback(alert.id, iso, notes);
    if (!ok) setError('Failed to schedule — please try again');
    else setShowCallback(false);
    setSubmitting(false);
  }, [alert.id, callbackDate, callbackTime, notes, onScheduleCallback]);

  const copyPhone = () => {
    navigator.clipboard.writeText(alert.consumer_phone).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`ica-card ${resolved ? 'ica-card-resolved' : 'ica-card-active'}`}>
      <div className="ica-card-header">
        <div className="ica-header-left">
          <div className={`ica-pulse ${resolved ? 'ica-pulse-resolved' : ''}`}>
            <Phone size={18} />
          </div>
          <div>
            <div className="ica-header-title">
              {resolved ? 'Resolved' : 'Incoming Transfer'}
            </div>
            <div className="ica-header-sub">
              {alert.direction && <span className="ica-direction">{alert.direction}</span>}
              <span>{new Date(alert.created_at).toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
        <div className="ica-header-right">
          <span className="ica-elapsed">
            <Clock size={12} />
            {elapsedStr}
          </span>
          {expanded ? (
            <button className="ica-btn-icon" onClick={() => setExpanded(false)}><ChevronUp size={16} /></button>
          ) : (
            <button className="ica-btn-icon" onClick={() => setExpanded(true)}><ChevronDown size={16} /></button>
          )}
          {resolved && (
            <button className="ica-btn-icon ica-dismiss" onClick={() => onDismiss(alert.id)}><X size={16} /></button>
          )}
        </div>
      </div>

      {expanded && (
        <>
          <div className="ica-status-badges">
            {STATUS_STEPS.map(step => (
              <span key={step} className={`ica-badge ${alert[step] ? 'ica-badge-active' : 'ica-badge-inactive'}`}>
                {alert[step] ? <Check size={10} /> : null}
                {STEP_LABELS[step]}
              </span>
            ))}
          </div>

          <div className="ica-client">
            <div className="ica-client-primary">
              <span className="ica-client-name">{alert.consumer_name || 'Unknown'}</span>
              <span className="ica-client-phone">{fmtPhone(alert.consumer_phone)}</span>
              <button className="ica-copy-btn" onClick={copyPhone} title="Copy phone">
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
            <div className="ica-client-details">
              {alert.consumer_address && (
                <div className="ica-detail-row"><MapPin size={13} /><span>{alert.consumer_address}</span></div>
              )}
              {alert.consumer_home_value && (
                <div className="ica-detail-row"><Home size={13} /><span>Home: {alert.consumer_home_value}</span></div>
              )}
              {alert.consumer_income_range && (
                <div className="ica-detail-row"><DollarSign size={13} /><span>Income: {alert.consumer_income_range}</span></div>
              )}
              {alert.consumer_property_info && (
                <div className="ica-detail-row"><FileText size={13} /><span>{alert.consumer_property_info}</span></div>
              )}
            </div>
          </div>

          {alert.recording_url && (
            <div className="ica-recording">
              <RecordingPlayer url={alert.recording_url} />
            </div>
          )}

          {alert.transcript && (
            <div className="ica-transcript">
              <div className="ica-transcript-title"><FileText size={12} />Transcript</div>
              <div className="ica-transcript-text">{alert.transcript}</div>
            </div>
          )}

          {error && (
            <div className="ica-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
              <button onClick={() => setError(null)}><X size={12} /></button>
            </div>
          )}

          {resolved ? (
            <div className={`ica-resolved-badge ica-resolved-${alert.outcome || alert.status}`}>
              {alert.outcome === 'answered' && <><Check size={14} /> Answered</>}
              {alert.outcome === 'missed' && <><PhoneOff size={14} /> Missed</>}
              {alert.status === 'callback_needed' && <><Calendar size={14} /> Callback scheduled</>}
              {alert.notes && <span style={{ marginLeft: 8, opacity: 0.7 }}>— {alert.notes}</span>}
            </div>
          ) : (
            <div className="ica-actions">
              <textarea
                className="ica-notes"
                placeholder="Notes (optional)..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
              />
              <div className="ica-action-buttons">
                <button
                  className="ica-btn ica-btn-answered"
                  disabled={submitting}
                  onClick={() => handleAcknowledge('answered')}
                >
                  {submitting ? <RefreshCw size={14} className="ica-spin" /> : <Phone size={14} />}
                  I Answered
                </button>
                <button
                  className="ica-btn ica-btn-missed"
                  disabled={submitting}
                  onClick={() => handleAcknowledge('missed')}
                >
                  <PhoneOff size={14} /> Missed
                </button>
                <button
                  className="ica-btn ica-btn-callback"
                  disabled={submitting}
                  onClick={() => setShowCallback(v => !v)}
                >
                  <Clock size={14} /> Callback
                </button>
              </div>
              {showCallback && (
                <div className="ica-callback-form">
                  <input type="date" className="ica-input" value={callbackDate} onChange={e => setCallbackDate(e.target.value)} />
                  <input type="time" className="ica-input" value={callbackTime} onChange={e => setCallbackTime(e.target.value)} />
                  <button
                    className="ica-btn-schedule"
                    disabled={submitting || !callbackDate || !callbackTime}
                    onClick={handleSchedule}
                  >
                    {submitting ? <RefreshCw size={12} className="ica-spin" /> : <Calendar size={12} />}
                    Schedule
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function IncomingCallAlert({
  alerts, onAcknowledge, onScheduleCallback, onDismiss, agentName,
}: IncomingCallAlertProps) {
  const [audioOn, setAudioOn] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeAlerts = alerts.filter(a => a.status === 'active');

  useEffect(() => {
    if (!audioOn || activeAlerts.length === 0) return;
    try {
      if (!audioRef.current) {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 300);
      }
    } catch { /* audio context not available */ }
  }, [audioOn, activeAlerts.length]);

  if (alerts.length === 0) return null;

  return (
    <div className="ica-overlay">
      <div className="ica-container">
        <div className="ica-top-bar">
          <div className="ica-top-left">
            <Phone size={14} />
            <span>{agentName}</span>
            {activeAlerts.length > 0 && (
              <span className="ica-alert-count">{activeAlerts.length}</span>
            )}
          </div>
          <button
            className={`ica-audio-toggle ${audioOn ? 'ica-audio-on' : ''}`}
            onClick={() => setAudioOn(v => !v)}
          >
            {audioOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            {audioOn ? 'On' : 'Off'}
          </button>
        </div>

        {alerts.map(alert => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onAcknowledge={onAcknowledge}
            onScheduleCallback={onScheduleCallback}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}
