import {useEffect,useRef,useState} from 'react';
import {Room,RoomEvent,Track,type Participant} from 'livekit-client';
import {authFetch} from '@/utils/auth-fetch';
type MediaTrack=Track;
function Media({track,local}:{track:MediaTrack;local:boolean}){
 const ref=useRef<HTMLMediaElement|null>(null);
 useEffect(()=>{const element=ref.current;if(!element)return;track.attach(element);if(local)element.muted=true;return()=>{track.detach(element);};},[track,local]);
 return track.kind===Track.Kind.Video?<video ref={e=>{ref.current=e;}} autoPlay playsInline muted={local}/>:!local?<audio ref={e=>{ref.current=e;}} autoPlay/>:null;
}
export default function LiveVideo({roomKey,title,sessionToken,onUnauthorized,onClose}:{roomKey:string;title:string;sessionToken:string;onUnauthorized:()=>void;onClose:()=>void}){
 const [ready,setReady]=useState(false);
 useEffect(()=>{let cancelled=false;void authFetch<{configured:boolean;missing?:string[]}>(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/federal-one-v2`,{onUnauthorized,body:{action:'whatsup_video_status',session_token:sessionToken,room:roomKey}}).then(r=>{if(cancelled)return;setReady(!!r.data?.configured);if(!r.ok||!r.data?.configured){setState('Video setup required');setError(r.error||(r.data?.missing?.length ? `Configure the video service: ${r.data.missing.join(', ')}`:'The owner needs to connect the video service.'));}});return()=>{cancelled=true;};},[sessionToken,roomKey]);
 const roomRef=useRef<Room|null>(null),epoch=useRef(0);const [state,setState]=useState('Ready to join'),[participants,setParticipants]=useState<Participant[]>([]),[error,setError]=useState(''),[connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[camera,setCamera]=useState(false),[mic,setMic]=useState(true),[sharing,setSharing]=useState(false),[audioBlocked,setAudioBlocked]=useState(false);
 const refresh=(room:Room)=>{if(roomRef.current!==room)return;setParticipants([room.localParticipant,...room.remoteParticipants.values()]);setCamera(room.localParticipant.isCameraEnabled);setMic(room.localParticipant.isMicrophoneEnabled);setSharing(room.localParticipant.isScreenShareEnabled);setAudioBlocked(!room.canPlaybackAudio);};
 useEffect(()=>()=>{epoch.current++;const room=roomRef.current;roomRef.current=null;void room?.disconnect(true);},[]);
 const leave=()=>{epoch.current++;const room=roomRef.current;roomRef.current=null;void room?.disconnect(true);onClose();};
 const join=async()=>{
  if(busy||connected||!ready)return;setBusy(true);setError('');setState('Connecting…');const attempt=++epoch.current;
  try{
   const r=await authFetch<{url:string;token:string}>(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/federal-one-v2`,{onUnauthorized,body:{action:'whatsup_video_join',session_token:sessionToken,room:roomKey}});
   if(epoch.current!==attempt)return;if(!r.ok||!r.data)throw new Error(r.error||'Could not join the call');
   const room=new Room({adaptiveStream:true,dynacast:true,videoCaptureDefaults:{resolution:{width:640,height:360,frameRate:24}}});roomRef.current=room;
   const update=()=>refresh(room);
   [RoomEvent.ParticipantConnected,RoomEvent.ParticipantDisconnected,RoomEvent.TrackSubscribed,RoomEvent.TrackUnsubscribed,RoomEvent.LocalTrackPublished,RoomEvent.LocalTrackUnpublished,RoomEvent.TrackMuted,RoomEvent.TrackUnmuted,RoomEvent.ActiveSpeakersChanged,RoomEvent.AudioPlaybackStatusChanged].forEach(event=>room.on(event,update));
   room.on(RoomEvent.Reconnecting,()=>{if(roomRef.current===room)setState('Reconnecting…');});
   room.on(RoomEvent.Reconnected,()=>{if(roomRef.current===room)setState('Connected');});
   room.on(RoomEvent.Disconnected,()=>{if(roomRef.current===room){setConnected(false);setParticipants([]);setState('Call ended');setBusy(false);}});
   await room.connect(r.data.url,r.data.token);if(epoch.current!==attempt){await room.disconnect(true);return;}
   setConnected(true);setState('Connected');
   try{await room.startAudio();await room.localParticipant.setMicrophoneEnabled(mic);if(epoch.current!==attempt){await room.disconnect(true);return;}await room.localParticipant.setCameraEnabled(camera);}catch{setError('Camera or microphone permission was denied. You can stay in the call and enable them when ready.');}
   if(epoch.current!==attempt){await room.disconnect(true);return;}refresh(room);
  }catch(e){if(epoch.current===attempt){await roomRef.current?.disconnect(true);roomRef.current=null;setState('Unable to connect');setError(e instanceof Error?e.message:'Connection failed');}}
  finally{if(epoch.current===attempt)setBusy(false);}
 };
 const control=async(kind:'mic'|'camera'|'screen')=>{const r=roomRef.current;if(!r||busy)return;setBusy(true);setError('');try{if(kind==='mic')await r.localParticipant.setMicrophoneEnabled(!r.localParticipant.isMicrophoneEnabled);else if(kind==='camera')await r.localParticipant.setCameraEnabled(!r.localParticipant.isCameraEnabled);else await r.localParticipant.setScreenShareEnabled(!r.localParticipant.isScreenShareEnabled);refresh(r);}catch{setError('Device access was denied or the device is unavailable. Check browser permissions.');}finally{setBusy(false);}};
 return <section className="whatsup-video" role="dialog" aria-modal="true" aria-label={`${title} live call`}><header><div><strong>{title}</strong><p role="status">{state} · {participants.length} participants</p></div><button onClick={leave}>Leave call</button></header>
 {!connected&&<div className="video-prejoin"><p>Choose what to share. Everyone in the call can see the participant list.</p><label><input type="checkbox" checked={camera} onChange={e=>setCamera(e.target.checked)} disabled={busy}/> Camera on when joining</label><label><input type="checkbox" checked={mic} onChange={e=>setMic(e.target.checked)} disabled={busy}/> Microphone on when joining</label><button onClick={()=>void join()} disabled={busy||!ready}>{busy?'Connecting…':'Join live call'}</button></div>}
 <div className="video-tiles">{participants.map(p=><article key={p.identity} className={p.isSpeaking?'speaking':''}><strong>{p.name||p.identity}{p===roomRef.current?.localParticipant?' (you)':''}</strong><span>{p.isMicrophoneEnabled?'Mic on':'Muted'}</span>{[...p.trackPublications.values()].filter(pub=>pub.track&&!pub.isMuted).map(pub=><Media key={pub.trackSid} track={pub.track!} local={p===roomRef.current?.localParticipant}/>)}{!p.isCameraEnabled&&<p>Camera off</p>}</article>)}</div>
 {error&&<p role="alert">{error}</p>}{connected&&<footer><button onClick={()=>void control('mic')} disabled={busy}>{mic?'Mute microphone':'Unmute microphone'}</button><button onClick={()=>void control('camera')} disabled={busy}>{camera?'Turn camera off':'Turn camera on'}</button><button onClick={()=>void control('screen')} disabled={busy}>{sharing?'Stop sharing':'Share screen'}</button>{audioBlocked&&<button onClick={()=>void roomRef.current?.startAudio().catch(()=>setError('Audio could not start. Check your output device.'))}>Enable sound</button>}</footer>}</section>;
}
