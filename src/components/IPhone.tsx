import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Phone, PhoneOff, PhoneOutgoing, PhoneIncoming, PhoneForwarded,
  RotateCcw, X, Delete, ChevronDown, ChevronUp, Loader2,
  Mic, MicOff, Volume2, VolumeX, Grid3X3,
} from 'lucide-react';
import { formatPhone } from '@/utils/privacy';
import { authFetch } from '@/utils/auth-fetch';
import './IPhone.css';

/* ── Types ── */
interface IPhoneProps {
  agentName: string;
  sessionToken: string;
  providerUrl: string;
  onUnauthorized: () => void;
}

interface RouteData {
  talkroute_number?: string;
  zadarma_sip_login?: string;
  zadarma_sip_password?: string;
}

type ConnState = 'idle' | 'connecting' | 'ready' | 'failed';
type CallState = 'idle' | 'dialing' | 'ringing-in' | 'active' | 'callback-ringing';

interface RecentCall {
  number: string;
  direction: 'outgoing' | 'incoming' | 'missed';
  time: Date;
}

/* ── Constants ── */
const WIDGET_DOMAIN = 'wolf-of-wall-street-ssy3.bolt.host';
const WIDGET_SCRIPT = 'https://my.zadarma.com/webphoneWebRTCWidget/v8/js/loader-phone-lib.js';

const DIALPAD_KEYS = [
  { digit: '1', sub: '' }, { digit: '2', sub: 'ABC' }, { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' }, { digit: '5', sub: 'JKL' }, { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' }, { digit: '8', sub: 'TUV' }, { digit: '9', sub: 'WXYZ' },
  { digit: '*', sub: '' }, { digit: '0', sub: '+' }, { digit: '#', sub: '' },
];

