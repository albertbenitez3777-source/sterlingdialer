import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, CameraOff, Minimize2, Move, Users, X } from 'lucide-react';

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
}

const FRAME_INTERVAL = 3000;
const POLL_INTERVAL = 3000;

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

export default function CameraWidget({ isOwner, agentId, agentName, sessionToken, providerUrl }: Props) {
  const [cam, setCam] = useState<CamState>('prompt');
  const [minimized, setMinimized] = useState(false);
  const [agents, setAgents] = useState<AgentCam[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
    report(false);
  }, [report]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

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

  // ── Minimized state (both roles) ──
  if (minimized) {
    return (
      <button className="cam-minimized" onClick={() => setMinimized(false)} title="Show camera">
        <Camera size={16} />
        {isOwner && <span className="cam-minimized-count">{agents.filter(a => a.camera_on).length}</span>}
      </button>
    );
  }

  // ── Own camera tile (shared between admin grid and agent widget) ──
  const ownCameraTile = (
    <div className="cam-agent-card self">
      <div className="cam-agent-vid">
        {cam === 'active' ? (
          <video ref={videoRef} autoPlay muted playsInline />
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
        {agentName} (You)
        {cam === 'active' && (
          <button className="cam-disconnect-btn" onClick={disconnect} title="Disconnect"><CameraOff size={12} /></button>
        )}
      </div>
    </div>
  );

  // ── ADMIN / SUPERVISOR: fixed panel with full team grid ──
  if (isOwner) {
    const others = agents.filter(a => a.agent_id !== agentId);
    return (
      <div className="cam-admin-panel">
        <div className="cam-admin-hdr">
          <Users size={16} />
          <h3>Team Cameras</h3>
          <span className="cam-admin-online">{agents.filter(a => a.camera_on).length} online</span>
          <button onClick={() => setMinimized(true)} title="Minimize"><Minimize2 size={14} /></button>
        </div>
        <div className="cam-admin-grid">
          {ownCameraTile}
          {others.map(a => (
            <div key={a.agent_id} className={`cam-agent-card ${a.camera_on ? 'live' : ''}`}>
              <div className="cam-agent-vid">
                {a.camera_on && a.last_frame ? (
                  <img src={`data:image/jpeg;base64,${a.last_frame}`} alt={a.full_name} className="cam-snapshot" />
                ) : (
                  <div className="cam-no-feed">
                    {a.camera_on ? <Camera size={24} /> : <CameraOff size={24} />}
                    <span>{a.camera_on ? 'Connecting...' : 'Camera off'}</span>
                  </div>
                )}
              </div>
              <div className="cam-agent-label">
                <span className={`cam-dot ${a.camera_on ? 'on' : ''}`} />
                {a.full_name}
              </div>
            </div>
          ))}
          {others.length === 0 && (
            <div className="cam-agent-card empty">
              <div className="cam-no-feed"><Users size={24} /><span>No agents online yet</span></div>
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
          {agentName}
          {cam === 'active' && (
            <button className="cam-disconnect-btn" onClick={disconnect} title="Disconnect"><CameraOff size={12} /></button>
          )}
          <button className="cam-minimize-inline" onClick={() => setMinimized(true)} title="Minimize"><X size={12} /></button>
        </div>
      </div>
    </div>
  );
}
