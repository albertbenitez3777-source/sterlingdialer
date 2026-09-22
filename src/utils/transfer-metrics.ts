type MetricName = 'transfers_requested' | 'talkroute_dialed' | 'agent_answered' | 'bridge_confirmed' | 'confirmed_transfer_failures' | 'transfer_failed_unverified';
export type TransferMetricSummary = Partial<Record<`${MetricName}_${'today' | 'week' | 'all'}`, number>>;
type MetricWindow = { requested: number; dialed: number; answered: number; bridged: number; failed: number; unverified: number };
export function transferMetricsForWindow(summary: TransferMetricSummary, window: 'today' | 'week' | 'all'): MetricWindow {
  return {
    requested: summary[`transfers_requested_${window}`] ?? 0,
    dialed: summary[`talkroute_dialed_${window}`] ?? 0,
    answered: summary[`agent_answered_${window}`] ?? 0,
    bridged: summary[`bridge_confirmed_${window}`] ?? 0,
    failed: summary[`confirmed_transfer_failures_${window}`] ?? 0,
    unverified: summary[`transfer_failed_unverified_${window}`] ?? 0,
  };
}
