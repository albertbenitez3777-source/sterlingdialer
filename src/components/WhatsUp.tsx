import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X, ImagePlus, ChevronDown, Video } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';
import './WhatsUp.css';
const LiveVideo=lazy(()=>import('./LiveVideo'));
type Person={id:string;full_name:string;role:string};
type Room={id:string;member_a:string;member_b:string};
type Message={id:string;sender_agent_id:string;sender_name:string;body:string;image_data?:string;created_at:string};
export function WhatsUp({sessionToken,agentId,onUnauthorized}:{sessionToken:string;agentId:string;onUnauthorized:()=>void}) {
 const [video,setVideo]=useState<{room:string;title:string}|null>(null);
 const [open,setOpen]=useState(true),[room,setRoom]=useState('team'),[people,setPeople]=useState<Person[]>([]),[rooms,setRooms]=useState<Room[]>([]),[review,setReview]=useState(false);
 const [messages,setMessages]=useState<Message[]>([]),[draft,setDraft]=useState(''),[photo,setPhoto]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[more,setMore]=useState(false),[unread,setUnread]=useState(false);
 const log=useRef<HTMLDivElement>(null); const pinned=useRef(true);
 useEffect(()=>{if(pinned.current&&log.current)log.current.scrollTop=log.current.scrollHeight;},[messages]);
 const current=useRef(room); current.current=room;
 const expired=useRef(onUnauthorized);expired.current=onUnauthorized;
 const lastTeam=useRef('');const teamSeen=useRef(false);const file=useRef<HTMLInputElement>(null);
 const api=useCallback(async<T,>(action:string,body:Record<string,unknown>={})=>authFetch<T>(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/federal-one-v2`,{onUnauthorized:()=>expired.current(),body:{action,session_token:sessionToken,...body}}),[sessionToken]);
 const directory=useCallback(async()=>{const r=await api<{agents:Person[];rooms:Room[];can_review:boolean}>('whatsup_directory');if(r.ok&&r.data){setPeople(r.data.agents);setRooms(r.data.rooms);setReview(r.data.can_review);}else setError(r.error||'Chat unavailable');},[api]);
 useEffect(()=>{let stop=false;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{await directory();if(!stop)timer=setTimeout(poll,30000);};void poll();return()=>{stop=true;clearTimeout(timer);};},[directory]);
 useEffect(()=>{
  let stopped=false;let after:string|undefined;let timer:ReturnType<typeof setTimeout>;
  pinned.current=true;setMessages([]);setError('');setDraft('');setPhoto(null);
  const poll=async()=>{
   const r=await api<{messages:Message[];has_more:boolean}>('whatsup_history',{room,after});
   if(stopped)return;
   if(r.ok&&r.data){setMessages(old=>{const map=new Map(old.map(m=>[m.id,m]));r.data!.messages.forEach(m=>map.set(m.id,m));return [...map.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at));});if(!after)setMore(r.data.has_more);after=r.data.messages.slice(-1)[0]?.created_at||after;setError('');}else setError(r.error||'Chat unavailable');
   if(room!=='team'||!open){const t=await api<{id:string}>('whatsup_latest',{room:'team'});if(stopped)return;const latest=t.data?.id||'';if(teamSeen.current&&latest!==lastTeam.current)setUnread(true);lastTeam.current=latest;teamSeen.current=true;}
   else {teamSeen.current=true;lastTeam.current=r.data?.messages.slice(-1)[0]?.id||lastTeam.current;setUnread(false);}
   timer=setTimeout(poll,4000);
  };void poll();return()=>{stopped=true;clearTimeout(timer);};
 },[api,room,open]);
 const roomInfo=rooms.find(r=>r.id===room);const observer=!!roomInfo&&roomInfo.member_a!==agentId&&roomInfo.member_b!==agentId;
 const name=(id:string)=>people.find(p=>p.id===id)?.full_name||'Former agent';
 const title=room==='team'?'Team chat':roomInfo?`${name(roomInfo.member_a)} · ${name(roomInfo.member_b)}`:'Direct chat';
 const choose=async(id:string)=>{setBusy(true);const r=await api<{room:string}>('whatsup_open',{peer_id:id});if(r.ok&&r.data){await directory();setRoom(r.data.room);}else setError(r.error||'Could not open chat');setBusy(false);};
 const send=async()=>{if(busy||(!draft.trim()&&!photo))return;setBusy(true);const selected=room;const r=await api('whatsup_send',{room,message:draft,image_data:photo});if(current.current===selected){if(r.ok){setDraft('');setPhoto(null);const h=await api<{messages:Message[]}>('whatsup_history',{room});if(h.ok&&h.data&&current.current===selected)setMessages(h.data.messages);}else setError(r.error||'Not sent');}setBusy(false);};
 const loadOlder=async()=>{if(!messages.length)return;setBusy(true);const selected=room;const r=await api<{messages:Message[];has_more:boolean}>('whatsup_history',{room,before:messages[0].created_at});if(current.current===selected&&r.ok&&r.data){setMessages(old=>[...r.data!.messages,...old]);setMore(r.data.has_more);}setBusy(false);};
 const selectPhoto=async(f?:File)=>{if(!f)return;if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10_000_000){setError('Choose a PNG, JPEG or WebP smaller than 10 MB.');return;}setBusy(true);try{const bitmap=await createImageBitmap(f);const scale=Math.min(1,800/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const data=canvas.toDataURL('image/jpeg',0.72);if(data.length>400000)throw new Error('Photo is too detailed; choose a smaller image.');setPhoto(data);setError('');}catch(e){setError(e instanceof Error?e.message:'Photo could not be read');}finally{setBusy(false);if(file.current)file.current.value='';}};
 return <aside className={`whatsup ${open?'expanded':''}`} aria-label="WhatsUp team communication">
  <button className="whatsup-bar" onClick={()=>setOpen(!open)} aria-expanded={open}><MessageCircle size={19}/><strong>WhatsUp</strong><span>{unread?'New team message':title}</span><ChevronDown size={16}/></button>
  {open&&<><div className="whatsup-tabs"><button onClick={()=>setRoom('team')} className={room==='team'?'selected':''}>Team {unread?'●':''}</button><select aria-label="Message an agent" value="" disabled={busy} onChange={e=>void choose(e.target.value)}><option value="">Message an agent…</option>{people.filter(p=>p.id!==agentId).map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
  {review&&<select className="whatsup-review" aria-label="Owner conversation review" value={room==='team'?'':room} onChange={e=>setRoom(e.target.value||'team')}><option value="">Owner: review a conversation…</option>{rooms.map(r=><option key={r.id} value={r.id}>{name(r.member_a)} / {name(r.member_b)}</option>)}</select>}
  <p className="whatsup-notice">Team messages are shared. Direct chats are visible to their participants and the owner/admin. History is retained.</p>
  <div ref={log} onScroll={()=>{const e=log.current;if(e)pinned.current=e.scrollHeight-e.scrollTop-e.clientHeight<50;}} className="whatsup-messages" role="log" aria-label={title} aria-live="polite">{more&&<button onClick={()=>void loadOlder()} disabled={busy}>Load earlier messages</button>}{messages.length===0&&!error&&<p>No messages yet.</p>}{messages.map(m=><article key={m.id} className={m.sender_agent_id===agentId?'mine':''}><header><strong>{m.sender_name}</strong><time>{new Date(m.created_at).toLocaleString()}</time></header>{m.image_data&&<img src={m.image_data} alt={`Photo shared by ${m.sender_name}`} loading="lazy"/>}<p>{m.body}</p></article>)}</div>
  {error&&<p className="whatsup-error" role="alert">{error}</p>}{observer?<p className="whatsup-notice">Owner review · read only</p>:<><div className="whatsup-compose">{photo&&<div><img src={photo} alt="Photo ready to send"/><button onClick={()=>setPhoto(null)} aria-label="Remove photo"><X size={14}/></button></div>}<textarea aria-label="Chat message" placeholder={room==='team'?'Message the team…':'Direct message…'} value={draft} onChange={e=>setDraft(e.target.value)} maxLength={2000}/><input hidden ref={file} type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void selectPhoto(e.target.files?.[0])}/><button disabled={busy} onClick={()=>file.current?.click()} aria-label="Attach a photo"><ImagePlus size={18}/></button><button disabled={busy||(!draft.trim()&&!photo)} onClick={()=>void send()} aria-label="Send chat message"><Send size={18}/></button></div></>}
  <div className="whatsup-call"><button disabled={observer||!!video} onClick={()=>setVideo({room,title})}><Video size={15}/> Live call</button><span>Join with camera and microphone controls.</span></div></>}
 {video&&<Suspense fallback={<p>Loading video controls…</p>}><LiveVideo roomKey={video.room} title={video.title} sessionToken={sessionToken} onUnauthorized={onUnauthorized} onClose={()=>setVideo(null)}/></Suspense>}
 </aside>;
}
