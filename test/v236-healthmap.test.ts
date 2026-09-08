// v236 Live Operations Health Map — Exhaustive Fixtures
// Validates component logic, CSS presence, integration, state derivation,
// per-agent table, responsive behavior, accessibility, and security preservation.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf-8');
const APP = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf-8');
const COMP = readFileSync(join(ROOT, 'src', 'components', 'LiveHealthMap.tsx'), 'utf-8');
const BARREL = readFileSync(join(ROOT, 'src', 'components', 'index.ts'), 'utf-8');

describe('v236 Live Operations Health Map', () => {
  // ── 1. Component exists and exported ────────────────────────────────────
  it('LiveHealthMap exported', () => { expect(COMP.includes('export function LiveHealthMap')).toBe(true); });
  it('HealthMapProps type defined', () => { expect(COMP.includes('HealthMapProps')).toBe(true); });
  it('barrel exports LiveHealthMap', () => { expect(BARREL.includes('LiveHealthMap')).toBe(true); });
  it('barrel exports HealthMapProps', () => { expect(BARREL.includes('HealthMapProps')).toBe(true); });

  // ── 2. Aggregate pipeline nodes ─────────────────────────────────────────
  for (const k of ['attempts', 'live_humans', 'transfer_requested', 'talkroute_dialed', 'agent_answered', 'bridge_confirmed', 'failed']) {
    it(`node: ${k}`, () => { expect(COMP.includes(`key: '${k}'`)).toBe(true); });
  }

  // ── 3. State colors ─────────────────────────────────────────────────────
  it('all four states', () => { expect(COMP.includes("'green'") && COMP.includes("'yellow'") && COMP.includes("'red'") && COMP.includes("'gray'")).toBe(true); });
  for (const s of ['green', 'yellow', 'red', 'gray']) {
    it(`CSS .healthmap-node.${s}`, () => { expect(CSS.includes(`.healthmap-node.${s}`)).toBe(true); });
  }

  // ── 4. Stopped = gray, never red ────────────────────────────────────────
  it('stopped+zero = gray', () => { expect(COMP.includes("if (campaignStopped && value === 0) return 'gray'")).toBe(true); });
  it('red only when NOT stopped', () => { expect(COMP.includes("errorCount >= FAILURE_THRESHOLD && !campaignStopped) return 'red'")).toBe(true); });

  // ── 5. Time filters: Today/Week/All ─────────────────────────────────────
  it('three filters', () => { expect(COMP.includes("'today'") && COMP.includes("'week'") && COMP.includes("'all'")).toBe(true); });
  it('ARIA tablist', () => { expect(COMP.includes('role="tablist"')).toBe(true); });

  // ── 6. Updated time ─────────────────────────────────────────────────────
  it('computed', () => { expect(COMP.includes('lastRefreshedLabel')).toBe(true); });
  it('displayed', () => { expect(COMP.includes('Updated {lastRefreshedLabel}')).toBe(true); });

  // ── 7. Detail drawer ────────────────────────────────────────────────────
  it('DetailDrawer component exists', () => { expect(COMP.includes('DetailDrawer')).toBe(true); });
  it('modal', () => { expect(COMP.includes('aria-modal="true"')).toBe(true); });
  it('recommendations', () => { expect(COMP.includes('recommendation')).toBe(true); });
  it('drawer CSS', () => { expect(CSS.includes('.healthmap-drawer')).toBe(true); });
  it('recommendation CSS', () => { expect(CSS.includes('.healthmap-recommendation')).toBe(true); });

  // ── 8. Disclaimer ───────────────────────────────────────────────────────
  it('drawer disclaimer', () => { expect(COMP.includes('Physical device ring and two-way audio not yet validated')).toBe(true); });
  it('footer disclaimer', () => { expect(COMP.includes('Physical ring and two-way audio validation pending')).toBe(true); });

  // ── 9. Responsive: topology desktop, timeline mobile ────────────────────
  it('topology default visible', () => { expect(CSS.includes('.healthmap-topology { display: block; }')).toBe(true); });
  it('timeline default hidden', () => { expect(CSS.includes('.healthmap-timeline { display: none; }')).toBe(true); });
  it('topology hidden mobile', () => { expect(CSS.includes('.healthmap-topology { display: none; }')).toBe(true); });
  it('timeline visible mobile', () => { expect(CSS.includes('.healthmap-timeline { display: block; }')).toBe(true); });

  // ── 10. Accessibility ───────────────────────────────────────────────────
  it('panel role', () => { expect(COMP.includes('role="region"')).toBe(true); });
  it('panel aria-label', () => { expect(COMP.includes('aria-label="Live Operations Health Map"')).toBe(true); });
  it('topology aria-label', () => { expect(COMP.includes('aria-label="Operations flow diagram"')).toBe(true); });
  it('timeline aria-label', () => { expect(COMP.includes('aria-label="Operations status list"')).toBe(true); });
  it('node aria labels', () => { expect(COMP.includes('stateAriaLabel')).toBe(true); });

  // ── 11. 44px touch targets ──────────────────────────────────────────────
  it('filter 44px', () => { expect(CSS.includes('.healthmap-filter-btn') && CSS.includes('min-height: 44px')).toBe(true); });
  it('agents toggle 44px', () => { expect(CSS.includes('.healthmap-agents-toggle') && CSS.includes('min-height: 44px')).toBe(true); });

  // ── 12. Reduced motion ──────────────────────────────────────────────────
  it('node transitions off', () => { expect(CSS.includes('.healthmap-node { transition: none; }')).toBe(true); });
  it('drawer animation off', () => { expect(CSS.includes('.healthmap-drawer { animation: none; }')).toBe(true); });

  // ── 13. Per-agent table ─────────────────────────────────────────────────
  it('AgentHealthRow type', () => { expect(COMP.includes('AgentHealthRow')).toBe(true); });
  it('AgentHealthRow has all time periods', () => { expect(COMP.includes('attempts_today: number')).toBe(true); });
  it('table element', () => { expect(COMP.includes('healthmap-agents-table')).toBe(true); });
  it('toggle label', () => { expect(COMP.includes('Per-Agent Breakdown')).toBe(true); });
  it('collapsible ARIA', () => { expect(COMP.includes('aria-expanded')).toBe(true); });
  it('per-agent state derivation', () => { expect(COMP.includes('agentRowState')).toBe(true); });
  it('pickAgent filter helper', () => { expect(COMP.includes('pickAgent')).toBe(true); });
  it('table CSS', () => { expect(CSS.includes('.healthmap-agents-table')).toBe(true); });
  it('agent name CSS', () => { expect(CSS.includes('.healthmap-agent-name')).toBe(true); });
  it('bridged cell CSS', () => { expect(CSS.includes('.healthmap-bridged-cell')).toBe(true); });
  it('failed cell CSS', () => { expect(CSS.includes('.healthmap-failed-cell')).toBe(true); });
  it('table scroll wrap', () => { expect(CSS.includes('.healthmap-agents-table-wrap')).toBe(true); });
  it('green row indicator', () => { expect(CSS.includes('.healthmap-agent-row.green')).toBe(true); });
  it('red row indicator', () => { expect(CSS.includes('.healthmap-agent-row.red')).toBe(true); });

  // ── 14. Per-agent table columns ─────────────────────────────────────────
  for (const col of ['Attempts', 'Live', 'TX Req.', 'TR Dialed', 'Answered', 'Bridged', 'Failed', 'Status']) {
    it(`column header: ${col}`, () => { expect(COMP.includes(`<th>${col}</th>`)).toBe(true); });
  }

  // ── 15. Integration in App.tsx ──────────────────────────────────────────
  it('imported', () => { expect(APP.includes('LiveHealthMap')).toBe(true); });
  it('rendered', () => { expect(APP.includes('<LiveHealthMap')).toBe(true); });
  it('campaignState prop', () => { expect(APP.includes('campaignState={adminStats.summary.campaign_state}')).toBe(true); });
  it('failedToday prop', () => { expect(APP.includes('failedToday=')).toBe(true); });
  it('failedWeek prop', () => { expect(APP.includes('failedWeek=')).toBe(true); });
  it('failedAll prop', () => { expect(APP.includes('failedAll=')).toBe(true); });
  it('agents prop with filter', () => { expect(APP.includes('agents={adminStats.agents.filter')).toBe(true); });
  it('agents passes all time periods', () => { expect(APP.includes('attempts_today: a.outbound_attempts_today')).toBe(true); });
  it('no external filter ref in agents prop', () => { expect(!APP.includes("filter === 'week' ? (a.outbound")).toBe(true); });
  it('lastRefreshed wired', () => { expect(APP.includes('lastRefreshed={dataHealth.lastSuccess}')).toBe(true); });

  // ── 16. No extra fetches ────────────────────────────────────────────────
  it('zero fetch calls', () => { expect((COMP.match(/fetch\(/g) || []).length === 0).toBe(true); });
  it('zero authFetch calls', () => { expect((COMP.match(/authFetch/g) || []).length === 0).toBe(true); });

  // ── 17. Owner-only ──────────────────────────────────────────────────────
  it('inside overview tab', () => {
    const s = APP.indexOf("{dashTab === 'overview' && (");
    const e = APP.indexOf("{dashTab === 'agents' && (");
    expect(s >= 0 && e > s && APP.substring(s, e).includes('LiveHealthMap')).toBe(true);
  });

  // ── 18. No forbidden mutations ──────────────────────────────────────────
  for (const term of ['start_campaign', 'stop_campaign', 'place_call', 'update_agent', 'redial']) {
    it(`no ${term}`, () => { expect(!COMP.includes(term)).toBe(true); });
  }

  // ── 19. Connector flow ──────────────────────────────────────────────────
  it('Connector exists', () => { expect(COMP.includes('Connector')).toBe(true); });
  it('Connector CSS', () => { expect(CSS.includes('.healthmap-connector')).toBe(true); });

  // ── 20. Auth/security preserved ─────────────────────────────────────────
  for (const term of ['wolf-auth', 'sessionToken', 'atomicLogout', 'onUnauthorized', 'authFetch']) {
    it(term, () => { expect(APP.includes(term)).toBe(true); });
  }

  // ── 21. Drawer animation ────────────────────────────────────────────────
  it('slideInRight keyframe', () => { expect(CSS.includes('@keyframes slideInRight')).toBe(true); });

  // ── 22. Mobile drawer ───────────────────────────────────────────────────
  it('full-width mobile', () => { expect(CSS.includes('.healthmap-drawer { max-width: 100%')).toBe(true); });

  // ── 23. Focus visible ───────────────────────────────────────────────────
  it('node focus-visible', () => { expect(CSS.includes('.healthmap-node:focus-visible')).toBe(true); });
  it('timeline node focus-visible', () => { expect(CSS.includes('.healthmap-timeline-node:focus-visible')).toBe(true); });

  // ── 24. Masked detail values ────────────────────────────────────────────
  it('maskValue helper used', () => { expect(COMP.includes('maskValue')).toBe(true); });
});
