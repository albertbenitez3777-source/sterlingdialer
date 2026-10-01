import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,create,ReactTestRenderer} from 'react-test-renderer';
import {CallbackSchedule} from '../src/modules/callback-schedule/CallbackSchedule';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),refresh:vi.fn(),task:null as null|((s:AbortSignal)=>Promise<unknown>)}));
vi.mock('@/utils/auth-fetch',()=>({authFetch:mocks.fetch}));
vi.mock('@/utils/serial-poll',()=>({startSerialPoll:(task:(s:AbortSignal)=>Promise<unknown>)=>{mocks.task=task;return {refresh:mocks.refresh,stop:vi.fn()};}}));
vi.mock('@/components/RecordingPlayer',()=>({RecordingPlayer:()=> <div>Private recording player</div>}));
vi.mock('@/modules/phone/PhoneNumber',()=>({PhoneNumber:({phone}:{phone:string})=><button>{phone}</button>}));
const data={success:true,items:[{source:'appointment',id:'fixture',agent_id:'james',call_id:'call',secretary_call_id:null,consumer_name:'Sample Contact',consumer_phone:'+12025550123',callback_at:'2026-10-01T20:15:00Z',deadline_at:'2026-10-01T20:30:00Z',recording_url:null,transcript:'Synthetic transcript'}],total:1,overdue:0,due_soon:1,checked_at:'2026-10-01T20:10:00Z'};
let view:ReactTestRenderer|undefined;
afterEach(()=>{act(()=>view?.unmount());view=undefined;vi.clearAllMocks();});
async function mount(){await act(async()=>{view=create(<CallbackSchedule sessionToken="synthetic" agentId="james" onUnauthorized={()=>{throw Error('Unexpected logout');}}/>);});}
async function refresh(){await act(async()=>{await mocks.task?.(new AbortController().signal);});}
describe('callback schedule isolation',()=>{
 it('shows live stats and opens the secretary without starting calls or changing appointments',async()=>{
  const secretary=vi.fn();
  await act(async()=>{view=create(<CallbackSchedule sessionToken="synthetic" agentId="james" onUnauthorized={()=>{}} onSecretary={secretary} liveStats={{today_total:123,active_calls_now:4,completed_today:119}}/>);});
  const text=JSON.stringify(view!.toJSON());expect(text).toContain('123');expect(text).toContain('Active now');expect(text).toContain('Ask Elizabeth');
  await act(async()=>{view!.root.findAllByType('button').find(b=>b.props.className==='f1-callback-secretary')!.props.onClick();});
  expect(secretary).toHaveBeenCalledTimes(1);expect(mocks.fetch).not.toHaveBeenCalled();
 });
 it('loads actual schedule, displays the shared reference and does not start audio or complete a callback',async()=>{
  mocks.fetch.mockResolvedValue({ok:true,data});await mount();await refresh();const text=JSON.stringify(view!.toJSON());
  expect(text).toContain('Sample Contact');expect(text).toContain('516221');expect(text).toContain('2:15 PM');expect(text).not.toContain('Private recording player');
  expect(mocks.fetch.mock.calls).toHaveLength(1);expect(mocks.fetch.mock.calls[0][1].body.action).toBe('get_callback_schedule');
 });
 it('keeps last schedule visible on a refresh error and does not log the agent out',async()=>{
  mocks.fetch.mockResolvedValueOnce({ok:true,data}).mockResolvedValueOnce({ok:false,error:'Temporarily unavailable'});await mount();await refresh();await refresh();
  const text=JSON.stringify(view!.toJSON());expect(text).toContain('Sample Contact');expect(text).toContain('last saved schedule');
 });
 it('loads recording controls only on explicit expansion; completion requires a separate click',async()=>{
  mocks.fetch.mockResolvedValue({ok:true,data});await mount();await refresh();
  const buttons=view!.root.findAllByType('button');await act(async()=>{buttons.find(b=>b.props['aria-expanded']===false)!.props.onClick();});
  expect(JSON.stringify(view!.toJSON())).toContain('Private recording player');expect(mocks.fetch).toHaveBeenCalledTimes(1);
  const done=view!.root.findAllByType('button').find(b=>b.children.includes('Mark done'))!;
  await act(async()=>{await done.props.onClick();});
  expect(mocks.fetch.mock.calls[1][1].body).toMatchObject({action:'complete_scheduled_callback',source:'appointment',id:'fixture',agent_id:'james'});
 });
});
