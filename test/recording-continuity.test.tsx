import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,create,ReactTestRenderer} from 'react-test-renderer';
import {RecordingPlayer} from '../src/components/RecordingPlayer';
import {IncomingCallAlert,type TransferAlert} from '../src/components/IncomingCallAlert';
import {IPhone} from '../src/components/IPhone';

const mocks=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@/utils/auth-fetch',()=>({authFetch:mocks.fetch}));
vi.mock('@/modules/phone/PhoneNumber',()=>({PhoneNumber:({children}:{children:unknown})=><span>{children}</span>}));
vi.mock('@/phone/use-phone-presence',()=>({usePhonePresence:()=>null}));
vi.mock('@/phone/useVoicemailCount',()=>({useVoicemailCount:()=>0}));
vi.mock('@/components/PhoneActivity',()=>({PhoneActivity:()=>null,usePhoneActivityCount:()=>0}));
vi.mock('@/components/PhoneVoicemail',()=>({PhoneVoicemail:()=>null}));

const grant=(value:string)=>`https://example.supabase.co/storage/v1/object/sign/call-recordings/calls/sample.mp3?token=${value}`;
let view:ReactTestRenderer|undefined;
let browser:EventTarget&{location:{origin:string;hostname:string}};
const frame={postMessage:vi.fn(),wolfPhone:{unlockAudio:vi.fn()}};
const media={currentTime:23,duration:98,paused:false,ended:false,play:vi.fn(()=>Promise.resolve())};
const props={callId:'call-a',sessionToken:'synthetic-session',onUnauthorized:vi.fn()};
const alert={id:'alert-a',call_id:'call-a',agent_id:'james',status:'completed',consumer_name:'Synthetic Contact',consumer_phone:'+12025550123',created_at:'2026-10-01T20:00:00Z',recording_url:grant('a')} as TransferAlert;
const alertProps={alerts:[alert],onAcknowledge:vi.fn(),onScheduleCallback:vi.fn(),onDismiss:vi.fn(),sessionToken:'synthetic-session',onUnauthorized:vi.fn(),agentName:'James'};

beforeEach(()=>{
 browser=Object.assign(new EventTarget(),{location:{origin:'https://wolf-of-wall-street-ssy3.bolt.host',hostname:'wolf-of-wall-street-ssy3.bolt.host'}});
 vi.stubGlobal('window',browser);vi.stubGlobal('navigator',{userAgent:'Test desktop',platform:'Test',maxTouchPoints:0});
 mocks.fetch.mockResolvedValue({ok:true,data:{route:{},caller:null}});
 media.currentTime=23;media.paused=false;media.ended=false;
});
afterEach(()=>{act(()=>view?.unmount());view=undefined;vi.clearAllMocks();vi.unstubAllGlobals();});
async function renderPlayer(url:string|null,overrides={}){await act(async()=>{view=create(<RecordingPlayer url={url} {...props} {...overrides}/>,{createNodeMock:element=>element.type==='audio'?media:null});});}
async function phoneEvent(data:Record<string,unknown>){await act(async()=>{browser.dispatchEvent(Object.assign(new Event('message'),{origin:browser.location.origin,source:frame,data:{channel:'wolf-zadarma-v1',...data}}));});}

describe('recording playback continuity',()=>{
 it('keeps the same audio element and source when a poll rotates its playback grant',async()=>{
  await renderPlayer(grant('a'));const audio=view!.root.findByType('audio');
  await act(async()=>view!.update(<RecordingPlayer url={grant('b')} {...props}/>));
  expect(view!.root.findByType('audio')===audio).toBe(true);expect(audio.props.src).toBe(grant('a'));expect(media.currentTime).toBe(23);expect(mocks.fetch).not.toHaveBeenCalled();
 });
 it('resets to the correct recording on a different call or signed-in account',async()=>{
  await renderPlayer(grant('a'));const audio=view!.root.findByType('audio');
  await act(async()=>view!.update(<RecordingPlayer url={grant('b')} {...props} callId="call-b"/>));
  const next=view!.root.findByType('audio');expect(next.props.src).toBe(grant('b'));expect(next===audio).toBe(false);
  await act(async()=>view!.update(<RecordingPlayer url={grant('c')} {...props} callId="call-b" sessionToken="new-synthetic-session"/>));
  expect(view!.root.findByType('audio')===next).toBe(false);expect(view!.root.findByType('audio').props.src).toBe(grant('c'));
 });
 it('only replaces an expired source after a real error, then restores the playhead',async()=>{
  await renderPlayer(grant('a'));const audio=view!.root.findByType('audio');
  await act(async()=>view!.update(<RecordingPlayer url={grant('b')} {...props}/>));
  expect(media.play).not.toHaveBeenCalled();
  await act(async()=>audio.props.onError());
  expect(view!.root.findByType('audio')===audio).toBe(true);expect(audio.props.src).toBe(grant('b'));
  media.currentTime=0;await act(async()=>audio.props.onLoadedMetadata());
  expect(media.currentTime).toBe(23);expect(media.play).toHaveBeenCalledTimes(1);expect(mocks.fetch).not.toHaveBeenCalled();
 });
 it('a polling response does not cancel in-flight authorized recovery',async()=>{
  let finish:(value:unknown)=>void=()=>{};mocks.fetch.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  await renderPlayer(null);expect(mocks.fetch).toHaveBeenCalledTimes(1);
  const signal=mocks.fetch.mock.calls[0][1].signal as AbortSignal;
  await act(async()=>view!.update(<RecordingPlayer url="https://api.bland.ai/v1/recordings/sample" {...props}/>));
  expect(signal.aborted).toBe(false);
  await act(async()=>finish({ok:true,data:{recording_url:grant('recovered')}}));
  expect(view!.root.findByType('audio').props.src).toBe(grant('recovered'));
 });
 it('never reuses another account’s pending recovery result',async()=>{
  let finish:(value:unknown)=>void=()=>{};mocks.fetch.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  await renderPlayer(null);const signal=mocks.fetch.mock.calls[0][1].signal as AbortSignal;
  await act(async()=>view!.update(<RecordingPlayer url={grant('new-account')} {...props} sessionToken="different-synthetic-session"/>));
  expect(signal.aborted).toBe(true);
  await act(async()=>finish({ok:true,data:{recording_url:grant('previous-account')}}));
  expect(view!.root.findByType('audio').props.src).toBe(grant('new-account'));
 });
});

