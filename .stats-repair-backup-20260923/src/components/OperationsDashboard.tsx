import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowUpRight, CheckCircle2, Headphones, RefreshCw, Voicemail } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { authFetch } from '@/utils/auth-fetch';
import { formatPhone } from '@/utils/privacy';

type Agent = { id: string; full_name: string; status: string; selected: boolean; phone_ready: boolean; route_ready: boolean; zadarma_number: string; attempts: number; humans: number; transfers: number; incoming: number; answered: number; transfer_answers: number; voicemail_reached: number; messages: number; unheard: number; unheard_backlog: number; missed: number; callbacks: number; in_progress: number };
export type OperationsOverview = {
  as_of: string; since: string | null; timezone: string; events_enabled: boolean; events_since: string | null; last_event_at: string | null; voicemail_import_configured: boolean;
  campaign: {state?: string; call_limit?: number; accepted?: number; concurrency?: number; started_at?: string};
  lines: {configured: number; effective: number; active: number; reserved: number; aged: number; hourly_target: number; minute_limit: number; recent_hour: number; recent_minute: number; pacing_allowance: number; available_slots: number; agent_slots: number; selected_agents: number; eligible_agents: number; blocking_reason: string | null};
  bland: {attempts: number; humans: number; transfers: number; destination_dialed: number; bridge_confirmed: number; in_progress: number; no_answer: number; customer_voicemail: number; failures: number; minutes: number; linked_received: number; linked_answered: number; linked_voicemail: number};
  zadarma: {incoming: number; outgoing: number; outgoing_answered: number; answered: number; voicemail_reached: number; missed: number; ringing: number; connected: number; unconfirmed: number; linked_transfers: number; unlinked_incoming: number};
  voicemail: {messages: number; unheard: number; unheard_backlog: number}; agents: Agent[];
  outcomes: Partial<Record<'human' | 'no_answer' | 'customer_voicemail' | 'in_progress' | 'other',number>> | null;
  hourly: {hour: string; attempts: number; humans: number; transfers: number}[];
  recent_calls: {pbx_call_id: string; full_name: string | null; direction: string; caller_number: string; called_number: string; started_at: string; disposition: string; voicemail_reached: boolean; answered: boolean; duration_seconds: number; linked_transfer: boolean}[];
};
const number = (value: number | undefined | null) => value == null ? '—' : value.toLocaleString();
const percent = (n: number, d: number) => d > 0 ? `${(100*n/d).toFixed(1)}%` : '—';
const time = (value: string, date = false) => new Date(value).toLocaleString('en-US', {timeZone:'America/Costa_Rica', ...(date ? {month:'short' as const, day:'numeric' as const} : {}), hour:'numeric', minute:'2-digit'});
const tooltip = {background:'#242126', border:'1px solid #67505b', borderRadius:12, color:'#f7efec'};

export function OperationsDashboard({sessionToken, providerUrl, onUnauthorized}: {sessionToken: string; providerUrl: string; onUnauthorized: () => void}) {
  const [data, setData] = useState<OperationsOverview | null>(null);
  const [windowName, setWindowName] = useState('today');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setBusy(true);
    try {
      const result = await authFetch<OperationsOverview>(providerUrl, {body:{action:'operations_overview',session_token:sessionToken,window:windowName},onUnauthorized:()=>auth.current()});
      if (current !== sequence.current) return;
      if (result.ok && result.data?.lines) { setData(result.data); setError(''); }
      else setError(result.error || 'Call statistics could not refresh.');
    } catch { if(current === sequence.current) setError('Call statistics could not refresh.'); }
    finally { if(current === sequence.current) setBusy(false); }
  }, [sessionToken,providerUrl,windowName]);
  useEffect(() => {
    setData(null); void load();
    const refresh = () => { if(document.visibilityState !== 'hidden') void load(); };
    const timer = window.setInterval(refresh,15000);
    document.addEventListener('visibilitychange',refresh);
    return () => { ++sequence.current; window.clearInterval(timer); document.removeEventListener('visibilitychange',refresh); };
  },[load]);
  return <OperationsView data={data} windowName={windowName} busy={busy} error={error} onWindow={setWindowName} onRefresh={()=>void load()}/>;
}

