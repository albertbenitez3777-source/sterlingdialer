import { AccessToken } from 'npm:livekit-server-sdk@2.19.0';
export function videoConfiguration() {
 const url=Deno.env.get('LIVEKIT_URL')||'';
 const missing=['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'].filter(k=>!Deno.env.get(k));
 return {configured:missing.length===0&&/^wss:\/\//.test(url),missing,url};
}
export async function createVideoGrant(agent:{id:string;full_name:string},room:string) {
 const config=videoConfiguration();
 if(!config.configured)return {data:{error:'Live video is not configured. Ask the owner to connect the video service.',code:'VIDEO_NOT_CONFIGURED'},status:503};
 const token=new AccessToken(Deno.env.get('LIVEKIT_API_KEY')!,Deno.env.get('LIVEKIT_API_SECRET')!,{identity:agent.id,name:agent.full_name,ttl:600});
 const project=new URL(Deno.env.get('SUPABASE_URL')!).hostname.split('.')[0];
 token.addGrant({roomJoin:true,room:`${project}-${room}`,canPublish:true,canSubscribe:true,canPublishData:false,canUpdateOwnMetadata:false});
 return {data:{url:config.url,token:await token.toJwt()},status:200};
}

