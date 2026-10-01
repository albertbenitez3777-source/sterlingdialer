import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,create,ReactTestRenderer} from 'react-test-renderer';
import {CallbackSchedule} from '../src/modules/callback-schedule/CallbackSchedule';
import {providerGatewayHeaders} from '../src/utils/provider-gateway';
import {providerFetch} from '../src/app/shared';
import {startSerialPoll} from '../src/utils/serial-poll';

vi.mock('@/components/RecordingPlayer',()=>({RecordingPlayer:()=> <div>Recording player</div>}));
vi.mock('@/modules/phone/PhoneNumber',()=>({PhoneNumber:()=> <button>Phone</button>}));
const endpoint='https://rqvpthnackbulnywwgix.supabase.co/functions/v1/wolf-provider';
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
const schedule=(total=1)=>({success:true,items:[],total,overdue:0,due_soon:total,checked_at:'2026-10-01T23:45:00Z',human_detected_today:7,human_calls:[],today_stats:{accepted_outbound:42,active_outbound:2,completed_outbound:40}});
let view:ReactTestRenderer|undefined;
let doc:EventTarget & {hidden:boolean};
beforeEach(()=>{vi.useFakeTimers();doc=Object.assign(new EventTarget(),{hidden:false});vi.stubGlobal('document',doc);vi.stubGlobal('window',new EventTarget());});
afterEach(()=>{act(()=>view?.unmount());view=undefined;vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('public gateway isolation',()=>{
 it('sends only a public anon JWT for this project and preserves other request headers',()=>{
  const headers=providerGatewayHeaders(endpoint,{'Content-Type':'application/json','X-Test':'preserved'});
  const key=headers.get('apikey')!;
  const claims=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  expect(claims.role).toBe('anon');expect(claims.ref).toBe('rqvpthnackbulnywwgix');
  expect(headers.get('Authorization')).toBe('Bearer '+key);
  expect(headers.get('X-Test')).toBe('preserved');
  expect(headers.get('Content-Type')).toBe('application/json');
 });
 it.each(['https://other.test/functions/v1/wolf-provider','https://rqvpthnackbulnywwgix.supabase.co.evil.test/functions/v1/wolf-provider','https://rqvpthnackbulnywwgix.supabase.co/functions/v1/federal-one-v2','https://rqvpthnackbulnywwgix.supabase.co/functions/v1/wolf-auth'])('does not alter unrelated or native-phone requests: %s',url=>{
  const headers=providerGatewayHeaders(url,{'Content-Type':'application/json'});
  expect(headers.has('Authorization')).toBe(false);expect(headers.has('apikey')).toBe(false);
 });
 it('preserves explicitly supplied authorization',()=>{
  const h=providerGatewayHeaders(endpoint,{Authorization:'Bearer synthetic-explicit'});
  expect(h.get('Authorization')).toBe('Bearer synthetic-explicit');
 });
 it('covers legacy providerFetch calls without replaying failed mutations',async()=>{
  const request=vi.fn(async (_url,init)=>{expect(new Headers(init.headers).has('Authorization')).toBe(true);return response({error:'busy'},503);});
  vi.stubGlobal('fetch',request);
  expect((await providerFetch(endpoint,{method:'POST',body:JSON.stringify({action:'synthetic'})})).status).toBe(503);
  expect(request).toHaveBeenCalledTimes(1);
 });
});

describe('real callback component request path',()=>{
 it.each([false,true])('loads and refreshes without an auth detour for ownerView=%s',async ownerView=>{
  let count=1;
  const request=vi.fn(async (url,init)=>{
   const body=JSON.parse(String(init.body));
   expect(body.action).toBe('get_callback_schedule');expect(body.agent_id).toBe('james');
   expect(body.session_token).toBe(ownerView?'synthetic-owner':'synthetic-james');
   const headers=new Headers(init.headers);
   if(!headers.has('Authorization'))return response({code:401,message:'Missing authorization header'},401);
   return response(schedule(count++));
  });
  vi.stubGlobal('fetch',request);
  await act(async()=>{view=create(<CallbackSchedule sessionToken={ownerView?'synthetic-owner':'synthetic-james'} agentId="james" ownerView={ownerView} onUnauthorized={()=>{throw Error('Unexpected logout');}}/>);});
  expect(JSON.stringify(view!.toJSON())).not.toContain('Loading appointments');
  expect(JSON.stringify(view!.toJSON())).toContain('42');expect(request).toHaveBeenCalledTimes(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(request).toHaveBeenCalledTimes(2);expect(JSON.stringify(view!.toJSON())).toContain('2 more in the next 30 minutes');
  request.mockResolvedValueOnce(response({error:'Temporarily unavailable'},503));
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(JSON.stringify(view!.toJSON())).toContain('last saved schedule');
  expect(JSON.stringify(view!.toJSON())).toContain('42');
 });
 it('refreshes immediately when a hidden tab becomes visible and removes its listeners on unmount',async()=>{
  doc.hidden=true;
  const request=vi.fn(async()=>response(schedule()));vi.stubGlobal('fetch',request);
  await act(async()=>{view=create(<CallbackSchedule sessionToken="synthetic" agentId="james" onUnauthorized={()=>{}}/>);});
  expect(request).not.toHaveBeenCalled();
  await act(async()=>{doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));});
  expect(request).toHaveBeenCalledTimes(1);
  act(()=>view!.unmount());view=undefined;
  doc.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));
  expect(request).toHaveBeenCalledTimes(1);
 });
 it('does not overlap requests when visibility and connection events arrive together',async()=>{
  let release!:(ok:boolean)=>void;
  const task=vi.fn(()=>new Promise<boolean>(resolve=>{release=resolve;}));
  const poll=startSerialPoll(task,15000,{paused:()=>doc.hidden});
  doc.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));
  expect(task).toHaveBeenCalledTimes(1);poll.stop();release(true);
  await vi.advanceTimersByTimeAsync(60000);expect(task).toHaveBeenCalledTimes(1);
 });
});
