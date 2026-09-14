import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, CameraOff, Maximize2, Minimize2, Move, Users, X } from 'lucide-react';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type CamState = 'prompt' | 'requesting' | 'active' | 'denied' | 'error';

interface Props {
  isOwner: boolean;
  agentId: string;
  agentName: string;
  sessionToken: string;
  providerUrl: string;
}

const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const POS: Record<Corner, React.CSSProperties> = {
  'top-left': { top: 80, left: 16 },
  'top-right': { top: 80, right: 16 },
  'bottom-left': { bottom: 80, left: 16 },
  'bottom-right': { bottom: 80, right: 16 },
};

export default function CameraWidget({ isOwner, agentId, agentName, sessionToken, providerUrl }: Props) {
  const [corner, setCorner] = useState<Corner>('top-left');
  const [cam, setCam] = useState<CamState>('prompt');
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [agents, setAgents] = useState<{ agent_id: string; full_name: string; camera_on: boolean }[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const expandVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const attachStream = useCallback((el: HTMLVideoElement | null) => {
    if (el && streamRef.current) el.srcObject = streamRef.current;
  }, []);

  useEffect(() => { attachStream(videoRef.current); }, [cam, expanded, attachStream]);
  useEffect(() => { if (expanded) attachStream(expandVideoRef.current); }, [expanded, attachStream]);

  const report = useCallback(async (on: boolean) => {
    try {
      await fetch(providerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'camera_status', session_token: sessionToken, camera_on: on }),
      });
    } catch { /* best-effort */ }
  }, [providerUrl, sessionToken]);

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
    if (expandVideoRef.current) expandVideoRef.current.srcObject = null;
    setCam('prompt');
    report(false);
  }, [report]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

  useEffect(() => {
    if (!isOwner || !expanded) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(providerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_camera_statuses', session_token: sessionToken }),
        });
        const data = await res.json();
        if (alive && data.cameras) setAgents(data.cameras);
      } catch { /* silent */ }
    };
    load();
    const iv = setInterval(load, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [isOwner, expanded, providerUrl, sessionToken]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragStart.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    dragStart.current = null;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    const midX = window.innerWidth / 2;
    const midY = window.innerHeight / 2;
    setCorner(e.clientY < midY ? (e.clientX < midX ? 'top-left' : 'top-right') : (e.clientX < midX ? 'bottom-left' : 'bottom-right'));
  };

  const cycleCorner = () => setCorner(CORNERS[(CORNERS.indexOf(corner) + 1) % 4]);

  if (minimized) {
    return (
      <button className="cam-minimized" style={{ position: 'fixed', ...POS[corner], zIndex: 10000 }} onClick={() => setMinimized(false)} title="Show camera">
        <Camera size={16} />
      </button>
    );
  }

  if (expanded && isOwner) {
    return (
      <div className="cam-expanded-overlay">
        <div className="cam-expanded">
          <div className="cam-expanded-hdr">
            <Users size={18} /> <h3>Team Cameras</h3>
            <button onClick={() => setExpanded(false)} title="Close"><Minimize2 size={16} /></button>
          </div>
          <div className="cam-expanded-grid">
            <div className="cam-agent-card self">
              <div className="cam-agent-vid">
                {cam === 'active' ? <video ref={expandVideoRef} autoPlay muted playsInline /> : <div className="cam-no-feed"><CameraOff size={24} /><span>Your camera</span></div>}
              </div>
              <div className="cam-agent-label"><span className={`cam-dot ${cam === 'active' ? 'on' : ''}`} />{agentName} (You)</div>
            </div>
            {agents.filter(a => a.agent_id !== agentId).map(a => (
              <div key={a.agent_id} className="cam-agent-card">
                <div className="cam-agent-vid">
                  <div className="cam-no-feed">{a.camera_on ? <Camera size={24} /> : <CameraOff size={24} />}<span>{a.camera_on ? 'Camera on' : 'Off'}</span></div>
                </div>
                <div className="cam-agent-label"><span className={`cam-dot ${a.camera_on ? 'on' : ''}`} />{a.full_name}</div>
              </div>
            ))}
            {agents.filter(a => a.agent_id !== agentId).length === 0 && (
              <div className="cam-agent-card empty"><div className="cam-no-feed"><Users size={24} /><span>No other agents online</span></div></div>
            )}
          </div>
          <p className="cam-expanded-note">Live video feeds from other agents require LiveKit to be configured.</p>
        </div>
      </div>
    );
  }

  const draggable = cam === 'active';

  return (
    <div className={`cam-widget cam-${cam}`} style={{ position: 'fixed', ...POS[corner], zIndex: 10000 }} onPointerDown={draggable ? onPointerDown : undefined} onPointerUp={draggable ? onPointerUp : undefined}>
      {cam === 'prompt' && (
        <button className="cam-connect-btn" onClick={connect}>
          <Camera size={22} />
          <span>Connect<br />Camera</span>
        </button>
      )}

      {cam === 'requesting' && (
        <div className="cam-requesting">
          <Camera size={22} className="cam-pulse" />
          <span>Allow camera access...</span>
        </div>
      )}

      {cam === 'active' && (
        <>
          <video ref={videoRef} autoPlay muted playsInline className="cam-video" />
          <div className="cam-controls">
            <button onClick={disconnect} title="Turn off"><CameraOff size={12} /></button>
            <button onClick={cycleCorner} title="Move to next corner"><Move size={12} /></button>
            {isOwner && <button onClick={() => setExpanded(true)} title="All agents"><Maximize2 size={12} /></button>}
            <button onClick={() => setMinimized(true)} title="Minimize"><X size={12} /></button>
          </div>
          <span className="cam-live-badge">LIVE</span>
        </>
      )}

      {(cam === 'denied' || cam === 'error') && (
        <div className="cam-denied">
          <CameraOff size={22} />
          <span>{cam === 'denied' ? 'Camera blocked' : 'Camera error'}</span>
          <button onClick={() => setCam('prompt')}>Retry</button>
        </div>
      )}

      {cam === 'active' && <div className="cam-drag-hint"><Move size={9} /> drag to move</div>}
    </div>
  );
}
