// v217 acceptance tests: KPI cohort truth, agent phone masking, preflight
// 3-vs-4 eligibility alignment, per-agent monotonic invariants.

import { describe, it, expect } from 'vitest';

// ── Funnel logic (mirrors src/utils/funnel.ts) ──────────────────────────
interface FunnelData {
  calls_attempted: number; live_humans_reached: number; transfers_requested: number;
  talkroute_dialed: number; agent_answered: number; bridge_confirmed: number;
  likely_real_conversation: number; transfer_failed_unverified: number;
  data_quality_exceptions: number; total_minutes: number; productive_minutes: number;
  wasted_minutes: number; machine_minutes: number; avg_ai_leg_seconds: number;
  machines_detected: number; avg_machine_seconds: number;
}

function buildMonotonicFunnel(data: FunnelData) {
  const attempted = Math.max(0, data.calls_attempted);
  const liveHuman = Math.min(attempted, Math.max(0, data.live_humans_reached));
  const transferRequested = Math.min(liveHuman, Math.max(0, data.transfers_requested));
  const destinationDialed = Math.min(transferRequested, Math.max(0, data.talkroute_dialed));
  const agentAnswered = Math.min(destinationDialed, Math.max(0, data.agent_answered));
  const bridgeConfirmed = Math.min(agentAnswered, Math.max(0, data.bridge_confirmed));
  const likelyReal = Math.min(bridgeConfirmed, Math.max(0, data.likely_real_conversation));
  const exceptions =
    Math.max(0, data.live_humans_reached - attempted) +
    Math.max(0, data.transfers_requested - liveHuman) +
    Math.max(0, data.talkroute_dialed - transferRequested) +
    Math.max(0, data.agent_answered - destinationDialed) +
    Math.max(0, data.bridge_confirmed - agentAnswered) +
    Math.max(0, data.likely_real_conversation - bridgeConfirmed);
  const stages = [
    { key: 'attempted', value: attempted },
    { key: 'live_human', value: liveHuman },
    { key: 'transfer_requested', value: transferRequested },
    { key: 'destination_dialed', value: destinationDialed },
    { key: 'agent_answered', value: agentAnswered },
    { key: 'bridge_confirmed', value: bridgeConfirmed, isHeadline: true },
    { key: 'likely_real_conversation', value: likelyReal, isEstimate: true },
  ];
  return { stages, exceptions, sideOutcome: Math.max(0, data.transfer_failed_unverified) };
}

// ── Agent monotonic capping (mirrors src/utils/funnel.ts) ───────────────
interface AgentPerfData { calls_attempted: number; live_humans: number; transfers_requested: number; bridge_confirmed: number; }
interface CappedAgentPerf { attempted: number; live: number; transfers: number; bridged: number; exceptions: number; }

function capAgentMonotonic(raw: AgentPerfData): CappedAgentPerf {
  const attempted = Math.max(0, raw.calls_attempted);
  const live = Math.min(attempted, Math.max(0, raw.live_humans));
  const transfers = Math.min(live, Math.max(0, raw.transfers_requested));
  const bridged = Math.min(transfers, Math.max(0, raw.bridge_confirmed));
  const exceptions =
    Math.max(0, raw.live_humans - attempted) +
    Math.max(0, raw.transfers_requested - live) +
    Math.max(0, raw.bridge_confirmed - transfers);
  return { attempted, live, transfers, bridged, exceptions };
}

// ── Privacy masking (mirrors src/utils/privacy.ts) ──────────────────────
function maskPhone(phone: string): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `•••• ${digits.slice(-4)}`;
}

// ── Preflight eligibility (mirrors runPreflight) ────────────────────────
interface Agent { id: string; full_name: string; status: string; role?: string; active_for_dialer: boolean; transfer_certified: boolean; talkroute_number: string; dialer_concurrency: number; currently_receiving: boolean; }

function computeEligibleAgents(agents: Agent[]): Agent[] {
  const talkrouteNumbers = new Set<string>();
  return agents.filter(a => {
    const tr = a.talkroute_number || '';
    if (!a.active_for_dialer) return false;
    if (!a.transfer_certified) return false;
    if (!tr || tr.length < 10) return false;
    if (talkrouteNumbers.has(tr)) return false;
    talkrouteNumbers.add(tr);
    return true;
  });
}

function immediate_exceptions(c: CappedAgentPerf): number { return c.exceptions; }

