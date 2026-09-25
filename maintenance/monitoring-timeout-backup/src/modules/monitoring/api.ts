import { useEffect } from 'react';
import { SUPABASE_URL } from '@/app/shared';
export const canMonitor = (owner: boolean, agent?: { id: string; role?: string } | null) => owner || (agent?.id === 'c242abef-c01e-490b-bab6-859cd89bd08a' && agent.role === 'supervisor');
export const costaRicaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
export async function monitoringRequest(token: string, body: Record<string, unknown>, signal?: AbortSignal) {
 const controller=new AbortController();
 const abort=()=>controller.abort();
 if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
 const timeout=window.setTimeout(abort,12000);
 try {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/federal-one-monitoring`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...body,session_token:token}), signal:controller.signal });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Monitoring unavailable');
  return data;
 } finally {window.clearTimeout(timeout);signal?.removeEventListener('abort',abort);}

}
export function useMonitoringAttendance(token: string, enabled: boolean) {
 useEffect(() => {
  if (!enabled || !token) return;
  const controller = new AbortController(); let pending = false;
  const heartbeat = async () => { if(pending) return; pending=true; try { await monitoringRequest(token, {action:'heartbeat'}, controller.signal); } catch { /* Monitoring failure never affects phone or login. */ } finally { pending=false; } };
  void heartbeat(); const timer = window.setInterval(heartbeat, 30000);
  return () => { controller.abort(); window.clearInterval(timer); };
 }, [token, enabled]);
}
