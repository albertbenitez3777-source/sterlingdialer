import {useEffect,useRef,useState} from 'react';
import {CalendarDays,Headphones,PhoneCall,Play,RefreshCw,Square} from 'lucide-react';
import {ModuleBoundary} from '@/app/ModuleBoundary';
import {PROVIDER_URL} from '@/app/shared';
import {authFetch} from '@/utils/auth-fetch';
import {startSerialPoll} from '@/utils/serial-poll';
import {RecordingPlayer} from '@/components/RecordingPlayer';
import {PhoneNumber} from '@/modules/phone/PhoneNumber';
import './callback-control.css';

type Item={id:string;source_call_id:string;source_at:string;consumer_name:string;phone:string;state:string;blocked_reason:string;result_code:string;appointment_saved:boolean;attempt_call_id:string|null;duration_seconds:number;transcript:string};
export type CallbackControlData={success:boolean;day:string;today:string;week_start:string;checked_at:string;main_running:boolean;other_active:number;
 counts:{detected:number;ready:number;waiting:number;excluded:number;active:number;called:number;scheduled:number;needs_review:number};
 run:null|{id:string;state:string;work_day:string;lines:number;reason:string;last_tick_at:string|null;created_at:string};
 items:Item[];history:{week_start:string;contacts:number;called:number}[]};
