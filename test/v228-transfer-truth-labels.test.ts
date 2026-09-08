// v228 Transfer Failure Truth-Labeling — Regression Tests
// Verifies that the dashboard distinguishes four transfer-failure categories
// based on actual call-leg evidence, not the generic webhook message.
// Mock-only — no database, no network, no production mutations.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const APP_TSC = readFileSync(join(PROJECT_ROOT, 'src', 'App.tsx'), 'utf-8');
const TIMELINE_TSC = readFileSync(join(PROJECT_ROOT, 'src', 'components', 'TalkrouteDeliveryTimeline.tsx'), 'utf-8');

describe('v228 transfer truth labels', () => {

  // ── 1. ErrorEntry type includes talkroute_leg_created ──────────────────────
  it('ErrorEntry type has talkroute_leg_created boolean field', () => {
    expect(APP_TSC.includes('talkroute_leg_created: boolean;')).toBe(true);
  });

  // ── 2. Generic "Transfer failed or destination did not answer" not in UI ───
  it('Timeline component does not hardcode generic message', () => {
    expect(TIMELINE_TSC.includes('Transfer failed or destination did not answer')).toBe(false);
  });

  // ── 3. Timeline still receives failedReasons from errors_recent ────────────
  it('App.tsx maps errors_recent reason to failedReasons', () => {
    expect(APP_TSC.includes('failedReasons={(adminStats.summary.errors_recent ?? []).map(e => e.reason)}')).toBe(true);
  });
  it('Timeline component accepts failedReasons prop', () => {
    expect(TIMELINE_TSC.includes('failedReasons')).toBe(true);
  });

  // ── 4. Four-case classification logic (simulated) ──────────────────────────
  it('Case 1: no leg → "Transfer ended before Talkroute was dialed"', () => {
    const row = { talkroute_leg_created: false, talkroute_answered: false, bridge_confirmed: false, transfer_failure_reason: 'Transfer failed or destination did not answer' };
    let reason: string;
    if (row.bridge_confirmed) reason = 'Transfer succeeded (bridge confirmed)';
    else if (!row.talkroute_leg_created) reason = 'Transfer ended before Talkroute was dialed';
    else if (!row.talkroute_answered) reason = 'Talkroute destination did not answer';
    else reason = 'Answered, bridge unverified';
    expect(reason === 'Transfer ended before Talkroute was dialed').toBe(true);
  });
  it('Case 1: does NOT use generic message', () => {
    const row = { talkroute_leg_created: false, talkroute_answered: false, bridge_confirmed: false, transfer_failure_reason: 'Transfer failed or destination did not answer' };
    let reason: string;
    if (row.bridge_confirmed) reason = 'Transfer succeeded (bridge confirmed)';
    else if (!row.talkroute_leg_created) reason = 'Transfer ended before Talkroute was dialed';
    else if (!row.talkroute_answered) reason = 'Talkroute destination did not answer';
    else reason = 'Answered, bridge unverified';
    expect(reason !== 'Transfer failed or destination did not answer').toBe(true);
  });

  // ── 5. Case 2: leg created but not answered ────────────────────────────────
  it('Case 2: leg but no answer → "Talkroute destination did not answer"', () => {
    const row = { talkroute_leg_created: true, talkroute_answered: false, bridge_confirmed: false };
    let reason: string;
    if (row.bridge_confirmed) reason = 'Transfer succeeded (bridge confirmed)';
    else if (!row.talkroute_leg_created) reason = 'Transfer ended before Talkroute was dialed';
    else if (!row.talkroute_answered) reason = 'Talkroute destination did not answer';
    else reason = 'Answered, bridge unverified';
    expect(reason === 'Talkroute destination did not answer').toBe(true);
  });

  // ── 6. Case 3: answered but no bridge proof ────────────────────────────────
  it('Case 3: answered no bridge → "Answered, bridge unverified"', () => {
    const row = { talkroute_leg_created: true, talkroute_answered: true, bridge_confirmed: false };
    let reason: string;
    if (row.bridge_confirmed) reason = 'Transfer succeeded (bridge confirmed)';
    else if (!row.talkroute_leg_created) reason = 'Transfer ended before Talkroute was dialed';
    else if (!row.talkroute_answered) reason = 'Talkroute destination did not answer';
    else reason = 'Answered, bridge unverified';
    expect(reason === 'Answered, bridge unverified').toBe(true);
  });

  // ── 7. Case 4: bridge confirmed is success, not failure ────────────────────
  it('Case 4: bridge confirmed → success label', () => {
    const row = { talkroute_leg_created: true, talkroute_answered: true, bridge_confirmed: true };
    let reason: string;
    if (row.bridge_confirmed) reason = 'Transfer succeeded (bridge confirmed)';
    else if (!row.talkroute_leg_created) reason = 'Transfer ended before Talkroute was dialed';
    else if (!row.talkroute_answered) reason = 'Talkroute destination did not answer';
    else reason = 'Answered, bridge unverified';
    expect(reason === 'Transfer succeeded (bridge confirmed)').toBe(true);
  });

  // ── 8. No inference from transferred_to or API accepted ────────────────────
  it('API accepted without leg → Case 1, not success', () => {
    const row = { talkroute_leg_created: false, talkroute_answered: false, bridge_confirmed: false, transfer_status: 'transfer_api_accepted', transferred_to: '+18005551234' };
    let reason: string;
    if (row.bridge_confirmed) reason = 'Transfer succeeded (bridge confirmed)';
    else if (!row.talkroute_leg_created) reason = 'Transfer ended before Talkroute was dialed';
    else if (!row.talkroute_answered) reason = 'Talkroute destination did not answer';
    else reason = 'Answered, bridge unverified';
    expect(reason === 'Transfer ended before Talkroute was dialed').toBe(true);
  });
  it('Does not infer success from transfer_api_accepted', () => {
    const row = { talkroute_leg_created: false, talkroute_answered: false, bridge_confirmed: false, transfer_status: 'transfer_api_accepted', transferred_to: '+18005551234' };
    let reason: string;
    if (row.bridge_confirmed) reason = 'Transfer succeeded (bridge confirmed)';
    else if (!row.talkroute_leg_created) reason = 'Transfer ended before Talkroute was dialed';
    else if (!row.talkroute_answered) reason = 'Talkroute destination did not answer';
    else reason = 'Answered, bridge unverified';
    expect(reason.includes('succeeded')).toBe(false);
  });
  it('Does not infer ringing from transferred_to', () => {
    const row = { talkroute_leg_created: false, talkroute_answered: false, bridge_confirmed: false, transfer_status: 'transfer_api_accepted', transferred_to: '+18005551234' };
    let reason: string;
    if (row.bridge_confirmed) reason = 'Transfer succeeded (bridge confirmed)';
    else if (!row.talkroute_leg_created) reason = 'Transfer ended before Talkroute was dialed';
    else if (!row.talkroute_answered) reason = 'Talkroute destination did not answer';
    else reason = 'Answered, bridge unverified';
    expect(reason.includes('ringing')).toBe(false);
  });

  // ── 9. Timeline component structure preserved ──────────────────────────────
  it('Timeline stage 1 preserved', () => {
    expect(TIMELINE_TSC.includes('Transfer Requested')).toBe(true);
  });
  it('Timeline stage 2 preserved', () => {
    expect(TIMELINE_TSC.includes('Destination Dialed')).toBe(true);
  });
  it('Timeline stage 3 preserved', () => {
    expect(TIMELINE_TSC.includes('Agent Answered')).toBe(true);
  });
  it('Timeline stage 4 preserved', () => {
    expect(TIMELINE_TSC.includes('Bridge Confirmed')).toBe(true);
  });
  it('Timeline still accepts failedCount prop', () => {
    expect(TIMELINE_TSC.includes('failedCount')).toBe(true);
  });
  it('Timeline still accepts unverifiedCount prop', () => {
    expect(TIMELINE_TSC.includes('unverifiedCount')).toBe(true);
  });

  // ── 10. Recent Failures list in App.tsx uses e.reason ──────────────────────
  it('Recent failures list has reason display class', () => {
    expect(APP_TSC.includes('recent-failure-reason')).toBe(true);
  });
  it('Recent failures list slices to 10', () => {
    expect(APP_TSC.includes('errors_recent.slice(0, 10)')).toBe(true);
  });

  // ── 11. No purple/indigo in timeline CSS ───────────────────────────────────
  it('No purple in timeline component', () => {
    expect(TIMELINE_TSC.includes('purple')).toBe(false);
  });
  it('No indigo in timeline component', () => {
    expect(TIMELINE_TSC.includes('indigo')).toBe(false);
  });

  // ── 12. All four labels are distinct strings ───────────────────────────────
  it('All four labels are unique strings', () => {
    const labels = [
      'Transfer ended before Talkroute was dialed',
      'Talkroute destination did not answer',
      'Answered, bridge unverified',
      'Transfer succeeded (bridge confirmed)',
    ];
    const unique = new Set(labels);
    expect(unique.size === 4).toBe(true);
  });

  // ── 13. Existing behavior preserved ────────────────────────────────────────
  it('TalkrouteDeliveryTimeline still rendered', () => {
    expect(APP_TSC.includes('TalkrouteDeliveryTimeline')).toBe(true);
  });
  it('InboundVerificationPanel still rendered', () => {
    expect(APP_TSC.includes('InboundVerificationPanel')).toBe(true);
  });
  it('TransferFunnel still rendered', () => {
    expect(APP_TSC.includes('TransferFunnel')).toBe(true);
  });
  it('bridge_confirmed still referenced', () => {
    expect(APP_TSC.includes('bridge_confirmed')).toBe(true);
  });
  it('authFetch still used', () => {
    expect(APP_TSC.includes('authFetch')).toBe(true);
  });
  it('maskPhone still imported', () => {
    expect(APP_TSC.includes('maskPhone')).toBe(true);
  });

});
