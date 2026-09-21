import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown, Delete, Phone, PhoneCall, PhoneIncoming,
  PhoneMissed, PhoneOff, PhoneOutgoing, Smartphone,
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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<{ stop: () => void } | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const sipUARef = useRef<any>(null);
  const sipSessionRef = useRef<any>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const zadarmaNumber = route?.talkroute_number || '';
  const hasSipCreds = !!(route?.zadarma_sip_login && route?.zadarma_sip_password);
  const firstName = agentName.split(' ')[0] || 'Agent';

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const r = await authFetch<{ route: RouteData }>(providerUrl, {
        body: { action: 'get_federal_one_v2', session_token: sessionToken },
        onUnauthorized: () => onUnauthorizedRef.current(),
      });
      if (!stop && r.ok && r.data?.route) setRoute(r.data.route);
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

  const addRecent = useCallback((number: string, direction: CallDirection, missed: boolean, name?: string) => {
    setRecent(prev => [{ number, direction, missed, name, time: new Date() }, ...prev].slice(0, 20));
  }, []);

  const endCall = useCallback(() => {
    stopTimer();
    stopRingtone();
    if (sipSessionRef.current) {
      try { sipSessionRef.current.terminate(); } catch { /* already ended */ }
      sipSessionRef.current = null;
    }
    setCallState('idle');
    setCallerName('');
    setCallerNumber('');
  }, [stopTimer, stopRingtone]);

  const acceptCall = useCallback(() => {
    stopRingtone();
    if (sipSessionRef.current) {
      try { sipSessionRef.current.answer({ mediaConstraints: { audio: true, video: false } }); } catch { /* session error */ }
    }
    setCallState('active');
    startTimer();
  }, [stopRingtone, startTimer]);

  const rejectCall = useCallback(() => {
    addRecent(callerNumber || 'Unknown', 'incoming', true, callerName);
    endCall();
  }, [addRecent, callerNumber, callerName, endCall]);

  const attachRemoteAudio = useCallback((session: any) => {
    if (session.connection) {
      session.connection.ontrack = (e: RTCTrackEvent) => {
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = new Audio();
          remoteAudioRef.current.autoplay = true;
        }
        remoteAudioRef.current.srcObject = e.streams[0];
      };
    }
  }, []);

  const makeCall = useCallback((number: string) => {
    if (!number || callState !== 'idle') return;
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length < 10) { setError('Enter a valid US number (10+ digits)'); return; }
    setError('');
    setCallDirection('outgoing');
    setCallerNumber(number);
    setCallerName('');
    setCallState('connecting');

    if (sipUARef.current) {
      try {
        const session = sipUARef.current.call(`sip:${cleaned}@pbx.zadarma.com`, {
          mediaConstraints: { audio: true, video: false },
          pcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
        });
        sipSessionRef.current = session;
        session.on('accepted', () => { setCallState('active'); startTimer(); });
        session.on('ended', () => { addRecent(number, 'outgoing', false); endCall(); });
        session.on('failed', () => { addRecent(number, 'outgoing', true); endCall(); setError('Call could not connect'); });
        attachRemoteAudio(session);
      } catch {
        setError('SIP call failed');
        setCallState('idle');
      }
    } else {
      setError('Phone not connected yet');
      setCallState('idle');
    }
  }, [callState, startTimer, addRecent, endCall, attachRemoteAudio]);

  // SIP UA
  useEffect(() => {
    if (!hasSipCreds || !route) return;
    let ua: any = null;

    (async () => {
      try {
        const JsSIP = await import('jssip');
        const socket = new JsSIP.WebSocketInterface('wss://pbx.zadarma.com');
        ua = new JsSIP.UA({
          sockets: [socket],
          uri: `sip:${route.zadarma_sip_login}@pbx.zadarma.com`,
          password: route.zadarma_sip_password!,
          register: true,
          session_timers: false,
        });
        sipUARef.current = ua;

        ua.on('newRTCSession', (data: any) => {
          if (data.originator === 'remote') {
            const session = data.session;
            sipSessionRef.current = session;
            const from = session.remote_identity?.uri?.user || 'Unknown';
            const displayName = session.remote_identity?.display_name || '';
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
      } catch { setError('Phone connection failed'); }
    })();

    return () => {
      if (ua) { try { ua.stop(); } catch { /* cleanup */ } }
      sipUARef.current = null;
    };
  }, [hasSipCreds, route, playRingtone, stopRingtone, startTimer, addRecent, endCall, attachRemoteAudio]);

  useEffect(() => () => { stopTimer(); stopRingtone(); }, [stopTimer, stopRingtone]);

  const pressDigit = (d: string) => {
    if (callState === 'active' && sipSessionRef.current) {
      try { sipSessionRef.current.sendDTMF(d); } catch { /* dtmf error */ }
    }
    setDigits(prev => prev + d);
  };

  const statusLabel = callState === 'ringing' ? 'ringing' :
    callState === 'active' || callState === 'connecting' ? 'connected' : '';

  return (
    <aside className="iphone-panel" aria-label="iPhone dialer">
      <button className="iphone-bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="iphone-bar-icon"><Smartphone size={18} /></span>
        <strong>iPhone</strong>
        {statusLabel && <span className={`iphone-bar-status ${statusLabel}`}>
          {callState === 'ringing' ? 'RINGING' : 'ON CALL'}
        </span>}
        <ChevronDown size={16} />
      </button>

      {open && <>
        {zadarmaNumber && (
          <div className="iphone-my-number">
            <Phone size={12} />
            <span>{firstName}'s line:</span>
            {formatPhone(zadarmaNumber)}
          </div>
        )}

        {callState === 'ringing' && (
          <div className="iphone-incoming">
            <div className="iphone-incoming-icon"><PhoneIncoming size={28} color="#4ade80" /></div>
            <h3>{callerName || 'Incoming Call'}</h3>
            <p>{callerNumber ? formatPhone(callerNumber) : 'Unknown number'}</p>
            <div className="iphone-incoming-actions">
              <button className="iphone-call-btn hangup" onClick={rejectCall} aria-label="Decline"><PhoneOff size={22} /></button>
              <button className="iphone-call-btn dial" onClick={acceptCall} aria-label="Accept"><Phone size={22} /></button>
            </div>
          </div>
        )}

        {callState === 'active' && (
          <div className="iphone-active-call">
            <div className="iphone-call-status">Connected</div>
            <h3>{callerName || formatPhone(callerNumber || digits)}</h3>
            <div className="iphone-timer">{formatTimer(timer)}</div>
            <button className="iphone-call-btn hangup" onClick={() => {
              addRecent(callerNumber || digits, callDirection, false, callerName);
              endCall();
            }} aria-label="End call"><PhoneOff size={22} /></button>
          </div>
        )}

        {callState === 'connecting' && (
          <div className="iphone-active-call">
            <div className="iphone-call-status" style={{ color: '#facc15' }}>Calling...</div>
            <h3>{formatPhone(callerNumber || digits)}</h3>
            <div className="iphone-timer">--:--</div>
            <button className="iphone-call-btn hangup" onClick={() => {
              addRecent(callerNumber || digits, 'outgoing', true);
              endCall();
            }} aria-label="Cancel call"><PhoneOff size={22} /></button>
          </div>
        )}

        {callState === 'idle' && <>
          <div className="iphone-display">
            <input
              type="text" value={digits}
              onChange={e => setDigits(e.target.value.replace(/[^0-9+*#]/g, ''))}
              placeholder="Enter number" aria-label="Phone number"
            />
          </div>
          <div className="iphone-dialpad">
            {DIALPAD_KEYS.map(k => (
              <button key={k.digit} onClick={() => pressDigit(k.digit)}>
                {k.digit}
                {k.sub && <small>{k.sub}</small>}
              </button>
            ))}
          </div>
          <div className="iphone-actions">
            <button className="iphone-call-btn clear" onClick={() => setDigits(d => d.slice(0, -1))} disabled={!digits} aria-label="Delete last digit"><Delete size={20} /></button>
            <button className="iphone-call-btn dial" onClick={() => makeCall(digits)} disabled={!digits} aria-label="Call"><Phone size={22} /></button>
          </div>
          {!hasSipCreds && (
            <div className="iphone-sip-notice">
              Dial pad ready. Incoming calls will ring here once extension credentials are configured.
            </div>
          )}
          {recent.length > 0 && (
            <div className="iphone-recent">
              <div className="iphone-recent-heading">Recent</div>
              {recent.slice(0, 5).map((r, i) => (
                <div key={i} className="iphone-recent-row" onClick={() => setDigits(r.number)}>
                  <span className={`recent-icon ${r.missed ? 'missed' : r.direction}`}>
                    {r.missed ? <PhoneMissed size={13} /> : r.direction === 'outgoing' ? <PhoneOutgoing size={13} /> : <PhoneIncoming size={13} />}
                  </span>
                  <strong>{r.name || formatPhone(r.number)}</strong>
                  <time>{r.time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                </div>
              ))}
            </div>
          )}
        </>}

        {error && <div className="iphone-error">{error}</div>}
      </>}
    </aside>
  );
}
