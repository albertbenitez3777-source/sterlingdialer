import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Phone, Play, RefreshCw } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';
import { formatPhone } from '@/utils/privacy';
export type PhoneHistoryCall = {pbx_call_id: string; direction: string; caller_number: string; called_number: string; started_at: string; ended_at?: string; answered_at?: string; voicemail_reached: boolean; disposition: string; recording_available: boolean; acknowledged_at?: string};
type AiCall = {id: string; consumer_name?: string; consumer_phone?: string; created_at: string; recording_available: boolean; ai_summary?: string};
export function usePhoneActivityCount(sessionToken: string, providerUrl: string) {
  const [count,setCount] = useState(0);
  useEffect(()=>{
    let alive=true;let running=false;
    async function refresh(){if(running||document.visibilityState==='hidden')return;running=true;try{const r=await authFetch<{calls:PhoneHistoryCall[]}>(providerUrl,{body:{action:'phone_activity',session_token:sessionToken},onUnauthorized:()=>{}});if(alive&&r.ok&&r.data)setCount(r.data.calls.filter(c=>c.direction==='inbound'&&c.ended_at&&!c.answered_at&&!c.acknowledged_at).length);}finally{running=false;}}
    void refresh();const timer=window.setInterval(()=>void refresh(),30000);const changed=()=>{void refresh();};
    window.addEventListener('f1-phone-activity-read',changed);document.addEventListener('visibilitychange',changed);
    return()=>{alive=false;window.clearInterval(timer);window.removeEventListener('f1-phone-activity-read',changed);document.removeEventListener('visibilitychange',changed);};
  },[sessionToken,providerUrl]);return count;
}
export function PhoneActivity({sessionToken,providerUrl,onUnauthorized,canCall,onCall}:{sessionToken:string;providerUrl:string;onUnauthorized:()=>void;canCall:boolean;onCall:(number:string)=>void}){
 const [calls,setCalls]=useState<PhoneHistoryCall[]>([]);const [aiCalls,setAiCalls]=useState<AiCall[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [audio,setAudio]=useState<{id:string;url:string}|null>(null);const [playing,setPlaying]=useState('');
 const auth=useRef(onUnauthorized);auth.current=onUnauthorized;
 const request=useCallback(<T,>(body:Record<string,unknown>)=>authFetch<T>(providerUrl,{body:{...body,session_token:sessionToken},onUnauthorized:()=>auth.current()}),[providerUrl,sessionToken]);
 const load=useCallback(async()=>{setBusy(true);const r=await request<{calls:PhoneHistoryCall[];ai_calls:AiCall[]}>({action:'phone_activity'});if(r.ok&&r.data){setCalls(r.data.calls);setAiCalls(r.data.ai_calls||[]);setError('');}else setError(r.error||'Could not load your calls.');setBusy(false);},[request]);
 useEffect(()=>{void load();const timer=window.setInterval(()=>{if(document.visibilityState!=='hidden')void load();},30000);return()=>window.clearInterval(timer);},[load]);
 async function play(id:string,kind:'native'|'ai'){setPlaying(id);setError('');const r=await request<{url:string}>({action:'phone_recording',id,kind});if(r.ok&&r.data)setAudio({id,url:r.data.url});else setError(r.error||'Recording unavailable.');setPlaying('');}
 async function read(id:string){const r=await request({action:'phone_activity_read',id});if(r.ok){setCalls(rows=>rows.map(c=>c.pbx_call_id===id?{...c,acknowledged_at:new Date().toISOString()}:c));window.dispatchEvent(new Event('f1-phone-activity-read'));}}
 const player=(id:string)=>audio?.id===id&&<audio controls autoPlay src={audio.url} onError={()=>{setAudio(null);setError('Audio could not play. Request a fresh link with Listen.');}}/>;
 return <div className="ip17-voicemail"><header><h3>Recent calls</h3><button disabled={busy} aria-label="Refresh recent calls" onClick={()=>void load()}><RefreshCw size={17}/></button></header><p className="ip17-vm-help">Calls to your Zadarma line are saved even when you are offline.</p>{error&&<p role="alert" className="ip17-error">{error}</p>}{!canCall&&(calls.length>0||aiCalls.length>0)&&<p className="ip17-activity-note">Enable your phone on Keypad to call back. Recordings play without connecting the phone.</p>}
 {!calls.length&&<p className="ip17-vm-empty">{busy?'Loading calls…':'No phone activity recorded yet.'}</p>}
 {calls.map(c=>{const missed=c.direction==='inbound'&&c.ended_at&&!c.answered_at;const number=c.direction==='outbound'?c.called_number:c.caller_number;return <article key={c.pbx_call_id} className={missed&&!c.acknowledged_at?'unheard':''}><div><strong>{number?formatPhone(number):'Unknown caller'}</strong><time>{new Date(c.started_at).toLocaleString()}</time><small>{c.voicemail_reached?'Reached voicemail':c.answered_at?'Answered':c.disposition === 'unconfirmed' ? 'Outcome syncing' : c.disposition} · {c.direction}</small></div>{c.voicemail_reached&&<p className="ip17-activity-note">A voicemail visit may end without a message. Received recordings appear in Voicemail.</p>}<div className="ip17-vm-actions">{c.recording_available&&<button disabled={playing===c.pbx_call_id} onClick={()=>void play(c.pbx_call_id,'native')}><Play size={13}/>Listen</button>}{missed&&!c.acknowledged_at&&<button onClick={()=>void read(c.pbx_call_id)}><Check size={13}/>Reviewed</button>}{number&&<button disabled={!canCall} aria-label={`Call back ${number}`} onClick={()=>onCall(number)}><Phone size={14}/></button>}</div>{player(c.pbx_call_id)}</article>;})}
 {aiCalls.length>0&&<header><h3 style={{fontSize:19}}>AI conversations</h3></header>}{aiCalls.map(c=><article key={c.id}><div><strong>{c.consumer_name||formatPhone(c.consumer_phone||'')}</strong><time>{new Date(c.created_at).toLocaleString()}</time><small>Elizabeth’s call before transfer</small></div>{c.ai_summary&&<p className="ip17-activity-note">{c.ai_summary}</p>}<div className="ip17-vm-actions">{c.recording_available&&<button disabled={playing===c.id} onClick={()=>void play(c.id,'ai')}><Play size={13}/>Listen</button>}{c.consumer_phone&&<button disabled={!canCall} aria-label={`Call back ${c.consumer_phone}`} onClick={()=>onCall(c.consumer_phone!)}><Phone size={14}/></button>}</div>{player(c.id)}</article>)}
 </div>;
}