type Props={sessionToken:string;onUnauthorized:()=>void};
const reasons:Record<string,string>={do_not_call_or_wrong_number:'Do not call / wrong number',declined_contact:'Declined further contact',machine_outcome:'Machine result',callback_already_scheduled:'Appointment already scheduled',call_in_progress:'Another call is in progress',wait_30_minutes:'Waiting between attempts',retry_limit:'Retry limit reached',contact_frequency_limit:'Contact limit reached',outside_calling_window:'Waiting for local calling hours',not_confirmed_complete:'Waiting for final call details'};
const time=(s:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Costa_Rica',hour:'numeric',minute:'2-digit'}).format(new Date(s));
function ContactRow({item,sessionToken,onUnauthorized}:{item:Item}&Props){
 const [listen,setListen]=useState(false);
 const label=item.appointment_saved?'Appointment saved':item.blocked_reason?(reasons[item.blocked_reason]||'Needs review'):({ready:'Ready to call',reserved:'Connecting',dialing:'Calling now',completed:'Call finished',rejected:'Provider rejected this attempt',unknown:'Provider result needs review'}[item.state]||item.state);
 return <article className="f1-cc-contact"><div className="f1-cc-contact-top"><div><strong>{item.consumer_name||'Call contact'}</strong><PhoneNumber phone={item.phone}/></div><div><b className={item.appointment_saved?'booked':''}>{label}</b><small>Detected {time(item.source_at)} · {item.duration_seconds||0} sec</small></div></div>
 <div className="f1-cc-contact-actions"><button type="button" onClick={()=>setListen(v=>!v)}><Headphones size={16}/>{listen?'Hide recording':'Listen to original call'}</button><details><summary>Read transcript</summary><p>{item.transcript||'Transcript not available yet.'}</p></details></div>
 {listen&&<RecordingPlayer callId={item.source_call_id} url={null} sessionToken={sessionToken} onUnauthorized={onUnauthorized}/>}</article>;
}
export function CallbackControlModule(props:Props){return <ModuleBoundary name="Callback Control"><CallbackControl key={props.sessionToken} {...props}/></ModuleBoundary>;}
export function CallbackControl({sessionToken,onUnauthorized}:Props){
 const [data,setData]=useState<CallbackControlData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[lines,setLines]=useState(3),[day,setDay]=useState(''),[page,setPage]=useState(0),[showContacts,setShowContacts]=useState(false);
 const refresh=useRef(()=>{}),unauthorized=useRef(onUnauthorized),alive=useRef(true),busyRef=useRef(false);
 unauthorized.current=onUnauthorized;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false};},[]);
 useEffect(()=>{
  setData(null);setError('');
  const poll=startSerialPoll(async signal=>{
   const res=await authFetch<CallbackControlData>(PROVIDER_URL,{body:{action:'callback_control_status',session_token:sessionToken,day:day||undefined,offset:page*25},onUnauthorized:()=>unauthorized.current(),timeoutMs:15000,signal});
   if(signal.aborted||!alive.current)return;
   if(!res.ok||!res.data?.success){setError(res.error||'Callback list could not refresh. Please retry.');return false;}
   setData(res.data);setError('');
   if(res.data.run?.state==='running'&&!busyRef.current)setLines(res.data.run.lines);
   return true;
  },15000,{paused:()=>document.hidden});refresh.current=poll.refresh;return poll.stop;
 },[sessionToken,day,page]);
 const running=data?.run?.state==='running';
 const stale=!data||!!error||Date.now()-Date.parse(data.checked_at)>45000;
 const history=!!data&&data.day!==data.today;
 async function command(action:'start'|'stop'|'speed',speed=lines){
  if(busyRef.current)return;
  if(action==='start'&&(stale||history||data?.main_running||data?.other_active||running))return;
  busyRef.current=true;setBusy(action);
  try{
   const res=await authFetch<{success:boolean}>(PROVIDER_URL,{body:{action:`callback_control_${action}`,session_token:sessionToken,lines:speed,day:data?.day},onUnauthorized:()=>unauthorized.current(),timeoutMs:20000});
   if(!alive.current)return;
   if(!res.ok||!res.data?.success)setError(res.error||'Could not update Callback Control. Refresh and try again.');
   else{setError('');setLines(speed);refresh.current();}
  }finally{busyRef.current=false;if(alive.current)setBusy('');}
 }
 const cannotStart=stale||history||!!running||!!busy||!!data?.main_running||!!data?.other_active||!!data?.counts.needs_review||!(data&&data.counts.ready+data.counts.waiting>0);
 return <section className="f1-callback-control" aria-label="Callback Control">
 <header><div className="f1-cc-title"><PhoneCall size={26}/><div><span>JAMES SPENCER · FOLLOW-UP CALLS</span><h2>Callback Control</h2><p>Call today’s human-detected contacts again to arrange an appointment.</p></div></div><span className={`f1-cc-status ${running?'running':''}`}>{running?'CALLING CALLBACKS':data?.run?.state==='attention'?'NEEDS REVIEW':'STOPPED'}</span></header>
 <div className="f1-cc-counts"><div><strong>{data?.counts.detected??'—'}</strong><span>Human-detected contacts</span></div><div className="ready"><strong>{data?.counts.ready??'—'}</strong><span>Ready to call</span></div><div><strong>{data?.counts.active??'—'}</strong><span>Calling now</span></div><div><strong>{data?.counts.called??'—'}</strong><span>Attempts finished</span></div><div className="booked"><strong>{data?.counts.scheduled??'—'}</strong><span>Appointments saved</span></div></div>
 <div className="f1-cc-controls"><div className="f1-cc-speed"><label htmlFor="callback-lines">Callback speed</label><div><select id="callback-lines" value={lines} disabled={!!busy||history} onChange={e=>{const next=Number(e.target.value);if(running)void command('speed',next);else setLines(next);}}>{[1,2,3,4,5,6,8,9,10,12,15,16,20,25].map(n=><option key={n} value={n}>{n} {n===1?'line':'lines'}</option>)}</select><span>Up to {lines} calls at once</span></div></div>
 <div className="f1-cc-buttons"><button type="button" className="start" disabled={cannotStart} onClick={()=>void command('start')}><Play size={19}/>{busy==='start'?'Starting…':'Start callbacks'}</button><button type="button" className="stop" disabled={!running||!!busy} onClick={()=>void command('stop')}><Square size={18}/>{busy==='stop'?'Stopping…':'Stop callbacks'}</button><button type="button" onClick={()=>refresh.current()} aria-label="Refresh Callback Control"><RefreshCw size={18}/></button></div></div>
 {data?.main_running?<p className="f1-cc-message">The main dialer is running. Stop it above, then let its active calls finish before starting callbacks.</p>:data?.other_active?<p className="f1-cc-message">Waiting for {data.other_active} existing outbound calls to finish.</p>:null}
 {data?.run?.reason&&<p role="status" className="f1-cc-message">{data.run.reason}</p>}
 {error&&<p role="alert" className="f1-cc-error">{error} {data?'Showing the last saved list.':''}</p>}
 <p className="f1-cc-help">{data?`${data.counts.waiting} waiting · ${data.counts.excluded} excluded · `:''}One follow-up per contact each week. Saved appointments, opt-outs, wrong numbers and contact limits are respected. Stop prevents new calls; calls already connecting may finish.</p>
 <details className="f1-cc-script"><summary>What Elizabeth says on a callback</summary><p>After confirming the right person and giving the required disclosure:</p><blockquote>“I’m following up for Mr. James Spencer at Federal One. He would like to review the PCH account and explain the paperwork with you today.”</blockquote><p>After checking availability:</p><blockquote>“I can reserve a callback in five to thirty minutes. Will you be able to answer at this number?”</blockquote><p>After the appointment is saved, she confirms the agreed window, asks them to keep their phone nearby and gives reference 516221. No live transfer.</p></details>
 <footer><div><CalendarDays size={17}/><label htmlFor="callback-day">Saved list</label><input id="callback-day" type="date" value={day||data?.day||''} max={data?.today} onChange={e=>{setDay(e.target.value);setPage(0);}}/><button type="button" onClick={()=>{setDay('');setPage(0);}}>Today</button></div><button type="button" onClick={()=>setShowContacts(v=>!v)}>{showContacts?'Hide contacts':'View contacts & recordings'}</button></footer>
 {history&&<p className="f1-cc-help">History view only. Select Today to start callbacks.</p>}
 {showContacts&&<div className="f1-cc-list">{!data?<p>Loading saved contacts…</p>:data.items.length===0?<p>No human-detected contacts saved for this date.</p>:data.items.map(item=><ContactRow key={item.id} item={item} sessionToken={sessionToken} onUnauthorized={onUnauthorized}/>)}<div className="f1-cc-pagination">{page>0&&<button onClick={()=>setPage(n=>n-1)}>Previous 25</button>}{data&&(page+1)*25<data.counts.detected&&<button onClick={()=>setPage(n=>n+1)}>Next 25</button>}</div></div>}
 <details className="f1-cc-history"><summary>Weekly history · new list every Sunday</summary><p>Sunday starts a fresh weekly list in Costa Rica time. Earlier calls and recordings stay saved.</p>{data?.history.map(week=><p key={week.week_start}><strong>Week of {week.week_start}</strong> · {week.contacts} contacts · {week.called} attempts finished</p>)}</details>
 <small className="f1-cc-updated">{data?`Updated ${time(data.checked_at)} CR · refreshes automatically`:'Loading Callback Control…'} · Speed is a maximum, subject to eligible contacts and provider limits.</small>
 </section>;
}
