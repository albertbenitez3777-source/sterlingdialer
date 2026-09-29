import {describe,it,expect,vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {makeHandler,summarizeStats} from '../supabase/functions/zadarma-diagnostics/handler';
const now=Date.parse('2026-09-29T20:30:00Z'),secret='test-only-long-diagnostics-scheduler-secret';
const body={start:'2026-09-29T18:00:00Z',end:'2026-09-29T20:00:00Z'};
function req(value:any=body,purpose='zadarma-diagnostics.',stamp=Math.floor(now/1000)){
 const raw=JSON.stringify(value);return new Request('https://local.test',{method:'POST',body:raw,headers:{'x-diagnostics-timestamp':String(stamp),'x-diagnostics-signature':createHmac('sha256',secret).update(purpose+stamp+'.'+raw).digest('hex')}});
}
function setup(){
 const read=vi.fn(async()=>({data:[{key:'dialer_scheduler_secret',value:secret}],error:null}));
 const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify({status:'success',balance:44,currency:'USD',sips:[],is_exists:true,domains:['wolf-of-wall-street-ssy3.bolt.host'],lines:3,is_online:true,caller_id:'+12029824430',ip_restriction:'private-ip',timezone:'UTC-6',stats:[{from:'12029824430',to:'private-destination',callstart:'2026-09-29 13:20:00',disposition:'no day limit',billseconds:0}],private:'never-output'})));
 return {read,fetcher,handler:makeHandler({db:{from:()=>({select:()=>({in:read})})},env:n=>n==='ZADARMA_API_KEY'?'test-key':n==='ZADARMA_API_SECRET'?'test-secret':undefined,fetcher:fetcher as any,now:()=>now})};
}
describe('private read-only outbound diagnostics',()=>{
 it('rejects missing authentication before any settings or provider reads',async()=>{const s=setup();expect((await s.handler(new Request('https://local.test',{method:'POST'}))).status).toBe(401);expect(s.read).not.toHaveBeenCalled();expect(s.fetcher).not.toHaveBeenCalled();});
 it('rejects a history-purpose signature',async()=>{const s=setup();expect((await s.handler(req(body,'zadarma-history.'))).status).toBe(401);expect(s.fetcher).not.toHaveBeenCalled();});
 it('rejects stale signatures',async()=>{const s=setup();expect((await s.handler(req(body,undefined,Math.floor(now/1000)-301))).status).toBe(401);expect(s.read).not.toHaveBeenCalled();});
 it('rejects unknown options and excessively broad windows',async()=>{for(const value of [{...body,path:'/v1/request/callback/'},{...body,start:'2026-09-20T00:00:00Z'}]){const s=setup();expect((await s.handler(req(value))).status).toBe(400);expect(s.fetcher).not.toHaveBeenCalled();}});
 it('rejects oversized request bodies',async()=>{const s=setup();expect((await s.handler(req({extra:'x'.repeat(3000)}))).status).toBe(413);expect(s.fetcher).not.toHaveBeenCalled();});
 it('only issues allowlisted GET requests and returns no secrets, customer numbers or private settings',async()=>{const s=setup();const r=await s.handler(req());expect(r.status).toBe(200);const result=await r.json();expect(result.ok).toBe(true);const output=JSON.stringify(result);for(const hidden of ['test-key','test-secret',secret,'private-destination','private-ip','never-output'])expect(output).not.toContain(hidden);for(const [url,opts] of s.fetcher.mock.calls as any){expect(opts.method).toBe('GET');expect(url).not.toMatch(/callback|password|get_key|create|edit/);}expect(output).toContain('no day limit');});
 it('does not expose error response content',async()=>{const s=setup();s.fetcher.mockImplementation(async()=>new Response('private-auth-details',{status:403}));const out=await (await s.handler(req())).json();expect(out.ok).toBe(false);expect(JSON.stringify(out)).toContain('PROVIDER_HTTP_403');expect(JSON.stringify(out)).not.toContain('private-auth-details');});
 it('keeps carrier failures separate from answered calls and unknown values',()=>{expect(summarizeStats([{from:'12029824430',disposition:'answered',billseconds:21},{from:'12029824430',disposition:'cancel',billseconds:0},{from:'unknown',disposition:'private-data'}])).toMatchObject([{extension:'101',disposition:'answered',attempts:1,connected_seconds:21},{extension:'101',disposition:'cancel',attempts:1,connected_seconds:0},{extension:'other',disposition:'unknown'}]);});
});
