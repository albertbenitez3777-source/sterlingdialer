import { useState, useCallback, type ReactNode } from 'react';
import {
  Activity, Phone, PhoneCall, Users, Radio, ArrowRight, Check,
  ChevronRight, AlertTriangle, Shield, X, Clock, PhoneOff,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────

export type NodeState = 'green' | 'yellow' | 'red' | 'gray';
type TimeFilter = 'today' | 'week' | 'all';

export interface AgentHealthRow {
  id: string;
  full_name: string;
  attempts_today: number; attempts_week: number; attempts_all: number;
  live_humans_today: number; live_humans_week: number; live_humans_all: number;
  transfers_requested_today: number; transfers_requested_week: number; transfers_requested_all: number;
  talkroute_dialed_today: number; talkroute_dialed_week: number; talkroute_dialed_all: number;
  agent_answered_today: number; agent_answered_week: number; agent_answered_all: number;
  bridge_confirmed_today: number; bridge_confirmed_week: number; bridge_confirmed_all: number;
  failed_today: number; failed_week: number; failed_all: number;
}

export interface HealthNode {
  key: string;
  label: string;
  icon: ReactNode;
  state: NodeState;
  value: number | string;
  detail: string;
  recommendation?: string;
}

export interface HealthMapProps {
  campaignState: string;
  dialerActivated: boolean;
  callsToday: number;
  callsWeek: number;
  callsAll: number;
  liveHumansToday: number;
  liveHumansWeek: number;
  liveHumansAll: number;
  transfersRequestedToday: number;
  transfersRequestedWeek: number;
  transfersRequestedAll: number;
  talkrouteDialedToday: number;
  talkrouteDialedWeek: number;
  talkrouteDialedAll: number;
  agentAnsweredToday: number;
  agentAnsweredWeek: number;
  agentAnsweredAll: number;
  bridgeConfirmedToday: number;
  bridgeConfirmedWeek: number;
  bridgeConfirmedAll: number;
  leadsRemaining: number;
  errorsRecent: Array<{ error_type: string; reason: string }>;
  agentsReachable: number;
  inboundConfiguredCount: number;
  totalAgentCount: number;
  blockingReason: string;
  lastRefreshed: number | null;
  agents: AgentHealthRow[];
  failedToday: number;
  failedWeek: number;
  failedAll: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const FAILURE_THRESHOLD = 3;

function deriveNodeState(
  value: number,
  campaignStopped: boolean,
  errorCount: number,
): NodeState {
  if (campaignStopped && value === 0) return 'gray';
  if (value > 0 && errorCount === 0) return 'green';
  if (value > 0 && errorCount > 0 && errorCount < FAILURE_THRESHOLD) return 'yellow';
  if (errorCount >= FAILURE_THRESHOLD && !campaignStopped) return 'red';
  if (value === 0 && !campaignStopped) return 'yellow';
  return 'gray';
}

const stateLabel: Record<NodeState, string> = {
  green: 'Verified',
  yellow: 'Waiting',
  red: 'Failure',
  gray: 'Idle',
};

const stateAriaLabel: Record<NodeState, string> = {
  green: 'Status: verified and operational',
  yellow: 'Status: waiting or data pending',
  red: 'Status: confirmed failure detected',
  gray: 'Status: idle or stopped',
};

function maskValue(v: number): string {
  return v.toLocaleString();
}

// ── Build nodes from stats ───────────────────────────────────────────────

function buildNodes(props: HealthMapProps, filter: TimeFilter): HealthNode[] {
  const stopped = props.campaignState !== 'running';
  const calls = filter === 'today' ? props.callsToday
    : filter === 'week' ? props.callsWeek : props.callsAll;
  const live = filter === 'today' ? props.liveHumansToday
    : filter === 'week' ? props.liveHumansWeek : props.liveHumansAll;
  const txReq = filter === 'today' ? props.transfersRequestedToday
    : filter === 'week' ? props.transfersRequestedWeek : props.transfersRequestedAll;
  const trDialed = filter === 'today' ? props.talkrouteDialedToday
    : filter === 'week' ? props.talkrouteDialedWeek : props.talkrouteDialedAll;
  const agentAns = filter === 'today' ? props.agentAnsweredToday
    : filter === 'week' ? props.agentAnsweredWeek : props.agentAnsweredAll;
  const bridged = filter === 'today' ? props.bridgeConfirmedToday
    : filter === 'week' ? props.bridgeConfirmedWeek : props.bridgeConfirmedAll;
  const failed = filter === 'today' ? props.failedToday
    : filter === 'week' ? props.failedWeek : props.failedAll;

  const transferErrors = props.errorsRecent.filter(e =>
    e.error_type === 'transfer_failure' || e.reason?.toLowerCase().includes('transfer')
  );

  return [
    {
      key: 'attempts',
      label: 'Attempts',
      icon: <Activity size={16} />,
      state: stopped && calls === 0 ? 'gray' : calls > 0 ? 'green' : 'yellow',
      value: maskValue(calls),
      detail: stopped
        ? `Campaign stopped. ${maskValue(props.leadsRemaining)} leads remaining.`
        : `${maskValue(calls)} calls attempted. ${maskValue(props.leadsRemaining)} leads remaining.`,
      recommendation: stopped ? 'Start the campaign when ready.' : undefined,
    },
    {
      key: 'live_humans',
      label: 'Live Humans',
      icon: <Users size={16} />,
      state: deriveNodeState(live, stopped, 0),
      value: maskValue(live),
      detail: `${maskValue(live)} live humans reached from ${maskValue(calls)} attempts.`,
    },
    {
      key: 'transfer_requested',
      label: 'Transfer Req.',
      icon: <Radio size={16} />,
      state: deriveNodeState(txReq, stopped, transferErrors.length),
      value: maskValue(txReq),
      detail: `${maskValue(txReq)} transfers requested from ${maskValue(live)} live humans.`,
      recommendation: transferErrors.length > 0
        ? `${transferErrors.length} transfer error(s) detected. Check agent Talkroute numbers.`
        : undefined,
    },
    {
      key: 'talkroute_dialed',
      label: 'Talkroute Dialed',
      icon: <Phone size={16} />,
      state: deriveNodeState(trDialed, stopped, 0),
      value: maskValue(trDialed),
      detail: `${maskValue(trDialed)} Talkroute destinations dialed for delivery.`,
    },
    {
      key: 'agent_answered',
      label: 'Agent Answered',
      icon: <PhoneCall size={16} />,
      state: deriveNodeState(agentAns, stopped, 0),
      value: maskValue(agentAns),
      detail: `${maskValue(agentAns)} agents answered the incoming transfer.`,
    },
    {
      key: 'bridge_confirmed',
      label: 'Bridge Confirmed',
      icon: <Check size={16} />,
      state: deriveNodeState(bridged, stopped, 0),
      value: maskValue(bridged),
      detail: `${maskValue(bridged)} transfers verified via speech analysis or MERGED bridge predicate.`,
    },
    {
      key: 'failed',
      label: 'Failed',
      icon: <PhoneOff size={16} />,
      state: failed === 0 ? (stopped ? 'gray' : 'green') :
        failed < FAILURE_THRESHOLD ? 'yellow' :
          (!stopped ? 'red' : 'yellow'),
      value: maskValue(failed),
      detail: `${maskValue(failed)} transfers have an explicit failure result. Transfers awaiting answer evidence are listed separately as unverified.`,
      recommendation: failed > 0 ? 'Review failure reasons in the Transfer Verification Timeline.' : undefined,
    },
  ];
}

// ── Build per-agent rows ─────────────────────────────────────────────────

function agentRowState(attempts: number, bridged: number, failed: number, unverified: number, stopped: boolean): NodeState {
  if (stopped && attempts === 0) return 'gray';
  if (failed > 0) return stopped ? 'yellow' : 'red';
  if (unverified > 0) return 'yellow';
  if (bridged > 0) return 'green';
  if (attempts > 0) return 'yellow';
  return 'gray';
}

function pickAgent(row: AgentHealthRow, f: 'today' | 'week' | 'all') {
  const s = f === 'week' ? '_week' : f === 'all' ? '_all' : '_today';
  return {
    attempts: row[`attempts${s}`] as number,
    live_humans: row[`live_humans${s}`] as number,
    transfers_requested: row[`transfers_requested${s}`] as number,
    talkroute_dialed: row[`talkroute_dialed${s}`] as number,
    agent_answered: row[`agent_answered${s}`] as number,
    bridge_confirmed: row[`bridge_confirmed${s}`] as number,
    failed: row[`failed${s}`] as number,
    unverified: Math.max(0, row[`transfers_requested${s}`] - row[`bridge_confirmed${s}`] - row[`failed${s}`]),
  };
}

// ── Detail Drawer ────────────────────────────────────────────────────────

function DetailDrawer({ node, onClose }: { node: HealthNode; onClose: () => void }) {
  return (
    <div
      className="healthmap-drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${node.label} details`}
    >
      <div className="healthmap-drawer" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="healthmap-drawer-header">
          <div className={`healthmap-node-icon ${node.state}`}>{node.icon}</div>
          <div>
            <h3>{node.label}</h3>
            <span className={`healthmap-state-badge ${node.state}`}>{stateLabel[node.state]}</span>
          </div>
        </div>
        <div className="healthmap-drawer-value">{node.value}</div>
        <p className="healthmap-drawer-detail">{node.detail}</p>
        {node.recommendation && (
          <div className="healthmap-recommendation">
            <AlertTriangle size={14} />
            <span>{node.recommendation}</span>
          </div>
        )}
        <div className="healthmap-disclaimer">
          <Shield size={12} />
          <span>Software verified only. Physical device ring and two-way audio not yet validated on hardware.</span>
        </div>
      </div>
    </div>
  );
}

// ── Connector ────────────────────────────────────────────────────────────

function Connector({ state }: { state: NodeState }) {
  return (
    <div className={`healthmap-connector ${state}`} aria-hidden="true">
      <div className="healthmap-connector-line" />
      <ArrowRight size={10} />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────

export function LiveHealthMap(props: HealthMapProps) {
  const [filter, setFilter] = useState<TimeFilter>('today');
  const [selectedNode, setSelectedNode] = useState<HealthNode | null>(null);
  const [showAgents, setShowAgents] = useState(false);

  const nodes = buildNodes(props, filter);
  const stopped = props.campaignState !== 'running';

  const handleNodeClick = useCallback((node: HealthNode) => {
    setSelectedNode(node);
  }, []);

  const lastRefreshedLabel = props.lastRefreshed
    ? `${Math.round((Date.now() - props.lastRefreshed) / 1000)}s ago`
    : 'loading...';

  const filters: { key: TimeFilter; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'Week' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="healthmap-panel" role="region" aria-label="Live Operations Health Map">
      <div className="healthmap-header">
        <div>
          <div className="eyebrow"><Activity size={12} /> OPERATIONS HEALTH</div>
          <h3>Live Operations Health Map</h3>
        </div>
        <div className="healthmap-controls">
          <div className="healthmap-filters" role="tablist" aria-label="Time filter">
            {filters.map(f => (
              <button
                key={f.key}
                className={`healthmap-filter-btn ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
                role="tab"
                aria-selected={filter === f.key}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="healthmap-updated">
            <Clock size={11} /> Updated {lastRefreshedLabel}
          </div>
        </div>
      </div>

      {/* Desktop/iPad topology */}
      <div className="healthmap-topology" aria-label="Operations flow diagram">
        <div className="healthmap-main-track">
          {nodes.map((node, i) => (
            <div key={node.key} className="healthmap-stage-group">
              <button
                className={`healthmap-node ${node.state}`}
                onClick={() => handleNodeClick(node)}
                aria-label={`${node.label}: ${node.value}. ${stateAriaLabel[node.state]}`}
                title={`${node.label} — ${stateLabel[node.state]}`}
              >
                <div className="healthmap-node-icon-wrap">{node.icon}</div>
                <span className="healthmap-node-label">{node.label}</span>
                <span className="healthmap-node-value">{node.value}</span>
              </button>
              {i < nodes.length - 1 && <Connector state={nodes[i + 1].state} />}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile timeline */}
      <div className="healthmap-timeline" aria-label="Operations status list">
        {nodes.map((node, i) => (
          <div key={node.key} className="healthmap-timeline-item">
            <button
              className={`healthmap-timeline-node ${node.state}`}
              onClick={() => handleNodeClick(node)}
              aria-label={`${node.label}: ${node.value}. ${stateAriaLabel[node.state]}`}
            >
              <div className="healthmap-node-icon-wrap">{node.icon}</div>
              <div className="healthmap-timeline-text">
                <span className="healthmap-node-label">{node.label}</span>
                <span className="healthmap-node-value">{node.value}</span>
              </div>
              <span className={`healthmap-state-badge ${node.state}`}>{stateLabel[node.state]}</span>
              <ChevronRight size={14} className="healthmap-chevron" />
            </button>
            {i < nodes.length - 1 && <div className={`healthmap-timeline-connector ${nodes[i + 1].state}`} aria-hidden="true" />}
          </div>
        ))}
      </div>

      {/* Per-agent breakdown */}
      {props.agents.length > 0 && (
        <div className="healthmap-agents-section">
          <button
            className="healthmap-agents-toggle"
            onClick={() => setShowAgents(!showAgents)}
            aria-expanded={showAgents}
          >
            <Users size={13} />
            <span>Per-Agent Breakdown ({props.agents.length})</span>
            <ChevronRight size={14} className={`healthmap-toggle-chevron ${showAgents ? 'open' : ''}`} />
          </button>
          {showAgents && (
            <div className="healthmap-agents-table-wrap">
              <table className="healthmap-agents-table" aria-label="Per-agent transfer pipeline">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Attempts</th>
                    <th>Live</th>
                    <th>TX Req.</th>
                    <th>TR Dialed</th>
                    <th>Answered</th>
                    <th>Bridged</th>
                    <th>Failed</th>
                    <th>Unverified</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {props.agents.map(row => {
                    const v = pickAgent(row, filter);
                    const state = agentRowState(v.attempts, v.bridge_confirmed, v.failed, v.unverified, stopped);
                    return (
                      <tr key={row.id} className={`healthmap-agent-row ${state}`}>
                        <td className="healthmap-agent-name">{row.full_name}</td>
                        <td>{maskValue(v.attempts)}</td>
                        <td>{maskValue(v.live_humans)}</td>
                        <td>{maskValue(v.transfers_requested)}</td>
                        <td>{maskValue(v.talkroute_dialed)}</td>
                        <td>{maskValue(v.agent_answered)}</td>
                        <td className="healthmap-bridged-cell">{maskValue(v.bridge_confirmed)}</td>
                        <td className={v.failed > 0 ? 'healthmap-failed-cell' : ''}>{maskValue(v.failed)}</td>
                        <td>{maskValue(v.unverified)}</td>
                        <td><span className={`healthmap-state-badge ${state}`}>{stateLabel[state]}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="healthmap-footer">
        <Shield size={11} />
        <span>Software-verified status only. Physical ring and two-way audio validation pending on hardware.</span>
      </div>

      {selectedNode && <DetailDrawer node={selectedNode} onClose={() => setSelectedNode(null)} />}
    </div>
  );
}
