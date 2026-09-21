import { useCallback, useEffect, useRef, useState } from 'react';
import JsSIP from 'jssip';
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

type ConnState = 'idle' | 'connecting' | 'registered' | 'failed' | 'widget' | 'callback-only';
type CallState = 'idle' | 'dialing' | 'ringing-in' | 'active' | 'ending';

interface RecentCall {
  number: string;
  direction: 'outgoing' | 'incoming' | 'missed';
  time: Date;
}

/* ── Constants ── */
const WSS_ENDPOINTS = [
  'wss://pbx.zadarma.com:8089/ws',
  'wss://pbx.zadarma.com:8089',
  'wss://pbx.zadarma.com/ws',
];
const SIP_DOMAIN = 'pbx.zadarma.com';
const STUN_SERVERS = [{ urls: 'stun:stun.zadarma.com' }, { urls: 'stun:stun.l.google.com:19302' }];
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
  const [callbackStatus, setCbStatus] = useState<'idle' | 'calling' | 'ok' | 'err'>('idle');

  /* ── Refs ── */
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const uaRef = useRef<JsSIP.UA | null>(null);
  const sessionRef = useRef<JsSIP.RTCSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const setupRanRef = useRef(false);
  const widgetLoadedRef = useRef(false);
  const wssIndexRef = useRef(0);

  const firstName = agentName.split(' ')[0] || 'Agent';
  const hasCreds = !!(route?.zadarma_sip_login && route?.zadarma_sip_password);

  /* ── Logging ── */
  const log = useCallback((msg: string) => {
    const line = `${ts()} ${msg}`;
    console.log('[Phone]', msg);
    setLogs(prev => [...prev.slice(-80), line]);
  }, []);

  /* ── Audio element ── */
  useEffect(() => {
    if (!remoteAudioRef.current) {
      const audio = document.createElement('audio');
      audio.id = 'ip17-remote-audio';
      audio.autoplay = true;
      document.body.appendChild(audio);
      remoteAudioRef.current = audio;
    }
    return () => {
      remoteAudioRef.current?.remove();
      remoteAudioRef.current = null;
    };
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

  /* ── Attach remote audio to RTC session ── */
  const attachAudio = useCallback((rtcSession: JsSIP.RTCSession) => {
    const pc = rtcSession.connection;
    if (!pc || !remoteAudioRef.current) return;
    const audio = remoteAudioRef.current;

    if ('ontrack' in pc) {
      pc.ontrack = (e: RTCTrackEvent) => {
        if (e.streams?.[0]) audio.srcObject = e.streams[0];
      };
    }
    // Also try existing streams
    const streams = pc.getRemoteStreams?.();
    if (streams?.length) audio.srcObject = streams[0];
  }, []);

  /* ── JsSIP connection ── */
  const connectJsSIP = useCallback((sipLogin: string, sipPassword: string, wssIndex: number) => {
    if (wssIndex >= WSS_ENDPOINTS.length) {
      log('All WSS endpoints failed. Trying Zadarma widget...');
      tryWidget(sipLogin);
      return;
    }

    const wssUrl = WSS_ENDPOINTS[wssIndex];
    wssIndexRef.current = wssIndex;
    setConnState('connecting');
    log(`Trying ${wssUrl}...`);

    try {
      const socket = new JsSIP.WebSocketInterface(wssUrl);
      socket.via_transport = 'wss';

      const config = {
        sockets: [socket],
        uri: `sip:${sipLogin}@${SIP_DOMAIN}`,
        password: sipPassword,
        display_name: firstName,
        register: true,
        register_expires: 120,
        session_timers: false,
        connection_recovery_min_interval: 4,
        connection_recovery_max_interval: 30,
      };

      if (uaRef.current) {
        try { uaRef.current.stop(); } catch (_) { /* ignore */ }
      }

      const ua = new JsSIP.UA(config);
      uaRef.current = ua;

      let connectTimeout: ReturnType<typeof setTimeout> | null = null;

      ua.on('connected', () => {
        log(`WebSocket connected on ${wssUrl}`);
      });

      ua.on('registered', () => {
        if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
        log(`Registered as ${sipLogin}`);
        setConnState('registered');
        setError('');
      });

      ua.on('registrationFailed', (e: { cause?: string }) => {
        log(`Registration failed: ${e.cause || 'unknown'}`);
        if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
        ua.stop();
        // Try next WSS endpoint
        connectJsSIP(sipLogin, sipPassword, wssIndex + 1);
      });

      ua.on('unregistered', () => {
        log('SIP unregistered');
        if (connState === 'registered') setConnState('failed');
      });

      ua.on('disconnected', () => {
        log('WebSocket disconnected');
      });

      ua.on('newRTCSession', (data: { originator: string; session: JsSIP.RTCSession; request: { from: { uri: { user: string } } } }) => {
        const rtcSession = data.session;

        if (data.originator === 'remote') {
          // Incoming call
          const caller = data.request.from.uri.user || 'Unknown';
          log(`Incoming call from ${caller}`);
          sessionRef.current = rtcSession;
          setCallNumber(caller);
          setCallState('ringing-in');

          rtcSession.on('ended', () => {
            log('Call ended');
            setCallState('idle');
            setCallNumber('');
            sessionRef.current = null;
          });

          rtcSession.on('failed', (e: { cause?: string }) => {
            log(`Call failed: ${e.cause || 'unknown'}`);
            setCallState('idle');
            setCallNumber('');
            sessionRef.current = null;
          });

          rtcSession.on('accepted', () => {
            log('Call accepted');
            setCallState('active');
            attachAudio(rtcSession);
          });

          rtcSession.on('confirmed', () => {
            attachAudio(rtcSession);
          });
        }
      });

      // Timeout for this endpoint
      connectTimeout = setTimeout(() => {
        log(`Timeout on ${wssUrl}`);
        try { ua.stop(); } catch (_) { /* ignore */ }
        connectJsSIP(sipLogin, sipPassword, wssIndex + 1);
      }, 8000);

      ua.start();
    } catch (err) {
      log(`JsSIP error on ${wssUrl}: ${err}`);
      connectJsSIP(sipLogin, sipPassword, wssIndex + 1);
    }
  }, [log, firstName, attachAudio, connState]);

  /* ── Widget fallback ── */
  const tryWidget = useCallback(async (sipLogin: string) => {
    if (widgetLoadedRef.current) return;
    setConnState('connecting');
    log('Setting up Zadarma widget...');

    // Setup domain
    try {
      await authFetch(providerUrl, {
        body: { action: 'zadarma_setup_webrtc', session_token: sessionToken },
        onUnauthorized: () => onUnauthorizedRef.current(),
      });
    } catch (_) { /* domain setup is best-effort */ }

    // Get key
    const keyRes = await authFetch<{ key?: string; error?: string }>(providerUrl, {
      body: { action: 'zadarma_webrtc_key', session_token: sessionToken },
      onUnauthorized: () => onUnauthorizedRef.current(),
    });

    if (!keyRes.ok || !keyRes.data?.key) {
      log(`Widget key failed: ${keyRes.data?.error || keyRes.error || 'unknown'}`);
      setConnState('callback-only');
      log('Falling back to callback mode');
      return;
    }

    const key = keyRes.data.key;
    log(`Got widget key, loading script...`);

    const script = document.createElement('script');
    script.id = 'zadarma-phone-lib';
    script.src = `${WIDGET_SCRIPT}?location_href=${encodeURIComponent(WIDGET_DOMAIN)}&key=${encodeURIComponent(key)}`;
    script.async = true;

    script.onload = () => {
      widgetLoadedRef.current = true;
      log('Widget loaded - use the floating Zadarma phone');
      setConnState('widget');
    };

    script.onerror = () => {
      log('Widget script failed to load');
      setConnState('callback-only');
    };

    document.body.appendChild(script);
  }, [providerUrl, sessionToken, log]);

  /* ── Auto-connect when route is loaded ── */
  useEffect(() => {
    if (!route || setupRanRef.current) return;
    if (!route.zadarma_sip_login || !route.zadarma_sip_password) {
      log('No SIP credentials found');
      setConnState('callback-only');
      return;
    }
    setupRanRef.current = true;
    connectJsSIP(route.zadarma_sip_login, route.zadarma_sip_password, 0);
  }, [route, connectJsSIP, log]);

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => {
      try { uaRef.current?.stop(); } catch (_) { /* */ }
      const ws = document.getElementById('zadarma-phone-lib');
      if (ws) ws.remove();
      document.querySelectorAll('[class*="zadarma"],[id*="zadarma"],[class*="webrtc-phone"]').forEach(el => el.remove());
    };
  }, []);

  /* ── Make outgoing call via JsSIP ── */
  const makeCall = useCallback((number: string) => {
    const cleaned = number.replace(/\D/g, '');
    if (!cleaned || cleaned.length < 3) return;

    if (connState === 'registered' && uaRef.current) {
      const target = `sip:${cleaned}@${SIP_DOMAIN}`;
      log(`Calling ${cleaned} via SIP...`);
      setCallNumber(cleaned);
      setCallState('dialing');

      try {
        const rtcSession = uaRef.current.call(target, {
          mediaConstraints: { audio: true, video: false },
          pcConfig: { iceServers: STUN_SERVERS },
          rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
        });

        sessionRef.current = rtcSession;

        rtcSession.on('progress', () => {
          log('Ringing...');
          setCallState('dialing');
        });

        rtcSession.on('accepted', () => {
          log('Call connected');
          setCallState('active');
          attachAudio(rtcSession);
        });

        rtcSession.on('confirmed', () => {
          attachAudio(rtcSession);
        });

        rtcSession.on('ended', () => {
          log('Call ended');
          setRecents(prev => [{ number: cleaned, direction: 'outgoing', time: new Date() }, ...prev.slice(0, 19)]);
          setCallState('idle');
          setCallNumber('');
          setMuted(false);
          setSpeakerOff(false);
          setShowDtmf(false);
          sessionRef.current = null;
        });

        rtcSession.on('failed', (e: { cause?: string }) => {
          log(`Call failed: ${e.cause || 'unknown'}`);
          setRecents(prev => [{ number: cleaned, direction: 'outgoing', time: new Date() }, ...prev.slice(0, 19)]);
          setCallState('idle');
          setCallNumber('');
          sessionRef.current = null;
          setError(`Call failed: ${e.cause || 'unknown'}`);
        });
      } catch (err) {
        log(`Call error: ${err}`);
        setCallState('idle');
        setError(`Could not place call: ${err}`);
      }
    } else if (connState === 'widget') {
      // Use the Zadarma widget's built-in call API
      const dialNum = cleaned.length === 10 ? `1${cleaned}` : cleaned;
      log(`Calling ${dialNum} via widget...`);
      setRecents(prev => [{ number: cleaned, direction: 'outgoing', time: new Date() }, ...prev.slice(0, 19)]);
      try {
        document.dispatchEvent(new CustomEvent('zadarma-phone-api', {
          detail: { command: 'call', number: dialNum },
        }));
        log('Call dispatched to widget');
      } catch (err) {
        log(`Widget call error: ${err}`);
        setError(`Widget call failed: ${err}`);
      }
    } else {
      // Callback mode
      makeCallbackCall(cleaned);
    }
  }, [connState, log, attachAudio]);

  /* ── Answer incoming call ── */
  const answerCall = useCallback(() => {
    if (!sessionRef.current) return;
    log('Answering...');
    sessionRef.current.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: STUN_SERVERS },
    });
    setCallState('active');
    attachAudio(sessionRef.current);
    setRecents(prev => [{ number: callNumber, direction: 'incoming', time: new Date() }, ...prev.slice(0, 19)]);
  }, [callNumber, log, attachAudio]);

  /* ── Decline / Hangup ── */
  const hangup = useCallback(() => {
    if (!sessionRef.current) { setCallState('idle'); return; }
    try {
      sessionRef.current.terminate();
    } catch (_) { /* */ }
    if (callState === 'ringing-in') {
      setRecents(prev => [{ number: callNumber, direction: 'missed', time: new Date() }, ...prev.slice(0, 19)]);
    }
    setCallState('idle');
    setCallNumber('');
    setMuted(false);
    setSpeakerOff(false);
    setShowDtmf(false);
    sessionRef.current = null;
  }, [callState, callNumber]);

  /* ── Mute / Speaker ── */
  const toggleMute = useCallback(() => {
    if (!sessionRef.current) return;
    if (muted) { sessionRef.current.unmute(); } else { sessionRef.current.mute(); }
    setMuted(!muted);
  }, [muted]);

  const toggleSpeaker = useCallback(() => {
    if (!remoteAudioRef.current) return;
    remoteAudioRef.current.muted = !speakerOff;
    setSpeakerOff(!speakerOff);
  }, [speakerOff]);

  /* ── DTMF ── */
  const sendDtmf = useCallback((tone: string) => {
    if (sessionRef.current && callState === 'active') {
      sessionRef.current.sendDTMF(tone);
      log(`DTMF: ${tone}`);
    }
  }, [callState, log]);

  /* ── Callback fallback ── */
  const makeCallbackCall = useCallback(async (number: string) => {
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length < 10) { setError('Enter at least 10 digits'); return; }
    setCbStatus('calling');
    setCallNumber(cleaned);
    setCallState('dialing');
    log(`Callback to ${cleaned}...`);

    const r = await authFetch<{ ok: boolean; message?: string; error?: string }>(providerUrl, {
      body: { action: 'zadarma_callback', session_token: sessionToken, to: cleaned },
      onUnauthorized: () => onUnauthorizedRef.current(),
    });

    if (r.ok && r.data?.ok) {
      log(`Callback initiated: ${r.data.message}`);
      setCbStatus('ok');
      setCallState('active');
      setRecents(prev => [{ number: cleaned, direction: 'outgoing', time: new Date() }, ...prev.slice(0, 19)]);
      setTimeout(() => setCbStatus('idle'), 8000);
    } else {
      const errMsg = r.data?.error || r.error || 'Callback failed';
      log(`Callback error: ${errMsg}`);
      setError(errMsg);
      setCbStatus('err');
      setCallState('idle');
      setCallNumber('');
      setTimeout(() => setCbStatus('idle'), 4000);
    }
  }, [providerUrl, sessionToken, log]);

  /* ── Reconnect ── */
  const reconnect = useCallback(() => {
    if (!route?.zadarma_sip_login || !route?.zadarma_sip_password) return;
    try { uaRef.current?.stop(); } catch (_) { /* */ }
    setupRanRef.current = false;
    widgetLoadedRef.current = false;
    const ws = document.getElementById('zadarma-phone-lib');
    if (ws) ws.remove();
    setConnState('idle');
    setError('');
    log('Reconnecting...');
    setTimeout(() => {
      setupRanRef.current = true;
      connectJsSIP(route.zadarma_sip_login!, route.zadarma_sip_password!, 0);
    }, 300);
  }, [route, connectJsSIP, log]);

  /* ── Dialpad press ── */
  const pressKey = useCallback((digit: string) => {
    if (callState === 'active') {
      sendDtmf(digit);
    } else {
      setDigits(prev => prev + digit);
    }
  }, [callState, sendDtmf]);

  /* ── Status ── */
  const statusDot = connState === 'registered' ? 'connected'
    : connState === 'widget' ? 'connected'
    : connState === 'callback-only' ? 'callback'
    : connState === 'failed' ? 'callback'
    : connState === 'connecting' ? 'connecting'
    : 'offline';

  const statusLabel = connState === 'registered' ? 'Connected'
    : connState === 'widget' ? 'Widget Active'
    : connState === 'callback-only' ? 'Callback Mode'
    : connState === 'failed' ? 'Callback Mode'
    : connState === 'connecting' ? 'Connecting...'
    : 'Loading...';

  const isCallbackMode = connState === 'callback-only' || connState === 'failed' || connState === 'widget';
  const canDial = connState === 'registered' || isCallbackMode;

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

  /* ─── Incoming Call View ─── */
  if (callState === 'ringing-in') {
    return (
      <aside className="ip17-shell ip17-ringing">
        <div className="ip17-island">
          <div className="ip17-island-pill">
            <div className={`ip17-island-dot ${statusDot}`} />
            <span className="ip17-island-label">{firstName}'s Phone</span>
            <button className="ip17-island-close" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>
        </div>
        <div className="ip17-body">
          <div className="ip17-incoming">
            <div className="ip17-avatar-ring"><PhoneIncoming size={36} /></div>
            <h3 className="ip17-caller">Incoming Call</h3>
            <p className="ip17-caller-num">{formatPhone(callNumber)}</p>
            <div className="ip17-incoming-btns">
              <div className="ip17-circle-btn decline">
                <button onClick={hangup}><PhoneOff size={28} /></button>
                <span>Decline</span>
              </div>
              <div className="ip17-circle-btn accept">
                <button onClick={answerCall}><Phone size={28} /></button>
                <span>Accept</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  /* ─── Active Call View ─── */
  if (callState === 'active' || callState === 'dialing') {
    return (
      <aside className="ip17-shell">
        <div className="ip17-island">
          <div className="ip17-island-pill">
            <div className="ip17-island-dot connected" />
            <span className="ip17-island-label">
              {callState === 'dialing' ? 'Calling...' : fmtDuration(callTimer)}
            </span>
            <div className="ip17-island-wave" />
          </div>
        </div>
        <div className="ip17-body">
          <div className="ip17-active">
            <div className="ip17-active-header">
              <h3 className="ip17-caller">{formatPhone(callNumber)}</h3>
              <p className="ip17-timer">
                {callState === 'dialing' ? 'Dialing...' : fmtDuration(callTimer)}
              </p>
              {isCallbackMode && callbackStatus === 'ok' && (
                <span className="ip17-callback-badge">CALLBACK - Answer your extension</span>
              )}
            </div>

            {/* Call controls */}
            <div className="ip17-call-controls">
              <button className={`ip17-ctrl-btn${muted ? ' active' : ''}`} onClick={toggleMute}>
                {muted ? <MicOff size={22} /> : <Mic size={22} />}
                <span>{muted ? 'Unmute' : 'Mute'}</span>
              </button>
              <button className={`ip17-ctrl-btn${speakerOff ? ' active' : ''}`} onClick={toggleSpeaker}>
                {speakerOff ? <VolumeX size={22} /> : <Volume2 size={22} />}
                <span>{speakerOff ? 'Speaker' : 'Speaker'}</span>
              </button>
              <button className={`ip17-ctrl-btn${showDtmf ? ' active' : ''}`} onClick={() => setShowDtmf(!showDtmf)}>
                <Grid3X3 size={22} />
                <span>Keypad</span>
              </button>
            </div>

            {/* DTMF pad */}
            {showDtmf && (
              <div className="ip17-dtmf-pad">
                {DIALPAD_KEYS.map(k => (
                  <button key={k.digit} className="ip17-dtmf-key" onClick={() => sendDtmf(k.digit)}>
                    {k.digit}
                  </button>
                ))}
              </div>
            )}

            {/* Hangup */}
            {connState === 'registered' ? (
              <button className="ip17-hangup-btn" onClick={hangup}><PhoneOff size={28} /></button>
            ) : (
              <button className="ip17-hangup-btn" onClick={() => { setCallState('idle'); setCallNumber(''); setCbStatus('idle'); }}>
                <PhoneOff size={28} />
              </button>
            )}
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

        {/* Connection mode info */}
        {isCallbackMode && (
          <div className="ip17-mode-notice">
            <PhoneForwarded size={14} />
            <span>
              Direct connection unavailable. Calls use callback: your Zadarma extension rings first, then connects to the number.
              <button onClick={reconnect}>Retry direct</button>
            </span>
          </div>
        )}

        {connState === 'widget' && (
          <div className="ip17-mode-notice" style={{ borderColor: '#1a3a1a', background: '#0a1a0a' }}>
            <Phone size={14} />
            <span style={{ color: '#8ee0a0' }}>
              Phone connected via Zadarma widget. Dial from the keypad above.
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
          {(connState === 'failed' || connState === 'callback-only') && (
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
