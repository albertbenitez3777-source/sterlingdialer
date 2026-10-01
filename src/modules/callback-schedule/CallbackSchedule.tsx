import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Check, ChevronDown, RefreshCw, Sparkles, ArrowUpRight } from 'lucide-react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { PROVIDER_URL } from '@/app/shared';
import { authFetch } from '@/utils/auth-fetch';
import { startSerialPoll } from '@/utils/serial-poll';
import { PhoneNumber } from '@/modules/phone/PhoneNumber';
import { RecordingPlayer } from '@/components/RecordingPlayer';
import './callback-schedule.css';

export const JAMES_CALLBACK_ID = 'c242abef-c01e-490b-bab6-859cd89bd08a';
export type ScheduledCallback = {source:'appointment'|'alert'|'call';id:string;agent_id:string;call_id:string|null;secretary_call_id:string|null;consumer_name:string;consumer_phone:string;callback_at:string;deadline_at:string|null;recording_url:string|null;transcript:string};
type Schedule = {success:boolean;items:ScheduledCallback[];total:number;overdue:number;due_soon:number;checked_at:string};
type Props = {sessionToken:string;agentId:string;onUnauthorized:()=>void;compact?:boolean;onOpenAll?:()=>void;onSecretary?:()=>void;liveStats?:{today_total?:number;active_calls_now?:number;completed_today?:number}|null};
const fmt = (value:string) => new Intl.DateTimeFormat('en-US',{timeZone:'America/Costa_Rica',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
export function CallbackScheduleModule(props:Props) { return <ModuleBoundary name="Callback schedule"><CallbackSchedule key={`${props.agentId}:${props.sessionToken}`} {...props} /></ModuleBoundary>; }
export function CallbackSchedule({sessionToken,agentId,onUnauthorized,compact=false,onOpenAll,onSecretary,liveStats}:Props) {
  const [data,setData]=useState<Schedule|null>(null), [error,setError]=useState(''), [expanded,setExpanded]=useState(''),[busy,setBusy]=useState(''),[page,setPage]=useState(0);
  const refresh=useRef<()=>void>(()=>{}), unauthorized=useRef(onUnauthorized), alive=useRef(true);
  unauthorized.current=onUnauthorized;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    setData(null);setError('');
    const poll=startSerialPoll(async signal=>{
      const res=await authFetch<Schedule>(PROVIDER_URL,{body:{action:'get_callback_schedule',session_token:sessionToken,agent_id:agentId,offset:page*100},onUnauthorized:()=>unauthorized.current(),signal,timeoutMs:12000});
      if(signal.aborted)return;
      if(!res.ok || !res.data?.success){setError(res.error||'Schedule could not refresh. Please retry.');return false;}
      setData(res.data);setError('');return true;
    },15000,{paused:()=>document.hidden});
    refresh.current=poll.refresh;return poll.stop;
  },[sessionToken,agentId,page]);
  async function complete(item:ScheduledCallback) {
    setBusy(item.id);
    const res=await authFetch<{success:boolean}>(PROVIDER_URL,{body:{action:'complete_scheduled_callback',session_token:sessionToken,agent_id:agentId,source:item.source,id:item.id},onUnauthorized:()=>unauthorized.current()});
    if(!alive.current)return;
    setBusy('');
    if(!res.ok||!res.data?.success)setError(res.error||'Could not mark callback done. Please retry.');
    else{setError('');setExpanded('');refresh.current();}
  }
  const items=compact?(data?.items||[]).slice(0,6):data?.items||[];
  return <section className="f1-callback-schedule" aria-label="Callback schedule">
    <header><div className="f1-callback-title"><CalendarClock size={25}/><div><span>JAMES SPENCER</span><h2>Your callback schedule</h2><p>Call the earliest appointment first. Times shown in Costa Rica. Callback reference: <b>516221</b>.</p></div></div><button type="button" className="f1-callback-refresh" onClick={()=>refresh.current()} aria-label="Refresh callback schedule"><RefreshCw size={16}/> Refresh</button></header>
    <div className="f1-callback-counts"><div className={data?.overdue?'late':''}><strong>{data?data.overdue:'—'}</strong><span>Overdue — call first</span></div><div><strong>{data?data.due_soon:'—'}</strong><span>Next 30 minutes</span></div><div><strong>{data?data.total:'—'}</strong><span>Callbacks to make</span></div></div>
    {liveStats !== undefined && <div className="f1-callback-live" aria-label="Today's dialer statistics"><span>TODAY'S CALLS</span><div><strong>{liveStats?.today_total??'—'}</strong> Dialer attempts</div><div><strong>{liveStats?.active_calls_now??'—'}</strong> Active now</div><div><strong>{liveStats?.completed_today??'—'}</strong> Completed</div></div>}
    {onSecretary && <button type="button" className="f1-callback-secretary" onClick={onSecretary}><Sparkles size={23}/><span><strong>Ask Elizabeth</strong><small>Open your secretary and her call history</small></span><ArrowUpRight size={21}/></button>}
    {error && <p role="alert" className="f1-callback-error">{error} {data?'Showing the last saved schedule.':''}</p>}
    {!data&&!error&&<p role="status" className="f1-callback-empty">Loading your appointments…</p>}
    {data&&!items.length&&<p className="f1-callback-empty">{page?'No more callbacks on this page.':'No scheduled callbacks yet. Confirmed appointments will appear here.'}</p>}
    <div className="f1-callback-list">{items.map(item=>{const open=expanded===item.source+item.id;const late=Date.parse(item.callback_at)<Date.now();return <article key={item.source+item.id} className={late?'late':''}>
      <div className="f1-callback-row"><div className="f1-callback-time"><b>{fmt(item.callback_at)}</b><span>{late?'Due now':'Scheduled'}{item.deadline_at?` · Latest ${new Intl.DateTimeFormat('en-US',{timeZone:'America/Costa_Rica',hour:'numeric',minute:'2-digit'}).format(new Date(item.deadline_at))}`:''}</span></div><div className="f1-callback-person"><strong>{item.consumer_name||'Callback contact'}</strong><PhoneNumber phone={item.consumer_phone}/></div><button type="button" className="f1-callback-details" aria-expanded={open} onClick={()=>setExpanded(open?'':item.source+item.id)}><ChevronDown size={15}/>{open?'Close':'Audio & details'}</button><button type="button" className="f1-callback-done" disabled={!!busy} onClick={()=>void complete(item)}><Check size={15}/>{busy===item.id?'Saving…':'Mark done'}</button></div>
      {open&&<div className="f1-callback-expanded"><p>Click the number to put it on your phone, then press Dial. Mark done only after you finish the callback.</p>{(item.call_id||item.secretary_call_id||item.recording_url)?<RecordingPlayer url={item.recording_url} callId={item.call_id||item.secretary_call_id||undefined} recordingSource={item.secretary_call_id&&item.call_id===item.secretary_call_id?'secretary_calls':'calls'} sessionToken={sessionToken} onUnauthorized={onUnauthorized}/>:<p>The original call is still being saved. Its recording will appear when available.</p>}<details><summary>Conversation transcript</summary><p className="f1-callback-transcript">{item.transcript||'Transcript not available yet.'}</p></details></div>}
    </article>})}</div>
    <footer><small>{data?`Updated ${new Intl.DateTimeFormat('en-US',{timeZone:'America/Costa_Rica',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(data.checked_at))} CR`:'Appointments refresh automatically.'}</small>{compact&&onOpenAll&&<button type="button" onClick={onOpenAll}>Open full schedule →</button>}{!compact&&data&&<div>{page>0&&<button type="button" onClick={()=>setPage(p=>p-1)}>Previous</button>}{(page+1)*100<data.total&&<button type="button" onClick={()=>setPage(p=>p+1)}>Next 100</button>}</div>}</footer>
  </section>;
}
