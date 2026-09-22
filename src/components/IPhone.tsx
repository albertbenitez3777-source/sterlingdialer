import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, PhoneOutgoing, PhoneIncoming, RotateCcw, X, Delete, Mic, MicOff, Volume2, VolumeX, Grid3X3, Pause, Play } from 'lucide-react';
import { formatPhone } from '@/utils/privacy';
import { authFetch } from '@/utils/auth-fetch';
import { normalizeDialNumber, type PhoneState } from '@/phone/call-controller';
import './IPhone.css';
import { PhoneVoicemail } from './PhoneVoicemail';
import { useVoicemailCount } from '@/phone/useVoicemailCount';

interface IPhoneProps { agentName: string; sessionToken: string; providerUrl: string; onUnauthorized: () => void }
interface RouteData { talkroute_number?: string; zadarma_number?: string; zadarma_sip_login?: string }
interface Caller { name?: string; phone?: string; address?: string; summary?: string; transcript?: string; fields?: Record<string, unknown> }
interface RecentCall { number: string; name?: string; direction: 'outgoing' | 'incoming' | 'missed'; time: Date }
type Connection = 'idle' | 'connecting' | 'ready' | 'failed';
const CHANNEL = 'wolf-zadarma-v1';
const CALLING_URL = 'https://wolf-of-wall-street-ssy3.bolt.host/';
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const LETTERS = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ', '', '+', ''];
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function IPhone({ agentName, sessionToken, providerUrl, onUnauthorized }: IPhoneProps) {
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<'keypad' | 'voicemail'>('keypad');
  const unreadVoicemails = useVoicemailCount(sessionToken, providerUrl);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [connection, setConnection] = useState<Connection>('idle');
  const [callState, setCallState] = useState<PhoneState>('idle');
  const [digits, setDigits] = useState('');
  const [callNumber, setCallNumber] = useState('');
  const [caller, setCaller] = useState<Caller | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [speakerOff, setSpeakerOff] = useState(false);
  const [showDtmf, setShowDtmf] = useState(false);
  const [error, setError] = useState('');
  const [micGranted, setMicGranted] = useState(false);
  const [frameVersion, setFrameVersion] = useState(0);
  const [frameReady, setFrameReady] = useState(false);
  const [recents, setRecents] = useState<RecentCall[]>([]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const unauthorizedRef = useRef(onUnauthorized); unauthorizedRef.current = onUnauthorized;
  const startingRef = useRef(false);
  const pendingCallRef = useRef(false);
  const callRef = useRef<{ number: string; name?: string; direction: 'incoming' | 'outgoing'; answered: boolean } | null>(null);
  const lookupSequence = useRef(0);
  const stateRef = useRef(callState); stateRef.current = callState;
  const credentialsRef = useRef<{ key: string; sip: string } | null>(null);
  const phoneIdentityRef = useRef(0);
  const companionOnly = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inPreview = window.location.hostname !== 'wolf-of-wall-street-ssy3.bolt.host';

  const command = useCallback((command: string, extra: Record<string, unknown> = {}) => {
    frameRef.current?.contentWindow?.postMessage({ channel: CHANNEL, command, ...extra }, window.location.origin);
  }, []);
  const unlockAudio = useCallback(() => {
    const phone = frameRef.current?.contentWindow as (Window & { wolfPhone?: { unlockAudio: () => void } }) | null;
    phone?.wolfPhone?.unlockAudio();
  }, []);
  const requestMic = useCallback(async () => {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Open the published HTTPS website to use the microphone.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicGranted(true); return true;
    } catch (e) {
      setMicGranted(false);
      setConnection('failed');
      setError(e instanceof Error && e.name === 'NotAllowedError'
        ? window.self !== window.top ? 'Open the calling app in its own tab, then allow microphone access.' : 'Microphone access is blocked. Allow it in this website’s browser settings, then retry.'
        : e instanceof Error && e.name === 'NotFoundError' ? 'No microphone was found. Connect a microphone or headset, then retry.'
        : e instanceof Error ? e.message : 'The microphone is unavailable.');
      return false;
    }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    void authFetch<{ route: RouteData }>(providerUrl, {
      body: { action: 'get_federal_one_v2', session_token: sessionToken }, signal: abort.signal,
      onUnauthorized: () => unauthorizedRef.current(),
    }).then(result => {
      if (abort.signal.aborted) return;
      if (result.ok && result.data) setRoute(result.data.route);
      else setError(result.error || 'Could not load phone settings.');
    });
    return () => { abort.abort(); phoneIdentityRef.current++; credentialsRef.current = null; };
  }, [providerUrl, sessionToken]);

  const lookupCaller = useCallback(async (phone: string) => {
    const sequence = ++lookupSequence.current;
    const result = await authFetch<{ caller: Caller | null }>(providerUrl, {
      body: { action: 'zadarma_caller_context', session_token: sessionToken, phone },
      onUnauthorized: () => unauthorizedRef.current(),
    });
    if (sequence === lookupSequence.current && result.ok && result.data?.caller) setCaller(result.data.caller);
  }, [providerUrl, sessionToken]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow || event.data?.channel !== CHANNEL) return;
      const data = event.data;
      if (data.type === 'frame-ready') setFrameReady(true);
      if (data.type === 'connection') {
        setConnection(data.state); startingRef.current = data.state === 'connecting';
        if (data.state === 'ready') setError('');
      }
      if (data.type === 'error') { setError(String(data.message)); pendingCallRef.current = false; }
      if (data.type === 'incoming' || data.type === 'outgoing') {
        const number = String(data.number || 'Unknown caller');
        const name = typeof data.name === 'string' ? data.name : undefined;
        callRef.current = { number, name, direction: data.type === 'incoming' ? 'incoming' : 'outgoing', answered: false };
        setCallNumber(number); setCaller(name ? { name } : null); setOpen(true); setView('keypad');
        void lookupCaller(number);
      }
      if (data.type === 'call-state') {
        const next = data.state as PhoneState;
        stateRef.current = next; setCallState(next);
        if (next === 'active' && callRef.current) callRef.current.answered = true;
        if (next === 'idle') {
          pendingCallRef.current = false; lookupSequence.current++;
          const call = callRef.current;
          if (call) setRecents(previous => [{ number: call.number, name: call.name, time: new Date(), direction: call.direction === 'incoming' && !call.answered ? 'missed' as const : call.direction }, ...previous].slice(0, 20));
          callRef.current = null; setCaller(null); setCallNumber(''); setShowDtmf(false); setSpeakerOff(false); setSeconds(0);
        }
      }
      if (data.type === 'controls') {
        if (typeof data.muted === 'boolean') setMuted(data.muted);
        if (typeof data.held === 'boolean') setHeld(data.held);
        if (typeof data.speakerOff === 'boolean') setSpeakerOff(data.speakerOff);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [lookupCaller]);

  useEffect(() => {
    if (!frameReady || !credentialsRef.current) return;
    command('connect', credentialsRef.current);
  }, [frameReady, frameVersion, command]);

  useEffect(() => {
    if (callState !== 'active') return;
    const started = Date.now(); setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [callState]);

  const enable = useCallback(async () => {
    if (companionOnly || !route?.zadarma_sip_login || startingRef.current || stateRef.current !== 'idle') return;
    const identity = phoneIdentityRef.current;
    startingRef.current = true; setError(''); unlockAudio();
    if (!await requestMic()) { startingRef.current = false; return; }
    if (identity !== phoneIdentityRef.current) return;
    setConnection('connecting');
    const result = await authFetch<{ key: string; sip: string }>(providerUrl, {
      body: { action: 'zadarma_webrtc_key', session_token: sessionToken },
      onUnauthorized: () => unauthorizedRef.current(),
    });
    if (identity !== phoneIdentityRef.current) return;
    if (!result.ok || !result.data?.key) { startingRef.current = false; setConnection('failed'); setError(result.error || 'Zadarma authorization failed.'); return; }
    const reconnecting = credentialsRef.current !== null;
    credentialsRef.current = result.data;
    if (reconnecting) { setFrameReady(false); setFrameVersion(version => version + 1); }
    else if (frameReady) command('connect', result.data);
  }, [companionOnly, route, unlockAudio, requestMic, providerUrl, sessionToken, frameReady, command]);

  const dial = useCallback(async (number: string) => {
    setOpen(true); setView('keypad'); setError(''); unlockAudio();
    if (companionOnly) { setError('Use your desktop to make and receive calls.'); return; }
    if (connection !== 'ready') { setDigits(number); setError('Press Enable phone and wait for Ready, then press Call.'); return; }
    if (stateRef.current !== 'idle' || pendingCallRef.current) { setError('Finish the current call first.'); return; }
    try {
      const normalized = normalizeDialNumber(number);
      pendingCallRef.current = true;
      if (!await requestMic()) { pendingCallRef.current = false; return; }
      command('dial', { number: normalized });
    } catch (e) { pendingCallRef.current = false; setError(e instanceof Error ? e.message : 'Invalid number.'); }
  }, [companionOnly, connection, command, requestMic, unlockAudio]);

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ phone: string }>).detail;
      if (detail?.phone) void dial(detail.phone);
    };
    window.addEventListener('wolf:phone:dial', handle);
    return () => window.removeEventListener('wolf:phone:dial', handle);
  }, [dial]);

  const answer = async () => { unlockAudio(); if (await requestMic()) command('answer'); };
  const status = connection === 'ready' ? 'Ready' : connection === 'connecting' ? 'Connecting…' : connection === 'failed' ? 'Not connected' : 'Enable phone';
  const dot = connection === 'ready' ? 'connected' : connection === 'connecting' ? 'connecting' : 'offline';
  const myNumber = route?.zadarma_number || route?.talkroute_number;
  const active = callState !== 'idle';
  const frame = !companionOnly && <iframe key={`${sessionToken.slice(-8)}-${frameVersion}`} ref={frameRef} src="/phone.html" title="Zadarma call connection" allow="microphone; autoplay" className="ip17-engine" />;

  return <>
    {frame}
    <aside className={`ip17-shell${!open ? ' ip17-closed' : ''}${callState === 'ringing-in' ? ' ip17-ringing' : ''}`} aria-label={`${agentName}'s Zadarma phone`}>
      {!open ? <button className="ip17-trigger" aria-label="Open phone" onClick={() => { unlockAudio(); setOpen(true); }}><Phone size={26} /><span className={`ip17-trigger-sip-dot ${dot}`} /></button> : <>
        <div className="ip17-island"><div className="ip17-island-pill"><div className={`ip17-island-dot ${dot}`} /><span className="ip17-island-label">{agentName.split(' ')[0]}'s Phone</span><button className="ip17-island-close" aria-label="Minimize phone" onClick={() => setOpen(false)}><X size={16} /></button></div></div>
        <div className="ip17-body">
          <div className="ip17-statusbar"><span className={`ip17-sip-badge ${dot}`}>{status}</span><span className="ip17-my-line">{myNumber ? formatPhone(myNumber) : 'No line assigned'}</span></div>
          {error && <div className="ip17-error" role="alert">{error}<button aria-label="Dismiss phone error" onClick={() => setError('')}>×</button></div>}
          {!active && <nav className="ip17-tabs" aria-label="Phone views"><button aria-current={view === 'keypad' ? 'page' : undefined} onClick={() => setView('keypad')}>Keypad</button><button aria-current={view === 'voicemail' ? 'page' : undefined} onClick={() => setView('voicemail')}>Voicemail{unreadVoicemails != null && unreadVoicemails > 0 && <span className="ip17-vm-badge" aria-label={`${unreadVoicemails} unheard messages`}> {unreadVoicemails}</span>}</button></nav>}
          {view === 'voicemail' && !active ? <PhoneVoicemail sessionToken={sessionToken} providerUrl={providerUrl} onUnauthorized={onUnauthorized} canCall={!companionOnly && connection === 'ready'} onCall={number => void dial(number)} /> : companionOnly ? <div className="ip17-mode-notice">Your phone is for client information. Open this app on your desktop to take calls.</div> : <>
            {inPreview && !active && <div className="ip17-mode-notice">For calling and microphone access, <a href={CALLING_URL} target="_blank" rel="noopener noreferrer">open the calling app in its own tab</a>.</div>}
            {!active && connection !== 'ready' && <button className="ip17-enable" disabled={!route?.zadarma_sip_login || connection === 'connecting'} onClick={() => void enable()}><RotateCcw size={16} />{connection === 'connecting' ? 'Connecting…' : connection === 'failed' ? 'Retry connection' : 'Enable microphone & phone'}</button>}
            {micGranted && !active && <div className="ip17-mic-status"><Mic size={13} />Microphone allowed</div>}
            {connection === 'ready' && !micGranted && <button className="ip17-enable" onClick={() => { unlockAudio(); void requestMic(); }}>Enable microphone and sound</button>}
            {active ? <div className="ip17-active">
              <div className="ip17-active-header"><h3 className="ip17-caller">{caller?.name || formatPhone(callNumber)}</h3>{caller?.name && <p>{formatPhone(callNumber)}</p>}<p className="ip17-timer" aria-live="polite">{callState === 'ringing-in' ? 'Incoming call' : callState === 'dialing' ? 'Calling…' : callState === 'answering' ? 'Connecting call…' : callState === 'ending' ? 'Ending call…' : `${held ? 'On hold · ' : ''}${duration(seconds)}`}</p></div>
              {caller?.address && <p className="ip17-caller-detail">{caller.address}</p>}
              {caller?.summary && <p className="ip17-caller-detail">{caller.summary}</p>}
              {caller?.fields && Object.keys(caller.fields).length > 0 && <details className="ip17-caller-detail"><summary>Client details</summary>{Object.entries(caller.fields).map(([key, value]) => <p key={key}><strong>{key.replace(/_/g, ' ')}:</strong> {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}</p>)}</details>}
              {caller?.transcript && <details className="ip17-caller-detail"><summary>AI conversation</summary><p>{caller.transcript}</p></details>}
              {callState === 'active' && <>
                <div className="ip17-call-controls">
                  <button className={`ip17-ctrl-btn${muted ? ' active' : ''}`} aria-pressed={muted} onClick={() => command('mute')}>{muted ? <MicOff size={22} /> : <Mic size={22} />}<span>{muted ? 'Unmute' : 'Mute'}</span></button>
                  <button className={`ip17-ctrl-btn${held ? ' active' : ''}`} aria-pressed={held} onClick={() => command('hold')}>{held ? <Play size={22} /> : <Pause size={22} />}<span>{held ? 'Resume' : 'Hold'}</span></button>
                  <button className={`ip17-ctrl-btn${speakerOff ? ' active' : ''}`} aria-pressed={speakerOff} onClick={() => command('speaker')}>{speakerOff ? <VolumeX size={22} /> : <Volume2 size={22} />}<span>{speakerOff ? 'Sound on' : 'Sound off'}</span></button>
                  <button className="ip17-ctrl-btn" onClick={() => setShowDtmf(value => !value)}><Grid3X3 size={22} /><span>Keypad</span></button>
                  <button className="ip17-ctrl-btn" onClick={unlockAudio}><Volume2 size={22} /><span>Enable sound</span></button>
                </div>
                {showDtmf && <div className="ip17-dtmf-pad">{KEYS.map(key => <button key={key} className="ip17-dtmf-key" onClick={() => command('dtmf', { tone: key })}>{key}</button>)}</div>}
              </>}
              <div className="ip17-answer-row">{callState === 'ringing-in' && <button className="ip17-dial-btn" aria-label="Answer call" onClick={() => void answer()}><Phone size={28} /></button>}<button className="ip17-hangup-btn" disabled={callState === 'ending'} aria-label={callState === 'ringing-in' ? 'Decline call' : 'End call'} onClick={() => command('hangup')}><PhoneOff size={28} /></button></div>
            </div> : <>
              <div className="ip17-idle"><div className="ip17-display"><input aria-label="Number to call" value={digits} onChange={event => setDigits(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void dial(digits); }} placeholder="Enter number" type="tel" autoComplete="off" />{digits && <button className="ip17-backspace" aria-label="Delete digit" onClick={() => setDigits(value => value.slice(0, -1))}><Delete size={20} /></button>}</div>
                <div className="ip17-dialpad">{KEYS.map((key, index) => <button key={key} className="ip17-key" onClick={() => setDigits(value => value + key)}><span className="ip17-key-digit">{key}</span><span className="ip17-key-sub">{LETTERS[index]}</span></button>)}</div>
                <div className="ip17-dial-row"><button className="ip17-dial-btn" aria-label="Call number" disabled={connection !== 'ready' || !digits.trim()} onClick={() => void dial(digits)}><Phone size={28} /></button></div>
              </div>
              {recents.length > 0 && <div className="ip17-recent"><div className="ip17-recent-title">Recent calls</div>{recents.slice(0, 8).map((call, index) => <div className="ip17-recent-row" key={`${call.time.getTime()}-${index}`}><div className={`ip17-recent-icon ${call.direction}`}>{call.direction === 'outgoing' ? <PhoneOutgoing size={14} /> : call.direction === 'incoming' ? <PhoneIncoming size={14} /> : <PhoneOff size={14} />}</div><div className="ip17-recent-info"><strong>{call.name || formatPhone(call.number)}</strong><time>{call.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><button className="ip17-callback" aria-label={`Call back ${call.number}`} disabled={connection !== 'ready'} onClick={() => void dial(call.number)}><Phone size={14} /></button></div>)}</div>}
            </>}
          </>}
        </div>
      </>}
    </aside>
  </>;
}
