import { TeamSnapshot } from '@/modules/monitoring/TeamSnapshot';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowUpRight, Camera, CameraOff, CheckCircle2, Clock, FileText, Flame,
  Inbox, MessageSquare, Pause, Phone, PhoneCall, PhoneForwarded, PhoneIncoming,
  Search, Send, ShieldCheck, Sparkles, Users, Video, XCircle,
} from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';
import { startSerialPoll } from '@/utils/serial-poll';
import { formatPhone } from '@/utils/privacy';

type QueueRecord = {
  id: string; consumer_name: string; consumer_phone: string;
  consumer_address?: string; duration_seconds: number; ai_summary: string;
  transfer_status?: string; queue: string; created_at: string;
  agent_disposition?: string; callback_requested?: boolean;
};

export interface AgentTodayStats {
  human_drops: number;
  fire_transfers: number;
  voice_messages: number;
  failed_transfers: number;
  callbacks_due: number;
  completed_callbacks: number;
  new_voicemails: number;
  live_humans?: number;
  active_calls_now?: number;
  today_total?: number;
  completed_today?: number;
}

type V2Message = {
  id: string; sender_agent_id: string | null; sender_name: string;
  message_kind: 'agent' | 'system' | 'transfer' | 'callback';
  body: string; created_at: string;
};

type V2Workspace = {
  route?: {
    bland_number?: string; talkroute_number?: string; transfer_certified?: boolean;
    inbound_configured?: boolean;
  };
  settings?: {
    personal_dialer_state?: string; number_certification_state?: string;
    camera_state?: string; camera_verified_at?: string | null;
  };
  messages?: V2Message[];
  active_client?: {
    contact_key: string; client_name: string; client_phone?: string;
    client_snapshot?: Record<string, unknown>; updated_at: string;
  } | null;
  client_notes?: Array<{ id: string; agent_id: string; client_name: string; body: string; created_at: string }>;
};

export interface AgentCockpitProps {
  showTeamMonitor?: boolean;
  agentName: string;
  agentId?: string;
  available: boolean;
  togglingAvail: boolean;
  onToggleAvail: () => void;
  fireTransfers: QueueRecord[];
  humanDrops: QueueRecord[];
  todayStats: AgentTodayStats | null;
  onNavTo: (tab: string) => void;
  activeNav: string;
  providerUrl?: string;
  sessionToken?: string;
  onUnauthorized?: () => void;
}

function fmtClock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function routeState(workspace: V2Workspace | null) {
  if (!workspace?.route) return { label: 'Checking route', tone: 'checking' };
  if (!workspace.route.transfer_certified) return { label: 'Certification required', tone: 'warn' };
  return { label: 'Personal route protected', tone: 'ready' };
}