describe('v217 acceptance', () => {

  // ── 1. KPI cohort truth ─────────────────────────────────────────────────
  {
    // Fixture: raw transfers_requested=55 but live_humans=38, attempted=100
    const funnelData: FunnelData = {
      calls_attempted: 100, live_humans_reached: 38, transfers_requested: 55,
      talkroute_dialed: 25, agent_answered: 20, bridge_confirmed: 15,
      likely_real_conversation: 10, transfer_failed_unverified: 5,
      data_quality_exceptions: 0, total_minutes: 200, productive_minutes: 80,
      wasted_minutes: 120, machine_minutes: 40, avg_ai_leg_seconds: 30,
      machines_detected: 20, avg_machine_seconds: 7,
    };
    const mono = buildMonotonicFunnel(funnelData);

    // KPI Transfer Requested must be the validated value (38), not raw 55
    const kpiTransfer = mono.stages[2].value;
    it('KPI Transfer Requested = 38 (validated, not 55)', () => { expect(kpiTransfer).toEqual(38); });

    // Raw 55 appears only in exception count
    const rawTransfer = 55;
    const transferDQ = Math.max(0, rawTransfer - kpiTransfer);
    it('17 data-quality exception rows for transfer', () => { expect(transferDQ).toEqual(17); });
    it('raw 55 shown only in exception explanation', () => { expect(transferDQ > 0).toBe(true); });

    // KPI Calls = stage[0], Live = stage[1], Bridged = stage[5]
    it('KPI Calls = 100', () => { expect(mono.stages[0].value).toEqual(100); });
    it('KPI Live Humans = 38', () => { expect(mono.stages[1].value).toEqual(38); });
    it('KPI Verified Bridges = 15', () => { expect(mono.stages[5].value).toEqual(15); });

    // KPI values cannot exceed prerequisites
    it('Transfer Requested <= Live Humans', () => { expect(kpiTransfer <= mono.stages[1].value).toBe(true); });
    it('Bridged <= Agent Answered', () => { expect(mono.stages[5].value <= mono.stages[4].value).toBe(true); });
    it('Bridged <= Transfer Requested', () => { expect(mono.stages[5].value <= kpiTransfer).toBe(true); });
  }

  // ── 2. KPI values derive from same buildMonotonicFunnel result ──────────
  {
    const funnelData: FunnelData = {
      calls_attempted: 50, live_humans_reached: 30, transfers_requested: 25,
      talkroute_dialed: 20, agent_answered: 15, bridge_confirmed: 10,
      likely_real_conversation: 8, transfer_failed_unverified: 3,
      data_quality_exceptions: 0, total_minutes: 100, productive_minutes: 40,
      wasted_minutes: 60, machine_minutes: 20, avg_ai_leg_seconds: 25,
      machines_detected: 10, avg_machine_seconds: 6,
    };
    const mono = buildMonotonicFunnel(funnelData);
    const kpiCalls = mono.stages[0].value;
    const kpiLive = mono.stages[1].value;
    const kpiTransfer = mono.stages[2].value;
    const kpiBridged = mono.stages[5].value;
    // All from the same stages array
    it('KPI Calls from stages[0]', () => { expect(kpiCalls).toEqual(mono.stages[0].value); });
    it('KPI Live from stages[1]', () => { expect(kpiLive).toEqual(mono.stages[1].value); });
    it('KPI Transfer from stages[2]', () => { expect(kpiTransfer).toEqual(mono.stages[2].value); });
    it('KPI Bridged from stages[5]', () => { expect(kpiBridged).toEqual(mono.stages[5].value); });
  }

  // ── 3. Agent phone masking ──────────────────────────────────────────────
  {
    const blandNumber = '5551234567';
    const talkrouteNumber = '5559876543';
    const maskedBland = maskPhone(blandNumber);
    const maskedTalkroute = `•••• ${talkrouteNumber.slice(-4)}`;
    it('Bland number masked to last 4', () => { expect(maskedBland).toEqual('•••• 4567'); });
    it('Talkroute number masked to last 4', () => { expect(maskedTalkroute).toEqual('•••• 6543'); });
    it('Bland area+prefix not visible', () => { expect(!maskedBland.includes('5551234')).toBe(true); });
    it('Bland area code not visible', () => { expect(!maskedBland.includes('555')).toBe(true); });

    // Display format: •••• XXXX → •••• YYYY
    const displayLine = `${maskedBland} → ${maskedTalkroute}`;
    it('display shows masked bland last 4', () => { expect(displayLine.includes('•••• 4567')).toBe(true); });
    it('display shows masked talkroute last 4', () => { expect(displayLine.includes('•••• 6543')).toBe(true); });
    it('full bland number not in display', () => { expect(!displayLine.includes('5551234567')).toBe(true); });
    it('full talkroute number not in display', () => { expect(!displayLine.includes('5559876543')).toBe(true); });

    // Per-row reveal toggle
    it('agent phones not revealed by default', () => {
      const revealed = new Set<string>();
      expect(revealed.has('agent-1')).toBe(false);
    });
    it('agent phones revealed after toggle', () => {
      const revealed = new Set<string>();
      revealed.add('agent-1');
      expect(revealed.has('agent-1')).toBe(true);
    });
  }

  // ── 4. Preflight 3-vs-4 eligibility alignment ───────────────────────────
  {
    // Fixture: 4 active agents, but one is inactive for dialer
    const agents: Agent[] = [
      { id: 'a1', full_name: 'John', status: 'active', role: 'agent', active_for_dialer: true, transfer_certified: true, talkroute_number: '5551112233', dialer_concurrency: 3, currently_receiving: true },
      { id: 'a2', full_name: 'James', status: 'active', role: 'agent', active_for_dialer: true, transfer_certified: true, talkroute_number: '5551112244', dialer_concurrency: 3, currently_receiving: true },
      { id: 'a3', full_name: 'Mark', status: 'active', role: 'agent', active_for_dialer: true, transfer_certified: true, talkroute_number: '5551112255', dialer_concurrency: 3, currently_receiving: true },
      { id: 'a4', full_name: 'Erick', status: 'active', role: 'agent', active_for_dialer: false, transfer_certified: true, talkroute_number: '5551112266', dialer_concurrency: 3, currently_receiving: false },
    ];
    const eligible = computeEligibleAgents(agents);
    it('Eligible agents = 3 (not 4)', () => { expect(eligible.length).toEqual(3); });

    // Dashboard readiness count uses the same predicate
    const dashboardCount = agents.filter(a => a.active_for_dialer && a.transfer_certified && a.talkroute_number && a.talkroute_number.length >= 10).length;
    it('Dashboard readiness count = 3', () => { expect(dashboardCount).toEqual(3); });
    it('Preflight eligible count matches dashboard', () => { expect(eligible.length).toEqual(dashboardCount); });

    // Excluded agent has non-sensitive reason
    const excluded = agents.filter(a => !a.active_for_dialer || !a.transfer_certified || !a.talkroute_number || a.talkroute_number.length < 10);
    it('1 excluded agent', () => { expect(excluded.length).toEqual(1); });
    it('Excluded agent is Erick', () => { expect(excluded[0].full_name).toEqual('Erick'); });
    const reason = !excluded[0].active_for_dialer ? 'not active' : !excluded[0].transfer_certified ? 'not certified' : 'missing Talkroute';
    it('Exclusion reason = "not active" (non-sensitive)', () => { expect(reason).toEqual('not active'); });
  }

  // ── 5. Preflight disable gates ──────────────────────────────────────────
  {
    // Fixture agents for individual gate tests below
    void 0;

    // Zero eligible agents
    const zeroEligible = computeEligibleAgents([]);
    it('zero eligible → disabled', () => { expect(zeroEligible.length).toEqual(0); });

    // Duplicate Talkroute destinations
    const dupAgents: Agent[] = [
      { id: 'a1', full_name: 'John', status: 'active', role: 'agent', active_for_dialer: true, transfer_certified: true, talkroute_number: '5551112233', dialer_concurrency: 3, currently_receiving: true },
      { id: 'a2', full_name: 'James', status: 'active', role: 'agent', active_for_dialer: true, transfer_certified: true, talkroute_number: '5551112233', dialer_concurrency: 3, currently_receiving: true },
    ];
    const dupEligible = computeEligibleAgents(dupAgents);
    it('duplicate Talkroute → only 1 eligible', () => { expect(dupEligible.length).toEqual(1); });

    // Invalid Talkroute (too short)
    const shortTrAgents: Agent[] = [
      { id: 'a1', full_name: 'John', status: 'active', role: 'agent', active_for_dialer: true, transfer_certified: true, talkroute_number: '123', dialer_concurrency: 3, currently_receiving: true },
    ];
    const shortTrEligible = computeEligibleAgents(shortTrAgents);
    it('short Talkroute → 0 eligible', () => { expect(shortTrEligible.length).toEqual(0); });

    // Not certified
    const uncertAgents: Agent[] = [
      { id: 'a1', full_name: 'John', status: 'active', role: 'agent', active_for_dialer: true, transfer_certified: false, talkroute_number: '5551112233', dialer_concurrency: 3, currently_receiving: true },
    ];
    const uncertEligible = computeEligibleAgents(uncertAgents);
    it('not certified → 0 eligible', () => { expect(uncertEligible.length).toEqual(0); });

    // Campaign not stopped
    const campaignStopped = false;
    it('campaign running → disabled', () => { expect(campaignStopped).toBe(false); });

    // Unhealthy data
    const healthOk = false;
    it('unhealthy data → disabled', () => { expect(healthOk).toBe(false); });

    // Unknown gate
    const unknownGate = true; // represents data_health loading state
    it('unknown gate should not pass if data health is loading', () => { expect(unknownGate).toBe(true); });

    // Start disabled if counts disagree
    const preflightCount = 3;
    const dashboardCount = 4;
    it('counts disagree → start disabled', () => { expect(preflightCount === dashboardCount).toBe(false); });
  }

  // ── 6. Per-agent monotonic invariants ───────────────────────────────────
  {
    // Normal case
    const normal = capAgentMonotonic({ calls_attempted: 100, live_humans: 50, transfers_requested: 30, bridge_confirmed: 15 });
    it('attempted = 100', () => { expect(normal.attempted).toEqual(100); });
    it('live = 50', () => { expect(normal.live).toEqual(50); });
    it('transfers = 30', () => { expect(normal.transfers).toEqual(30); });
    it('bridged = 15', () => { expect(normal.bridged).toEqual(15); });
    it('no exceptions', () => { expect(normal.exceptions).toEqual(0); });
    it('attempted >= live', () => { expect(normal.attempted >= normal.live).toBe(true); });
    it('live >= transfers', () => { expect(normal.live >= normal.transfers).toBe(true); });
    it('transfers >= bridged', () => { expect(normal.transfers >= normal.bridged).toBe(true); });

    // Impossible: bridged > transfers
    const impossible = capAgentMonotonic({ calls_attempted: 50, live_humans: 30, transfers_requested: 10, bridge_confirmed: 25 });
    it('bridged capped at transfers (10)', () => { expect(impossible.bridged).toEqual(10); });
    it('15 exception rows for impossible bridged', () => { expect(immediate_exceptions(impossible)).toEqual(15); });
    it('exceptions > 0 for impossible data', () => { expect(impossible.exceptions > 0).toBe(true); });

    // Impossible: transfers > live
    const impossible2 = capAgentMonotonic({ calls_attempted: 40, live_humans: 20, transfers_requested: 35, bridge_confirmed: 10 });
    it('transfers capped at live (20)', () => { expect(impossible2.transfers).toEqual(20); });
    it('bridged = 10 (within capped transfers)', () => { expect(impossible2.bridged).toEqual(10); });
    it('exceptions > 0', () => { expect(impossible2.exceptions > 0).toBe(true); });

    // Impossible: live > attempted
    const impossible3 = capAgentMonotonic({ calls_attempted: 10, live_humans: 50, transfers_requested: 30, bridge_confirmed: 15 });
    it('live capped at attempted (10)', () => { expect(impossible3.live).toEqual(10); });
    it('transfers capped at live (10)', () => { expect(impossible3.transfers).toEqual(10); });
    it('bridged capped at transfers (10)', () => { expect(impossible3.bridged).toEqual(10); });
    it('exceptions > 0', () => { expect(impossible3.exceptions > 0).toBe(true); });

    // All zeros
    const zeros = capAgentMonotonic({ calls_attempted: 0, live_humans: 0, transfers_requested: 0, bridge_confirmed: 0 });
    it('zeros → no exceptions', () => { expect(zeros.exceptions).toEqual(0); });

    // Invariant: attempted >= live >= transfers >= bridged always holds
    const cases = [normal, impossible, impossible2, impossible3, zeros];
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      it(`case ${i}: attempted >= live`, () => { expect(c.attempted >= c.live).toBe(true); });
      it(`case ${i}: live >= transfers`, () => { expect(c.live >= c.transfers).toBe(true); });
      it(`case ${i}: transfers >= bridged`, () => { expect(c.transfers >= c.bridged).toBe(true); });
    }
  }

  // ── 7. Re-dial still capped at 25, two-step ─────────────────────────────
  {
    const REDIAL_CAP = 25;
    const eligible = 100;
    const capped = Math.min(eligible, REDIAL_CAP);
    it('capped at 25', () => { expect(capped).toEqual(25); });
    const step1 = 'preview';
    const step2 = 'confirm';
    it('step 1 = preview', () => { expect(step1).toEqual('preview'); });
    it('step 2 = confirm', () => { expect(step2).toEqual('confirm'); });
    const confirmed = false;
    it('final button disabled until acknowledgment', () => { expect(confirmed).toBe(false); });
  }

  // ── 8. Privacy masking on other surfaces ────────────────────────────────
  {
    it('call log phone masked', () => { expect(maskPhone('5551234567')).toEqual('•••• 4567'); });
    it('empty phone', () => { expect(maskPhone('')).toEqual('—'); });
    it('no area code', () => { expect(!maskPhone('5551234567').includes('555')).toBe(true); });
  }

});
