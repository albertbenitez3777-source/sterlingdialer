import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
type Dependencies = { db: any; env: (name: string) => string | undefined; fetcher?: typeof fetch; now?: () => number };
const PURPOSE = 'zadarma-diagnostics.';
const EXTENSIONS = ['100', '101', '102'];
const ROUTES: Record<string,string> = {'12027739590':'100','12029824430':'101','12029495811':'102'};
const DISPOSITIONS = new Set(['answered','busy','cancel','cancelled','no answer','call failed','failed','no money','unallocated number','no limit','no day limit','line limit','no money, no limit']);
const reply = (status:number,data:unknown) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const number = (v:unknown) => Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null;
const bool = (v:unknown) => v===true || v==='true' || v===1 || v==='1';
const digits = (v:unknown) => String(v??'').replace(/\D/g,'');
const date = (v:unknown) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v)) ? String(v) : null;
function providerDate(v:number){return new Date(v-6*3600000).toISOString().slice(0,19).replace('T',' ');}
async function boundedBody(req:Request){
  if(Number(req.headers.get('content-length')||0)>2048)throw new Error('BODY_TOO_LARGE');
  const reader=req.body?.getReader();if(!reader)return '';
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>2048){await reader.cancel();throw new Error('BODY_TOO_LARGE');}chunks.push(p.value);}
  const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return new TextDecoder().decode(out);
}
export function summarizeStats(rows:any[]){
  const groups=new Map<string,any>();
  for(const r of rows){
    const extension=ROUTES[digits(r.from)]||'other';
    const rawDisposition=String(r.disposition??'');
    const disposition=DISPOSITIONS.has(rawDisposition)?rawDisposition:(/^[a-z][a-z _,]{0,63}$/i.test(rawDisposition)?rawDisposition:'unknown');
    const key=extension+':'+disposition;
    const g=groups.get(key)||{extension,disposition,attempts:0,connected_seconds:0,first_at:null,last_at:null};
    g.attempts++;g.connected_seconds+=number(r.billseconds)||0;
    const t=date(r.callstart);if(t){if(!g.first_at||t<g.first_at)g.first_at=t;if(!g.last_at||t>g.last_at)g.last_at=t;}
    groups.set(key,g);
  }
  return [...groups.values()];
}
export function makeHandler({db,env,fetcher=fetch,now=Date.now}:Dependencies){
  return async(req:Request)=>{
    if(req.method!=='POST')return reply(405,{ok:false,code:'METHOD_NOT_ALLOWED'});
    const timestamp=req.headers.get('x-diagnostics-timestamp')||'',signature=req.headers.get('x-diagnostics-signature')||'';
    if(!/^\d{10}$/.test(timestamp)||!/^[a-f0-9]{64}$/.test(signature)||Math.abs(now()/1000-Number(timestamp))>300)return reply(401,{ok:false,code:'UNAUTHORIZED'});
    try{
      const raw=await boundedBody(req);
      const settings=await db.from('system_config').select('key,value').in('key',['dialer_scheduler_secret']);
      if(settings.error)return reply(503,{ok:false,code:'SETTINGS_UNAVAILABLE'});
      const scheduler=settings.data?.find((r:any)=>r.key==='dialer_scheduler_secret')?.value;
      if(typeof scheduler!=='string'||scheduler.length<32)return reply(503,{ok:false,code:'AUTH_UNAVAILABLE'});
      const expected=createHmac('sha256',scheduler).update(PURPOSE+timestamp+'.'+raw).digest('hex');
      if(!timingSafeEqual(new TextEncoder().encode(expected),new TextEncoder().encode(signature)))return reply(401,{ok:false,code:'UNAUTHORIZED'});
      let body:any;try{body=JSON.parse(raw);}catch{return reply(400,{ok:false,code:'INVALID_JSON'});}
      const start=Date.parse(body.start),end=Date.parse(body.end);
      if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end-start>86400000||end>now()+60000||start<now()-7*86400000||Object.keys(body).some(k=>!['start','end'].includes(k)))return reply(400,{ok:false,code:'INVALID_WINDOW'});
      // Use only the existing working server environment; never return credentials.
      const key=env('ZADARMA_API_KEY'),secret=env('ZADARMA_API_SECRET');
      if(!key||!secret)return reply(503,{ok:false,code:'PROVIDER_AUTH_UNAVAILABLE'});
      async function read(path:string,params:Record<string,string>={}){
        const query=new URLSearchParams(Object.entries(params).sort(([a],[b])=>a.localeCompare(b))).toString();
        const digest=createHash('md5').update(query).digest('hex');
        const signed=btoa(createHmac('sha1',secret!).update(path+query+digest).digest('hex'));
        const r=await fetcher('https://api.zadarma.com'+path+(query?'?'+query:''),{method:'GET',headers:{Authorization:key+':'+signed},signal:AbortSignal.timeout(12000)});
        if(!r.ok)throw new Error('PROVIDER_HTTP_'+r.status);
        const data=await r.json();if(data.status!=='success')throw new Error('PROVIDER_REJECTED_REQUEST');return data;
      }
      async function check(name:string,fn:()=>Promise<any>){try{return {check:name,ok:true,data:await fn()};}catch(e){const code=e instanceof Error&&/^PROVIDER_(HTTP_\d{3}|REJECTED_REQUEST)$/.test(e.message)?e.message:'PROVIDER_UNAVAILABLE';return {check:name,ok:false,code};}}
      const results=[];
      results.push(await check('account',async()=>{const r=await read('/v1/info/balance/');return {balance:number(r.balance),currency:/^[A-Z]{3}$/.test(r.currency)?r.currency:null};}));
      results.push(await check('sip_capacity',async()=>{const r=await read('/v1/sip/');return {sips:(Array.isArray(r.sips)?r.sips:[]).map((s:any)=>({id:/^\d{4,8}$/.test(String(s.id))?String(s.id):null,lines:number(s.lines)}))};}));
      results.push(await check('webphone_domain',async()=>{const r=await read('/v1/webrtc/');return {exists:bool(r.is_exists),production_authorized:Array.isArray(r.domains)&&r.domains.includes('wolf-of-wall-street-ssy3.bolt.host')};}));
      for(const ext of EXTENSIONS){
        results.push(await check('extension_'+ext,async()=>{const [r,s]=await Promise.all([read('/v1/pbx/internal/'+ext+'/info/'),read('/v1/pbx/internal/'+ext+'/status/')]);return {extension:ext,lines:number(r.lines),expected_caller_id:ROUTES[digits(r.caller_id)]===ext,caller_id_by_direction:bool(r.caller_id_by_direction),ip_restriction_set:![undefined,null,false,'false','',0,'0'].includes(r.ip_restriction),online:bool(s.is_online)};}));
      }
      results.push(await check('external_call_outcomes',async()=>{
        const tz=await read('/v1/info/timezone/');if(!/^UTC-0?6(?::00)?$/.test(String(tz.timezone)))throw new Error('PROVIDER_UNAVAILABLE');
        const rows:any[]=[];let complete=false;
        for(let page=0;page<3;page++){const r=await read('/v1/statistics/',{start:providerDate(start),end:providerDate(end),skip:String(page*1000),limit:'1000'});if(!Array.isArray(r.stats))throw new Error('PROVIDER_UNAVAILABLE');rows.push(...r.stats);if(r.stats.length<1000){complete=true;break;}}
        return {complete,rows:rows.length,timezone:'America/Costa_Rica',groups:summarizeStats(rows)};
      }));
      return reply(200,{ok:results.every(r=>r.ok),checked_at:new Date(now()).toISOString(),results});
    }catch(e){return reply(e instanceof Error&&e.message==='BODY_TOO_LARGE'?413:503,{ok:false,code:e instanceof Error&&e.message==='BODY_TOO_LARGE'?'BODY_TOO_LARGE':'DIAGNOSTICS_UNAVAILABLE'});}
  };
}
