export type TransferMetricSummary = {
  transfers_requested_today?: number;
  transfers_requested_week?: number;
  talkroute_dialed_today?: number;
  talkroute_dialed_week?: number;
  agent_answered_today?: number;
  agent_answered_week?: number;
  bridge_confirmed_today?: number;
  bridge_confirmed_week?: number;
  transfer_failed_unverified_today?: number;
  transfer_failed_unverified_week?: number;
};

type MetricWindow = {
  requested: number;
  dialed: number;
  answered: number;
  bridged: number;
  failed: number;
  unverified: number;
};

export function transferMetricsForWindow(
  summary: TransferMetricSummary,
  window: 'today' | 'week' | 'all',
): MetricWindow {
  if (window === 'today') {
    return {
      requested: summary.transfers_requested_today ?? 0,
      dialed: summary.talkroute_dialed_today ?? 0,
      answered: summary.agent_answered_today ?? 0,
      bridged: summary.bridge_confirmed_today ?? 0,
      failed: 0,
      unverified: summary.transfer_failed_unverified_today ?? 0,
    };
  }
  if (window === 'week') {
    return {
      requested: summary.transfers_requested_week ?? 0,
      dialed: summary.talkroute_dialed_week ?? 0,
      answered: summary.agent_answered_week ?? 0,
      bridged: summary.bridge_confirmed_week ?? 0,
      failed: 0,
      unverified: summary.transfer_failed_unverified_week ?? 0,
    };
  }
  return {
    requested: summary.transfers_requested_week ?? 0,
    dialed: summary.talkroute_dialed_week ?? 0,
    answered: summary.agent_answered_week ?? 0,
    bridged: summary.bridge_confirmed_week ?? 0,
    failed: 0,
    unverified: summary.transfer_failed_unverified_week ?? 0,
  };
}