function ts() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ══════════════════════════════════════════════════════════════════════ */
export function IPhone({ agentName, sessionToken, providerUrl, onUnauthorized }: IPhoneProps) {
  /* ── State ── */
  const [open, setOpen] = useState(false);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [connState, setConnState] = useState<ConnState>('idle');
  const [callState, setCallState] = useState<CallState>('idle');
  const [digits, setDigits] = useState('');
  const [callNumber, setCallNumber] = useState('');
  const [callTimer, setCallTimer] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speakerOff, setSpeakerOff] = useState(false);
  const [showDtmf, setShowDtmf] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState('');
  const [recents, setRecents] = useState<RecentCall[]>([]);
  const [micGranted, setMicGranted] = useState(false);

  /* ── Refs ── */
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setupRanRef = useRef(false);
  const widgetLoadedRef = useRef(false);

  const firstName = agentName.split(' ')[0] || 'Agent';

  /* ── Logging ── */
  const log = useCallback((msg: string) => {
    const line = `${ts()} ${msg}`;
    console.log('[Phone]', msg);
    setLogs(prev => [...prev.slice(-80), line]);
  }, []);

  /* ── Call timer ── */
  useEffect(() => {
    if (callState === 'active') {
      setCallTimer(0);
      timerRef.current = setInterval(() => setCallTimer(t => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callState]);

  /* ── Request microphone permission ── */
  const requestMic = useCallback(async () => {
    if (micGranted) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setMicGranted(true);
      log('Microphone access granted');
      return true;
    } catch (err) {
      log(`Microphone denied: ${err}`);
      setError('Microphone access is required for calls. Please allow it in your browser settings.');
      return false;
    }
  }, [micGranted, log]);

  /* ── Load route data ── */
  useEffect(() => {
    let stop = false;
    (async () => {
      const r = await authFetch<{ route: RouteData }>(providerUrl, {
        body: { action: 'get_federal_one_v2', session_token: sessionToken },
        onUnauthorized: () => onUnauthorizedRef.current(),
      });
      if (stop) return;
      if (r.ok && r.data?.route) {
        setRoute(r.data.route);
        if (r.data.route.zadarma_sip_login) log(`SIP: ${r.data.route.zadarma_sip_login}`);
      } else {
        log(`Route load failed: ${r.error || 'unknown'}`);
        setError('Could not load phone settings');
      }
    })();
    return () => { stop = true; };
  }, [providerUrl, sessionToken, log]);

  /* ── Load Zadarma widget ── */
  const loadWidget = useCallback(async () => {
    if (widgetLoadedRef.current) return;
    setConnState('connecting');
    log('Setting up Zadarma phone...');

    // Step 1: Setup WebRTC domain (idempotent)
    try {
      await authFetch(providerUrl, {
        body: { action: 'zadarma_setup_webrtc', session_token: sessionToken },
        onUnauthorized: () => onUnauthorizedRef.current(),
      });
    } catch (_) { /* best-effort */ }

    // Step 2: Get WebRTC key
    const keyRes = await authFetch<{ key?: string; error?: string }>(providerUrl, {
      body: { action: 'zadarma_webrtc_key', session_token: sessionToken },
      onUnauthorized: () => onUnauthorizedRef.current(),
    });

    if (!keyRes.ok || !keyRes.data?.key) {
      log(`Widget key failed: ${keyRes.data?.error || keyRes.error || 'unknown'}`);
      setConnState('failed');
      return;
    }

    const key = keyRes.data.key;
    log('Got widget key, loading phone...');

    // Step 3: Request microphone early so widget can use it
    await requestMic();

    // Step 4: Load the widget script
    const script = document.createElement('script');
    script.id = 'zadarma-phone-lib';
    script.src = `${WIDGET_SCRIPT}?location_href=${encodeURIComponent(WIDGET_DOMAIN)}&key=${encodeURIComponent(key)}`;
    script.async = true;

    script.onload = () => {
      widgetLoadedRef.current = true;
      log('Zadarma phone ready');
      setConnState('ready');
    };

    script.onerror = () => {
      log('Widget script failed to load');
      setConnState('failed');
    };

    document.body.appendChild(script);
  }, [providerUrl, sessionToken, log, requestMic]);

  /* ── Auto-connect when route is loaded ── */
  useEffect(() => {
    if (!route || setupRanRef.current) return;
    if (!route.zadarma_sip_login) {
      log('No SIP credentials found');
      setConnState('failed');
      return;
    }
    setupRanRef.current = true;
    loadWidget();
  }, [route, loadWidget, log]);

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => {
      const ws = document.getElementById('zadarma-phone-lib');
      if (ws) ws.remove();
      document.querySelectorAll('[class*="zadarma"],[id*="zadarma"],[class*="webrtc-phone"]').forEach(el => el.remove());
    };
  }, []);

  /* ── Make outgoing call ── */
  const makeCall = useCallback(async (number: string) => {
    const cleaned = number.replace(/\D/g, '');
    if (!cleaned || cleaned.length < 3) return;

    // Always ensure mic is granted before calling
    const hasMic = await requestMic();
    if (!hasMic) return;

    if (connState === 'ready' && widgetLoadedRef.current) {
      // Try dispatching call to the Zadarma widget
      const dialNum = cleaned.length === 10 ? `1${cleaned}` : cleaned;
      log(`Dialing ${dialNum} via Zadarma widget...`);
      setCallNumber(cleaned);
      setCallState('dialing');
      setRecents(prev => [{ number: cleaned, direction: 'outgoing', time: new Date() }, ...prev.slice(0, 19)]);

      try {
        // Zadarma widget API: dispatch call command
        document.dispatchEvent(new CustomEvent('zadarma-phone-api', {
          detail: { command: 'call', number: dialNum },
        }));
        log('Call sent to widget');
        // Also try callback as backup in parallel
        initiateCallback(cleaned);
      } catch (err) {
        log(`Widget call error: ${err}`);
        // Fall back to callback
        initiateCallback(cleaned);
      }
    } else {
      // No widget -- pure callback
      setCallNumber(cleaned);
      setCallState('dialing');
      setRecents(prev => [{ number: cleaned, direction: 'outgoing', time: new Date() }, ...prev.slice(0, 19)]);
      initiateCallback(cleaned);
    }
  }, [connState, log, requestMic]);

  /* ── Callback API ── */
  const initiateCallback = useCallback(async (number: string) => {
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length < 10) { setError('Enter at least 10 digits'); return; }
    const dialNum = cleaned.length === 10 ? `1${cleaned}` : cleaned;
    log(`Requesting callback to ${dialNum}...`);

    const r = await authFetch<{ ok: boolean; message?: string; error?: string }>(providerUrl, {
      body: { action: 'zadarma_callback', session_token: sessionToken, to: dialNum },
      onUnauthorized: () => onUnauthorizedRef.current(),
    });

    if (r.ok && r.data?.ok) {
      log(`Callback initiated: ${r.data.message || 'success'}`);
      setCallState('callback-ringing');
    } else {
      const errMsg = r.data?.error || r.error || 'Callback failed';
      log(`Callback error: ${errMsg}`);
      setError(errMsg);
      setCallState('idle');
      setCallNumber('');
    }
  }, [providerUrl, sessionToken, log]);

  /* ── End call ── */
  const endCall = useCallback(() => {
    setCallState('idle');
    setCallNumber('');
    setMuted(false);
    setSpeakerOff(false);
    setShowDtmf(false);
  }, []);

  /* ── Reconnect ── */
  const reconnect = useCallback(() => {
    if (!route?.zadarma_sip_login) return;
    widgetLoadedRef.current = false;
    const ws = document.getElementById('zadarma-phone-lib');
    if (ws) ws.remove();
    document.querySelectorAll('[class*="zadarma"],[id*="zadarma"],[class*="webrtc-phone"]').forEach(el => el.remove());
    setupRanRef.current = false;
    setConnState('idle');
    setError('');
    log('Reconnecting...');
    setTimeout(() => {
      setupRanRef.current = true;
      loadWidget();
    }, 300);
  }, [route, loadWidget, log]);

  /* ── Dialpad press ── */
  const pressKey = useCallback((digit: string) => {
    setDigits(prev => prev + digit);
  }, []);

  /* ── Status ── */
  const statusDot = connState === 'ready' ? 'connected'
    : connState === 'failed' ? 'callback'
    : connState === 'connecting' ? 'connecting'
    : 'offline';

  const statusLabel = connState === 'ready' ? 'Connected'
    : connState === 'failed' ? 'Connection Failed'
    : connState === 'connecting' ? 'Connecting...'
    : 'Loading...';

  const canDial = connState === 'ready' || connState === 'failed';

  /* ─── Closed ─── */
  if (!open) {
    return (
      <aside className={`ip17-shell ip17-closed${callState === 'ringing-in' ? ' ip17-ringing' : ''}`} aria-label="Open phone">
        <button className="ip17-trigger" onClick={() => setOpen(true)}>
          <div className="ip17-trigger-icon">
            <Phone size={26} />
            <div className="ip17-trigger-waves"><span /><span /><span /></div>
          </div>
          <div className={`ip17-trigger-sip-dot ${statusDot}`} />
          {callState === 'ringing-in' && <div className="ip17-trigger-badge" />}
        </button>
      </aside>
    );
  }

  /* ─── Active Call View ─── */
  if (callState === 'active' || callState === 'dialing' || callState === 'callback-ringing') {
    return (
      <aside className="ip17-shell">
        <div className="ip17-island">
          <div className="ip17-island-pill">
            <div className={`ip17-island-dot ${callState === 'callback-ringing' ? 'connecting' : 'connected'}`} />
            <span className="ip17-island-label">
              {callState === 'dialing' ? 'Calling...'
                : callState === 'callback-ringing' ? 'Ringing...'
                : fmtDuration(callTimer)}
            </span>
            <div className="ip17-island-wave" />
          </div>
        </div>
        <div className="ip17-body">
          <div className="ip17-active">
            <div className="ip17-active-header">
              <h3 className="ip17-caller">{formatPhone(callNumber)}</h3>
              <p className="ip17-timer">
                {callState === 'dialing' ? 'Dialing...'
                  : callState === 'callback-ringing' ? 'Your Zadarma phone will ring — answer it to connect'
                  : fmtDuration(callTimer)}
              </p>
            </div>

            {callState === 'callback-ringing' && (
              <div className="ip17-callback-notice">
                <Loader2 size={20} className="ip17-spin" />
                <p>Zadarma is calling your extension now. Answer the call on the Zadarma widget (floating phone button) to connect to the other line.</p>
              </div>
            )}

            {/* Call controls - only show when active */}
            {callState === 'active' && (
              <div className="ip17-call-controls">
                <button className={`ip17-ctrl-btn${muted ? ' active' : ''}`} onClick={() => setMuted(!muted)}>
                  {muted ? <MicOff size={22} /> : <Mic size={22} />}
                  <span>{muted ? 'Unmute' : 'Mute'}</span>
                </button>
                <button className={`ip17-ctrl-btn${speakerOff ? ' active' : ''}`} onClick={() => setSpeakerOff(!speakerOff)}>
                  {speakerOff ? <VolumeX size={22} /> : <Volume2 size={22} />}
                  <span>Speaker</span>
                </button>
                <button className={`ip17-ctrl-btn${showDtmf ? ' active' : ''}`} onClick={() => setShowDtmf(!showDtmf)}>
                  <Grid3X3 size={22} />
                  <span>Keypad</span>
                </button>
              </div>
            )}

            {/* DTMF pad */}
            {showDtmf && callState === 'active' && (
              <div className="ip17-dtmf-pad">
                {DIALPAD_KEYS.map(k => (
                  <button key={k.digit} className="ip17-dtmf-key" onClick={() => log(`DTMF: ${k.digit}`)}>
                    {k.digit}
                  </button>
                ))}
              </div>
            )}

            {/* Hangup / Cancel */}
            <button className="ip17-hangup-btn" onClick={endCall}>
              <PhoneOff size={28} />
            </button>
          </div>
        </div>
      </aside>
    );
  }

  /* ─── Idle View (Dialpad) ─── */
  return (
    <aside className="ip17-shell">
      <div className="ip17-island">
        <div className="ip17-island-pill">
          <div className={`ip17-island-dot ${statusDot}`} />
          <span className="ip17-island-label">{firstName}'s Phone</span>
          <button className="ip17-island-close" onClick={() => setOpen(false)}><X size={16} /></button>
        </div>
      </div>

      <div className="ip17-body">
        {/* Status bar */}
        <div className="ip17-statusbar">
          <span className={`ip17-sip-badge ${statusDot}`}>{statusLabel}</span>
          {route?.talkroute_number && <span className="ip17-my-line">{formatPhone(route.talkroute_number)}</span>}
        </div>

        {/* Mic permission button */}
        {!micGranted && connState === 'ready' && (
          <div className="ip17-mode-notice" style={{ borderColor: '#3a2a1a', background: '#1a0f0a' }}>
            <Mic size={14} />
            <span>
              Microphone access needed for calls.{' '}
              <button onClick={requestMic} style={{ color: '#f0a050', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Allow microphone
              </button>
            </span>
          </div>
        )}

        {/* Connection status notice */}
        {connState === 'failed' && (
          <div className="ip17-mode-notice">
            <PhoneForwarded size={14} />
            <span>
              Phone connection failed.{' '}
              <button onClick={reconnect}>Retry connection</button>
            </span>
          </div>
        )}

        {connState === 'ready' && micGranted && (
          <div className="ip17-mode-notice" style={{ borderColor: '#1a3a1a', background: '#0a1a0a' }}>
            <Phone size={14} />
            <span style={{ color: '#8ee0a0' }}>
              Phone ready. Dial a number and press the green button to call.
            </span>
          </div>
        )}

        {/* Number display */}
        <div className="ip17-idle">
          <div className="ip17-display">
            <input
              type="text"
              value={digits}
              onChange={e => setDigits(e.target.value.replace(/[^0-9*#+]/g, ''))}
              placeholder="Enter number"
              autoComplete="off"
            />
            {digits && (
              <button className="ip17-backspace" onClick={() => setDigits(d => d.slice(0, -1))}>
                <Delete size={20} />
              </button>
            )}
          </div>

          {/* Dialpad */}
          <div className="ip17-dialpad">
            {DIALPAD_KEYS.map(k => (
              <button key={k.digit} className="ip17-key" onClick={() => pressKey(k.digit)}>
                <span className="ip17-key-digit">{k.digit}</span>
                {k.sub && <span className="ip17-key-sub">{k.sub}</span>}
              </button>
            ))}
          </div>

          {/* Dial button */}
          <div className="ip17-dial-row">
            <button
              className="ip17-dial-btn"
              disabled={!canDial || digits.replace(/\D/g, '').length < 3}
              onClick={() => makeCall(digits)}
            >
              <Phone size={28} />
            </button>
          </div>
        </div>

        {/* Recents */}
        {recents.length > 0 && (
          <div className="ip17-recent">
            <div className="ip17-recent-title">Recents</div>
            {recents.slice(0, 8).map((r, i) => (
              <div key={i} className="ip17-recent-row">
                <div className={`ip17-recent-icon ${r.direction}`}>
                  {r.direction === 'outgoing' ? <PhoneOutgoing size={14} /> :
                   r.direction === 'incoming' ? <PhoneIncoming size={14} /> :
                   <PhoneOff size={14} />}
                </div>
                <div className="ip17-recent-info">
                  <strong>{formatPhone(r.number)}</strong>
                  <time>{r.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
                <button className="ip17-callback" onClick={() => { setDigits(r.number); }}>
                  <Phone size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Debug log */}
        <div className="ip17-log-toggle">
          <button onClick={() => setShowLog(!showLog)}>
            {showLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span>Debug log</span>
          </button>
          {connState === 'failed' && (
            <button className="ip17-reconnect" onClick={reconnect}>
              <RotateCcw size={10} /> Reconnect
            </button>
          )}
        </div>

        {showLog && (
          <div className="ip17-debug-log">
            {logs.length === 0 ? (
              <div className="ip17-log-line">Waiting...</div>
            ) : logs.map((line, i) => (
              <div key={i} className="ip17-log-line">{line}</div>
            ))}
          </div>
        )}

        {error && (
          <div className="ip17-error">{error}<button onClick={() => setError('')}>&times;</button></div>
        )}
      </div>
    </aside>
  );
}
