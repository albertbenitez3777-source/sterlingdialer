export type TransferWindow = 'today' | 'week' | 'all';

type TransferMetric = 'transfers_requested' | 'talkroute_dialed' | 'agent_answered' |
  'bridge_confirmed' | 'confirmed_transfer_failures';
type LegacyFunnel = { transfers_requested?: number; talkroute_answered?: number; bridge_confirmed?: number };

export type TransferMetricSummary = Partial<Record<`${TransferMetric}_${TransferWindow}`, number>> & {
  funnel_today?: LegacyFunnel; funnel_week?: LegacyFunnel; funnel_all?: LegacyFunnel;
};

function firstCount(...values: unknown[]): number {
  const value = values.find(v => typeof v === 'number' && Number.isFinite(v));
  return typeof value === 'number' ? Math.max(0, value) : 0;
}

// Each stage uses its own evidence. An answer count cannot stand in for dialed
// destinations, and missing answer evidence is not an explicit transfer failure.
export function transferMetricsForWindow(summary: TransferMetricSummary, window: TransferWindow) {
  const funnel = summary[`funnel_${window}`];
  const requested = firstCount(summary[`transfers_requested_${window}`], funnel?.transfers_requested);
  const dialed = firstCount(summary[`talkroute_dialed_${window}`]);
  const answered = firstCount(summary[`agent_answered_${window}`], funnel?.talkroute_answered);
  const bridged = firstCount(summary[`bridge_confirmed_${window}`], funnel?.bridge_confirmed);
  const failed = firstCount(summary[`confirmed_transfer_failures_${window}`]);
  return { requested, dialed, answered, bridged, failed,
    unverified: Math.max(0, requested - bridged - failed) };
}
