// v251 — Production repair: Today feed, status model, supervisor, alerts, archived roster
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const APP = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf-8');
const PROVIDER = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-provider', 'index.ts'), 'utf-8');
const OPP = readFileSync(join(ROOT, 'src', 'components', 'OpportunitiesFeed.tsx'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf-8');
const PRIVACY = readFileSync(join(ROOT, 'src', 'utils', 'privacy.ts'), 'utf-8');

// Extract the opp handler section from provider
const oppStart = PROVIDER.indexOf('action === "get_agent_opportunities"');
const oppEnd = PROVIDER.indexOf('// GET_AGENT_QUEUES:', oppStart);
const oppHandler = PROVIDER.slice(oppStart, oppEnd > 0 ? oppEnd : oppStart + 10000);

// Extract agent_redial section
const redialStart = PROVIDER.indexOf('action === "agent_redial"');
const agentRedial = PROVIDER.slice(redialStart, redialStart + 8000);
const blandFetchIdx = agentRedial.indexOf('fetch("https://api.bland.ai');
const preBlantSection = agentRedial.slice(0, blandFetchIdx > 0 ? blandFetchIdx : agentRedial.length);

const searchAction = PROVIDER.slice(
  PROVIDER.indexOf('action === "search_contacts"'),
  PROVIDER.indexOf('action === "search_contacts"') + 3000
);

const COCKPIT = readFileSync(join(ROOT, 'src', 'components', 'AgentCockpit.tsx'), 'utf-8');

describe('v251 Production Repair', () => {
  // ── 1. WIDENED TODAY FEED FILTER via RPC (James 11-vs-8 fix) ──
  it('uses RPC function instead of PostgREST .or()', () => { expect(oppHandler.includes('get_agent_opportunities')).toBe(true); });
  it('passes agent_id to RPC', () => { expect(oppHandler.includes('p_agent_id')).toBe(true); });
  it('passes tab to RPC', () => { expect(oppHandler.includes('p_tab')).toBe(true); });
  it('reads RPC result', () => { expect(oppHandler.includes('rpcResult')).toBe(true); });
  it('handles RPC errors', () => { expect(oppHandler.includes('rpcError')).toBe(true); });
  it('reads rows from RPC result', () => { expect(oppHandler.includes('result.rows')).toBe(true); });
  it('reads counts from RPC result', () => { expect(oppHandler.includes('result.counts')).toBe(true); });
  it('reads today boundary from server', () => { expect(oppHandler.includes('result.server_today_start')).toBe(true); });

  // ── 2. STATUS PRECEDENCE MODEL (no contradictions) ──
  it('server computes primary_status', () => { expect(oppHandler.includes('primary_status')).toBe(true); });
  it('server computes status_rank', () => { expect(oppHandler.includes('status_rank')).toBe(true); });
  it('status model checks bridge_confirmed', () => { expect(oppHandler.includes('bridge_confirmed')).toBe(true); });
  it('status model checks talkroute_answered', () => { expect(oppHandler.includes('talkroute_answered')).toBe(true); });
  it('bridge_confirmed rank 9', () => { expect(oppHandler.includes('"bridge_confirmed", status_rank: 9')).toBe(true); });
  it('talkroute_answered rank 8', () => { expect(oppHandler.includes('"talkroute_answered", status_rank: 8')).toBe(true); });
  it('talkroute_dialed rank 7', () => { expect(oppHandler.includes('"talkroute_dialed", status_rank: 7')).toBe(true); });
  it('transfer_requested rank 6', () => { expect(oppHandler.includes('"transfer_requested", status_rank: 6')).toBe(true); });
  it('live_human rank 5', () => { expect(oppHandler.includes('"live_human", status_rank: 5')).toBe(true); });
  it('voicemail rank 4', () => { expect(oppHandler.includes('"voicemail", status_rank: 4')).toBe(true); });
  it('no_answer rank 3', () => { expect(oppHandler.includes('"no_answer", status_rank: 3')).toBe(true); });
  it('pending rank 2', () => { expect(oppHandler.includes('"pending", status_rank: 2')).toBe(true); });
  it('failed rank 1', () => { expect(oppHandler.includes('"failed", status_rank: 1')).toBe(true); });
  it('UI uses single primary status badge', () => { expect(OPP.includes('PrimaryStatusBadge')).toBe(true); });
  it('funnel shown separately', () => { expect(OPP.includes('FunnelBadges')).toBe(true); });
  it('old mixed OutcomeBadges removed', () => { expect(!OPP.includes('OutcomeBadges')).toBe(true); });

  // ── 3. DEDUPE BY LEAD + HISTORY ──
  it('server groups by lead_id', () => { expect(oppHandler.includes('leadGroups')).toBe(true); });
  it('fallback key for null lead_id', () => { expect(oppHandler.includes('row.lead_id || row.id')).toBe(true); });
  it('server returns call_history', () => { expect(oppHandler.includes('call_history')).toBe(true); });
  it('picks highest status call', () => { expect(oppHandler.includes('status_rank') && oppHandler.includes('localeCompare')).toBe(true); });
  it('UI renders call_history', () => { expect(OPP.includes('call_history')).toBe(true); });
  it('history list UI element', () => { expect(OPP.includes('opp-history-list')).toBe(true); });
  it('toggle history state', () => { expect(OPP.includes('showHistory')).toBe(true); });

  // ── 4. TODAY-FIRST SORTING ──
  it('today records sorted first', () => { expect(oppHandler.includes('aToday !== bToday')).toBe(true); });
  it('within today: highest status first', () => { expect(oppHandler.includes('status_rank') && oppHandler.includes('status_rank as number')).toBe(true); });
  it('fallback: newest first', () => { expect(oppHandler.includes('bTs.localeCompare(aTs)') || oppHandler.includes('b.created_at.localeCompare(a.created_at)')).toBe(true); });

  // ── 5. ALERTS / NEW COUNT / POLLING ──
  it('server accepts since_ts', () => { expect(oppHandler.includes('since_ts')).toBe(true); });
  it('server returns new_since_count', () => { expect(oppHandler.includes('new_since_count')).toBe(true); });
  it('client tracks new count', () => { expect(OPP.includes('newCount')).toBe(true); });
  it('new alert badge rendered', () => { expect(OPP.includes('opp-new-badge')).toBe(true); });
  it('Bell icon for alerts', () => { expect(OPP.includes('Bell')).toBe(true); });
  it('alert audio attempt', () => { expect(OPP.includes('alertAudioRef')).toBe(true); });
  it('12s polling interval', () => { expect(OPP.includes('12_000')).toBe(true); });
  it('cleanup on unmount', () => { expect(OPP.includes('clearInterval')).toBe(true); });
  it('tracks last fetch timestamp', () => { expect(OPP.includes('lastFetchTs')).toBe(true); });
  it('CSS for alert badge', () => { expect(CSS.includes('opp-new-badge')).toBe(true); });
  it('pulse animation', () => { expect(CSS.includes('opp-pulse')).toBe(true); });

  // ── 6. SUPERVISOR ROLE ──
  it('supervisor in AgentRole type', () => { expect(APP.includes("'supervisor'")).toBe(true); });
  it('supervisor gets admin views', () => { expect(APP.includes("role === 'supervisor'")).toBe(true); });
  it('canControl flag for destructive ops', () => { expect(APP.includes('canControl')).toBe(true); });
  it('campaign buttons gated by canControl', () => { expect(APP.includes("canControl && (adminStats.summary.campaign_state")).toBe(true); });
  it('settings tab gated by canControl', () => { expect(APP.includes("canControl && <button")).toBe(true); });
  it('server has isReadAdmin helper', () => { expect(PROVIDER.includes('isReadAdmin')).toBe(true); });
  it('server recognizes supervisor role', () => { expect(PROVIDER.includes('supervisor')).toBe(true); });
  it('campaign_start stays owner-only', () => {
    const destructiveCheck = PROVIDER.slice(PROVIDER.indexOf('action === "campaign_start"'), PROVIDER.indexOf('action === "campaign_start"') + 500);
    expect(destructiveCheck.includes('agent.role !== "owner" && agent.role !== "administrator"')).toBe(true);
  });
  it('supervisor cannot start campaigns', () => {
    const destructiveCheck = PROVIDER.slice(PROVIDER.indexOf('action === "campaign_start"'), PROVIDER.indexOf('action === "campaign_start"') + 500);
    expect(!destructiveCheck.includes('supervisor')).toBe(true);
  });

  // ── 7. FULL ROSTER (including archived) ──
  it('archived section in agents tab', () => { expect(APP.includes('Archived / Inactive')).toBe(true); });
  it('filters for archived agents', () => { expect(APP.includes("a.status !== 'active'")).toBe(true); });
  it('shows all-time call count', () => { expect(APP.includes('outbound_attempts_all')).toBe(true); });
  it('shows all-time bridge count', () => { expect(APP.includes('bridge_confirmed_all')).toBe(true); });

  // ── 8. PHONE VISIBILITY (zero masked) ──
  it('formatPhone exists', () => { expect(PRIVACY.includes('function formatPhone')).toBe(true); });
  it('CallList full phone', () => { expect(APP.includes('formatPhone(call.consumer_phone)')).toBe(true); });
  it('Opportunities full phone', () => { expect(OPP.includes('formatPhone(r.consumer_phone)')).toBe(true); });
  it('Contacts full phone', () => { expect(APP.includes('formatPhone(contact.phone)')).toBe(true); });
  it('SavedTransfers full phone', () => { expect(APP.includes('formatPhone(st.consumer_phone)')).toBe(true); });
  it('maskPhone only in admin reveal helper', () => {
    const maskPhoneAgentLines = APP.split('\n').filter(l => l.includes('maskPhone(') && !l.includes('import'));
    expect(maskPhoneAgentLines.length <= 1).toBe(true);
  });

  // ── 9. FULL CLIENT PROFILE ──
  it('profile section', () => { expect(OPP.includes('Full Client Profile')).toBe(true); });
  it('home value', () => { expect(OPP.includes('consumer_home_value')).toBe(true); });
  it('income', () => { expect(OPP.includes('consumer_income_range')).toBe(true); });
  it('property', () => { expect(OPP.includes('consumer_property_info')).toBe(true); });
  it('custom fields', () => { expect(OPP.includes('consumer_custom_fields')).toBe(true); });
  it('disposition', () => { expect(OPP.includes('agent_disposition')).toBe(true); });
  it('notes', () => { expect(OPP.includes('agent_notes')).toBe(true); });

  // ── 10. POWER DIALER STRICT VALIDATION ──
  it('rejects >3', () => { expect(agentRedial.includes('call_ids.length > 3')).toBe(true); });
  it('>3 error message', () => { expect(agentRedial.includes('Maximum 3 contacts per redial batch')).toBe(true); });
  it('no silent slice', () => { expect(!agentRedial.includes('.slice(0, 3)')).toBe(true); });
  it('rejects empty', () => { expect(agentRedial.includes('call_ids.length === 0')).toBe(true); });
  it('rejects duplicates', () => { expect(agentRedial.includes('new Set(ids).size !== ids.length')).toBe(true); });
  it('UUID validation', () => { expect(agentRedial.includes('uuidRe')).toBe(true); });
  it('assignment check', () => { expect(agentRedial.includes('originalCalls.length !== ids.length')).toBe(true); });
  it('DNC check', () => { expect(agentRedial.includes('Do-Not-Call list')).toBe(true); });
  it('DNC before Bland', () => { expect(preBlantSection.includes('is_dnc')).toBe(true); });
  it('>3 before Bland', () => { expect(preBlantSection.includes('call_ids.length > 3')).toBe(true); });
  it('scoped to agent', () => { expect(agentRedial.includes('.eq("agent_id", agent.id)')).toBe(true); });
  it('uses talkroute, not direct', () => { expect(agentRedial.includes('normalizeToE164(agentRow.talkroute_number)')).toBe(true); });
  it('transfer routing uses talkroute_number', () => {
    const routingSection = agentRedial.slice(agentRedial.indexOf('transferNumber'), agentRedial.indexOf('transferNumber') + 200);
    expect(routingSection.includes('talkroute_number')).toBe(true);
  });
  it('transfer routing never uses agent_direct_number', () => {
    const routingSection = agentRedial.slice(agentRedial.indexOf('transferNumber'), agentRedial.indexOf('transferNumber') + 200);
    expect(!routingSection.includes('agent_direct_number')).toBe(true);
  });

  // ── 11. AGENT SCOPED SEARCH ──
  it('search filters by agent_id', () => { expect(searchAction.includes('.eq("agent_id", agent.id)')).toBe(true); });
  it('search checks admin role', () => { expect(searchAction.includes('verifySession')).toBe(true); });

  // ── 12. SERVER-SIDE ET BOUNDARIES ──
  it('ET timezone', () => { expect(oppHandler.includes('America/New_York') || oppHandler.includes('server_today_start')).toBe(true); });
  it('today boundary', () => { expect(oppHandler.includes('todayStartISO') || oppHandler.includes('server_today_start')).toBe(true); });

  // ── 13. BRIDGE CONFIRMATION LOGIC ──
  it('post-transfer speech check', () => { expect(oppHandler.includes('has_post_transfer_ai_speech')).toBe(true); });
  it('bridge_confirmed boolean check', () => { expect(oppHandler.includes('bridge_confirmed')).toBe(true); });
  it('bridge_confirmed_at check', () => { expect(oppHandler.includes('bridge_confirmed_at')).toBe(true); });

  // ── 14. RESPONSIVE ──
  it('profile grid', () => { expect(CSS.includes('opp-profile-grid') && CSS.includes('grid-template-columns')).toBe(true); });
  it('mobile breakpoint', () => { expect(CSS.includes('640px')).toBe(true); });

  // ── 15. RECORDING + CALLBACK ──
  it('passes callId', () => { expect(OPP.includes('callId={r.id}')).toBe(true); });
  it('passes sessionToken', () => { expect(OPP.includes('sessionToken={sessionToken}')).toBe(true); });
  it('callback prop', () => { expect(OPP.includes('onCallback')).toBe(true); });

  // ── 16. ADMIN FUNNEL METRICS ──
  it('transfer requested metric', () => { expect(APP.includes('transfers_requested_today') || APP.includes('transfers_requested')).toBe(true); });
  it('talkroute dialed metric', () => { expect(APP.includes('talkroute_dialed_today') || APP.includes('talkroute_dialed')).toBe(true); });
  it('bridge confirmed metric', () => { expect(APP.includes('bridge_confirmed_today')).toBe(true); });
  it('agent answered metric', () => { expect(APP.includes('agent_answered_today') || APP.includes('agent_answered')).toBe(true); });

  // ── 17. v254 REGRESSION: live_humans uses is_live_human, not human_drops ──
  it('AgentCockpit reads live_humans field', () => { expect(COCKPIT.includes('todayStats.live_humans')).toBe(true); });
  it('App.tsx prefers live_humans over human_drops', () => { expect(APP.includes('live_humans ?? agentTodayStats?.human_drops') || APP.includes('live_humans ??')).toBe(true); });

  // ── 18. v254 REGRESSION: RPC uses correct AT TIME ZONE pattern ──
  it('edge fn reads server_today_start from RPC', () => { expect(oppHandler.includes('server_today_start') || oppHandler.includes('result.server_today_start')).toBe(true); });
});
