import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowUpRight, CheckCircle2, Headphones, Phone, RefreshCw, Voicemail } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { authFetch } from '@/utils/auth-fetch';
import { formatPhone } from '@/utils/privacy';

type Agent = { id: string; full_name: string; phone_ready: boolean; route_ready: boolean; bland_number: string; zadarma_number: string; attempts: number; humans: number; transfers: number; incoming: number; answered: number; voicemail_reached: number; messages: number; unheard: number; callbacks: number; in_progress: number };
type Overview = {
  as_of: string; events_enabled: boolean; events_since: string | null; voicemail_import_configured: boolean;
  campaign: {state: string; call_limit: number; accepted: number; concurrency: number; started_at: string};
  bland: {attempts: number; humans: number; transfers: number; destination_dialed: number; bridge_confirmed: number; in_progress: number; no_answer: number; customer_voicemail: number; failures: number; minutes: number};
  zadarma: {incoming: number; outgoing: number; answered: number; voicemail_reached: number; missed: number; ringing: number; unconfirmed?: number};
  voicemail: {messages: number; unheard: number}; agents: Agent[];
  hourly: {hour: string; attempts: number; humans: number; transfers: number}[];
  recent_calls: {pbx_call_id: string; full_name: string; direction: string; caller_number: string; called_number: string; started_at: string; disposition: string; voicemail_reached: boolean; answered: boolean; duration_seconds: number; recording_available: boolean}[];
};
const number = (value: number) => Number(value || 0).toLocaleString();
const time = (value: string) => new Date(value).toLocaleTimeString('en-US', {timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit'});
const tooltip = {background: '#242126', border: '1px solid #514047', borderRadius: 12, color: '#f7efec'};
export function OperationsDashboard({sessionToken, providerUrl, onUnauthorized}: {sessionToken: string; providerUrl: string; onUnauthorized: () => void}) {
  const [data, setData] = useState<Overview | null>(null);
  const [windowName, setWindowName] = useState('today');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setBusy(true);
    const result = await authFetch<Overview>(providerUrl, {body: {action:'operations_overview', session_token:sessionToken, window:windowName}, onUnauthorized:()=>auth.current()});
    if (current !== sequence.current) return;
    if (result.ok && result.data) { setData(result.data); setError(''); }
    else setError(result.error || 'Live statistics could not refresh.');
    setBusy(false);
  }, [sessionToken, providerUrl, windowName]);
  useEffect(() => {
    setData(null); void load();
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(); };
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => { ++sequence.current; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);
  const bars = data?.agents.map(a=>({...a, name:a.full_name.split(' ')[0]})) || [];
  const hours = data?.hourly.map(h=>({...h, label:time(h.hour)})) || [];
  return <section className="ops-dashboard" aria-label="Bland and Zadarma call operations">
    <div className="ops-heading"><div><span className="ops-eyebrow"><Activity size={13}/> LIVE OPERATIONS</span><h2>Every call. A clear next step.</h2><p>Bland AI → assigned Zadarma line → agent or voicemail</p></div>
      <div className="ops-tools"><div className="ops-range" aria-label="Statistics period">{['today','week','all'].map(w=><button key={w} onClick={()=>setWindowName(w)} aria-pressed={windowName===w}>{w==='all'?'All time':w==='week'?'This week':'Today'}</button>)}</div><button className="ops-refresh" aria-label="Refresh call operations" disabled={busy} onClick={()=>void load()}><RefreshCw size={16} className={busy?'search-spinner':''}/></button></div>
    </div>
    {error && <p className="ops-notice ops-warning" role="alert">{error}{data?' Displaying the last successful update.':''}</p>}
    {!data ? <p className="ops-empty">{busy?'Loading call activity…':'No statistics available.'}</p> : <>
      <div className="ops-batch"><span className={`ops-state ${data.campaign.state==='running'?'running':''}`}><i/>{data.campaign.state==='running'?'Dialer running':`Dialer ${data.campaign.state}`}</span><strong>{number(data.campaign.accepted)} <small>/ {number(data.campaign.call_limit)} in this batch</small></strong><div className="ops-progress" role="progressbar" aria-label="Current batch calls" aria-valuemin={0} aria-valuemax={data.campaign.call_limit} aria-valuenow={data.campaign.accepted}><span style={{width:`${Math.min(100,100*data.campaign.accepted/Math.max(1,data.campaign.call_limit))}%`}}/></div><span>{data.campaign.concurrency} concurrent calls</span></div>
      <div className="ops-kpis">
        {[
          ['AI outbound calls',data.bland.attempts,`${data.bland.in_progress} in progress`],
          ['People reached',data.bland.humans,`${data.bland.attempts?(100*data.bland.humans/data.bland.attempts).toFixed(1):'0'}% of attempts`],
          ['Transfer requests',data.bland.transfers,`${data.bland.destination_dialed} destination dials reported`],
          ['Zadarma received',data.events_enabled?data.zadarma.incoming:null,'Includes direct callbacks'],
          ['Agent answered',data.events_enabled?data.zadarma.answered:null,'Confirmed by Zadarma'],
          ['Voicemail reached',data.events_enabled?data.zadarma.voicemail_reached:null,'Voicemail service answered'],
          ['Saved messages',data.voicemail.messages,`${data.voicemail.unheard} unheard recordings`],
          ['Missed calls',data.events_enabled?data.zadarma.missed:null,'No agent or voicemail answer'],
        ].map(([label,value,hint])=><article className="ops-kpi" key={String(label)}><span>{label}</span><strong>{value==null?'—':number(Number(value))}</strong><small>{hint}</small></article>)}
      </div>
      <div className="ops-status-row"><span><CheckCircle2 size={14}/>{data.agents.filter(a=>a.route_ready).length} verified routes selected</span><span><Headphones size={14}/>{data.agents.filter(a=>a.phone_ready).length} desktop phones ready</span><span><Voicemail size={14}/>Offline agents continue receiving routed calls</span>{Boolean(data.zadarma.unconfirmed)&&<span>{data.zadarma.unconfirmed} call outcome(s) syncing</span>}</div>
      {!data.events_enabled && <p className="ops-notice ops-warning">Zadarma event delivery needs configuration. Native call totals are unavailable until it is connected.</p>}
      {!data.voicemail_import_configured && <p className="ops-notice ops-warning"><Voicemail size={17}/><span><strong>Voicemail audio delivery needs a receiving mailbox connection.</strong> Zadarma sends messages to the configured email address. The phone inbox shows recordings only after they have been imported.</span></p>}
      <div className="ops-charts">
        <article className="ops-panel"><header><div><h3>Call activity</h3><p>Last 24 hours in this period · Eastern time</p></div><Activity size={18}/></header>
          {hours.length ? <div className="ops-chart" role="img" aria-label={`Activity chart: ${data.bland.attempts} attempts and ${data.bland.transfers} transfer requests in the selected period`}><ResponsiveContainer width="100%" height={235}><AreaChart data={hours} margin={{top:12,right:12,left:-20,bottom:0}}><CartesianGrid stroke="#3b3439" vertical={false}/><XAxis dataKey="label" tick={{fill:'#b8abad',fontSize:11}} axisLine={false} tickLine={false}/><YAxis allowDecimals={false} tick={{fill:'#b8abad',fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={tooltip}/><Legend iconType="circle"/><Area dataKey="attempts" name="Calls" stroke="#e4767d" fill="#e4767d" fillOpacity={0.13} strokeWidth={2} isAnimationActive={false}/><Area dataKey="humans" name="People" stroke="#d6bd92" fill="#d6bd92" fillOpacity={0.08} strokeWidth={2} isAnimationActive={false}/><Area dataKey="transfers" name="Transfers" stroke="#aeb7cc" fill="#aeb7cc" fillOpacity={0.04} strokeWidth={2} isAnimationActive={false}/></AreaChart></ResponsiveContainer></div>:<p className="ops-empty">No calls in the last 24 hours.</p>}
        </article>
        <article className="ops-panel"><header><div><h3>Team activity</h3><p>AI calls and transfer requests by agent</p></div><Phone size={18}/></header><div className="ops-chart" role="img" aria-label="Calls and transfers grouped by agent"><ResponsiveContainer width="100%" height={235}><BarChart data={bars} margin={{top:12,right:12,left:-20,bottom:0}}><CartesianGrid stroke="#3b3439" vertical={false}/><XAxis dataKey="name" tick={{fill:'#b8abad',fontSize:12}} axisLine={false} tickLine={false}/><YAxis allowDecimals={false} tick={{fill:'#b8abad',fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={tooltip} cursor={{fill:'#ffffff06'}}/><Legend iconType="circle"/><Bar dataKey="attempts" name="Calls" fill="#cf6b73" radius={[5,5,0,0]} maxBarSize={34} isAnimationActive={false}/><Bar dataKey="transfers" name="Transfers" fill="#d6bd92" radius={[5,5,0,0]} maxBarSize={34} isAnimationActive={false}/></BarChart></ResponsiveContainer></div></article>
      </div>
      <article className="ops-panel"><header><div><h3>Your agents</h3><p>Routing stays active when a desktop is disconnected.</p></div><span className="ops-caption">{data.agents.length} assigned lines</span></header><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Agent / Zadarma line</th><th>Desktop</th><th>Calls</th><th>People</th><th>Transfers</th><th>Answered</th><th>Voicemail reached</th><th>Unheard</th><th>Callbacks</th></tr></thead><tbody>{data.agents.map(a=><tr key={a.id}><td><strong>{a.full_name}</strong><small>{formatPhone(a.zadarma_number)} · {a.route_ready?'Route active':'Check route'}</small></td><td><span className={`ops-tag ${a.phone_ready?'online':'neutral'}`}>{a.phone_ready?'Ready':'Offline'}</span></td><td>{a.attempts}</td><td>{a.humans}</td><td>{a.transfers}</td><td>{data.events_enabled?a.answered:'—'}</td><td>{data.events_enabled?a.voicemail_reached:'—'}</td><td>{a.unheard}</td><td>{a.callbacks}</td></tr>)}</tbody></table></div></article>
      <div className="ops-charts ops-bottom">
        <article className="ops-panel"><header><div><h3>AI call outcomes</h3><p>Customer voicemail is separate from your agents’ inboxes.</p></div></header><div className="ops-outcomes">{[['People reached',data.bland.humans],['No answer',data.bland.no_answer],['Customer voicemail',data.bland.customer_voicemail],['Transfer failures',data.bland.failures]].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{number(Number(value))}</strong><div><i style={{width:`${Math.min(100,100*Number(value)/Math.max(1,data.bland.attempts))}%`}}/></div></div>)}</div><p className="ops-footnote">{data.bland.minutes} recorded call minutes · {data.bland.bridge_confirmed} provider-confirmed bridges. Outcomes may overlap.</p></article>
        <article className="ops-panel"><header><div><h3>Latest Zadarma activity</h3><p>Actual events from the assigned phone lines</p></div></header>{!data.recent_calls.length?<p className="ops-empty">{data.events_enabled?'Waiting for the next call event. Earlier records may not yet be imported.':'Connect the event feed to see activity.'}</p>:<div className="ops-events">{data.recent_calls.slice(0,6).map(c=><div key={c.pbx_call_id}>{c.direction==='outbound'?<ArrowUpRight size={18}/>:<ArrowDownLeft size={18}/>}<div><strong>{c.full_name.split(' ')[0]} · {formatPhone(c.direction==='outbound'?c.called_number:c.caller_number)}</strong><small>{c.voicemail_reached?'Voicemail service answered':c.answered?'Agent answered':c.disposition==='unconfirmed'?'Outcome syncing':c.disposition} · {c.duration_seconds}s</small></div><time>{time(c.started_at)}</time></div>)}</div>}</article>
      </div>
      <footer className="ops-footer"><span>Updated {time(data.as_of)} ET · refreshes every 15 seconds</span>{data.events_since&&<span>Zadarma event collection since {time(data.events_since)} ET</span>}</footer>
    </>}
  </section>;
}
