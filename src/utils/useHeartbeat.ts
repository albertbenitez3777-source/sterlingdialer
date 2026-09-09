import { useEffect, useRef } from 'react';
import { authFetch } from '@/utils/auth-fetch';
import type { PresenceState } from '@/utils/attendance';

export interface AttendanceInfo {
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
  onAttendance: (info: AttendanceInfo) => void;
  onError: (msg: string) => void;
  enabled: boolean;
  intervalMs?: number;
}

/** Keep presence fresh in background tabs; cancel old-account requests on change. */
export function useHeartbeat({providerUrl,sessionToken,onUnauthorized,onAttendance,onError,
  enabled,intervalMs=30_000}: UseHeartbeatOptions) {
  const callbacks=useRef({onUnauthorized,onAttendance,onError});
  callbacks.current={onUnauthorized,onAttendance,onError};
  useEffect(()=>{
    if (!enabled || !sessionToken) return;
    let active=true;
    let pending: AbortController | null=null;
    const send=async()=>{
      if (!active || pending) return;
      const controller=new AbortController();
      pending=controller;
      try {
        const result=await authFetch(providerUrl,{
          body:{action:'heartbeat',session_token:sessionToken},signal:controller.signal,
          onUnauthorized:()=>{if(active) callbacks.current.onUnauthorized();},
        });
        if(!active || controller.signal.aborted) return;
        const raw=(result.data as Record<string,unknown> | null)?.attendance as Record<string,unknown> | undefined;
        if(result.ok && raw?.valid) {
          callbacks.current.onAttendance({
            presence:(raw.presence as PresenceState)||'unknown',
            lastConfirmedAt:raw.last_confirmed_at as string|null,
            currentSessionSeconds:Number(raw.current_session_seconds)||0,
            todayTotalSeconds:Number(raw.today_total_seconds)||0,
            weekTotalSeconds:Number(raw.week_total_seconds)||0,
            isLegacyEstimate:raw.is_legacy_estimate===true,
            timezone:(raw.timezone as string)||'America/New_York',
            serverNow:(raw.server_now as string)||new Date().toISOString(),
          });
        } else if(!result.loggedOut) callbacks.current.onError(result.error||'Attendance sync unavailable');
      } finally { if(pending===controller) pending=null; }
    };
    const visible=()=>{if(document.visibilityState==='visible') void send();};
    void send();
    const timer=setInterval(send,intervalMs);
    document.addEventListener('visibilitychange',visible);
    window.addEventListener('online',send);
    window.addEventListener('focus',send);
    return()=>{
      active=false;
      pending?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange',visible);
      window.removeEventListener('online',send);
      window.removeEventListener('focus',send);
    };
  },[providerUrl,sessionToken,enabled,intervalMs]);
}
