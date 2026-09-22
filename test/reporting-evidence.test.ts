import { describe, expect, it } from 'vitest';
import { transferMetricsForWindow } from '../src/utils/transfer-metrics';
import { buildMonotonicFunnel, capAgentMonotonic, type FunnelData } from '../src/utils/funnel';

describe('reported call evidence', () => {
  it('keeps all-time evidence separate from the current week', () => {
    const result = transferMetricsForWindow({transfers_requested_week:7,transfers_requested_all:1748,agent_answered_week:2,agent_answered_all:120,confirmed_transfer_failures_all:4},'all');
    expect(result).toMatchObject({requested:1748,answered:120,failed:4});
    expect(transferMetricsForWindow({transfers_requested_week:7},'all').requested).toBe(0);
  });
  it('preserves a bridge when earlier phone evidence is missing', () => {
    const data: FunnelData = {calls_attempted:100,live_humans_reached:20,transfers_requested:10,talkroute_dialed:9,agent_answered:0,bridge_confirmed:4,likely_real_conversation:2,transfer_failed_unverified:5,data_quality_exceptions:0,total_minutes:10,productive_minutes:1,wasted_minutes:3,machine_minutes:2,avg_ai_leg_seconds:10,machines_detected:30,avg_machine_seconds:4};
    const result=buildMonotonicFunnel(data);
    expect(result.stages.map(s=>s.value)).toEqual([100,20,10,9,0,4,2]);
    expect(result.exceptions).toBeGreaterThan(0);
    expect(result.sideOutcome).toBe(5);
  });
  it('does not hide agent transfers when human classification is missing', () => {
    expect(capAgentMonotonic({calls_attempted:10,live_humans:0,transfers_requested:2,bridge_confirmed:1})).toMatchObject({attempted:10,live:0,transfers:2,bridged:1,exceptions:2});
  });
});