export function AgentCockpit(props: AgentCockpitProps) {
  const {
    agentName, agentId, available, togglingAvail, onToggleAvail, fireTransfers,
    humanDrops, todayStats, onNavTo, providerUrl, sessionToken, onUnauthorized,
  } = props;
  const [workspace, setWorkspace] = useState<V2Workspace | null>(null);
  const [chatText, setChatText] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [cameraState, setCameraState] = useState<'idle' | 'requesting' | 'live' | 'blocked'>('idle');
  const [isMobile, setIsMobile] = useState(false);
  const [dialerChanging, setDialerChanging] = useState(false);
  const [dialerError, setDialerError] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const auth = useRef(onUnauthorized);
  auth.current = onUnauthorized;

  useEffect(() => {
    if (!providerUrl || !sessionToken) return;
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    setIsMobile(mobile);
    const poll = startSerialPoll(async signal => {
      const result = await authFetch<V2Workspace>(providerUrl, {
        body: { action: 'get_federal_one_v2', session_token: sessionToken },
        signal, onUnauthorized: () => auth.current?.(),
      });
      if (!signal.aborted && result.ok && result.data) setWorkspace(result.data);
      return result.ok;
    }, 5000, { paused: () => document.visibilityState === 'hidden' });
    let deviceKey = window.localStorage.getItem('federal-one-device-key');
    if (!deviceKey) {
      deviceKey = crypto.randomUUID();
      window.localStorage.setItem('federal-one-device-key', deviceKey);
    }
    const heartbeatPoll = startSerialPoll(async signal => {
      const result = await authFetch(providerUrl, {
        body: { action: 'device_heartbeat', session_token: sessionToken, device_key: deviceKey, device_kind: mobile ? 'phone' : 'desktop' },
        signal, onUnauthorized: () => auth.current?.(),
      });
      return result.ok;
    }, 15000, { maxBackoffMs: 30000 });
    const visible = () => { if (document.visibilityState !== 'hidden') poll.refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { poll.stop(); heartbeatPoll.stop(); document.removeEventListener('visibilitychange', visible); };
  }, [providerUrl, sessionToken]);

  const changeDialerState = async () => {
    if (!providerUrl || !sessionToken || dialerChanging) return;
    const current = workspace?.settings?.personal_dialer_state || 'stopped';
    const state = current === 'running' ? 'paused' : 'running';
    setDialerChanging(true);
    setDialerError('');
    const result = await authFetch<{ state: string }>(providerUrl, {
      body: { action: 'set_personal_dialer_state', session_token: sessionToken, state },
      onUnauthorized: () => onUnauthorized?.(),
    });
    if (result.ok) setWorkspace(currentWorkspace => ({
      ...currentWorkspace,
      settings: { ...currentWorkspace?.settings, personal_dialer_state: result.data?.state || state },
    }));
    else setDialerError(result.error || 'Dialer could not be updated');
    setDialerChanging(false);
  };

  const saveClientNote = async () => {
    if (!workspace?.active_client || !clientNote.trim() || !providerUrl || !sessionToken || noteSaving) return;
    setNoteSaving(true);
    const result = await authFetch<{ note: { id: string; agent_id: string; client_name: string; body: string; created_at: string } }>(providerUrl, {
      body: { action: 'add_client_note', session_token: sessionToken, client_name: workspace.active_client.client_name, client_phone: workspace.active_client.client_phone, note: clientNote.trim() },
      onUnauthorized: () => onUnauthorized?.(),
    });
    if (result.ok && result.data?.note) {
      setClientNote('');
      setWorkspace(current => ({ ...current, client_notes: [result.data!.note, ...(current?.client_notes || [])] }));
    }
    setNoteSaving(false);
  };

  const setRemoteCameraState = useCallback(async (state: 'disconnected' | 'requesting' | 'connected' | 'blocked') => {
    if (!providerUrl || !sessionToken) return;
    await authFetch(providerUrl, {
      body: { action: 'set_federal_one_camera_state', session_token: sessionToken, camera_state: state },
      onUnauthorized: () => onUnauthorized?.(),
    });
  }, [providerUrl, sessionToken, onUnauthorized]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState('idle');
    void setRemoteCameraState('disconnected');
  }, [setRemoteCameraState]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const startCamera = async () => {
    if (isMobile || !navigator.mediaDevices?.getUserMedia) return;
    setCameraState('requesting');
    void setRemoteCameraState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('live');
      void setRemoteCameraState('connected');
    } catch {
      setCameraState('blocked');
      void setRemoteCameraState('blocked');
    }
  };

  const sendMessage = async () => {
    const message = chatText.trim();
    if (!message || !providerUrl || !sessionToken || chatSending) return;
    setChatSending(true);
    setChatError('');
    const result = await authFetch<{ message: V2Message }>(providerUrl, {
      body: { action: 'send_federal_one_message', session_token: sessionToken, message },
      onUnauthorized: () => onUnauthorized?.(),
    });
    if (result.ok && result.data?.message) {
      setChatText('');
      setWorkspace(current => ({ ...current, messages: [...(current?.messages || []), result.data!.message] }));
    } else {
      setChatError(result.error || 'Message could not be sent');
    }
    setChatSending(false);
  };

  const pipeline = useMemo(() => [
    { label: 'Active now', value: todayStats?.active_calls_now ?? '—', icon: PhoneCall },
    { label: 'Live humans', value: todayStats?.live_humans ?? todayStats?.human_drops ?? '—', icon: Users },
    { label: 'Transfers', value: todayStats?.fire_transfers ?? '—', icon: PhoneForwarded },
    { label: 'Callbacks', value: todayStats?.callbacks_due ?? '—', icon: PhoneIncoming },
    { label: 'Completed', value: todayStats?.completed_today ?? '—', icon: CheckCircle2 },
    { label: 'Needs review', value: todayStats?.failed_transfers ?? '—', icon: XCircle },
  ], [todayStats, fireTransfers.length, humanDrops.length]);

  const firstName = agentName.split(' ')[0] || 'Agent';
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const route = routeState(workspace);
  const messages = workspace?.messages || [];
  const recent = [...fireTransfers, ...humanDrops].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 4);

  if (isMobile) {
    return (
      <div className="f1-mobile-companion">
        <div className="f1-mobile-orb"><ShieldCheck size={24} /></div>
        <span className="f1-overline">FEDERAL ONE 2.0</span>
        <h2>{firstName}'s Client Companion</h2>
        <p>Your phone follows the client open on your computer. Calling and camera controls stay on your computer.</p>
        {workspace?.active_client ? <div className="f1-mobile-active-client">
          <small>OPEN ON YOUR COMPUTER</small>
          <strong>{workspace.active_client.client_name}</strong>
          <span>{workspace.active_client.client_phone ? formatPhone(workspace.active_client.client_phone) : 'Client record'}</span>
          <button onClick={() => onNavTo('contacts')}>Open client <ArrowUpRight size={15} /></button>
          <div className="f1-mobile-note"><input value={clientNote} onChange={event => setClientNote(event.target.value)} placeholder="Add a note…" maxLength={2000} /><button onClick={() => void saveClientNote()} disabled={!clientNote.trim() || noteSaving}><Send size={14} /></button></div>
          {(workspace.client_notes || []).slice(0, 2).map(note => <p className="f1-mobile-note-row" key={note.id}>{note.body}</p>)}
        </div> : <div className="f1-mobile-active-client empty"><strong>No client open</strong><span>Open a client on your computer and it will appear here.</span></div>}
        <div className="f1-mobile-actions">
          <button onClick={() => onNavTo('extra')}><FileText size={18} /><span>Extra Info</span><ArrowUpRight size={16} /></button>
          <button onClick={() => onNavTo('contacts')}><Search size={18} /><span>Find a client</span><ArrowUpRight size={16} /></button>
          <button onClick={() => onNavTo('inbox')}><Inbox size={18} /><span>Incoming alerts</span><ArrowUpRight size={16} /></button>
          <button onClick={() => onNavTo('saved')}><Clock size={18} /><span>Callbacks & saved</span><ArrowUpRight size={16} /></button>
        </div>
      </div>
    );
  }

  return (
    <div className="f1-command-center" role="region" aria-label="Federal One agent command center">
      {props.showTeamMonitor && sessionToken ? <TeamSnapshot token={sessionToken} onOpen={()=>onNavTo('monitoring')}/> : <section className="f1-command-hero">
        <div className="f1-command-copy">
          <span className="f1-overline"><Sparkles size={12} /> MY WORKSPACE</span>
          <h2>{greeting}, <em>{firstName}</em></h2>
          <p>Everything you need to find clients, make calls, and get help.</p>
        </div>
        <button className={`f1-availability ${available ? 'is-ready' : 'is-away'}`} onClick={onToggleAvail} disabled={togglingAvail}>
          <span />
          <div><small>WORK STATUS</small><strong>{togglingAvail ? 'Updating' : available ? 'Available' : 'Away'}</strong></div>
        </button>
      </section>}

      <section className="f1-readiness-rail">
        <div className="f1-readiness-item"><span className="f1-readiness-icon"><Activity size={15} /></span><div><small>WORKSTATION</small><strong>Connected</strong></div></div>
        <div className="f1-readiness-item"><span className="f1-readiness-icon"><Phone size={15} /></span><div><small>BLAND.AI LINE</small><strong>{workspace?.route?.bland_number ? formatPhone(workspace.route.bland_number) : 'Checking'}</strong></div></div>
        <div className="f1-readiness-item"><span className="f1-readiness-icon"><PhoneForwarded size={15} /></span><div><small>ZADARMA</small><strong>{workspace?.route?.talkroute_number ? formatPhone(workspace.route.talkroute_number) : 'Checking'}</strong></div></div>
        <div className={`f1-readiness-item ${route.tone}`}><span className="f1-readiness-icon"><ShieldCheck size={15} /></span><div><small>ROUTE STATUS</small><strong>{route.label}</strong></div></div>
      </section>

      <button className={`f1-simple-dialer ${workspace?.settings?.personal_dialer_state === 'running' ? 'running' : ''}`} onClick={() => void changeDialerState()} disabled={dialerChanging || !workspace?.route?.transfer_certified}>
        <span>{workspace?.settings?.personal_dialer_state === 'running' ? <Pause size={19} /> : <PhoneCall size={19} />}</span>
        <div><small>MY DIALER</small><strong>{dialerChanging ? 'Updating…' : workspace?.settings?.personal_dialer_state === 'running' ? 'Pause my calls' : 'Start my calls'}</strong></div>
        <ArrowUpRight size={17} />
      </button>
      {dialerError && <div className="f1-simple-error">{dialerError}</div>}

      <div className="f1-command-grid">
        <main className="f1-command-main">
          <div className="f1-primary-actions">
            <button className="f1-primary-action extra-info-cockpit" onClick={() => onNavTo('extra')}>
              <span className="f1-action-icon"><FileText size={24} /></span><div><small>RESEARCH</small><strong>Extra Info</strong><p>Find more on a live call</p></div><ArrowUpRight size={18} />
            </button>
            <button className="f1-primary-action dialer" onClick={() => onNavTo('calls')}>
              <span className="f1-action-icon"><Flame size={24} /></span><div><small>CALLS</small><strong>My Calls</strong><p>See live calls and history</p></div><ArrowUpRight size={18} />
            </button>
            <button className="f1-primary-action secretary" onClick={() => onNavTo('secretary')}>
              <span className="f1-action-icon"><Send size={24} /></span><div><small>HELP</small><strong>Ask Elizabeth</strong><p>Have Elizabeth call first</p></div><ArrowUpRight size={18} />
            </button>
            <button className="f1-primary-action intelligence" onClick={() => onNavTo('contacts')}>
              <span className="f1-action-icon"><Search size={24} /></span><div><small>SEARCH</small><strong>Find a Client</strong><p>Search records and public sources</p></div><ArrowUpRight size={18} />
            </button>
          </div>

          <div className="f1-metric-panel">
            <div className="f1-panel-heading"><div><small>TODAY</small><strong>Personal performance</strong></div><span>LIVE DATA</span></div>
            <div className="f1-metric-grid">
              {pipeline.map(({ label, value, icon: Icon }) => <div className="f1-metric" key={label}><Icon size={15} /><strong>{value}</strong><span>{label}</span></div>)}
            </div>
          </div>

          <div className="f1-activity-panel">
            <div className="f1-panel-heading"><div><small>OPERATIONS PULSE</small><strong>Recent client activity</strong></div><button onClick={() => onNavTo('calls')}>View all <ArrowUpRight size={13} /></button></div>
            {recent.length === 0 ? <div className="f1-empty-pulse"><Activity size={19} /><span>New client activity will appear here in real time.</span></div> : recent.map(item => (
              <button className="f1-activity-row" key={item.id} onClick={() => onNavTo('calls')}>
                <span className="f1-client-monogram">{item.consumer_name?.split(' ').map(p => p[0]).join('').slice(0, 2) || '?'}</span>
                <div><strong>{item.consumer_name || 'Unknown client'}</strong><small>{item.queue === 'fire_transfer' ? 'Transfer ready' : 'Live response'} · {fmtClock(item.created_at)}</small></div>
                <span className={item.queue === 'fire_transfer' ? 'hot' : 'warm'}>{item.queue === 'fire_transfer' ? 'TRANSFER' : 'HUMAN'}</span>
              </button>
            ))}
          </div>
        </main>

        <aside className="f1-collaboration-rail">
          <div className="f1-workroom-card">
            <div className="f1-panel-heading"><div><small>FEDERAL ONE WORKROOM</small><strong>Camera verification</strong></div><Video size={16} /></div>
            <div className={`f1-camera-stage ${cameraState}`}>
              <video ref={videoRef} muted playsInline />
              {cameraState !== 'live' && <div className="f1-camera-placeholder">{cameraState === 'blocked' ? <CameraOff size={26} /> : <Camera size={26} />}<strong>{cameraState === 'requesting' ? 'Requesting permission' : cameraState === 'blocked' ? 'Camera permission blocked' : 'Camera is off'}</strong><span>Permission is requested before activation.</span></div>}
              {cameraState === 'live' && <span className="f1-camera-live"><i /> CAMERA CONNECTED</span>}
            </div>
            {cameraState === 'live' ? <button className="f1-camera-button stop" onClick={stopCamera}><CameraOff size={15} /> Leave workroom</button> : <button className="f1-camera-button" onClick={startCamera} disabled={cameraState === 'requesting'}><Camera size={15} /> {cameraState === 'blocked' ? 'Try camera again' : 'Join workroom'}</button>}
          </div>

          <div className="f1-team-card">
            <div className="f1-panel-heading"><div><small>TEAM ROOM</small><strong>Federal One Chat</strong></div><MessageSquare size={16} /></div>
            <div className="f1-chat-feed">
              {messages.length === 0 ? <div className="f1-chat-empty">Team messages and system alerts will appear here.</div> : messages.slice(-8).map(message => (
                <div className={`f1-chat-message ${message.sender_agent_id === agentId ? 'mine' : ''}`} key={message.id}>
                  <div><strong>{message.sender_name}</strong><time>{fmtClock(message.created_at)}</time></div><p>{message.body}</p>
                </div>
              ))}
            </div>
            {chatError && <div className="f1-chat-error">{chatError}</div>}
            <div className="f1-chat-compose">
              <input value={chatText} onChange={event => setChatText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void sendMessage(); }} placeholder="Message the team..." maxLength={2000} />
              <button onClick={sendMessage} disabled={!chatText.trim() || chatSending} aria-label="Send message"><Send size={15} /></button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
