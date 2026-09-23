import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/utils/auth-fetch';

type Presence = {
  connection_state: 'idle' | 'connecting' | 'ready' | 'failed';
  call_state: 'idle' | 'dialing' | 'ringing-in' | 'answering' | 'active' | 'ending';
  microphone_granted: boolean;
  device_kind: 'desktop' | 'companion';
};

// Readiness reflects a registered desktop phone with microphone permission.
// Monotonic sequence numbers prevent delayed responses reviving stale status.
export function usePhonePresence(url: string, token: string, state: Presence, onUnauthorized: () => void) {
  const [instanceId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const latest = useRef(state); latest.current = state;
  const unauthorized = useRef(onUnauthorized); unauthorized.current = onUnauthorized;
  const mounted = useRef(false);
  const send = useCallback(async () => {
    const currentSequence = ++sequence.current;
    const result = await authFetch<{ ok: boolean }>(url, {
      body: { action: 'phone_presence_update', session_token: token, instance_id: instanceId, sequence: currentSequence, ...latest.current },
      timeoutMs: 10000, onUnauthorized: () => unauthorized.current(),
    });
    if (mounted.current && currentSequence === sequence.current) {
      setError(result.ok ? '' : 'Phone status could not sync. Reconnecting automatically…');
    }
  }, [url, token, instanceId]);

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => { void send(); }, 20000);
    const resume = () => { if (!document.hidden) void send(); };
    const offline = () => {
      void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ action: 'phone_presence_update', session_token: token, instance_id: instanceId,
          sequence: ++sequence.current, ...latest.current, connection_state: 'idle', call_state: 'idle', microphone_granted: false }),
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('pagehide', offline);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('pagehide', offline);
      offline();
    };
  }, [url, token, instanceId, send]);

  useEffect(() => { void send(); }, [send, state.connection_state, state.call_state, state.microphone_granted, state.device_kind]);
  return error;
}
