import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Delete, Mic, MicOff, Phone,
  PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing,
  PhoneForwarded, RotateCcw, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import { formatPhone } from '@/utils/privacy';
import { authFetch } from '@/utils/auth-fetch';
import './IPhone.css';

type CallDirection = 'outgoing' | 'incoming';
type CallState = 'idle' | 'ringing' | 'active' | 'connecting';

interface RecentCall {
  number: string;
  name?: string;
  direction: CallDirection;
  missed: boolean;
  time: Date;
}

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

const DIALPAD_KEYS = [
  { digit: '1', sub: '' },
  { digit: '2', sub: 'ABC' },
  { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' },
  { digit: '5', sub: 'JKL' },
  { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' },
  { digit: '8', sub: 'TUV' },
  { digit: '9', sub: 'WXYZ' },
  { digit: '*', sub: '' },
  { digit: '0', sub: '+' },
  { digit: '#', sub: '' },
];

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function ts() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Load Zadarma WebRTC widget scripts dynamically
function loadZadarmaScripts(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).__zadarmaLoaded) { resolve(); return; }
    const base = 'https://my.zadarma.com/webphoneWebRTCWidget/v9/js/';
    const s1 = document.createElement('script');
    s1.src = `${base}loader-phone-lib.js?${Date.now()}`;
    s1.async = true;
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = `${base}loader-phone-fn.js?${Date.now()}`;
      s2.async = true;
      s2.onload = () => {
        (window as any).__zadarmaLoaded = true;
        resolve();
      };
      s2.onerror = () => reject(new Error('Failed to load Zadarma phone fn script'));
      document.head.appendChild(s2);
    };
    s1.onerror = () => reject(new Error('Failed to load Zadarma phone lib script'));
    document.head.appendChild(s1);
  });
}

