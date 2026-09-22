import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, CameraOff, Clock, Minimize2, Users, X } from 'lucide-react';

type CamState = 'prompt' | 'requesting' | 'active' | 'denied' | 'error';

interface Props {
  isOwner: boolean;
  agentId: string;
  agentName: string;
  sessionToken: string;
  providerUrl: string;
}

interface AgentCam {
  agent_id: string;
  full_name: string;
  camera_on: boolean;
  last_frame?: string | null;
  updated_at?: string;
  connected_at?: string | null;
}

const FRAME_INTERVAL = 3000;
const POLL_INTERVAL = 3000;
const STALE_THRESHOLD = 12_000;

function captureFrame(video: HTMLVideoElement): string | null {
  if (!video.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, 160, 120);
  return canvas.toDataURL('image/jpeg', 0.4).split(',')[1] || null;
}

function isStale(updatedAt?: string): boolean {
  if (!updatedAt) return true;
  return Date.now() - new Date(updatedAt).getTime() > STALE_THRESHOLD;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function reportSync(providerUrl: string, sessionToken: string, on: boolean) {
  try {
    const body = JSON.stringify({ action: 'camera_status', session_token: sessionToken, camera_on: on });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(providerUrl, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(providerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    }
  } catch { /* best effort */ }
}

// Ticking timer that re-renders every second
function ConnectionTimer({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const elapsed = now - new Date(since).getTime();
  if (elapsed < 0) return null;
  return <span className="cam-timer"><Clock size={10} /> {formatDuration(elapsed)}</span>;
}

export default function CameraWidget({ isOwner, agentId, agentName, sessionToken, providerUrl }: Props) {
  const [cam, setCam] = useState<CamState>('prompt');
  const [minimized, setMinimized] = useState(isOwner);
  const [agents, setAgents] = useState<AgentCam[]>([]);
  const [connectedSince, setConnectedSince] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;

  const attachStream = useCallback((el: HTMLVideoElement | null) => {
    if (el && streamRef.current) el.srcObject = streamRef.current;
  }, []);

  useEffect(() => { attachStream(videoRef.current); }, [cam, attachStream]);

  const report = useCallback(async (on: boolean, frame?: string | null) => {
    try {
      const payload: Record<string, unknown> = { action: 'camera_status', session_token: sessionToken, camera_on: on };
      if (frame) payload.frame = frame;
      await fetch(providerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch { /* best-effort */ }
  }, [providerUrl, sessionToken]);

  useEffect(() => {
    if (cam !== 'active') return;
    const iv = setInterval(() => {
      if (!videoRef.current) return;
      const frame = captureFrame(videoRef.current);
      if (frame) report(true, frame);
    }, FRAME_INTERVAL);
    return () => clearInterval(iv);
  }, [cam, report]);

  const connect = useCallback(async () => {
    setCam('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      setCam('active');
      setConnectedSince(new Date().toISOString());
      report(true);
    } catch (err: unknown) {
      setCam((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'error');
    }
  }, [report]);

  const disconnect = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCam('prompt');
    setConnectedSince(null);
    report(false);
  }, [report]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (camRef.current === 'active') reportSync(providerUrl, sessionToken, false);
    };
  }, [providerUrl, sessionToken]);

  useEffect(() => {
    const handler = () => {
      if (camRef.current === 'active') reportSync(providerUrl, sessionToken, false);
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [providerUrl, sessionToken]);

  // Admin: always poll for agent feeds
  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(providerUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_camera_statuses', session_token: sessionToken, include_frames: true }),
        });
        const data = await res.json();
        if (alive && data.cameras) setAgents(data.cameras);
      } catch { /* silent */ }
    };
    load();
    const iv = setInterval(load, POLL_INTERVAL);
    return () => { alive = false; clearInterval(iv); };
  }, [isOwner, providerUrl, sessionToken]);

  const isAgentLive = (a: AgentCam) => a.camera_on && !isStale(a.updated_at);

  // ── Minimized ──
  if (minimized) {
    return (
      <button className="cam-minimized" onClick={() => setMinimized(false)} title="Show camera">
        <Camera size={16} /><span>Cameras</span>
        {isOwner && <span className="cam-minimized-count">{agents.filter(isAgentLive).length}</span>}
      </button>
    );
  }

  // ── Own camera tile ──
  const ownCameraTile = (
    <div className="cam-agent-card self">
      <div className="cam-agent-vid">
        {cam === 'active' ? (
          <>
            <video ref={videoRef} autoPlay muted playsInline />
            <span className="cam-live-badge">LIVE</span>
          </>
        ) : cam === 'requesting' ? (
          <div className="cam-no-feed"><Camera size={24} className="cam-pulse" /><span>Requesting...</span></div>
        ) : cam === 'denied' || cam === 'error' ? (
          <div className="cam-no-feed">
            <CameraOff size={24} />
            <span>{cam === 'denied' ? 'Blocked' : 'Error'}</span>
            <button className="cam-retry-btn" onClick={() => setCam('prompt')}>Retry</button>
          </div>
        ) : (
          <button className="cam-tile-connect" onClick={connect}>
            <Camera size={28} />
            <span>Connect Camera</span>
          </button>
        )}
      </div>
      <div className="cam-agent-label">
        <span className={`cam-dot ${cam === 'active' ? 'on' : ''}`} />
        <span className="cam-agent-name">{agentName} (You)</span>
        {cam === 'active' && connectedSince && <ConnectionTimer since={connectedSince} />}
        {cam === 'active' && (
          <button className="cam-disconnect-btn" onClick={disconnect} title="Disconnect"><CameraOff size={12} /></button>
        )}
      </div>
    </div>
  );

  // ── ADMIN / SUPERVISOR: fixed panel, only connected agents shown ──
  if (isOwner) {
    const liveOthers = agents.filter(a => a.agent_id !== agentId && isAgentLive(a));
    const liveCount = agents.filter(isAgentLive).length;
    return (
      <div className="cam-admin-panel">
        <div className="cam-admin-hdr">
          <Users size={16} />
          <h3>Team Cameras</h3>
          <span className="cam-admin-online">{liveCount} online</span>
          <button onClick={() => setMinimized(true)} title="Minimize"><Minimize2 size={14} /></button>
        </div>
        <div className="cam-admin-grid">
          {ownCameraTile}
          {liveOthers.map(a => (
            <div key={a.agent_id} className="cam-agent-card live">
              <div className="cam-agent-vid">
                {a.last_frame ? (
                  <img src={`data:image/jpeg;base64,${a.last_frame}`} alt={a.full_name} className="cam-snapshot" />
                ) : (
                  <div className="cam-no-feed"><Camera size={24} className="cam-pulse" /><span>Connecting...</span></div>
                )}
                <span className="cam-live-badge">LIVE</span>
              </div>
              <div className="cam-agent-label">
                <span className="cam-dot on" />
                <span className="cam-agent-name">{a.full_name}</span>
                {a.connected_at && <ConnectionTimer since={a.connected_at} />}
              </div>
            </div>
          ))}
          {liveOthers.length === 0 && cam !== 'active' && (
            <div className="cam-agent-card empty">
              <div className="cam-no-feed"><Users size={24} /><span>No agents connected</span></div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── AGENT: small floating pip ──
  return (
    <div className="cam-widget-agent">
      <div className="cam-agent-card self">
        <div className="cam-agent-vid">
          {cam === 'active' ? (
            <>
              <video ref={videoRef} autoPlay muted playsInline />
              <span className="cam-live-badge">LIVE</span>
            </>
          ) : cam === 'requesting' ? (
            <div className="cam-no-feed"><Camera size={24} className="cam-pulse" /><span>Requesting...</span></div>
          ) : cam === 'denied' || cam === 'error' ? (
            <div className="cam-no-feed">
              <CameraOff size={24} />
              <span>{cam === 'denied' ? 'Camera blocked' : 'Camera error'}</span>
              <button className="cam-retry-btn" onClick={() => setCam('prompt')}>Retry</button>
            </div>
          ) : (
            <button className="cam-tile-connect" onClick={connect}>
              <Camera size={28} />
              <span>Connect Camera</span>
            </button>
          )}
        </div>
        <div className="cam-agent-label">
          <span className={`cam-dot ${cam === 'active' ? 'on' : ''}`} />
          <span className="cam-agent-name">{agentName}</span>
          {cam === 'active' && connectedSince && <ConnectionTimer since={connectedSince} />}
          {cam === 'active' && (
            <button className="cam-disconnect-btn" onClick={disconnect} title="Disconnect"><CameraOff size={12} /></button>
          )}
          <button className="cam-minimize-inline" onClick={() => setMinimized(true)} title="Minimize"><X size={12} /></button>
        </div>
      </div>
    </div>
  );
}
