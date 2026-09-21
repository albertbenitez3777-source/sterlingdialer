import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Delete, Mic, MicOff, Music, Phone,
  PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing,
  RotateCcw, Signal, Volume2, X, ChevronDown, ChevronUp,
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

const WS_URLS = [
  'wss://pbx.zadarma.com:8089/ws',
  'wss://pbx.zadarma.com',
  'wss://sip.zadarma.com:8089/ws',
  'wss://sip.zadarma.com',
];

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function createHoldTone(): { stop: () => void } {
  const ctx = new AudioContext();
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.value = 396;
  osc2.type = 'sine';
  osc2.frequency.value = 528;
  gain.gain.value = 0.06;
  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);
  osc1.start();
  osc2.start();
  return { stop: () => { osc1.stop(); osc2.stop(); ctx.close(); } };
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
  const [onHold, setOnHold] = useState(false);
  const [sipConnected, setSipConnected] = useState(false);
  const [showDialpad, setShowDialpad] = useState(true);
  const [sipLog, setSipLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [sipAttempt, setSipAttempt] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<{ stop: () => void } | null>(null);
  const holdRef = useRef<{ stop: () => void } | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const sipUARef = useRef<any>(null);
  const sipSessionRef = useRef<any>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const zadarmaNumber = route?.talkroute_number || '';
  const hasSipCreds = !!(route?.zadarma_sip_login && route?.zadarma_sip_password);
  const firstName = agentName.split(' ')[0] || 'Agent';

  const log = useCallback((msg: string) => {
    const line = `${ts()} ${msg}`;
    console.log('[SIP]', msg);
    setSipLog(prev => [...prev.slice(-30), line]);
  }, []);

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
          setSipLog([`${ts()} Credentials loaded: ${r.data.route.zadarma_sip_login}`]);
        } else {
          setSipLog([`${ts()} No SIP credentials found for this agent`]);
        }
      } else if (!stop) {
        setSipLog([`${ts()} Failed to load agent route data`]);
      }
    };
    void load();
    return () => { stop = true; };
  }, [providerUrl, sessionToken]);

  const startTimer = useCallback(() => {
    setTimer(0);
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const playRingtone = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      const ringInterval = setInterval(() => { gain.gain.value = gain.gain.value > 0 ? 0 : 0.15; }, 1000);
      audioRef.current = { stop: () => { osc.stop(); ctx.close(); clearInterval(ringInterval); } };
    } catch { /* audio not available */ }
  }, []);

  const stopRingtone = useCallback(() => {
    audioRef.current?.stop();
    audioRef.current = null;
  }, []);

  const stopHoldMusic = useCallback(() => {
    holdRef.current?.stop();
    holdRef.current = null;
  }, []);

  const addRecent = useCallback((number: string, direction: CallDirection, missed: boolean, name?: string) => {
    setRecent(prev => [{ number, direction, missed, name, time: new Date() }, ...prev].slice(0, 20));
  }, []);

  const endCall = useCallback(() => {
    stopTimer();
    stopRingtone();
    stopHoldMusic();
    if (sipSessionRef.current) {
      try { sipSessionRef.current.terminate(); } catch { /* already ended */ }
      sipSessionRef.current = null;
    }
    setCallState('idle');
    setCallerName('');
    setCallerNumber('');
    setMuted(false);
    setOnHold(false);
  }, [stopTimer, stopRingtone, stopHoldMusic]);

  const acceptCall = useCallback(() => {
    stopRingtone();
    if (sipSessionRef.current) {
      try {
        sipSessionRef.current.answer({
          mediaConstraints: { audio: true, video: false },
          pcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
        });
      } catch { /* session error */ }
    }
    setCallState('active');
    startTimer();
  }, [stopRingtone, startTimer]);

  const rejectCall = useCallback(() => {
    addRecent(callerNumber || 'Unknown', 'incoming', true, callerName);
    endCall();
  }, [addRecent, callerNumber, callerName, endCall]);

  const toggleMute = useCallback(() => {
    const session = sipSessionRef.current;
    if (!session) return;
    try {
      if (muted) session.unmute({ audio: true });
      else session.mute({ audio: true });
      setMuted(!muted);
    } catch { /* mute error */ }
  }, [muted]);

  const toggleHold = useCallback(() => {
    const session = sipSessionRef.current;
    if (!session) return;
    try {
      if (onHold) {
        session.unhold();
        stopHoldMusic();
      } else {
        session.hold();
        holdRef.current = createHoldTone();
      }
      setOnHold(!onHold);
    } catch { /* hold error */ }
  }, [onHold, stopHoldMusic]);

  const attachRemoteAudio = useCallback((session: any) => {
    const handler = (e: RTCTrackEvent) => {
      if (!remoteAudioRef.current) {
        remoteAudioRef.current = new Audio();
        remoteAudioRef.current.autoplay = true;
      }
      if (e.streams?.[0]) {
        remoteAudioRef.current.srcObject = e.streams[0];
      } else {
        const stream = new MediaStream([e.track]);
        remoteAudioRef.current.srcObject = stream;
      }
      remoteAudioRef.current.play().catch(() => {});
    };
    if (session.connection) {
      session.connection.addEventListener('track', handler);
    }
    session.on('peerconnection', (data: { peerconnection: RTCPeerConnection }) => {
      data.peerconnection.addEventListener('track', handler);
    });
  }, []);

  const makeCall = useCallback((number: string) => {
    if (!number || callState !== 'idle') return;
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length < 10) { setError('Enter a valid number (10+ digits)'); return; }
    setError('');
    setCallDirection('outgoing');
    setCallerNumber(number);
    setCallerName('');
    setCallState('connecting');

    if (sipUARef.current && sipConnected) {
      try {
        const target = `sip:${cleaned}@pbx.zadarma.com`;
        log(`Dialing ${cleaned}...`);
        const eventHandlers = {
          progress: () => log('Remote ringing...'),
          confirmed: () => log('Media flowing'),
          accepted: () => { setCallState('active'); startTimer(); log('Call answered'); },
          ended: (e: any) => {
            log(`Call ended: ${e?.cause || 'normal'}`);
            addRecent(number, 'outgoing', false);
            endCall();
          },
          failed: (e: any) => {
            const cause = e?.cause || 'unknown';
            log(`Call failed: ${cause}`);
            addRecent(number, 'outgoing', true);
            endCall();
            setError(`Call failed: ${cause}`);
          },
        };
        const session = sipUARef.current.call(target, {
          eventHandlers,
          mediaConstraints: { audio: true, video: false },
          pcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
          rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
        });
        sipSessionRef.current = session;
        attachRemoteAudio(session);
      } catch (err) {
        log(`Call error: ${err}`);
        setError('SIP call failed');
        setCallState('idle');
      }
    } else if (sipUARef.current && !sipConnected) {
      log('Cannot call - SIP not registered');
      setError('Phone not registered yet - check SIP status');
      setCallState('idle');
    } else {
      log('Cannot call - no SIP connection');
      setError(hasSipCreds ? 'Phone is still connecting...' : 'No SIP credentials configured');
      setCallState('idle');
    }
  }, [callState, sipConnected, hasSipCreds, startTimer, addRecent, endCall, attachRemoteAudio, log]);

  const callbackNumber = useCallback((num: string) => {
    setDigits(num);
    makeCall(num);
  }, [makeCall]);

  // SIP UA registration - tries each WebSocket URL with a timeout
  useEffect(() => {
    if (!hasSipCreds || !route) return;
    let ua: any = null;
    let stopped = false;
    let connectTimeout: ReturnType<typeof setTimeout> | null = null;

    const tryConnect = async (urlIndex: number) => {
      if (stopped || urlIndex >= WS_URLS.length) {
        if (!stopped) {
          log('All WebSocket URLs failed. WebRTC may not be enabled in Zadarma.');
          setError('Cannot connect - see debug log');
        }
        return;
      }

      // Clean up previous attempt
      if (ua) {
        try { ua.stop(); } catch { /* ok */ }
        ua = null;
        sipUARef.current = null;
      }
      if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }

      const wsUrl = WS_URLS[urlIndex];
      log(`Trying ${wsUrl} ...`);
      setSipAttempt(urlIndex + 1);

      try {
        const JsSIP = await import('jssip');
        if (stopped) return;

        const socket = new JsSIP.WebSocketInterface(wsUrl);
        ua = new JsSIP.UA({
          sockets: [socket],
          uri: `sip:${route.zadarma_sip_login}@pbx.zadarma.com`,
          password: route.zadarma_sip_password!,
          authorization_user: route.zadarma_sip_login!,
          display_name: firstName,
          register: true,
          session_timers: false,
          connection_recovery_min_interval: 2,
          connection_recovery_max_interval: 10,
          register_expires: 120,
          user_agent: 'FederalOne-WebPhone/1.0',
        });
        sipUARef.current = ua;

        let wsConnected = false;
        let registered = false;

        ua.on('connected', () => {
          wsConnected = true;
          log(`WebSocket open: ${wsUrl}`);
          if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
          // Give SIP REGISTER 8 seconds after WS connects
          connectTimeout = setTimeout(() => {
            if (!registered && !stopped) {
              log(`SIP REGISTER timeout on ${wsUrl}`);
              ua.stop();
              ua = null;
              sipUARef.current = null;
              tryConnect(urlIndex + 1);
            }
          }, 8000);
        });

        ua.on('disconnected', () => {
          log(`WebSocket closed: ${wsUrl}`);
          if (!registered) {
            // WS disconnected before we registered - try next
            if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
            if (!stopped && !wsConnected) {
              // Never connected - try next URL immediately
              tryConnect(urlIndex + 1);
            }
          }
          setSipConnected(false);
        });

        ua.on('registered', () => {
          registered = true;
          if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
          log(`Registered as ${route.zadarma_sip_login} via ${wsUrl}`);
          setSipConnected(true);
          setError('');
        });

        ua.on('unregistered', () => {
          log('Unregistered');
          setSipConnected(false);
        });

        ua.on('registrationFailed', (data: any) => {
          const cause = data?.cause || 'unknown';
          log(`Registration failed: ${cause} via ${wsUrl}`);
          setSipConnected(false);
          if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }

          if (cause === 'Connection Error' || cause === 'Request Timeout') {
            ua.stop();
            ua = null;
            sipUARef.current = null;
            if (!stopped) tryConnect(urlIndex + 1);
          } else {
            // Auth error or other SIP error - don't try more URLs, same creds will fail
            setError(`SIP: ${cause}`);
            log(`Stopping - "${cause}" won't resolve by trying another URL`);
          }
        });

        ua.on('newRTCSession', (data: any) => {
          if (data.originator === 'remote') {
            const session = data.session;
            sipSessionRef.current = session;
            const from = session.remote_identity?.uri?.user || 'Unknown';
            const displayName = session.remote_identity?.display_name || '';
            log(`Incoming call from ${from}`);
            setCallerNumber(from);
            setCallerName(displayName);
            setCallDirection('incoming');
            setCallState('ringing');
            setOpen(true);
            playRingtone();
            session.on('ended', () => { addRecent(from, 'incoming', false, displayName); endCall(); });
            session.on('failed', () => { addRecent(from, 'incoming', true, displayName); endCall(); });
            attachRemoteAudio(session);
          }
        });

        ua.start();

        // If WebSocket doesn't even open in 6 seconds, try next URL
        connectTimeout = setTimeout(() => {
          if (!wsConnected && !stopped) {
            log(`Connection timeout: ${wsUrl}`);
            try { ua.stop(); } catch { /* ok */ }
            ua = null;
            sipUARef.current = null;
            tryConnect(urlIndex + 1);
          }
        }, 6000);

      } catch (err) {
        log(`Error: ${err}`);
        if (!stopped) tryConnect(urlIndex + 1);
      }
    };

    void tryConnect(0);

    return () => {
      stopped = true;
      if (connectTimeout) clearTimeout(connectTimeout);
      if (ua) { try { ua.stop(); } catch { /* cleanup */ } }
      sipUARef.current = null;
      setSipConnected(false);
    };
  }, [hasSipCreds, route, firstName, log, playRingtone, addRecent, endCall, attachRemoteAudio]);

  useEffect(() => () => { stopTimer(); stopRingtone(); stopHoldMusic(); }, [stopTimer, stopRingtone, stopHoldMusic]);

  const pressDigit = (d: string) => {
    if (callState === 'active' && sipSessionRef.current) {
      try { sipSessionRef.current.sendDTMF(d); } catch { /* dtmf error */ }
    }
    setDigits(prev => prev + d);
  };

  const retryConnection = useCallback(() => {
    setError('');
    setSipLog(prev => [...prev, `${ts()} Manual retry...`]);
    // Trigger re-mount of the SIP effect by toggling route reference
    setRoute(prev => prev ? { ...prev } : prev);
  }, []);

  const isOnCall = callState === 'active' || callState === 'connecting' || callState === 'ringing';
  const statusDot = sipConnected ? 'connected' : hasSipCreds ? 'connecting' : 'offline';

  // Closed state: glowing circular trigger button
  if (!open) {
    return (
      <aside
        className={`ip17-shell ip17-closed ${callState === 'ringing' ? 'ip17-ringing' : ''} ${sipConnected ? 'ip17-sip-on' : ''}`}
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

  // Open state: full iPhone 17 Pro Max
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
              {callState === 'active' && <div className="ip17-island-wave" />}
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
            {sipConnected ? 'SIP Connected' : hasSipCreds ? `Trying ${sipAttempt}/${WS_URLS.length}...` : 'No SIP'}
          </span>
          {zadarmaNumber && <span className="ip17-my-line">{formatPhone(zadarmaNumber)}</span>}
        </div>

        {/* SIP debug log toggle */}
        <div className="ip17-log-toggle">
          <button onClick={() => setShowLog(!showLog)}>
            {showLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span>SIP Debug {sipConnected ? '(OK)' : `(${sipAttempt}/${WS_URLS.length})`}</span>
          </button>
          {!sipConnected && hasSipCreds && (
            <button className="ip17-reconnect" onClick={retryConnection}>Retry</button>
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
              <button className="ip17-circle-btn decline" onClick={rejectCall} aria-label="Decline">
                <PhoneOff size={24} />
                <span>Decline</span>
              </button>
              <button className="ip17-circle-btn accept" onClick={acceptCall} aria-label="Accept">
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
                {callState === 'connecting' ? 'Calling...' : formatTimer(timer)}
              </div>
              {onHold && <div className="ip17-hold-badge">ON HOLD</div>}
            </div>

            <div className="ip17-call-controls">
              <button className={`ip17-ctrl-btn ${muted ? 'active' : ''}`} onClick={toggleMute}>
                {muted ? <MicOff size={20} /> : <Mic size={20} />}
                <span>{muted ? 'Unmute' : 'Mute'}</span>
              </button>
              <button className={`ip17-ctrl-btn ${onHold ? 'active' : ''}`} onClick={toggleHold}>
                {onHold ? <Volume2 size={20} /> : <Music size={20} />}
                <span>{onHold ? 'Resume' : 'Hold'}</span>
              </button>
              <button className="ip17-ctrl-btn" onClick={() => setShowDialpad(!showDialpad)}>
                <Signal size={20} />
                <span>Keypad</span>
              </button>
            </div>

            {showDialpad && callState === 'active' && (
              <div className="ip17-dtmf-pad">
                {DIALPAD_KEYS.map(k => (
                  <button key={k.digit} className="ip17-dtmf-key" onClick={() => pressDigit(k.digit)}>
                    {k.digit}
                  </button>
                ))}
              </div>
            )}

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
                disabled={!digits || !sipConnected}
                aria-label="Call"
              >
                <Phone size={24} />
              </button>
            </div>

            {!sipConnected && hasSipCreds && (
              <div className="ip17-notice">Connecting to Zadarma... Check debug log for status.</div>
            )}
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
