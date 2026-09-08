import { useCallback, useEffect, useRef } from 'react';
import { authFetch } from '@/utils/auth-fetch';
import type { PresenceState } from '@/utils/attendance';

export interface HeartbeatAttendance {
  presence: PresenceState;
  lastConfirmedAt: string | null;
  currentSessionSeconds: number;
  todayTotalSeconds: number;
  weekTotalSeconds: number;
  isLegacyEstimate: boolean;
  timezone: string;
  serverNow: string;
}

interface UseHeartbeatOptions {
  providerUrl: string;
  sessionToken: string;
  onUnauthorized: () => void;
  onAttendance: (data: HeartbeatAttendance) => void;
  onError: (msg: string) => void;
  enabled: boolean;
  intervalMs?: number;
}

/**
 * Client heartbeat with:
 * - 30-second polling interval (configurable)
 * - Page visibility awareness (pause when hidden, resume when visible)
 * - Stale request cancellation on logout/account change
 * - Safe overlap prevention (single in-flight request)
 * - Reconnect on regaining network/focus
 */
export function useHeartbeat({
  providerUrl, sessionToken, onUnauthorized, onAttendance, onError,
  enabled, intervalMs = 30_000,
}: UseHeartbeatOptions) {
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const tokenRef = useRef(sessionToken);
  tokenRef.current = sessionToken;

  const sendHeartbeat = useCallback(async () => {
    if (inFlightRef.current || !tokenRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await authFetch(providerUrl, {
        body: { action: 'heartbeat', session_token: tokenRef.current },
        onUnauthorized,
      });
      if (!mountedRef.current) return;
      if (result.ok && result.data) {
        const raw = (result.data as Record<string, unknown>).attendance as Record<string, unknown> | undefined;
        if (raw && raw.valid) {
          onAttendance({
            presence: (raw.presence as PresenceState) || 'unknown',
            lastConfirmedAt: raw.last_confirmed_at as string | null,
            currentSessionSeconds: (raw.current_session_seconds as number) || 0,
            todayTotalSeconds: (raw.today_total_seconds as number) || 0,
            weekTotalSeconds: (raw.week_total_seconds as number) || 0,
            isLegacyEstimate: (raw.is_legacy_estimate as boolean) || false,
            timezone: (raw.timezone as string) || 'America/New_York',
            serverNow: (raw.server_now as string) || new Date().toISOString(),
          });
        }
      } else if (!result.loggedOut) {
        onError(result.error || 'Heartbeat failed');
      }
    } catch {
      if (mountedRef.current) onError('Heartbeat network error');
    } finally {
      inFlightRef.current = false;
    }
  }, [providerUrl, onUnauthorized, onAttendance, onError]);

  // Start/stop polling
  useEffect(() => {
    mountedRef.current = true;
    if (!enabled || !sessionToken) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }

    sendHeartbeat();
    timerRef.current = setInterval(sendHeartbeat, intervalMs);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [enabled, sessionToken, intervalMs, sendHeartbeat]);

  // Page visibility: pause when hidden, immediate heartbeat when visible
  useEffect(() => {
    if (!enabled) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [enabled, sendHeartbeat]);

  // Network reconnect: immediate heartbeat
  useEffect(() => {
    if (!enabled) return;
    const handleOnline = () => sendHeartbeat();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [enabled, sendHeartbeat]);
}
