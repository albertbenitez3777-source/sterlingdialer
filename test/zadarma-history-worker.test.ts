import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { makeHandler, providerDate } from '../supabase/functions/zadarma-history/handler';

const now = Date.parse('2026-09-29T04:30:00Z');
const scheduler = 'test-only-scheduler-secret-with-sufficient-length';
const body = { start: '2026-09-28T06:00:00Z', end: '2026-09-29T04:00:00Z' };
function request(value: unknown=body, purpose='zadarma-history.', stamp=Math.floor(now/1000)) {
  const raw=JSON.stringify(value); const timestamp=String(stamp);
  return new Request('https://local.test/history',{method:'POST',body:raw,headers:{
    'x-history-timestamp':timestamp,
    'x-history-signature':createHmac('sha256',scheduler).update(purpose+timestamp+'.'+raw).digest('hex')
  }});
}
function setup(responses: any[] = [{status:'success',timezone:'UTC-6'},{status:'success',stats:[]}]) {
  const writes:any[]=[]; const reads:string[][]=[];
  const rpc=vi.fn(async()=>({data:{ok:true,calls_checked:0},error:null}));
  const db={rpc,from:()=>({select:()=>({in:async(_key:string,keys:string[])=>{
    reads.push(keys);return {data:[{key:'dialer_scheduler_secret',value:scheduler}],error:null};
  }}),upsert:async(rows:any)=>{writes.push(rows);return {error:null};}})};
  const fetcher=vi.fn(async()=>{const item=responses.shift();return item instanceof Response?item:new Response(JSON.stringify(item),{status:200});}) as unknown as typeof fetch;
  const handler=makeHandler({db,fetcher,now:()=>now,env:name=>({ZADARMA_API_KEY:'test-env-key',ZADARMA_API_SECRET:'test-env-secret'}[name])});
  return {handler,rpc,fetcher,writes,reads};
}
describe('isolated Zadarma history worker',()=>{
  it('rejects missing authorization before reading settings',async()=>{
    const s=setup();expect((await s.handler(new Request('https://local.test',{method:'POST',body:'{}'}))).status).toBe(401);
    expect(s.reads).toHaveLength(0);expect(s.fetcher).not.toHaveBeenCalled();
  });
  it('rejects signatures issued for the dialer instead of history',async()=>{
    const s=setup();expect((await s.handler(request(body,''))).status).toBe(401);expect(s.fetcher).not.toHaveBeenCalled();
  });
  it('rejects expired signatures',async()=>{
    const s=setup();expect((await s.handler(request(body,'zadarma-history.',Math.floor(now/1000)-301))).status).toBe(401);
    expect(s.reads).toHaveLength(0);
  });
  it('rejects oversized bodies',async()=>{
    const s=setup();expect((await s.handler(request({extra:'x'.repeat(5000)}))).status).toBe(413);expect(s.fetcher).not.toHaveBeenCalled();
  });
  it('uses the working server credential path without reading fallback credentials',async()=>{
    const s=setup();const r=await s.handler(request());expect(r.status).toBe(200);
    expect(s.reads).toEqual([['dialer_scheduler_secret']]);
    expect((s.fetcher as any).mock.calls[0][1].headers.Authorization).toMatch(/^test-env-key:/);
    expect(s.rpc).toHaveBeenCalledWith('apply_verified_zadarma_call_history',{p_stats:[],p_start:'2026-09-28T06:00:00.000Z',p_end:'2026-09-29T04:00:00.000Z'});
  });
  it('uses Costa Rica provider date boundaries',()=>{
    expect(providerDate(Date.parse('2026-09-28T06:00:00Z'))).toBe('2026-09-28 00:00:00');
  });
  it('supports an authenticated provider probe without importing data',async()=>{
    const s=setup();const r=await s.handler(request({...body,dry_run:true}));
    expect(await r.json()).toMatchObject({ok:true,dry_run:true,provider_rows:0});expect(s.rpc).not.toHaveBeenCalled();expect(s.writes).toHaveLength(0);
  });
  it('does not guess a provider timezone',async()=>{
    const s=setup([{status:'success',timezone:'UTC+0'}]);const r=await s.handler(request());expect(r.status).toBe(409);expect(s.rpc).not.toHaveBeenCalled();
  });
  it('records a sanitized authorization failure without retrying or importing',async()=>{
    const s=setup([new Response('private response contents',{status:401})]);const r=await s.handler(request());
    expect(await r.json()).toEqual({ok:false,code:'PROVIDER_HTTP_401'});expect(s.fetcher).toHaveBeenCalledTimes(1);expect(s.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(s.writes)).not.toContain('private response contents');
  });
  it('does not treat truncated pagination as complete',async()=>{
    const page={status:'success',stats:Array.from({length:1000},()=>({pbx_call_id:'test'}))};
    const s=setup([{status:'success',timezone:'UTC-6'},page,page,page]);const r=await s.handler(request());
    expect(await r.json()).toEqual({ok:false,code:'HISTORY_WINDOW_TOO_LARGE'});expect(s.rpc).not.toHaveBeenCalled();expect(s.fetcher).toHaveBeenCalledTimes(4);
  });
  it('rejects invalid or overly broad date windows',async()=>{
    const s=setup();const r=await s.handler(request({...body,start:'2026-09-25T00:00:00Z'}));expect(r.status).toBe(400);expect(s.fetcher).not.toHaveBeenCalled();
  });
  it('does not claim success when the database import fails',async()=>{
    const s=setup();s.rpc.mockResolvedValueOnce({data:null,error:{message:'private database details'}} as any);
    const r=await s.handler(request());expect(await r.json()).toEqual({ok:false,code:'HISTORY_APPLY_FAILED'});expect(r.status).toBe(503);
  });
});
