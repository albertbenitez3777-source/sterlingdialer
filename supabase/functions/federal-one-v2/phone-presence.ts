
const roles = ['owner','administrator','supervisor'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function phonePresence(db: any, agent: {id:string;role:string}, body: Record<string,unknown>) {
 const reply=(data:unknown,status=200)=>({data,status});
 if(body.action==='phone_presence_update') {
  if(['owner','administrator'].includes(agent.role)) return reply({error:'Agent phone required'},403);
  const connection=String(body.connection_state||'');
  const call=String(body.call_state||'');
  const kind=String(body.device_kind||'');
  if(!uuid.test(String(body.instance_id||'')) || !['idle','connecting','ready','failed'].includes(connection) ||
    !['idle','dialing','ringing-in','answering','active','ending'].includes(call) ||
    !['desktop','companion'].includes(kind) || typeof body.microphone_granted!=='boolean' ||
    !Number.isSafeInteger(body.sequence) || Number(body.sequence)<0) return reply({error:'Invalid phone status'},400);
  const {data:session,error:sessionError}=await db.from('auth_sessions').select('id')
   .eq('session_token',body.session_token).eq('agent_id',agent.id).is('invalidated_at',null)
   .gt('expires_at',new Date().toISOString()).maybeSingle();
  if(sessionError) return reply({error:'Phone status could not be saved'},503);
  if(!session) return reply({error:'Invalid or expired session'},401);
  const {data,error}=await db.rpc('record_phone_presence',{
   p_agent_id:agent.id,p_instance_id:body.instance_id,p_session_id:session.id,
   p_connection_state:connection,p_call_state:call,p_microphone_granted:body.microphone_granted,
   p_device_kind:kind,p_sequence:body.sequence
  });
  return error?reply({error:'Phone status could not be saved'},503):reply({ok:true,accepted:data});
 }
 if(body.action!=='phone_presence_list') return reply({error:'Unknown phone status action'},400);
 if(!roles.includes(agent.role)) return reply({error:'Supervisor access required'},403);
 const {data:agents,error}=await db.from('agents').select('id,full_name').eq('status','active').eq('is_owner',false).order('full_name');
 if(error) return reply({error:'Phone status unavailable'},503);
 const checked_at=new Date().toISOString();
 const rows=[];
 for(const a of agents||[]) {
  const {data:ready,error:readError}=await db.rpc('agent_phone_ready',{p_agent_id:a.id});
  if(readError) return reply({error:'Phone status unavailable'},503);
  rows.push({...a,ready:ready===true,status:ready===true?'ready':'not_ready'});
 }
 return reply({agents:rows,checked_at,requires_desktop_heartbeat:true});
}

