import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { OperationsView, type OperationsOverview } from '@/components/OperationsDashboard';

function render(limit: number | null | undefined, state = 'running') {
  const data: OperationsOverview = {
    as_of: new Date().toISOString(), since: null, timezone: 'America/Costa_Rica', events_enabled: true, events_since: null, last_event_at: null, voicemail_import_configured: true,
    campaign: { state, call_limit: limit, accepted: 501, concurrency: 20 },
    lines: { configured: 20, effective: 20, active: 4, reserved: 0, aged: 0, hourly_target: 400, minute_limit: 20, recent_hour: 50, recent_minute: 5, pacing_allowance: 15, available_slots: 16, agent_slots: 17, selected_agents: 3, eligible_agents: 3, blocking_reason: null },
    bland: { attempts: 501, humans: 0, transfers: 0, destination_dialed: 0, bridge_confirmed: 0, in_progress: 4, no_answer: 0, customer_voicemail: 0, failures: 0, minutes: 0, linked_received: 0, linked_answered: 0, linked_voicemail: 0 },
    zadarma: { incoming: 0, outgoing: 0, outgoing_answered: 0, answered: 0, voicemail_reached: 0, missed: 0, ringing: 0, connected: 0, unconfirmed: 0, linked_transfers: 0, unlinked_incoming: 0 },
    voicemail: { messages: 0, unheard: 0, unheard_backlog: 0 }, agents: [], outcomes: null, hourly: [], recent_calls: [],
  };
  return renderToStaticMarkup(<OperationsView data={data} windowName="today" busy={false} error="" onWindow={() => {}} onRefresh={() => {}} />);
}

describe('continuous run operations reporting', () => {
  it('does not report the old cutoff after 501 accepted calls', () => {
    const html = render(null);
    expect(html).toContain('Until stopped');
    expect(html).toContain('Slots open for the next dispatch');
    expect(html).not.toContain('Batch limit reached');
    expect(html).not.toContain('role="progressbar"');
  });
  it('preserves explicit finite limits', () => {
    expect(render(400)).toContain('Batch limit reached');
    expect(render(600)).toContain('99 remaining');
  });
  it('never infers continuous mode from a missing limit', () => {
    const html = render(undefined);
    expect(html).toContain('Run limit unavailable');
    expect(html).not.toContain('Until stopped');
    expect(html).not.toContain('Batch limit reached');
  });
  it('shows an operator stop even in continuous mode', () => {
    expect(render(null, 'stopped')).toContain('Dialer stopped');
    expect(render(null, 'stopped')).not.toContain('Slots open for the next dispatch');
  });
});
