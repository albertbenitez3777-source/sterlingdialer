import { useState, useRef, useCallback, useEffect } from 'react';
import { Volume2, VolumeX, RefreshCw } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? '';
const PROVIDER_URL = `${SUPABASE_URL}/functions/v1/wolf-provider`;

interface RecordingPlayerProps {
  url: string | null | undefined;
  callId?: string;
  sessionToken?: string;
  onUnauthorized?: () => void;
}

export function RecordingPlayer({ url, callId, sessionToken, onUnauthorized }: RecordingPlayerProps) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [recoveredUrl, setRecoveredUrl] = useState<string | null>(null);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const attemptedRecovery = useRef(false);

  const activeUrl = recoveredUrl || url;

  const attemptRecovery = useCallback(async () => {
    if (attemptedRecovery.current || !callId || !sessionToken || recovering) return;
    attemptedRecovery.current = true;
    setRecovering(true);
    setError(false);
    setLoading(true);

    try {
      const result = await authFetch<{ recording_url: string }>(PROVIDER_URL, {
        onUnauthorized: onUnauthorized || (() => {}),
        body: { action: 'recover_recording', session_token: sessionToken, call_id: callId },
      });

      if (result.ok && result.data?.recording_url) {
        setRecoveredUrl(result.data.recording_url + '?t=' + Date.now());
      } else {
        setRecoveryFailed(true);
        setError(true);
        setLoading(false);
      }
    } catch {
      setRecoveryFailed(true);
      setError(true);
      setLoading(false);
    } finally {
      setRecovering(false);
    }
  }, [callId, sessionToken, recovering, onUnauthorized]);

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
          <span>Recording unavailable</span>
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
          controls
          src={activeUrl}
          className="recording-audio"
          onLoadedData={() => setLoading(false)}
          onError={handleAudioError}
          style={{ width: '100%', display: loading || recovering ? 'none' : 'block' }}
        />
      </div>
    </div>
  );
}
