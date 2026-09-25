import { useEffect, useRef, useState } from 'react';
import { DIALER_CONTROLS_URL } from '@/app/shared';
import { authFetch } from '@/utils/auth-fetch';
type LiveStatus={as_of:string;campaign:{state:string;activated:boolean;lines:number;updated_at:string}|null;agents:{id:string;name:string;selected:boolean;last_seen_at:string|null;available:boolean}[]};
export function AdminLiveStatus({token,onUnauthorized}:{token:string;onUnauthorized:()=>void}) {
 const [data,setData]=useState<LiveStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[clock,setClock]=useState(Date.now());
 const auth=useRef(onUnauthorized);auth.current=onUnauthorized;
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),10000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{const controller=new AbortController();let pending=false;
 const load=async()=>{if(pending||controller.signal.aborted)return;pending=true;setBusy(true);try{const result=await authFetch<LiveStatus>(DIALER_CONTROLS_URL,{body:{action:'get_live_status',session_token:token},signal:controller.signal,timeoutMs:25000,onUnauthorized:()=>auth.current()});if(controller.signal.aborted)return;if(result.ok&&result.data?.as_of){setData(result.data);setError('');}else setError('Live status could not refresh. Previous values may be out of date.');}catch{if(!controller.signal.aborted)setError('Live status could not refresh.');}finally{pending=false;if(!controller.signal.aborted)setBusy(false);}};
 void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);return()=>{controller.abort();clearInterval(timer);};},[token,refresh]);
 const stale=!!error||!data||clock-new Date(data.as_of).getTime()>90000;
 return <section className="admin-quick-links" aria-label="Dialer and team live status"><header><h2>Dialer & team — right now</h2><button type="button" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>{busy?'Checking…':'Refresh status'}</button></header>{error&&<p role="alert">{error}</p>}
 <p role="status"><strong>{!data?'Checking dialer…':stale?'Dialer status needs a refresh':data.campaign?.state==='running'?'Dialer is ON':data.campaign?.state==='stopped'?'Dialer is OFF':`Dialer: ${data.campaign?.state||'unknown'}`}</strong>{data?.campaign&&` · ${data.campaign.lines} line limit`}</p>
 <div>{data?.agents.map(a=>{const recent=!!a.last_seen_at&&clock-new Date(a.last_seen_at).getTime()<90000;return <article key={a.id}><h3>{a.name}</h3><p>{stale?'Current activity unknown':recent?'🟢 App activity received':'⚪ No recent app activity'}</p><p>{a.selected?'Selected for dialer calls':'Not selected for dialer calls'}{stale?' — last recorded':''}</p><small>Last activity: {a.last_seen_at?new Date(a.last_seen_at).toLocaleTimeString('en-US',{timeZone:'America/Costa_Rica'}):'not reported'}</small></article>;})}</div>
 <p>Recent app activity is a login signal, not proof of phone audio or agent availability. No recent signal can mean a closed app, lost connection, or delayed reporting.</p><small>{data?`Updated ${new Date(data.as_of).toLocaleTimeString('en-US',{timeZone:'America/Costa_Rica'})} Costa Rica time`:'This panel loads independently of call reports.'}</small></section>;
}