describe('manual panels',()=>{
 it('leads remain collapsed on load and when polling returns new alerts',async()=>{
  await act(async()=>{view=create(<IncomingCallAlert {...alertProps}/>);});
  expect(view!.root.findAllByType('audio')).toHaveLength(0);expect(JSON.stringify(view!.toJSON())).not.toContain('Synthetic Contact');
  await act(async()=>view!.update(<IncomingCallAlert {...alertProps} alerts={[alert,{...alert,id:'alert-b'}]}/>));
  expect(JSON.stringify(view!.toJSON())).not.toContain('Synthetic Contact');
  const toggle=view!.root.findByProps({'aria-label':'Open leads'});await act(async()=>toggle.props.onClick());
  expect(JSON.stringify(view!.toJSON())).toContain('Synthetic Contact');
  await act(async()=>view!.root.findByProps({'aria-label':'Close leads'}).props.onClick());
  await act(async()=>view!.update(<IncomingCallAlert {...alertProps} alerts={[alert,{...alert,id:'alert-c'}]}/>));
  expect(JSON.stringify(view!.toJSON())).not.toContain('Synthetic Contact');
 });
 it('the manually opened lead panel can recover an authorized missing recording',async()=>{
  mocks.fetch.mockResolvedValue({ok:true,data:{recording_url:grant('recovered')}});
  await act(async()=>{view=create(<IncomingCallAlert {...alertProps} alerts={[{...alert,recording_url:null}]}/>);});
  expect(mocks.fetch).not.toHaveBeenCalled();
  await act(async()=>view!.root.findByProps({'aria-label':'Open leads'}).props.onClick());
  expect(mocks.fetch.mock.calls[0][1].body).toEqual({action:'recover_recording',session_token:'synthetic-session',call_id:'call-a',recording_source:'calls'});
  expect(view!.root.findByType('audio').props.src).toBe(grant('recovered'));
 });
 it('the phone starts minimized and an incoming event does not reopen it or replace its connection frame',async()=>{
  await act(async()=>{view=create(<IPhone agentName="James" sessionToken="synthetic-session" providerUrl="https://example.test/provider" onUnauthorized={()=>{}}/>,{createNodeMock:element=>element.type==='iframe'?{contentWindow:frame}:null});});
  const engine=view!.root.findByType('iframe');expect(view!.root.findAllByProps({'aria-label':'Open phone'})).toHaveLength(1);
  await phoneEvent({type:'incoming',number:'+12025550123'});await phoneEvent({type:'call-state',state:'ringing-in'});
  expect(view!.root.findByType('iframe')===engine).toBe(true);expect(view!.root.findAllByProps({'aria-label':'Minimize phone'})).toHaveLength(0);
  const button=view!.root.findByProps({'aria-label':'Open phone — incoming call'});await act(async()=>button.props.onClick());
  expect(view!.root.findAllByProps({'aria-label':'Answer call'})).toHaveLength(1);expect(frame.postMessage).not.toHaveBeenCalled();
  await act(async()=>view!.root.findByProps({'aria-label':'Answer call'}).props.onClick());
  expect(frame.postMessage).toHaveBeenCalledWith({channel:'wolf-zadarma-v1',command:'answer'},browser.location.origin);
  await act(async()=>view!.root.findByProps({'aria-label':'Minimize phone'}).props.onClick());
  await phoneEvent({type:'outgoing',number:'+12025550124'});
  expect(view!.root.findAllByProps({'aria-label':'Minimize phone'})).toHaveLength(0);expect(view!.root.findByType('iframe')===engine).toBe(true);
 });
});
