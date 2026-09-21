import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Delete, Mic, MicOff, Phone,
  PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing,
  PhoneForwarded, RotateCcw, X, ChevronDown, ChevronUp,
  Grid3x3,
} from 'lucide-react';
import JsSIP from 'jssip';
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

const ZADARMA_WSS = 'wss://pbx.zadarma.com';
const ZADARMA_SIP_DOMAIN = 'pbx.zadarma.com';

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function ts() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  const [sipRegistered, setSipRegistered] = useState(false);
  const [sipStatus, setSipStatus] = useState<'loading' | 'registered' | 'failed' | 'connecting'>('loading');
  const [sipLog, setSipLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showDtmf, setShowDtmf] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const uaRef = useRef<JsSIP.UA | null>(null);
  const sessionRef = useRef<JsSIP.RTCSession | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const zadarmaNumber = route?.talkroute_number || '';
  const hasSipCreds = !!(route?.zadarma_sip_login && route?.zadarma_sip_password);
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

  // Create hidden audio element for remote audio
  useEffect(() => {
    if (!remoteAudioRef.current) {
      const audio = document.createElement('audio');
      audio.id = 'ip17-remote-audio';
      audio.autoplay = true;
      audio.style.display = 'none';
      document.body.appendChild(audio);
      remoteAudioRef.current = audio;
    }
    return () => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }
    };
  }, []);

  // Initialize JsSIP UA
  useEffect(() => {
    if (!hasSipCreds || !route?.zadarma_sip_login || !route?.zadarma_sip_password) return;

    const sipLogin = route.zadarma_sip_login;
    const sipPassword = route.zadarma_sip_password;
    const sipUri = `sip:${sipLogin}@${ZADARMA_SIP_DOMAIN}`;

    log(`Connecting to ${ZADARMA_SIP_DOMAIN}...`);
    setSipStatus('connecting');

    const socket = new JsSIP.WebSocketInterface(ZADARMA_WSS);
    const config: JsSIP.UserAgentConfiguration = {
      sockets: [socket],
      uri: sipUri,
      password: sipPassword,
      display_name: agentName,
      register: true,
      register_expires: 300,
      session_timers: false,
      user_agent: 'WolfDialer/1.0',
    };

    const ua = new JsSIP.UA(config);
    uaRef.current = ua;

    ua.on('registered', () => {
      log('SIP registered successfully');
      setSipRegistered(true);
      setSipStatus('registered');
    });

    ua.on('unregistered', () => {
      log('SIP unregistered');
      setSipRegistered(false);
      setSipStatus('failed');
    });

    ua.on('registrationFailed', (e: { cause?: string }) => {
      log(`Registration failed: ${e.cause || 'unknown'}`);
      setSipRegistered(false);
      setSipStatus('failed');
    });

    ua.on('newRTCSession', (data: { originator: string; session: JsSIP.RTCSession; request: { from?: { display_name?: string }; getHeader?: (h: string) => string | undefined } }) => {
      const rtcSession = data.session;

      if (data.originator === 'remote') {
        const fromUri = rtcSession.remote_identity?.uri?.toString() || '';
        const fromUser = rtcSession.remote_identity?.uri?.user || '';
        const fromDisplay = rtcSession.remote_identity?.display_name || '';

        log(`Incoming call from ${fromDisplay || fromUser}`);

        if (sessionRef.current) {
          log('Busy - rejecting incoming call');
          rtcSession.terminate({ status_code: 486 });
          return;
        }

        sessionRef.current = rtcSession;
        setCallState('ringing');
        setCallDirection('incoming');
        setCallerName(fromDisplay);
        setCallerNumber(fromUser);
        setOpen(true);

        rtcSession.on('failed', () => {
          log('Incoming call failed/rejected');
          addRecent(fromUser || 'Unknown', 'incoming', true, fromDisplay);
          endCallCleanup();
        });

        rtcSession.on('ended', () => {
          log('Incoming call ended');
          addRecent(fromUser || 'Unknown', 'incoming', false, fromDisplay);
          endCallCleanup();
        });

        rtcSession.on('confirmed', () => {
          log('Incoming call answered');
          setCallState('active');
          startTimer();
          attachRemoteAudio(rtcSession);
        });
      }
    });

    ua.start();

    return () => {
      ua.stop();
      uaRef.current = null;
      setSipRegistered(false);
      setSipStatus('loading');
    };
  }, [hasSipCreds, route?.zadarma_sip_login, route?.zadarma_sip_password, agentName, log]);

  const attachRemoteAudio = useCallback((session: JsSIP.RTCSession) => {
    const pc = session.connection;
    if (!pc || !remoteAudioRef.current) return;
    const receivers = pc.getReceivers();
    if (receivers.length > 0) {
      const stream = new MediaStream();
      receivers.forEach(r => { if (r.track) stream.addTrack(r.track); });
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.play().catch(() => {});
    }
    pc.ontrack = (ev) => {
      if (remoteAudioRef.current && ev.streams[0]) {
        remoteAudioRef.current.srcObject = ev.streams[0];
        remoteAudioRef.current.play().catch(() => {});
      }
    };
  }, []);

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

  const endCallCleanup = useCallback(() => {
    stopTimer();
    sessionRef.current = null;
    setCallState('idle');
    setCallerName('');
    setCallerNumber('');
    setMuted(false);
    setShowDtmf(false);
  }, [stopTimer]);

  const answerIncoming = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    log('Answering incoming call...');
    session.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: [{ urls: 'stun:stun.zadarma.com' }] },
    });
  }, [log]);

  const declineIncoming = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    log('Declining incoming call');
    session.terminate({ status_code: 486 });
  }, [log]);

  // API callback call (fallback when SIP not registered)
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

  // Direct SIP call via JsSIP
  const makeSipCall = useCallback((number: string) => {
    const ua = uaRef.current;
    if (!ua || !sipRegistered) return;

    const cleaned = number.replace(/\D/g, '');
    log(`SIP call to ${cleaned}...`);
    setCallDirection('outgoing');
    setCallerNumber(number);
    setCallerName('');
    setCallState('connecting');

    const target = `sip:${cleaned}@${ZADARMA_SIP_DOMAIN}`;
    const session = ua.call(target, {
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: [{ urls: 'stun:stun.zadarma.com' }] },
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
    });

    sessionRef.current = session;

    session.on('progress', () => {
      log('Call ringing...');
    });

    session.on('confirmed', () => {
      log('Call connected');
      setCallState('active');
      startTimer();
      attachRemoteAudio(session);
    });

    session.on('failed', (e: { cause?: string }) => {
      log(`Call failed: ${e.cause || 'unknown'}`);
      addRecent(number, 'outgoing', true);
      endCallCleanup();
    });

    session.on('ended', () => {
      log('Call ended');
      addRecent(number, 'outgoing', false);
      endCallCleanup();
    });
  }, [sipRegistered, startTimer, addRecent, endCallCleanup, attachRemoteAudio, log]);

  const makeCall = useCallback((number: string) => {
    if (!number || callState !== 'idle') return;
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length < 10) { setError('Enter a valid number (10+ digits)'); return; }
    setError('');

    if (sipRegistered) {
      makeSipCall(number);
    } else if (hasSipCreds) {
      void makeCallbackCall(number);
    } else {
      setError('No SIP credentials configured');
    }
  }, [callState, sipRegistered, hasSipCreds, makeSipCall, makeCallbackCall]);

  const hangUp = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      try { session.terminate(); } catch { /* already ended */ }
    }
    endCallCleanup();
  }, [endCallCleanup]);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (muted) {
      session.unmute({ audio: true });
      setMuted(false);
      log('Unmuted');
    } else {
      session.mute({ audio: true });
      setMuted(true);
      log('Muted');
    }
  }, [muted, log]);

  const sendDtmf = useCallback((tone: string) => {
    const session = sessionRef.current;
    if (!session) return;
    session.sendDTMF(tone);
    log(`DTMF: ${tone}`);
  }, [log]);

  const callbackNumber = useCallback((num: string) => {
    setDigits(num);
    makeCall(num);
  }, [makeCall]);

  const reconnectSip = useCallback(() => {
    const ua = uaRef.current;
    if (ua) {
      log('Reconnecting...');
      setSipStatus('connecting');
      ua.stop();
      setTimeout(() => ua.start(), 500);
    }
  }, [log]);

  useEffect(() => () => { stopTimer(); }, [stopTimer]);

  const pressDigit = (d: string) => {
    if (callState === 'active' || callState === 'connecting') {
      sendDtmf(d);
    } else {
      setDigits(prev => prev + d);
    }
  };

  const isOnCall = callState === 'active' || callState === 'connecting' || callState === 'ringing';
  const statusDot = sipRegistered ? 'connected' : hasSipCreds ? (sipStatus === 'failed' ? 'callback' : 'connecting') : 'offline';
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
            <span className="ip17-island-label">
              {callState === 'ringing' ? 'Incoming' : callState === 'connecting' ? 'Calling...' : formatTimer(timer)}
            </span>
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
            {sipRegistered ? 'SIP Connected' :
             sipStatus === 'failed' ? 'Callback Mode' :
             sipStatus === 'connecting' ? 'Connecting...' :
             hasSipCreds ? 'Loading...' : 'No SIP'}
          </span>
          {zadarmaNumber && <span className="ip17-my-line">{formatPhone(zadarmaNumber)}</span>}
        </div>

        {/* Status notices */}
        {sipRegistered && callState === 'idle' && (
          <div className="ip17-mode-notice" style={{ borderColor: '#1a3a1a', background: '#0a1a0a' }}>
            <Phone size={14} />
            <span style={{ color: '#8ee0a0' }}>Phone is connected. You can make and receive calls directly from your browser.</span>
          </div>
        )}

        {sipStatus === 'failed' && callState === 'idle' && (
          <div className="ip17-mode-notice">
            <PhoneForwarded size={14} />
            <span>
              Direct connection couldn't be established. Calls will use the callback method -- Zadarma rings your extension first, then connects to the number you dialed.
              <br />
              <button onClick={reconnectSip}>Try reconnecting</button>
            </span>
          </div>
        )}

        {/* Debug log toggle */}
        <div className="ip17-log-toggle">
          <button onClick={() => setShowLog(!showLog)}>
            {showLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span>Debug log</span>
          </button>
          {sipStatus === 'failed' && (
            <button className="ip17-reconnect" onClick={reconnectSip}>Reconnect</button>
          )}
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
              <button className="ip17-circle-btn decline" onClick={declineIncoming} aria-label="Decline">
                <PhoneOff size={24} />
                <span>Decline</span>
              </button>
              <button className="ip17-circle-btn accept" onClick={answerIncoming} aria-label="Accept">
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
                {callState === 'connecting' ? (sipRegistered ? 'Ringing...' : 'Ringing your extension...') : formatTimer(timer)}
              </div>
              {!sipRegistered && callState === 'active' && (
                <div className="ip17-callback-badge">VIA CALLBACK</div>
              )}
            </div>

            {/* In-call controls */}
            <div className="ip17-call-controls">
              <button className={`ip17-ctrl-btn ${muted ? 'active' : ''}`} onClick={toggleMute}>
                {muted ? <MicOff size={22} /> : <Mic size={22} />}
                <span>{muted ? 'Unmute' : 'Mute'}</span>
              </button>
              <button className={`ip17-ctrl-btn ${showDtmf ? 'active' : ''}`} onClick={() => setShowDtmf(!showDtmf)}>
                <Grid3x3 size={22} />
                <span>Keypad</span>
              </button>
              <button className="ip17-ctrl-btn" style={{ opacity: 0.3, cursor: 'default' }}>
                <Phone size={22} />
                <span>Hold</span>
              </button>
            </div>

            {/* DTMF pad during call */}
            {showDtmf && (
              <div className="ip17-dtmf-pad">
                {['1','2','3','4','5','6','7','8','9','*','0','#'].map(d => (
                  <button key={d} className="ip17-dtmf-key" onClick={() => sendDtmf(d)}>{d}</button>
                ))}
              </div>
            )}

            <button className="ip17-hangup-btn" onClick={hangUp} aria-label="End call">
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
