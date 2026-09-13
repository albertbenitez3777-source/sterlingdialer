import { createVideoGrant, videoConfiguration } from './video.ts';
// All access uses the existing verified session. No public table reads.
export async function whatsUp(supabase: any, agent: {id:string;full_name:string;role:string}, body: Record<string,unknown>) {
 const action=String(body.action||'');
 if(!action.startsWith('whatsup_')) return null;
 const owner=['owner','administrator'].includes(agent.role);
 const respond=(data:unknown,status=200)=>({data,status});
 const allowed=async(room:string,write=false)=>{
  if(room==='team')return true;
  if(!/^[0-9a-f-]{36}$/.test(room))return false;
  const {data,error}=await supabase.from('federal_one_conversations').select('member_a,member_b').eq('id',room).maybeSingle();
  return !error&&!!data&&(data.member_a===agent.id||data.member_b===agent.id||(!write&&owner));
 };
 if(action==='whatsup_directory'){
  const {data:agents,error}=await supabase.from('agents').select('id,full_name,role').eq('status','active').order('full_name');
  let query=supabase.from('federal_one_conversations').select('*').order('created_at',{ascending:false});
  if(!owner)query=query.or(`member_a.eq.${agent.id},member_b.eq.${agent.id}`);
  const {data:rooms,error:roomError}=await query;
  return error||roomError?respond({error:'Chat directory unavailable'},503):respond({agents,rooms,can_review:owner});
 }
 if(action==='whatsup_open'){
  const peer=String(body.peer_id||'');
  if(!/^[0-9a-f-]{36}$/.test(peer)||peer===agent.id)return respond({error:'Choose another agent'},400);
  const {data}=await supabase.from('agents').select('id').eq('id',peer).eq('status','active').maybeSingle();
  if(!data)return respond({error:'Agent unavailable'},404);
  const [member_a,member_b]=[agent.id,peer].sort();
  const {data:room,error}=await supabase.from('federal_one_conversations').upsert({member_a,member_b},{onConflict:'member_a,member_b'}).select('id').single();
  return error?respond({error:'Conversation could not be opened'},500):respond({room:room.id});
 }
 const room=String(body.room||'team');
 if(!await allowed(room,(action==='whatsup_send'||action==='whatsup_video_join')))return respond({error:'Conversation access denied'},403);
 if(action==='whatsup_video_status'){const config=videoConfiguration();return respond({configured:config.configured,...(owner?{missing:config.missing}:{})});}
 if(action==='whatsup_video_join')return createVideoGrant(agent,room);
 if(action==='whatsup_latest'){
  const {data,error}=await supabase.from('federal_one_chat_messages').select('id').eq('room_key',room).order('created_at',{ascending:false}).limit(1);
  return error?respond({error:'Chat status unavailable'},503):respond({id:data?.[0]?.id||''});
 }
 if(action==='whatsup_history'){
  let query=supabase.from('federal_one_chat_messages').select('id,sender_agent_id,sender_name,body,image_data,created_at').eq('room_key',room).order('created_at',{ascending:!!body.after}).limit(50);
  if(body.after){const date=new Date(String(body.after));if(!Number.isFinite(date.getTime()))return respond({error:'Invalid history date'},400);query=query.gt('created_at',date.toISOString());}
  if(body.before){const date=new Date(String(body.before));if(!Number.isFinite(date.getTime()))return respond({error:'Invalid history date'},400);query=query.lt('created_at',date.toISOString());}
  const {data,error}=await query;
  return error?respond({error:'Messages could not be loaded'},503):respond({messages:body.after?(data||[]):(data||[]).reverse(),has_more:data?.length===50});
 }
 if(action==='whatsup_send'){
  const message=String(body.message||'').trim(); const image=body.image_data?String(body.image_data):null;
  if(message.length>2000||(!message&&!image))return respond({error:'Write a message or choose a photo'},400);
  if(image&&(image.length>400000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)))return respond({error:'Photo must be a small PNG, JPEG or WebP'},400);
  const {data,error}=await supabase.from('federal_one_chat_messages').insert({room_key:room,sender_agent_id:agent.id,sender_name:agent.full_name,message_kind:'agent',body:message||'Photo',image_data:image}).select('id').single();
  return error?respond({error:'Message was not sent. Try again.'},500):respond({id:data.id});
 }
 return respond({error:'Unknown chat action'},400);
}
