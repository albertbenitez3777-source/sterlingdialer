import { useState, useRef, useCallback, useEffect } from 'react';
import { Volume2, VolumeX, RefreshCw } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? '';
const PROVIDER_URL = `${SUPABASE_URL}/functions/v1/wolf-provider`;

interface RecordingPlayerProps {
  url: string | null | undefined;
  callId?: string;
  recordingSource?: 'calls' | 'secretary_calls';
  sessionToken?: string;
  onUnauthorized?: () => void;
}

export function RecordingPlayer({ url, callId, recordingSource = 'calls', sessionToken, onUnauthorized }: RecordingPlayerProps) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [recoveredUrl, setRecoveredUrl] = useState<string | null>(null);
  const [recoveredKey, setRecoveredKey] = useState<string | null>(null);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const attemptedRecovery = useRef(false);
  const recoveryRequest = useRef<AbortController | null>(null);
  const sourceKey = `${recordingSource}:${callId || ''}:${sessionToken || ''}:${url || ''}`;
  const activeKey = useRef<string | null>(sourceKey);
  activeKey.current = sourceKey;

  // Provider URLs require a server credential; the browser uses a short-lived
  // playback grant instead. Never send provider keys to the client.
  const directUrl = /^https:\/\/api\.bland\.ai(?:\/|$)/i.test(url || '') ? null : url;
  const activeUrl = (recoveredKey === sourceKey ? recoveredUrl : null) || directUrl;

  useEffect(() => {
    activeKey.current = sourceKey;
    attemptedRecovery.current = false;
    setRecoveredUrl(null);
    setRecoveredKey(null);
    setRecoveryFailed(false);
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
        body: { action: 'recover_recording', session_token: sessionToken, call_id: callId, recording_source: recordingSource },
      });
      if (controller.signal.aborted || activeKey.current !== sourceKey) return;

      if (result.ok && result.data?.recording_url) {
        setRecoveredKey(sourceKey);
        setRecoveredUrl(result.data.recording_url);
      } else {
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
    setLoading(false);
    if (!attemptedRecovery.current && callId && sessionToken) {
      attemptRecovery();
    } else {
      setError(true);
    }
  }, [callId, sessionToken, attemptRecovery]);

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
          <span>Recording not ready or unavailable. Retry after the call finishes.</span>
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
          key={activeUrl}
          controls
          preload="metadata"
          src={activeUrl}
          className="recording-audio"
          onLoadedMetadata={() => setLoading(false)}
          onCanPlay={() => setLoading(false)}
          onError={handleAudioError}
          style={{ width: '100%', display: loading || recovering ? 'none' : 'block' }}
        />
      </div>
    </div>
  );
}
