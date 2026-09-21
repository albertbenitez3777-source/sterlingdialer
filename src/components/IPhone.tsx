import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Delete, Mic, MicOff, Music, Phone,
  PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing,
  RotateCcw, Signal, Volume2, X, ChevronDown, ChevronUp,
  PhoneForwarded,
} from 'lucide-react';
import { formatPhone } from '@/utils/privacy';
import { authFetch } from '@/utils/auth-fetch';
import './IPhone.css';

type CallDirection = 'outgoing' | 'incoming';
type CallState = 'idle' | 'ringing' | 'active' | 'connecting';
type CallMode = 'webrtc' | 'callback';

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

const WS_URL = 'wss://pbx.zadarma.com:8089/ws';
const ZADARMA_STUN = 'stun:stun.zadarma.com:3478';

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
  const [callMode, setCallMode] = useState<CallMode>('webrtc');
  const [wsAttempted, setWsAttempted] = useState(false);

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
          setSipLog([`${ts()} SIP login: ${r.data.route.zadarma_sip_login}`]);
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
          pcConfig: { iceServers: [{ urls: ZADARMA_STUN }] },
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

  // API callback call (desk phone mode)
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

  // WebRTC call (browser mode)
  const makeWebRTCCall = useCallback((number: string) => {
    const cleaned = number.replace(/\D/g, '');
    if (!sipUARef.current || !sipConnected) {
      log('WebRTC not connected, cannot call');
      setError('Phone not registered');
      return;
    }
    try {
      const target = `sip:${cleaned}@pbx.zadarma.com`;
      log(`WebRTC call to ${cleaned}...`);
      setCallDirection('outgoing');
      setCallerNumber(number);
      setCallerName('');
      setCallState('connecting');

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
        pcConfig: { iceServers: [{ urls: ZADARMA_STUN }] },
        rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      });
      sipSessionRef.current = session;
      attachRemoteAudio(session);
    } catch (err) {
      log(`Call error: ${err}`);
      setError('SIP call failed');
      setCallState('idle');
    }
  }, [sipConnected, startTimer, addRecent, endCall, attachRemoteAudio, log]);

  const makeCall = useCallback((number: string) => {
    if (!number || callState !== 'idle') return;
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length < 10) { setError('Enter a valid number (10+ digits)'); return; }
    setError('');

    if (callMode === 'webrtc' && sipConnected) {
      makeWebRTCCall(number);
    } else if (hasSipCreds) {
      void makeCallbackCall(number);
    } else {
      setError('No SIP credentials configured');
    }
  }, [callState, callMode, sipConnected, hasSipCreds, makeWebRTCCall, makeCallbackCall]);

  const callbackNumber = useCallback((num: string) => {
    setDigits(num);
    makeCall(num);
  }, [makeCall]);

  // SIP UA registration - WebSocket approach
  useEffect(() => {
    if (!hasSipCreds || !route) return;
    let ua: any = null;
    let stopped = false;
    let connectTimeout: ReturnType<typeof setTimeout> | null = null;

    const attempt = async () => {
      log(`Connecting to ${WS_URL}...`);
      try {
        const JsSIP = await import('jssip');
        if (stopped) return;

        const socket = new JsSIP.WebSocketInterface(WS_URL);
        ua = new JsSIP.UA({
          sockets: [socket],
          uri: `sip:${route.zadarma_sip_login}@pbx.zadarma.com`,
          password: route.zadarma_sip_password!,
          authorization_user: route.zadarma_sip_login!,
          display_name: firstName,
          register: true,
          session_timers: false,
          connection_recovery_min_interval: 4,
          connection_recovery_max_interval: 30,
          register_expires: 120,
          user_agent: 'FederalOne-WebPhone/1.0',
        });
        sipUARef.current = ua;

        let wsConnected = false;

        ua.on('connected', () => {
          wsConnected = true;
          log('WebSocket connected');
          if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
          // Give SIP REGISTER 10 seconds
          connectTimeout = setTimeout(() => {
            if (!stopped && !sipConnected) {
              log('SIP REGISTER timed out');
              setWsAttempted(true);
              setCallMode('callback');
              log('Switched to desk-phone callback mode');
            }
          }, 10000);
        });

        ua.on('disconnected', () => {
          log('WebSocket disconnected');
          setSipConnected(false);
          if (!wsConnected && !stopped) {
            log('WebSocket never opened');
            setWsAttempted(true);
            setCallMode('callback');
            log('Switched to desk-phone callback mode');
          }
        });

        ua.on('registered', () => {
          if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
          log(`Registered as ${route.zadarma_sip_login}`);
          setSipConnected(true);
          setCallMode('webrtc');
          setError('');
        });

        ua.on('unregistered', () => {
          log('Unregistered');
          setSipConnected(false);
        });

        ua.on('registrationFailed', (data: any) => {
          const cause = data?.cause || 'unknown';
          log(`Registration failed: ${cause}`);
          setSipConnected(false);
          if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
          setWsAttempted(true);
          setCallMode('callback');
          log('Switched to desk-phone callback mode');
          if (cause !== 'Connection Error' && cause !== 'Request Timeout') {
            setError(`SIP: ${cause}`);
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

        // Overall timeout: if nothing happens in 8 seconds, switch to callback
        connectTimeout = setTimeout(() => {
          if (!stopped && !sipConnected) {
            log('Connection timeout');
            setWsAttempted(true);
            setCallMode('callback');
            log('Switched to desk-phone callback mode');
          }
        }, 8000);

      } catch (err) {
        log(`Connection error: ${err}`);
        setWsAttempted(true);
        setCallMode('callback');
      }
    };

    void attempt();

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

  const retryWebRTC = useCallback(() => {
    setError('');
    setWsAttempted(false);
    setSipLog(prev => [...prev, `${ts()} Retrying WebRTC...`]);
    setRoute(prev => prev ? { ...prev } : prev);
  }, []);

  const isOnCall = callState === 'active' || callState === 'connecting' || callState === 'ringing';
  const statusDot = sipConnected ? 'connected' : hasSipCreds ? (wsAttempted ? 'callback' : 'connecting') : 'offline';
  const canDial = hasSipCreds && (sipConnected || wsAttempted);

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
            {sipConnected ? 'Browser Phone' :
             wsAttempted ? 'Desk Phone' :
             hasSipCreds ? 'Connecting...' : 'No SIP'}
          </span>
          {zadarmaNumber && <span className="ip17-my-line">{formatPhone(zadarmaNumber)}</span>}
        </div>

        {/* Mode indicator when in callback mode */}
        {wsAttempted && !sipConnected && hasSipCreds && callState === 'idle' && (
          <div className="ip17-mode-notice">
            <PhoneForwarded size={14} />
            <span>Calls will ring your SIP desk phone first, then connect to the number you dialed.</span>
            <button onClick={retryWebRTC}>Try browser mode</button>
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
                {callState === 'connecting' ? (callMode === 'callback' ? 'Ringing desk phone...' : 'Calling...') : formatTimer(timer)}
              </div>
              {callMode === 'callback' && callState === 'active' && (
                <div className="ip17-callback-badge">VIA DESK PHONE</div>
              )}
              {onHold && <div className="ip17-hold-badge">ON HOLD</div>}
            </div>

            {callMode === 'webrtc' && (
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
            )}

            {showDialpad && callState === 'active' && callMode === 'webrtc' && (
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
