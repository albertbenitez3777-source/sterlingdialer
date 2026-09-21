import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, FlaskConical, Phone, RefreshCw, Square, Voicemail } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';
import { formatPhone } from '@/utils/privacy';
import './TestCallPanel.css';

interface Props { sessionToken: string; providerUrl: string; onUnauthorized: () => void }
interface Route { id: string; name: string; from?: string; transfer?: string; extension?: string; error?: string }
interface TestCall { id: string; client_name: string; client_phone: string; agent_name: string; provider_call_id?: string;
  status: string; completed: boolean; answered_by?: string; transferred_to?: string; transferred_at?: string;
  summary?: string; transcript?: string; error_message?: string; created_at: string; checked_at?: string }
interface MailboxConfig { configured: boolean; email: string; inbox_connected: boolean }
const label = (s: string) => ({ submitting: 'Submitting', queued: 'Call queued', 'in-progress': 'Call in progress',
  completed: 'Call ended', failed: 'Call failed', busy: 'Number busy', 'no-answer': 'No answer',
  canceled: 'Canceled', unknown: 'Result uncertain', 'stop-requested': 'Stop requested' }[s] || s);

export function TestCallPanel({ sessionToken, providerUrl, onUnauthorized }: Props) {
  const [agents, setAgents] = useState<Route[]>([]);
  const [agentId, setAgentId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+1 866 999 1670');
  const [calls, setCalls] = useState<TestCall[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [mailbox, setMailbox] = useState<MailboxConfig | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailError, setMailError] = useState('');
  const authRef = useRef(onUnauthorized); authRef.current = onUnauthorized;
  const pending = useRef(false);
  const requestId = useRef<string | null>(null);
  const selected = agents.find(a => a.id === agentId);
  const request = useCallback(<T,>(body: Record<string, unknown>, timeoutMs = 15000) => authFetch<T>(providerUrl, {
    body: { ...body, session_token: sessionToken }, timeoutMs, onUnauthorized: () => authRef.current(),
  }), [providerUrl, sessionToken]);
  const load = useCallback(async () => {
    setLoading(true);
    const result = await request<{ agents: Route[]; calls: TestCall[] }>({ action: 'phone_test_list' });
    if (result.ok && result.data) {
      setAgents(result.data.agents); setCalls(result.data.calls);
      setAgentId(id => id || result.data!.agents.find(a => a.name === 'James Spencer')?.id || result.data!.agents[0]?.id || '');
    } else setError(result.error || 'Test calls could not be loaded.');
    setLoading(false);
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!agentId) return;
    let active = true; setMailbox(null); setEmail(''); setMailError('');
    void request<MailboxConfig>({ action: 'mailbox_config', agent_id: agentId }).then(result => {
      if (!active) return;
      if (result.ok && result.data) { setMailbox(result.data); setEmail(result.data.email || ''); }
      else setMailError(result.error || 'Could not load voicemail settings.');
    });
    return () => { active = false; };
  }, [agentId, request]);
  const update = (call: TestCall) => setCalls(previous => [call, ...previous.filter(c => c.id !== call.id)].sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0, 20));
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || !selected || selected.error) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    requestId.current ||= crypto.randomUUID();
    const result = await request<{call: TestCall; warning?: string}>({ action: 'phone_test_start',
      request_id: requestId.current, agent_id: agentId, name, phone }, 30000);
    if (result.ok && result.data?.call) {
      update(result.data.call); requestId.current = null;
      setNotice(result.data.warning || (result.data.call.status === 'queued' ? 'Bland accepted the call. Answer your test phone, confirm your name, and agree to the transfer.' : 'The provider result is shown below.'));
    } else {
      setError(result.error || 'Could not submit the test.');
      // Keep the same request ID after network uncertainty; retry cannot place a duplicate.
      if (result.status >= 400 && result.status < 500) requestId.current = null;
    }
    setBusy(false); pending.current = false;
  }
  async function refresh(call: TestCall, stop = false) {
    const result = await request<{call: TestCall; warning?: string}>({ action: stop ? 'phone_test_stop' : 'phone_test_status', id: call.id });
    if (result.ok && result.data) { update(result.data.call); if (result.data.warning) setNotice(result.data.warning); }
    else setError(result.error || 'The result is temporarily unavailable.');
  }
  useEffect(() => {
    const active = calls.find(c => c.provider_call_id && !c.completed && Date.now() - Date.parse(c.created_at) < 10 * 60_000);
    if (!active) return;
    const timer = setTimeout(() => { if (!document.hidden) void refresh(active); }, 10000);
    return () => clearTimeout(timer);
  }, [calls, request]);
  async function setupMailbox(event: React.FormEvent) {
    event.preventDefault(); if (mailBusy) return;
    setMailBusy(true); setMailError('');
    const result = await request<MailboxConfig>({ action: 'mailbox_setup', agent_id: agentId, email }, 30000);
    if (result.ok && result.data) setMailbox(result.data);
    else setMailError(result.error || 'Voicemail setup failed.');
    setMailBusy(false);
  }
  return <section className="phone-test" aria-label="Test calls">
    <header><div className="phone-test-eyebrow"><FlaskConical size={17} /> PHONE TESTING</div><h1>Try the whole conversation.</h1><p>Elizabeth calls your test phone, asks to connect you, then transfers to the agent you choose.</p></header>
    {error && <p role="alert" className="phone-test-error">{error}</p>}
    {notice && <p role="status" className="phone-test-notice">{notice}</p>}
    <div className="phone-test-grid">
      <form className="phone-test-card" onSubmit={event => void start(event)}>
        <h2>Start a test call</h2>
        <label>Person’s name<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Name Elizabeth should ask for" disabled={busy} /></label>
        <label>Number to call<input required type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" disabled={busy} /></label>
        <label>Transfer to<select value={agentId} onChange={e => setAgentId(e.target.value)} disabled={busy || loading} required><option value="" disabled>Choose an agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        {selected?.error && <p className="phone-test-error">{selected.error}</p>}
        <button className="phone-test-primary" disabled={busy || loading || !selected || Boolean(selected.error)} type="submit"><Phone size={18} />{busy ? 'Requesting call…' : requestId.current ? 'Check / retry this request' : 'Call my test number'}</button>
        <p className="phone-test-hint">This places one real call. Keep the chosen agent’s desktop phone open and Ready to answer.</p>
      </form>
      <div className="phone-test-card phone-test-route"><h2>The selected call route</h2>
        {selected && !selected.error ? <><div><span>AI calls from</span><strong>{formatPhone(selected.from || '')}</strong><small>{selected.name}’s Bland line</small></div><ArrowRight size={20} /><div><span>You agree to speak</span><strong>{selected.name}</strong><small>Elizabeth asks before transferring</small></div><ArrowRight size={20} /><div><span>Agent answers on the computer</span><strong>{formatPhone(selected.transfer || '')}</strong><small>Zadarma extension {selected.extension}</small></div></> : <p>Choose an agent to see the route.</p>}
      </div>
    </div>
    <section className="phone-test-card phone-test-history"><header><h2>Test history</h2><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button></header>
      {!calls.length && <p className="phone-test-hint">{loading ? 'Loading test history…' : 'Your test calls will appear here.'}</p>}
      {calls.map(call => <article key={call.id}>
        <div className="phone-test-result-head"><div><strong>{call.client_name}</strong><span>{formatPhone(call.client_phone)} → {call.agent_name}</span><time>{new Date(call.created_at).toLocaleString()}</time></div><span className={`phone-test-status ${call.status === 'failed' ? 'failed' : ''}`}>{label(call.status)}</span></div>
        <p>{call.transferred_to ? `Bland reports a transfer to ${formatPhone(call.transferred_to)}. Confirm ringing and audio on the agent’s desktop.` : 'No transfer has been reported by Bland yet.'}</p>
        {call.answered_by && <p>Test phone answered by: {call.answered_by}</p>}
        {call.error_message && <p className="phone-test-error">{call.error_message}</p>}
        {call.summary && <p>{call.summary}</p>}
        {call.transcript && <details><summary>AI conversation</summary><p className="phone-test-transcript">{call.transcript}</p></details>}
        {call.provider_call_id && <div className="phone-test-actions"><button onClick={() => void refresh(call)}><RefreshCw size={14} /> Check result</button>{!call.completed && <button onClick={() => void refresh(call, true)}><Square size={14} /> Stop test</button>}</div>}
      </article>)}
    </section>
    <section className="phone-test-card"><h2><Voicemail size={20} /> {selected?.name || 'Agent'}’s voicemail</h2>
      <p>If the agent is unavailable or does not answer, Zadarma can play its greeting and email the caller’s recorded message.</p>
      <form className="phone-test-mailbox" onSubmit={event => void setupMailbox(event)}><label>Voicemail delivery email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="A real receiving mailbox" disabled={mailBusy} /></label><button type="submit" disabled={mailBusy || !selected || Boolean(selected.error)}>{mailBusy ? 'Saving…' : 'Enable voicemail'}</button></form>
      {mailError && <p role="alert" className="phone-test-error">{mailError}</p>}
      <p className="phone-test-hint">{mailbox?.configured ? 'Zadarma confirms voicemail for no answer or unavailable.' : 'Voicemail has not been enabled for this agent.'} Automatic delivery into the phone’s Voicemail tab requires the receiving mailbox integration to be connected and tested.</p>
    </section>
  </section>;
}
