import { useState, useRef, useCallback, useEffect } from 'react';
import { Volume2, VolumeX, RefreshCw } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';
import { recordingIdentity } from '@/modules/recordings/recording-identity';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? '';
const PROVIDER_URL = `${SUPABASE_URL}/functions/v1/wolf-provider`;

interface RecordingPlayerProps {
  url: string | null | undefined;
  callId?: string;
  recordingSource?: 'calls' | 'secretary_calls';
  sessionToken?: string;
  onUnauthorized?: () => void;
}

export function RecordingPlayer(props: RecordingPlayerProps) {
  const identity=recordingIdentity(props.recordingSource||'calls',props.callId,props.url,props.sessionToken);
  return <RecordingPlayback key={identity} {...props} />;
}

function RecordingPlayback({ url, callId, recordingSource = 'calls', sessionToken, onUnauthorized }: RecordingPlayerProps) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [recoveredUrl, setRecoveredUrl] = useState<string | null>(null);
  const [recoveredKey, setRecoveredKey] = useState<string | null>(null);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const attemptedRecovery = useRef(false);
  const recoveryRequest = useRef<AbortController | null>(null);
  const sourceKey = recordingIdentity(recordingSource,callId,url,sessionToken);
  const activeKey = useRef<string | null>(sourceKey);
  activeKey.current = sourceKey;
  const audioRef = useRef<HTMLAudioElement|null>(null);
  const resume = useRef<{time:number;playing:boolean}|null>(null);

  // Provider URLs require a server credential; the browser uses a short-lived
  // playback grant instead. Never send provider keys to the client.
  const incomingUrl = /^https:\/\/api\.bland\.ai(?:\/|$)/i.test(url || '') ? null : url;
  const [directUrl,setDirectUrl] = useState(incomingUrl);
  const activeUrl = (recoveredKey === sourceKey ? recoveredUrl : null) || directUrl;

  // Polling may renew a signed URL every few seconds. Keep the working source
  // and browser playhead; only an actual load error or explicit Retry replaces it.
  useEffect(()=>{if(!directUrl&&incomingUrl)setDirectUrl(incomingUrl);},[incomingUrl,directUrl]);

  useEffect(() => {
    activeKey.current = sourceKey;
    attemptedRecovery.current = false;
    setRecoveredUrl(null);
    setRecoveredKey(null);
    setRecoveryFailed(false);
    setRecoveryMessage('');
    setError(false);
    setRecovering(false);
    setLoading(true);
    return () => { activeKey.current = null; recoveryRequest.current?.abort(); };
  }, [sourceKey]);

  const attemptRecovery = useCallback(async () => {
    if (attemptedRecovery.current || !callId || !sessionToken || recovering) return;
    attemptedRecovery.current = true;
    setRecovering(true);
    setError(false);
    setLoading(true);
    const controller = new AbortController();
    recoveryRequest.current = controller;

    try {
      const result = await authFetch<{ recording_url: string }>(PROVIDER_URL, {
        onUnauthorized: () => { if (activeKey.current === sourceKey) onUnauthorized?.(); },
        signal: controller.signal,
        timeoutMs: 90000,
        body: { action: 'recover_recording', session_token: sessionToken, call_id: callId, recording_source: recordingSource },
      });
      if (controller.signal.aborted || activeKey.current !== sourceKey) return;

      if (result.ok && result.data?.recording_url) {
        setError(false);
        setRecoveryFailed(false);
        setRecoveryMessage('');
        setRecoveredKey(sourceKey);
        setRecoveredUrl(result.data.recording_url);
      } else {
        setRecoveryMessage(result.error || 'Recording is unavailable from the provider.');
        setRecoveryFailed(true);
        setError(true);
        setLoading(false);
      }
    } catch {
      if (controller.signal.aborted || activeKey.current !== sourceKey) return;
      setRecoveryFailed(true);
      setError(true);
      setLoading(false);
    } finally {
      if (activeKey.current === sourceKey) setRecovering(false);
    }
  }, [callId, sessionToken, recordingSource, sourceKey, recovering, onUnauthorized]);

  useEffect(() => {
    if (!activeUrl && callId && sessionToken && !recoveryFailed && !attemptedRecovery.current && !recovering) {
      attemptRecovery();
    }
  }, [activeUrl, callId, sessionToken, recoveryFailed, recovering, attemptRecovery]);

  const handleAudioError = useCallback(() => {
    if (recovering) return;
    const audio=audioRef.current;
    if(audio)resume.current={time:Number.isFinite(audio.currentTime)?audio.currentTime:0,playing:!audio.paused&&!audio.ended};
    if(incomingUrl&&incomingUrl!==activeUrl){
      setRecoveredUrl(null);setRecoveredKey(null);setDirectUrl(incomingUrl);
      setError(false);setLoading(true);return;
    }
    setLoading(false);
    if (!attemptedRecovery.current && callId && sessionToken) {
      attemptRecovery();
    } else {
      setError(true);
    }
  }, [callId, sessionToken, attemptRecovery, recovering, incomingUrl, activeUrl]);

  const handleMetadata = () => {
    setLoading(false);
    const position=resume.current,audio=audioRef.current;
    if(!position||!audio)return;
    resume.current=null;
    try{audio.currentTime=Number.isFinite(audio.duration)?Math.min(position.time,Math.max(0,audio.duration-0.1)):position.time;}catch{/* Some streams cannot seek until buffered. */}
    if(position.playing)void audio.play().catch(()=>{ /* Native Play remains available if browser activation is needed. */ });
  };

  const handleManualRetry = useCallback(() => {
    attemptedRecovery.current = false;
    setRecoveryFailed(false);
    setError(false);
    setRecoveredUrl(null);
    setLoading(true);
    attemptRecovery();
  }, [attemptRecovery]);

  if (!activeUrl && !callId) return null;

  if (!activeUrl && callId && sessionToken && !recoveryFailed && !error) {
    return (
      <div className="detail-section">
        <div className="detail-label">RECORDING</div>
        <div className="recording-loading">
          <RefreshCw size={14} className="search-spinner" />
          <span>Recovering audio...</span>
        </div>
      </div>
    );
  }

  if (error || (!activeUrl && recoveryFailed)) {
    return (
      <div className="detail-section">
        <div className="detail-label">RECORDING</div>
        <div className="recording-unavailable">
          <VolumeX size={14} />
          <span>{recoveryMessage || 'Recording not ready or unavailable. Retry after the call finishes.'}</span>
          {callId && sessionToken && (
            <button className="recording-retry-btn" onClick={handleManualRetry} disabled={recovering}>
              <RefreshCw size={12} className={recovering ? 'animate-spin' : ''} />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!activeUrl) return null;

  return (
    <div className="detail-section">
      <div className="detail-label">RECORDING</div>
      <div className="recording-player-wrap">
        {(loading || recovering) && (
          <div className="recording-loading">
            <Volume2 size={14} className="search-spinner" />
            <span>{recovering ? 'Recovering audio...' : 'Loading audio...'}</span>
          </div>
        )}
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          src={activeUrl}
          className="recording-audio"
          onLoadedMetadata={handleMetadata}
          onCanPlay={() => setLoading(false)}
          onError={handleAudioError}
          style={{ width: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}
