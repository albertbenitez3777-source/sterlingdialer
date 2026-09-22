export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  color: string;
  description: string;
  isHeadline?: boolean;
  isEstimate?: boolean;
}

export interface FunnelData {
  calls_attempted: number;
  live_humans_reached: number;
  transfers_requested: number;
  talkroute_dialed: number;
  agent_answered: number;
  bridge_confirmed: number;
  likely_real_conversation: number;
  transfer_failed_unverified: number;
  data_quality_exceptions: number;
  total_minutes: number;
  productive_minutes: number;
  wasted_minutes: number;
  machine_minutes: number;
  avg_ai_leg_seconds: number;
  machines_detected: number;
  avg_machine_seconds: number;
}

export const STAGE_DEFINITIONS: Record<string, string> = {
  attempted: 'Provider accepted an outbound call in the selected window.',
  live_human: 'Outbound call classified as a live human by the call-processing system; not identity verification.',
  transfer_requested: 'Outbound call with an explicit transfer-request timestamp.',
  destination_dialed: 'The provider dialed the assigned Zadarma number.',
  agent_answered: 'An inbound Zadarma answer linked to this outbound call, excluding voicemail.',
  bridge_confirmed: 'Agent-answered call meeting the strict bridge-confirm predicate.',
  likely_real_conversation: 'Provider-confirmed bridge with at least 45 post-transfer seconds and recorded representative speech evidence.',
};

export function buildMonotonicFunnel(data: FunnelData): { stages: FunnelStage[]; exceptions: number; sideOutcome: number } {
  const attempted = Math.max(0, data.calls_attempted);
  const liveHuman = Math.max(0, data.live_humans_reached);
  const transferRequested = Math.max(0, data.transfers_requested);
  const destinationDialed = Math.max(0, data.talkroute_dialed);
  const agentAnswered = Math.max(0, data.agent_answered);
  const bridgeConfirmed = Math.max(0, data.bridge_confirmed);
  const likelyReal = Math.max(0, data.likely_real_conversation);

  const exceptions =
    Math.max(0, data.live_humans_reached - attempted) +
    Math.max(0, data.transfers_requested - liveHuman) +
    Math.max(0, data.talkroute_dialed - transferRequested) +
    Math.max(0, data.agent_answered - destinationDialed) +
    Math.max(0, data.bridge_confirmed - agentAnswered) +
    Math.max(0, data.likely_real_conversation - bridgeConfirmed);

  const stages: FunnelStage[] = [
    { key: 'attempted', label: 'Calls Attempted', value: attempted, color: 'var(--sage-400)', description: STAGE_DEFINITIONS.attempted },
    { key: 'live_human', label: 'Human-classified Calls', value: liveHuman, color: 'var(--gold-300)', description: STAGE_DEFINITIONS.live_human },
    { key: 'transfer_requested', label: 'Transfer Requested', value: transferRequested, color: 'var(--rust-400)', description: STAGE_DEFINITIONS.transfer_requested },
    { key: 'destination_dialed', label: 'Zadarma Destination Dialed', value: destinationDialed, color: 'var(--steel-300)', description: STAGE_DEFINITIONS.destination_dialed },
    { key: 'agent_answered', label: 'Agent Answer Confirmed', value: agentAnswered, color: 'var(--sage-300)', description: STAGE_DEFINITIONS.agent_answered },
    { key: 'bridge_confirmed', label: 'Bridge Confirmed', value: bridgeConfirmed, color: 'var(--sage-400)', description: STAGE_DEFINITIONS.bridge_confirmed, isHeadline: true },
    { key: 'likely_real_conversation', label: 'Post-transfer Speech (45s+)', value: likelyReal, color: 'var(--gold-200)', description: STAGE_DEFINITIONS.likely_real_conversation, isEstimate: true },
  ];

  return { stages, exceptions, sideOutcome: Math.max(0, data.transfer_failed_unverified) };
}

export function isMonotonic(data: FunnelData): boolean {
  return (
    data.calls_attempted >= data.live_humans_reached &&
    data.live_humans_reached >= data.transfers_requested &&
    data.transfers_requested >= data.talkroute_dialed &&
    data.talkroute_dialed >= data.agent_answered &&
    data.agent_answered >= data.bridge_confirmed &&
    data.bridge_confirmed >= data.likely_real_conversation
  );
}

export interface AgentPerfData {
  calls_attempted: number;
  live_humans: number;
  transfers_requested: number;
  bridge_confirmed: number;
}

export interface CappedAgentPerf {
  attempted: number;
  live: number;
  transfers: number;
  bridged: number;
  exceptions: number;
}

export function capAgentMonotonic(raw: AgentPerfData): CappedAgentPerf {
  const attempted = Math.max(0, raw.calls_attempted);
  const live = Math.max(0, raw.live_humans);
  const transfers = Math.max(0, raw.transfers_requested);
  const bridged = Math.max(0, raw.bridge_confirmed);
  const exceptions =
    Math.max(0, raw.live_humans - attempted) +
    Math.max(0, raw.transfers_requested - live) +
    Math.max(0, raw.bridge_confirmed - transfers);
  return { attempted, live, transfers, bridged, exceptions };
}