export function OperationsView({data,windowName,busy,error,onWindow,onRefresh}: {data: OperationsOverview | null; windowName: string; busy: boolean; error: string; onWindow: (w: string)=>void; onRefresh: ()=>void}) {
  const [clock,setClock] = useState(Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setClock(Date.now()),5000);return()=>window.clearInterval(timer);},[]);
  const stale = data && clock-new Date(data.as_of).getTime()>60000;
  const hours = data?.hourly.map(h=>({...h,label:time(h.hour)})) || [];
  const l = data?.lines;
  const remaining = Math.max(0,(data?.campaign.call_limit || 0)-(data?.campaign.accepted || 0));
  const lineState = !data ? '' : data.campaign.state !== 'running' ? 'Dialer stopped' : remaining === 0 ? 'Batch limit reached' : !l?.effective ? 'No eligible agent routes' : !l.pacing_allowance ? 'Waiting for pacing allowance' : !l.available_slots || !l.agent_slots ? 'Available capacity occupied' : 'Slots open for the next dispatch';
  return <section className="ops-dashboard" aria-label="Call operations and agent delivery">
    <div className="ops-heading"><div><span className="ops-eyebrow"><Activity size={13}/> OPERATIONS / CALL DELIVERY</span><h2>From first dial to agent answer.</h2><p>Today begins at midnight in Costa Rica · weeks begin Monday</p></div><div className="ops-tools"><div className="ops-range" aria-label="Statistics period">{['today','week','all'].map(w=><button key={w} onClick={()=>onWindow(w)} aria-pressed={windowName===w}>{w==='all'?'All time':w==='week'?'This week':'Today'}</button>)}</div><button className="ops-refresh" aria-label="Refresh call operations" disabled={busy} onClick={onRefresh}><RefreshCw size={16} className={busy?'search-spinner':''}/></button></div></div>
    {error && <p className="ops-notice" role="alert">{error}{data?' Showing the last successful snapshot.':''}</p>}
    {stale && <p className="ops-notice" role="status">This snapshot is over one minute old. Live line counts may have changed.</p>}
    {!data || !l ? <p className="ops-empty">{busy?'Loading call activity…':'No statistics available.'}</p> : <>
      <article className="ops-live-card" aria-label="Current line usage">
        <div className="ops-live-primary"><span className={`ops-state ${data.campaign.state==='running'?'running':''}`}><i/>{data.campaign.state==='running'?'Dialer running':`Dialer ${data.campaign.state || 'idle'}`}</span><div className="ops-live-number">{l.active}<span>/ {l.configured}</span></div><h3>Tracked active / configured limit</h3><div className="ops-line-lights" aria-label={`${l.active} tracked active calls, ${l.reserved} reserved, limit ${l.configured}`}>{Array.from({length:Math.min(12,Math.max(l.configured,l.active+l.reserved))},(_,i)=><i key={i} className={i<l.active?'occupied':i<l.active+l.reserved?'reserved':''}/>)}</div><p>Accepted calls awaiting completion events. This is not a count of answered conversations.</p></div>
        <div className="ops-live-detail"><div className="ops-line-facts"><div><strong>{l.effective}</strong><span>Eligible line capacity</span></div><div><strong>{l.reserved}</strong><span>Reserved, not accepted</span></div><div><strong>{l.minute_limit}<small> / min</small></strong><span>Maximum new starts</span></div><div><strong>{number(l.hourly_target)}<small> / hr</small></strong><span>Rolling hourly ceiling</span></div></div><div className="ops-live-status"><strong>{lineState}</strong><span>{l.recent_minute} started/reserved in the last minute · {l.recent_hour} in the last hour</span></div><p>{l.selected_agents} agents selected · {l.eligible_agents} eligible routes · up to 7 lines per agent and 12 overall</p></div>
      </article>
      {l.aged>0&&<p className="ops-notice">{l.aged} active record(s) are over 10 minutes old and need completion verification.</p>}
      {l.effective<l.configured&&<p className="ops-notice">The selected limit is {l.configured}, but the currently eligible agents support {l.effective} lines.</p>}
      <div className="ops-batch"><span>Current batch · independent of the period above</span><strong>{number(data.campaign.accepted)} <small>/ {number(data.campaign.call_limit)} accepted</small></strong><div className="ops-progress" role="progressbar" aria-label="Current batch progress" aria-valuemin={0} aria-valuemax={data.campaign.call_limit || 1} aria-valuenow={data.campaign.accepted || 0}><span style={{width:`${Math.min(100,100*(data.campaign.accepted||0)/Math.max(1,data.campaign.call_limit||0))}%`}}/></div><span>{remaining} remaining</span></div>
      <div className="ops-kpis">{[
        ['Outbound calls accepted',data.bland.attempts,'Provider IDs received; excludes unsent reservations'],
        ['Human-classified calls',data.bland.humans,`${percent(data.bland.humans,data.bland.attempts)} of accepted calls`],
        ['Transfer requests',data.bland.transfers,`${percent(data.bland.transfers,data.bland.humans)} per human-classified call`],
        ['Transfer → agent answer',data.events_enabled?data.bland.linked_answered:null,`${percent(data.bland.linked_answered,data.bland.transfers)} of requests · matched phone evidence`],
        ['All agent answers',data.events_enabled?data.zadarma.answered:null,'Inbound phone answers; excludes voicemail'],
        ['Agent voicemail reached',data.events_enabled?data.zadarma.voicemail_reached:null,'Voicemail pickups; a message is not guaranteed'],
        ['Saved voicemail audio',data.voicemail.messages,`${data.voicemail.unheard} unheard in this period`],
        ['Missed incoming calls',data.events_enabled?data.zadarma.missed:null,`${data.zadarma.unconfirmed} additional outcomes unconfirmed`],
      ].map(([label,value,hint])=><article className="ops-kpi" key={String(label)}><span>{label}</span><strong>{number(value==null?null:Number(value))}</strong><small>{hint}</small></article>)}</div>
      <div className="ops-status-row"><span><CheckCircle2 size={14}/>{l.eligible_agents} selected routes eligible</span><span><Headphones size={14}/>{data.agents.filter(a=>a.selected&&a.phone_ready).length} selected desktop phones ready</span><span><Voicemail size={14}/>{data.voicemail.unheard_backlog} unheard messages across all dates</span></div>
      {data.agents.some(a=>a.selected&&!a.phone_ready)&&<p className="ops-notice"><Headphones size={17}/><span><strong>{data.agents.filter(a=>a.selected&&!a.phone_ready).map(a=>a.full_name).join(', ')}: desktop phone not ready.</strong>Calls can still route to the assigned line. The desktop phone must be connected for the agent to answer there.</span></p>}
      {!data.events_enabled?<p className="ops-notice">Phone event collection is not configured. Agent-answer and missed-call totals are unavailable.</p>:data.events_since&&(!data.since||new Date(data.events_since)>new Date(data.since))&&<p className="ops-coverage">Phone evidence starts {time(data.events_since,true)} Costa Rica time. Earlier calls in this period may have no phone events; zero means no confirmation recorded.</p>}
      {!data.voicemail_import_configured&&<p className="ops-notice">Voicemail audio delivery needs a receiving mailbox connection. Saved-message totals include only imported audio.</p>}
      <div className="ops-charts">
        <article className="ops-panel"><header><div><h3>Call activity</h3><p>Up to 24 hourly buckets within this period · Costa Rica time</p></div><Activity size={18}/></header><div className="ops-chart" role="img" aria-label="Hourly accepted calls, detected humans, and transfer requests"><ResponsiveContainer width="100%" height={245}><AreaChart data={hours} margin={{top:12,right:12,left:-20,bottom:0}}><CartesianGrid stroke="#3b3439" vertical={false}/><XAxis dataKey="label" tick={{fill:'#b8abad',fontSize:11}} axisLine={false} tickLine={false} minTickGap={35}/><YAxis allowDecimals={false} tick={{fill:'#b8abad',fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={tooltip}/><Legend iconType="circle"/><Area dataKey="attempts" name="Accepted" stroke="#e4767d" fill="#e4767d" fillOpacity={0.13} strokeWidth={2} isAnimationActive={false}/><Area dataKey="humans" name="Human-classified" stroke="#d6bd92" fill="#d6bd92" fillOpacity={0.08} strokeWidth={2} isAnimationActive={false}/><Area dataKey="transfers" name="Requests" stroke="#aeb7cc" fill="#aeb7cc" fillOpacity={0.04} strokeWidth={2} isAnimationActive={false}/></AreaChart></ResponsiveContainer></div></article>
        <article className="ops-panel"><header><div><h3>Where the handoff stops</h3><p>Evidence linked to outbound calls in this period</p></div></header><div className="ops-handoff">{[['Transfer requested',data.bland.transfers],['Destination dialed',data.bland.destination_dialed],['Phone line received',data.events_enabled?data.bland.linked_received:null],['Agent answered',data.events_enabled?data.bland.linked_answered:null],['Agent voicemail',data.events_enabled?data.bland.linked_voicemail:null]].map(([label,value],i)=><div key={String(label)}><span className="ops-step">{String(i+1).padStart(2,'0')}</span><span>{label}</span><strong>{number(value==null?null:Number(value))}</strong></div>)}</div><p className="ops-footnote">{data.bland.failures} explicit transfer failures · {data.bland.bridge_confirmed} provider-confirmed bridges. Phone answers require separate phone evidence.</p></article>
      </div>
      <article className="ops-panel"><header><div><h3>Agent delivery</h3><p>Selected period totals · Active, unheard backlog, and callbacks are current across all dates</p></div><span className="ops-caption">{data.agents.length} agents</span></header><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Agent / assigned line</th><th>Desktop</th><th>Active</th><th>Calls</th><th>Humans</th><th>Requests</th><th>Transfer answers</th><th>All inbound answers</th><th>Voicemail</th><th>Missed</th><th>Unheard backlog</th><th>Callbacks due</th></tr></thead><tbody>{data.agents.map(a=><tr key={a.id}><td><strong>{a.full_name}</strong><small>{formatPhone(a.zadarma_number)} · {a.status!=='active'?a.status:!a.selected?'Dialer off':a.route_ready?'Selected · route ready':'Selected · route needs review'}</small></td><td><span className={`ops-tag ${a.phone_ready?'online':'neutral'}`}>{a.phone_ready?'Ready':'Offline'}</span></td><td>{a.in_progress}</td><td>{a.attempts}</td><td>{a.humans}</td><td>{a.transfers}</td><td>{data.events_enabled?a.transfer_answers:'—'}</td><td>{data.events_enabled?a.answered:'—'}</td><td>{data.events_enabled?a.voicemail_reached:'—'}</td><td>{data.events_enabled?a.missed:'—'}</td><td>{a.unheard_backlog}</td><td>{a.callbacks}</td></tr>)}</tbody></table></div><p className="ops-footnote ops-table-note">Human classification does not verify the intended client. Agent answer totals include incoming callbacks; transfer answers include only calls matched to an outbound call.</p></article>
      <div className="ops-charts ops-bottom"><article className="ops-panel"><header><div><h3>Outbound call outcomes</h3><p>Each accepted call appears in exactly one group.</p></div></header><div className="ops-outcomes">{([['Human-classified','human'],['No answer','no_answer'],['Customer voicemail','customer_voicemail'],['In progress','in_progress'],['Other / unclassified','other']] as const).map(([label,key])=><div key={key}><span>{label}</span><strong>{number(data.outcomes?.[key]||0)}</strong><div><i style={{width:`${100*(data.outcomes?.[key]||0)/Math.max(1,data.bland.attempts)}%`}}/></div></div>)}</div><p className="ops-footnote">{data.bland.minutes} recorded outbound minutes. Customer voicemail is separate from voicemail on an agent’s line.</p></article>
      <article className="ops-panel"><header><div><h3>Phone activity</h3><p>{data.zadarma.incoming} incoming · {data.zadarma.linked_transfers} matched transfers · {data.zadarma.unlinked_incoming} unmatched incoming</p></div></header><p className="ops-footnote">{data.zadarma.outgoing} outgoing calls · {data.zadarma.outgoing_answered} answered by the called party. Unmatched incoming calls may include direct callbacks.</p>{!data.recent_calls.length?<p className="ops-empty">No phone events recorded for this period.</p>:<div className="ops-events">{data.recent_calls.slice(0,6).map(c=><div key={c.pbx_call_id}>{c.direction==='outbound'?<ArrowUpRight size={18}/>:<ArrowDownLeft size={18}/>}<div><strong>{c.full_name?.split(' ')[0]||'Unassigned'} · {formatPhone(c.direction==='outbound'?c.called_number:c.caller_number)}</strong><small>{c.voicemail_reached?'Voicemail answered':c.answered?(c.direction==='outbound'?'Called party answered':'Agent answered'):c.disposition==='unconfirmed'?'Outcome unconfirmed':c.disposition} · {c.duration_seconds}s</small></div><time>{time(c.started_at,true)}</time></div>)}</div>}</article></div>
      <footer className="ops-footer"><span>Snapshot {time(data.as_of,true)} · refreshes every 15 seconds</span><span>Last phone event: {data.last_event_at?time(data.last_event_at,true):'none recorded'} · Costa Rica (UTC−6)</span></footer>
    </>}
  </section>;
}
