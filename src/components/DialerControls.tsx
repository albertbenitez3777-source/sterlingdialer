import { Headphones, Pause, Play, Users, Voicemail, Zap } from 'lucide-react';

type Agent = { id: string; full_name: string; role: string; status: string; active_for_dialer: boolean; dialer_concurrency: number; phone_ready?: boolean; transfer_certified: boolean; inbound_configured?: boolean };
interface Props {
  agents: Agent[]; lines: number; running: boolean; saving: boolean; changingAgent: string | null;
  starting: boolean; stopping: boolean; notice: string | null;
  onLines: (lines: number) => void; onAgent: (id: string, selected: boolean) => void;
  onStart: () => void; onStop: () => void;
}

export function DialerControls({ agents, lines, running, saving, changingAgent, starting, stopping, notice, onLines, onAgent, onStart, onStop }: Props) {
  const roster = agents.filter(a => a.status === 'active' && !['owner', 'administrator'].includes(a.role));
  const selected = roster.filter(a => a.active_for_dialer);
  const capacity = Math.min(lines, selected.reduce((n, a) => n + Math.min(a.dialer_concurrency || 3, 7), 0));
  const changing = saving || changingAgent !== null || starting || stopping;
  return <section className="f1-dialer-controls" aria-label="Dialer controls">
    <header><div><span className="f1-control-eyebrow"><Zap size={13} /> {running ? "DIALER RUNNING" : "DIALER STOPPED"}</span><h2>Call controls</h2></div>
      <button className={running ? 'f1-control-stop' : 'f1-control-start'} disabled={running ? stopping : changing || !selected.length} onClick={running ? onStop : onStart}>
        {running ? <Pause size={17} /> : <Play size={17} />}{stopping ? 'Stopping…' : starting ? 'Starting…' : running ? 'Stop Dialer' : 'Start Dialer'}
      </button>
    </header>
    <div className="f1-control-settings">
      <div><label>Speed presets</label><div className="f1-control-presets">{[1, 2, 3, 4].map(m => <button key={m} disabled={changing} aria-pressed={lines === m * 3} onClick={() => onLines(m * 3)}>{m}×<small>{m * 3} lines</small></button>)}</div></div>
      <div className="f1-control-line-choice"><label htmlFor="dialer-simultaneous-lines">Lines at a time</label><select id="dialer-simultaneous-lines" value={lines} disabled={changing} onChange={e => onLines(Number(e.target.value))}>{Array.from({length:12}, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} {n === 1 ? 'line' : 'lines'}</option>)}</select><small>Total across your selected agents</small></div>
      <div className="f1-control-summary"><strong>{lines}<span>simultaneous line limit</span></strong><small>{selected.length} of {roster.length} agents selected{capacity < lines ? ` · current capacity ${capacity} lines` : ''}</small></div>
    </div>
    <div className="f1-control-team-heading"><h3><Users size={16} /> Agents receiving dialer calls</h3><span>Changes save automatically</span></div>
    <div className="f1-control-agents">{roster.map(a => <article key={a.id} className={a.active_for_dialer ? 'selected' : ''}>
      <div className="f1-control-agent-top"><strong>{a.full_name}</strong><button role="switch" aria-checked={a.active_for_dialer} aria-label={`Dialer calls for ${a.full_name}`} disabled={changing} onClick={() => onAgent(a.id, a.active_for_dialer)}><i /><span>{changingAgent === a.id ? 'Saving…' : a.active_for_dialer ? 'On' : 'Off'}</span></button></div>
      <p>{a.active_for_dialer ? 'Selected for new calls' : 'No new dialer calls'}</p>
      <small>{a.phone_ready ? <Headphones size={13} /> : <Voicemail size={13} />}{a.phone_ready ? 'Desktop phone ready' : 'Desktop offline · voicemail available'}</small>
      {a.active_for_dialer && (!a.transfer_certified || !a.inbound_configured) && <small className="f1-control-warning">Route needs verification before dialing</small>}
    </article>)}</div>
    {!selected.length && <p className="f1-control-warning" role="status">Choose at least one agent to send new dialer calls.</p>}
    <p className="f1-control-footnote">Only selected agents receive new AI dialer calls. Unanswered transfers go to their voicemail. Existing calls and incoming callbacks continue when an agent is switched off.</p>
    {notice && <p className="f1-control-feedback" role="status">{notice}</p>}
  </section>;
}