export function IPhone({ agentName, sessionToken, providerUrl, onUnauthorized }: IPhoneProps) {
  const [open, setOpen] = useState(false);
  const [digits, setDigits] = useState('');
  const [callState, setCallState] = useState<CallState>('idle');
  const [callDirection, setCallDirection] = useState<CallDirection>('outgoing');
  const [callerName, setCallerName] = useState('');
  const [callerNumber, setCallerNumber] = useState('');
  const [timer, setTimer] = useState(0);
  const [recent, setRecent] = useState<RecentCall[]>([]);
  const [error, setError] = useState('');
  const [route, setRoute] = useState<RouteData | null>(null);
  const [muted, setMuted] = useState(false);
  const [widgetReady, setWidgetReady] = useState(false);
  const [widgetStatus, setWidgetStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [sipLog, setSipLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showDialpad, setShowDialpad] = useState(true);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const zadarmaNumber = route?.talkroute_number || '';
  const hasSipCreds = !!(route?.zadarma_sip_login);
  const firstName = agentName.split(' ')[0] || 'Agent';

  const log = useCallback((msg: string) => {
    const line = `${ts()} ${msg}`;
    console.log('[Phone]', msg);
    setSipLog(prev => [...prev.slice(-40), line]);
  }, []);

  // Load route data
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const r = await authFetch<{ route: RouteData }>(providerUrl, {
        body: { action: 'get_federal_one_v2', session_token: sessionToken },
        onUnauthorized: () => onUnauthorizedRef.current(),
      });
      if (!stop && r.ok && r.data?.route) {
        setRoute(r.data.route);
        if (r.data.route.zadarma_sip_login) {
          setSipLog([`${ts()} SIP: ${r.data.route.zadarma_sip_login}`]);
        } else {
          setSipLog([`${ts()} No SIP credentials for this agent`]);
        }
      } else if (!stop) {
        setSipLog([`${ts()} Failed to load route data`]);
      }
    };
    void load();
    return () => { stop = true; };
  }, [providerUrl, sessionToken]);

  // Initialize Zadarma WebRTC widget
  useEffect(() => {
    if (!hasSipCreds || !route?.zadarma_sip_login) return;
    let stopped = false;

    const init = async () => {
      try {
        log('Loading Zadarma WebRTC scripts...');
        await loadZadarmaScripts();
        if (stopped) return;

        log('Fetching WebRTC key...');
        const r = await authFetch<{ key: string; sip: string }>(providerUrl, {
          body: { action: 'zadarma_webrtc_key', session_token: sessionToken },
          onUnauthorized: () => onUnauthorizedRef.current(),
        });
        if (stopped) return;

        if (!r.ok || !r.data?.key) {
          log(`Key fetch failed: ${r.error || 'unknown'}`);
          setWidgetStatus('failed');
          setError(r.error || 'Failed to get WebRTC key');
          return;
        }

        const { key, sip } = r.data;
        log(`Got key for ${sip}, initializing widget...`);

        const zadarmaWidgetFn = (window as any).zadarmaWidgetFn;
        if (typeof zadarmaWidgetFn !== 'function') {
          log('Widget function not available');
          setWidgetStatus('failed');
          setError('Zadarma widget failed to load');
          return;
        }

        zadarmaWidgetFn(key, sip, 'square', 'en', true, {
          right: '400px',
          bottom: '20px',
        });

        log('Widget initialized successfully');
        setWidgetReady(true);
        setWidgetStatus('ready');
      } catch (err) {
        if (!stopped) {
          log(`Init error: ${err}`);
          setWidgetStatus('failed');
          setError('Phone widget failed to initialize');
        }
      }
    };

    void init();
    return () => { stopped = true; };
  }, [hasSipCreds, route?.zadarma_sip_login, providerUrl, sessionToken, log]);

  const startTimer = useCallback(() => {
    setTimer(0);
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const addRecent = useCallback((number: string, direction: CallDirection, missed: boolean, name?: string) => {
    setRecent(prev => [{ number, direction, missed, name, time: new Date() }, ...prev].slice(0, 20));
  }, []);

  const endCall = useCallback(() => {
    stopTimer();
    setCallState('idle');
    setCallerName('');
    setCallerNumber('');
    setMuted(false);
  }, [stopTimer]);

  // API callback call (fallback when widget unavailable)
  const makeCallbackCall = useCallback(async (number: string) => {
    const cleaned = number.replace(/\D/g, '');
    log(`API callback to ${cleaned}...`);
    setCallDirection('outgoing');
    setCallerNumber(number);
    setCallerName('');
    setCallState('connecting');

    const r = await authFetch<{ ok: boolean; message?: string; error?: string }>(providerUrl, {
      body: { action: 'zadarma_callback', session_token: sessionToken, to: cleaned },
      onUnauthorized: () => onUnauthorizedRef.current(),
    });

    if (r.ok && r.data?.ok) {
      log(`Callback initiated: ${r.data.message || 'success'}`);
      setCallState('active');
      startTimer();
      addRecent(number, 'outgoing', false);
    } else {
      const errMsg = r.data?.error || r.error || 'Callback failed';
      log(`Callback error: ${errMsg}`);
      setError(errMsg);
      setCallState('idle');
      addRecent(number, 'outgoing', true);
    }
  }, [providerUrl, sessionToken, startTimer, addRecent, log]);

  const makeCall = useCallback((number: string) => {
    if (!number || callState !== 'idle') return;
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length < 10) { setError('Enter a valid number (10+ digits)'); return; }
    setError('');

    if (hasSipCreds) {
      void makeCallbackCall(number);
    } else {
      setError('No SIP credentials configured');
    }
  }, [callState, hasSipCreds, makeCallbackCall]);

  const callbackNumber = useCallback((num: string) => {
    setDigits(num);
    makeCall(num);
  }, [makeCall]);

  useEffect(() => () => { stopTimer(); }, [stopTimer]);

  const pressDigit = (d: string) => {
    setDigits(prev => prev + d);
  };

  const isOnCall = callState === 'active' || callState === 'connecting' || callState === 'ringing';
  const statusDot = widgetReady ? 'connected' : hasSipCreds ? (widgetStatus === 'failed' ? 'callback' : 'connecting') : 'offline';
  const canDial = hasSipCreds;

  // Closed state
  if (!open) {
    return (
      <aside
        className={`ip17-shell ip17-closed ${callState === 'ringing' ? 'ip17-ringing' : ''}`}
        aria-label="Open phone"
      >
        <button className="ip17-trigger" onClick={() => setOpen(true)}>
          <div className="ip17-trigger-icon">
            <Phone size={26} />
            <div className="ip17-trigger-waves">
              <span /><span /><span />
            </div>
          </div>
          {callState === 'ringing' && <div className="ip17-trigger-badge" />}
          <div className={`ip17-trigger-sip-dot ${statusDot}`} />
        </button>
      </aside>
    );
  }

  return (
    <aside className={`ip17-shell ${callState === 'ringing' ? 'ip17-ringing' : ''}`}>
      {/* Dynamic Island */}
      <div className="ip17-island">
        <div className="ip17-island-pill">
          <div className={`ip17-island-dot ${statusDot}`} />
          {isOnCall ? (
            <>
              <span className="ip17-island-label">
                {callState === 'ringing' ? 'Incoming' : callState === 'connecting' ? 'Calling...' : formatTimer(timer)}
              </span>
            </>
          ) : (
            <span className="ip17-island-label">{firstName}'s Phone</span>
          )}
          <button className="ip17-island-close" onClick={() => setOpen(false)} aria-label="Close phone">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="ip17-body">
        {/* Status bar */}
        <div className="ip17-statusbar">
          <span className={`ip17-sip-badge ${statusDot}`}>
            {widgetReady ? 'WebRTC Ready' :
             widgetStatus === 'failed' ? 'Callback Mode' :
             hasSipCreds ? 'Loading...' : 'No SIP'}
          </span>
          {zadarmaNumber && <span className="ip17-my-line">{formatPhone(zadarmaNumber)}</span>}
        </div>

        {/* Widget status notice */}
        {widgetReady && callState === 'idle' && (
          <div className="ip17-mode-notice" style={{ borderColor: '#1a3a1a', background: '#0a1a0a' }}>
            <Phone size={14} />
            <span style={{ color: '#8ee0a0' }}>Zadarma web phone is active. Use the widget or the dialpad below to make calls.</span>
          </div>
        )}

        {widgetStatus === 'failed' && callState === 'idle' && (
          <div className="ip17-mode-notice">
            <PhoneForwarded size={14} />
            <span>Widget couldn't load. Calls will use the API callback method -- Zadarma rings your extension first, then connects to the number you dialed.</span>
          </div>
        )}

        {/* Debug log toggle */}
        <div className="ip17-log-toggle">
          <button onClick={() => setShowLog(!showLog)}>
            {showLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span>Debug log</span>
          </button>
        </div>

        {showLog && (
          <div className="ip17-debug-log">
            {sipLog.length === 0 ? (
              <div className="ip17-log-line">Waiting for credentials...</div>
            ) : sipLog.map((line, i) => (
              <div key={i} className="ip17-log-line">{line}</div>
            ))}
          </div>
        )}

        {/* ── RINGING ── */}
        {callState === 'ringing' && (
          <div className="ip17-incoming">
            <div className="ip17-avatar-ring">
              <PhoneIncoming size={32} />
            </div>
            <h3 className="ip17-caller">{callerName || 'Incoming Call'}</h3>
            <p className="ip17-caller-num">{callerNumber ? formatPhone(callerNumber) : 'Unknown'}</p>
            <div className="ip17-incoming-btns">
              <button className="ip17-circle-btn decline" onClick={() => { addRecent(callerNumber || 'Unknown', 'incoming', true, callerName); endCall(); }} aria-label="Decline">
                <PhoneOff size={24} />
                <span>Decline</span>
              </button>
              <button className="ip17-circle-btn accept" onClick={() => { setCallState('active'); startTimer(); }} aria-label="Accept">
                <Phone size={24} />
                <span>Accept</span>
              </button>
            </div>
          </div>
        )}

        {/* ── ACTIVE / CONNECTING ── */}
        {(callState === 'active' || callState === 'connecting') && (
          <div className="ip17-active">
            <div className="ip17-active-header">
              <h3 className="ip17-caller">{callerName || formatPhone(callerNumber || digits)}</h3>
              <div className="ip17-timer">
                {callState === 'connecting' ? 'Ringing your extension...' : formatTimer(timer)}
              </div>
              {!widgetReady && callState === 'active' && (
                <div className="ip17-callback-badge">VIA CALLBACK</div>
              )}
            </div>

            <button className="ip17-hangup-btn" onClick={() => {
              addRecent(callerNumber || digits, callDirection, false, callerName);
              endCall();
            }} aria-label="End call">
              <PhoneOff size={24} />
            </button>
          </div>
        )}

        {/* ── IDLE ── */}
        {callState === 'idle' && (
          <div className="ip17-idle">
            <div className="ip17-display">
              <input
                type="text" value={digits}
                onChange={e => setDigits(e.target.value.replace(/[^0-9+*#]/g, ''))}
                placeholder="Enter number" aria-label="Phone number"
              />
              {digits && (
                <button className="ip17-backspace" onClick={() => setDigits(d => d.slice(0, -1))} aria-label="Delete">
                  <Delete size={18} />
                </button>
              )}
            </div>

            <div className="ip17-dialpad">
              {DIALPAD_KEYS.map(k => (
                <button key={k.digit} className="ip17-key" onClick={() => pressDigit(k.digit)}>
                  <span className="ip17-key-digit">{k.digit}</span>
                  {k.sub && <span className="ip17-key-sub">{k.sub}</span>}
                </button>
              ))}
            </div>

            <div className="ip17-dial-row">
              <button
                className="ip17-dial-btn"
                onClick={() => makeCall(digits)}
                disabled={!digits || !canDial}
                aria-label="Call"
              >
                <Phone size={24} />
              </button>
            </div>

            {!hasSipCreds && (
              <div className="ip17-notice">No SIP credentials configured for this agent.</div>
            )}

            {recent.length > 0 && (
              <div className="ip17-recent">
                <div className="ip17-recent-title">Recents</div>
                {recent.slice(0, 6).map((r, i) => (
                  <div key={i} className="ip17-recent-row">
                    <span className={`ip17-recent-icon ${r.missed ? 'missed' : r.direction}`}>
                      {r.missed ? <PhoneMissed size={14} /> : r.direction === 'outgoing' ? <PhoneOutgoing size={14} /> : <PhoneIncoming size={14} />}
                    </span>
                    <div className="ip17-recent-info">
                      <strong>{r.name || formatPhone(r.number)}</strong>
                      <time>{r.time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                    </div>
                    <button className="ip17-callback" onClick={() => callbackNumber(r.number)} aria-label="Call back">
                      <RotateCcw size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <div className="ip17-error">{error}<button onClick={() => setError('')}>&times;</button></div>}
      </div>
    </aside>
  );
}
