import { callbackParticipant } from './callback-agents';
import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Check, RefreshCw, Sparkles, ArrowUpRight, Headphones, Users } from 'lucide-react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { CALLBACK_WORKSPACE_URL } from '@/modules/callback-schedule/callback-api';
import { authFetch } from '@/utils/auth-fetch';
import { startSerialPoll } from '@/utils/serial-poll';
import { PhoneNumber } from '@/modules/phone/PhoneNumber';
import { RecordingPlayer } from '@/components/RecordingPlayer';
import './callback-schedule.css';

export const JAMES_CALLBACK_ID = 'c242abef-c01e-490b-bab6-859cd89bd08a';
export type ScheduledCallback = {source:'appointment'|'alert'|'call';id:string;agent_id:string;call_id:string|null;secretary_call_id:string|null;consumer_name:string;consumer_phone:string;callback_at:string;deadline_at:string|null;recording_url:string|null;transcript:string};
type HumanCall = {id:string;created_at:string;consumer_name:string;consumer_phone:string;recording_url:string|null;transcript:string;duration_seconds:number;call_direction:string;callback_scheduled:boolean};
type Schedule = {success:boolean;items:ScheduledCallback[];total:number;overdue:number;due_soon:number;checked_at:string;human_detected_today?:number;human_calls?:HumanCall[];today_stats?:{accepted_outbound:number;active_outbound:number;completed_outbound:number}};
type Props = {sessionToken:string;agentId:string;onUnauthorized:()=>void;compact?:boolean;ownerView?:boolean;onOpenAll?:()=>void;onSecretary?:()=>void;liveStats?:{today_total?:number;active_calls_now?:number;completed_today?:number}|null};
const fmt = (value:string) => new Intl.DateTimeFormat('en-US',{timeZone:'America/Costa_Rica',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
const clock = (value:string) => new Intl.DateTimeFormat('en-US',{timeZone:'America/Costa_Rica',hour:'numeric',minute:'2-digit'}).format(new Date(value));

function CallAudio({callId,url,source='calls',transcript,sessionToken,onUnauthorized}:{callId?:string;url:string|null;source?:'calls'|'secretary_calls';transcript:string;sessionToken:string;onUnauthorized:()=>void}) {
  const [listening,setListening]=useState(false);
  return <div className="f1-callback-media">
    {!listening && <button type="button" className="f1-listen-button" onClick={()=>setListening(true)} disabled={!callId&&!url}><Headphones size={18}/>{callId||url?'Listen to recording':'Recording pending'}</button>}
    {listening && <RecordingPlayer url={url} callId={callId} recordingSource={source} sessionToken={sessionToken} onUnauthorized={onUnauthorized}/>}
    <details><summary>Read transcript</summary><p className="f1-callback-transcript">{transcript||'Transcript not available yet.'}</p></details>
  </div>;
}
export function CallbackScheduleModule(props:Props) { return <ModuleBoundary name="Callback schedule"><CallbackSchedule key={`${props.agentId}:${props.sessionToken}`} {...props} /></ModuleBoundary>; }
export function CallbackSchedule({sessionToken,agentId,onUnauthorized,compact=false,ownerView=false,onOpenAll,onSecretary,liveStats}:Props) {
  const [data,setData]=useState<Schedule|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[page,setPage]=useState(0),[humanLimit,setHumanLimit]=useState(5),[callbackLimit,setCallbackLimit]=useState(compact?6:100);
  const refresh=useRef<()=>void>(()=>{}),unauthorized=useRef(onUnauthorized),alive=useRef(true),scheduleRef=useRef<HTMLDivElement>(null),humansRef=useRef<HTMLDivElement>(null);
  unauthorized.current=onUnauthorized;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    setData(null);setError('');
    const poll=startSerialPoll(async signal=>{
      const res=await authFetch<Schedule>(CALLBACK_WORKSPACE_URL,{body:{action:'get_callback_schedule',session_token:sessionToken,agent_id:agentId,offset:page*100},onUnauthorized:()=>unauthorized.current(),signal,timeoutMs:12000});
      if(signal.aborted)return;
      if(!res.ok||!res.data?.success){setError(res.error||'Schedule could not refresh. Please retry.');return false;}
      setData(res.data);setError('');return true;
    },15000,{paused:()=>document.hidden});
    refresh.current=poll.refresh;return poll.stop;
  },[sessionToken,agentId,page]);
  async function complete(item:ScheduledCallback) {
    setBusy(item.id);
    const res=await authFetch<{success:boolean}>(CALLBACK_WORKSPACE_URL,{body:{action:'complete_scheduled_callback',session_token:sessionToken,agent_id:agentId,source:item.source,id:item.id},onUnauthorized:()=>unauthorized.current()});
    if(!alive.current)return;
    setBusy('');
    if(!res.ok||!res.data?.success)setError(res.error||'Could not mark callback done. Please retry.');
    else{setError('');refresh.current();}
  }
  const agent=callbackParticipant(agentId);
  const items=(data?.items||[]).slice(0,callbackLimit),humanCalls=data?.human_calls||[];
  const stats=data?.today_stats;
  return <section className="f1-callback-schedule" aria-label={`${agent?.shortName||"Agent"} callbacks and human-detected calls`}>
    <header><div className="f1-callback-title"><CalendarClock size={28}/><div><span>{agent?.name.toUpperCase()||"AGENT"} · LIVE WORKLIST</span><h2>{ownerView?`${agent?.shortName||"Agent"}’s callbacks & conversations`:"Your callbacks & conversations"}</h2><p>Appointments and call recordings, right here. Times shown in Costa Rica.</p></div></div><button type="button" className="f1-callback-refresh" onClick={()=>refresh.current()} aria-label="Refresh callback schedule"><RefreshCw size={16}/> Refresh</button></header>
    <div className="f1-callback-counts">
      <button type="button" className="scheduled" onClick={()=>scheduleRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'})}><CalendarClock size={24}/><strong>{data?data.total:'—'}</strong><span>Scheduled callbacks</span><small>Still need a return call</small></button>
      <button type="button" className={data?.overdue?'late':''} onClick={()=>scheduleRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'})}><strong>{data?data.overdue:'—'}</strong><span>Ready to call now</span><small>{data?`${data.due_soon} more in the next 30 minutes`:'Checking the schedule…'}</small></button>
      <button type="button" className="humans" onClick={()=>humansRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'})}><Users size={24}/><strong>{data?.human_detected_today??'—'}</strong><span>Human-detected today</span><small>Review the recordings below</small></button>
    </div>
    <div className="f1-callback-live" aria-label="Today's dialer statistics"><span>TODAY’S {agent?.shortName.toUpperCase()||"AGENT"} CALLS</span><div><strong>{stats?.accepted_outbound??liveStats?.today_total??'—'}</strong> Dialer attempts</div><div><strong>{stats?.active_outbound??liveStats?.active_calls_now??'—'}</strong> Active now</div><div><strong>{stats?.completed_outbound??liveStats?.completed_today??'—'}</strong> Completed</div></div>
    {error&&<p role="alert" className="f1-callback-error">{error} {data?'Showing the last saved schedule.':''}</p>}
    <div ref={scheduleRef} className="f1-home-work-section"><div className="f1-work-heading"><h3><CalendarClock size={23}/> Scheduled callbacks</h3><span>Reference <b>516221</b></span></div><p className="f1-work-help">Call the earliest appointment first. Click a number to put it on the phone, then press Dial.</p>
      {!data&&!error&&<p role="status" className="f1-callback-empty">Loading appointments…</p>}
      {data&&!items.length&&<p className="f1-callback-empty">{page?'No more callbacks on this page.':'No scheduled callbacks waiting. Saved appointments appear here automatically.'}</p>}
      <div className="f1-callback-list">{items.map(item=>{const late=Date.parse(item.callback_at)<Date.now();return <article key={item.source+item.id} className={late?'late':''}>
        <div className="f1-callback-row"><div className="f1-callback-time"><b>{fmt(item.callback_at)}</b><span>{late?'CALL NOW':'Scheduled'}{item.deadline_at?` · By ${clock(item.deadline_at)}`:''}</span></div><div className="f1-callback-person"><strong>{item.consumer_name||'Callback contact'}</strong><PhoneNumber phone={item.consumer_phone}/></div><button type="button" className="f1-callback-done" disabled={!!busy} onClick={()=>void complete(item)}><Check size={15}/>{busy===item.id?'Saving…':'Mark done'}</button></div>
        <CallAudio callId={item.call_id||item.secretary_call_id||undefined} url={item.recording_url} source={item.secretary_call_id&&item.call_id===item.secretary_call_id?'secretary_calls':'calls'} transcript={item.transcript} sessionToken={sessionToken} onUnauthorized={onUnauthorized}/>
      </article>})}</div>
      {data&&items.length<data.items.length&&<button type="button" onClick={()=>setCallbackLimit(n=>n+10)}>Show more scheduled callbacks</button>}
      <p className="f1-work-help">Mark done only after the return call is finished.</p>
    </div>
    <div ref={humansRef} className="f1-home-work-section"><div className="f1-work-heading"><h3><Users size={23}/> Human-detected calls</h3><span>Today · newest first</span></div><p className="f1-work-help">Detected by the system; listen to confirm a real conversation. Opt-outs and wrong numbers are excluded. A detected person is not automatically a scheduled callback.</p>
      {data&&data.human_calls===undefined&&<p className="f1-callback-empty">Human-call details are loading. Refresh shortly.</p>}
      {data?.human_calls&&humanCalls.length===0&&<p className="f1-callback-empty">No human-detected conversations available today.</p>}
      <div className="f1-callback-list f1-human-list">{humanCalls.slice(0,humanLimit).map(call=><article key={call.id}><div className="f1-callback-row"><div className="f1-callback-person"><strong>{call.consumer_name||'Call contact'}</strong><PhoneNumber phone={call.consumer_phone}/></div><div className="f1-human-meta"><b>{clock(call.created_at)}</b><span>{call.call_direction==='inbound'?'Inbound callback':'Outbound call'} · {Math.max(0,call.duration_seconds||0)} sec</span><em>{call.callback_scheduled?'Callback scheduled':'No scheduled callback'}</em></div></div><CallAudio callId={call.id} url={call.recording_url} transcript={call.transcript} sessionToken={sessionToken} onUnauthorized={onUnauthorized}/></article>)}</div>
      {humanCalls.length>humanLimit&&<button type="button" onClick={()=>setHumanLimit(n=>n+10)}>Show more human-detected calls</button>}
      {data&&Number(data.human_detected_today)>50&&humanLimit>=50&&<p className="f1-work-help">Showing the latest 50. Earlier calls remain in Call History.</p>}
    </div>
    {onSecretary&&<button type="button" className="f1-callback-secretary" onClick={onSecretary}><Sparkles size={23}/><span><strong>Ask Elizabeth</strong><small>Open your secretary and her call history</small></span><ArrowUpRight size={21}/></button>}
    <footer><small>{data?`Updated ${new Intl.DateTimeFormat('en-US',{timeZone:'America/Costa_Rica',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(data.checked_at))} CR · refreshes automatically`:'Appointments refresh automatically.'}</small>{compact&&onOpenAll&&<button type="button" onClick={onOpenAll}>Full schedule →</button>}{data&&<div>{page>0&&<button type="button" onClick={()=>setPage(p=>p-1)}>Previous callbacks</button>}{(page+1)*100<data.total&&<button type="button" onClick={()=>setPage(p=>p+1)}>Next 100 callbacks</button>}</div>}</footer>
  </section>;
}
