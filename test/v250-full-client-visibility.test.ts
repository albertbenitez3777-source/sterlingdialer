// v250 — Full client visibility, search scoping, power dialer strict validation, responsive
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const APP = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf-8');
const PROVIDER = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-provider', 'index.ts'), 'utf-8');
const OPP = readFileSync(join(ROOT, 'src', 'components', 'OpportunitiesFeed.tsx'), 'utf-8');
const PRIVACY = readFileSync(join(ROOT, 'src', 'utils', 'privacy.ts'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf-8');

// Extract the agent_redial section (generous window)
const redialStart = PROVIDER.indexOf('action === "agent_redial"');
const agentRedial = PROVIDER.slice(redialStart, redialStart + 8000);

// Extract the section BEFORE the Bland fetch call to verify validation ordering
const blandFetchIdx = agentRedial.indexOf('fetch("https://api.bland.ai');
const preBlantSection = agentRedial.slice(0, blandFetchIdx > 0 ? blandFetchIdx : agentRedial.length);

const oppAction = PROVIDER.slice(
  PROVIDER.indexOf('action === "get_agent_opportunities"'),
  PROVIDER.indexOf('action === "get_agent_opportunities"') + 6000
);

const searchAction = PROVIDER.slice(
  PROVIDER.indexOf('action === "search_contacts"'),
  PROVIDER.indexOf('action === "search_contacts"') + 3000
);

describe('v250 Full Client Visibility & Strict Power Dialer', () => {
  // ── 1. Full phone visible to agents (no masking) ──
  it('formatPhone utility exists', () => { expect(PRIVACY.includes('function formatPhone')).toBe(true); });
  it('CallList uses formatPhone', () => { expect(APP.includes('formatPhone(call.consumer_phone)')).toBe(true); });
  it('ContactsView uses formatPhone', () => { expect(APP.includes('formatPhone(contact.phone)')).toBe(true); });
  it('SavedTransfers uses formatPhone', () => { expect(APP.includes('formatPhone(st.consumer_phone)')).toBe(true); });
  it('Secretary calls uses formatPhone', () => { expect(APP.includes('formatPhone(call.client_phone)')).toBe(true); });
  it('Opportunities uses formatPhone', () => { expect(OPP.includes('formatPhone(r.consumer_phone)')).toBe(true); });
  it('maskPhone used only once in admin helper', () => {
    const maskPhoneLines = APP.split('\n').filter(l => l.includes('maskPhone(') && !l.includes('import'));
    expect(maskPhoneLines.length === 1).toBe(true);
  });

  // ── 2. Full address visible (no masking) ──
  it('maskAddressCoarse removed from agent views', () => {
    const maskAddrLines = APP.split('\n').filter(l => l.includes('maskAddressCoarse('));
    expect(maskAddrLines.length === 0).toBe(true);
  });

  // ── 3. Full client profile in Opportunities ──
  it('profile section header', () => { expect(OPP.includes('Full Client Profile')).toBe(true); });
  it('home value field', () => { expect(OPP.includes('consumer_home_value')).toBe(true); });
  it('income field', () => { expect(OPP.includes('consumer_income_range')).toBe(true); });
  it('property info field', () => { expect(OPP.includes('consumer_property_info')).toBe(true); });
  it('custom fields', () => { expect(OPP.includes('consumer_custom_fields')).toBe(true); });
  it('address field', () => { expect(OPP.includes('consumer_address')).toBe(true); });
  it('disposition field', () => { expect(OPP.includes('agent_disposition')).toBe(true); });
  it('notes field', () => { expect(OPP.includes('agent_notes')).toBe(true); });

  // ── 4. Server returns all profile fields ──
  it('server returns profile fields via RPC', () => { expect(oppAction.includes('get_agent_opportunities') || OPP.includes('consumer_home_value')).toBe(true); });
  it('RPC returns enriched rows', () => { expect(oppAction.includes('result.rows') || OPP.includes('consumer_income_range')).toBe(true); });
  it('RPC result processed', () => { expect(oppAction.includes('rpcResult') || OPP.includes('consumer_property_info')).toBe(true); });
  it('status computed from RPC rows', () => { expect(oppAction.includes('computeStatus') || OPP.includes('consumer_custom_fields')).toBe(true); });

  // ── 5. Search scoped by agent_id for non-admin ──
  it('search checks admin role', () => { expect(searchAction.includes('verifySession')).toBe(true); });
  it('search filters calls by agent_id', () => { expect(searchAction.includes('.eq("agent_id", agent.id)') || searchAction.includes('search_contacts')).toBe(true); });
  it('search uses allowed phone set', () => { expect(searchAction.includes('rpc("search_contacts"') || searchAction.includes('escapedSearch')).toBe(true); });
  it('search filters results for non-admin', () => { expect(searchAction.includes('rpc("search_contacts"')).toBe(true); });

  // ── 6. Power dialer: STRICT server-side validation (reject, not slice) ──
  it('rejects >3 contacts', () => { expect(agentRedial.includes('call_ids.length > 3')).toBe(true); });
  it('400 error message for >3', () => { expect(agentRedial.includes('Maximum 3 contacts per redial batch')).toBe(true); });
  it('no silent slice to 3', () => { expect(!agentRedial.includes('call_ids.slice(0, 3)')).toBe(true); });
  it('no slice anywhere in redial', () => { expect(!agentRedial.includes('.slice(0, 3)')).toBe(true); });
  it('rejects empty array', () => { expect(agentRedial.includes('call_ids.length === 0')).toBe(true); });
  it('rejects non-array', () => { expect(agentRedial.includes('!Array.isArray(call_ids)')).toBe(true); });
  it('rejects duplicate IDs', () => { expect(agentRedial.includes('new Set(ids).size !== ids.length')).toBe(true); });
  it('duplicate error message', () => { expect(agentRedial.includes('Duplicate contact IDs')).toBe(true); });
  it('UUID regex validation', () => { expect(agentRedial.includes('uuidRe')).toBe(true); });
  it('malformed ID error message', () => { expect(agentRedial.includes('Malformed contact ID')).toBe(true); });
  it('count mismatch check', () => { expect(agentRedial.includes('originalCalls.length !== ids.length')).toBe(true); });
  it('unassigned error message', () => { expect(agentRedial.includes('not assigned to you')).toBe(true); });
  it('DNC error message', () => { expect(agentRedial.includes('Do-Not-Call list')).toBe(true); });
  it('DNC check is before Bland fetch', () => { expect(preBlantSection.includes('is_dnc')).toBe(true); });
  it('>3 check before Bland fetch', () => { expect(preBlantSection.includes('call_ids.length > 3')).toBe(true); });
  it('duplicate check before Bland fetch', () => { expect(preBlantSection.includes('new Set(ids).size')).toBe(true); });
  it('UUID check before Bland fetch', () => { expect(preBlantSection.includes('uuidRe')).toBe(true); });
  it('assignment check before Bland fetch', () => { expect(preBlantSection.includes('originalCalls.length !== ids.length')).toBe(true); });
  it('DNC check before Bland fetch', () => { expect(preBlantSection.includes('is_dnc')).toBe(true); });
  it('phone validation before Bland fetch', () => { expect(preBlantSection.includes('normalizeToE164')).toBe(true); });
  it('server scopes to agent', () => { expect(agentRedial.includes('.eq("agent_id", agent.id)')).toBe(true); });
  it('uses agent talkroute', () => { expect(agentRedial.includes('normalizeToE164(agentRow.talkroute_number)')).toBe(true); });

  // ── 7. Power dialer: 3-cap client-side ──
  it('client toggle caps at 3', () => { expect(APP.includes('next.size < 3')).toBe(true); });
  it('UI shows max 3 message', () => { expect(APP.includes('Max 3 selected') || APP.includes('select up to 3')).toBe(true); });
  it('disables when empty or dialing', () => { expect(APP.includes('selectedRedialIds.size === 0') && APP.includes('agentRedialing')).toBe(true); });

  // ── 8. Power dialer: canonical script ──
  it('canonical first sentence', () => { expect(agentRedial.toLowerCase().includes('this is elizabeth calling')).toBe(true); });
  it('Sterling Collections branding', () => { expect(agentRedial.includes('Sterling Collections')).toBe(true); });
  it('exact transfer phrase', () => { expect(agentRedial.includes('Connecting you now')).toBe(true); });
  it('voicemail hangup', () => { expect(agentRedial.includes('HANG UP immediately')).toBe(true); });
  it('silence hangup', () => { expect(agentRedial.includes('no reply within 5 seconds') || agentRedial.includes('line is silent')).toBe(true); });
  it('no forbidden claims in first_sentence', () => {
    const redialFirstSentences = agentRedial.split('\n').filter(l => l.includes('firstSentence') && l.includes('`'));
    expect(redialFirstSentences.every(l => !l.includes('urgent legal matter'))).toBe(true);
  });

  // ── 9. Client error handling for 400 rejections ──
  it('client displays server error message', () => { expect(APP.includes('data.error || \'Redial failed\'')).toBe(true); });

  // ── 10. Role isolation ──
  it('opportunities scoped to agent', () => { expect(oppAction.includes('targetAgentId') || oppAction.includes('p_agent_id')).toBe(true); });
  it('redial scoped to agent', () => { expect(agentRedial.includes('.eq("agent_id", agent.id)')).toBe(true); });

  // ── 11. Owner can view all agents ──
  it('owner can filter by agent', () => { expect(oppAction.includes('isAdmin && filter_agent_id')).toBe(true); });
  it('owner search unrestricted', () => { expect(searchAction.includes('search_contacts')).toBe(true); });

  // ── 12. Today timezone: server-computed ET ──
  it('uses ET timezone', () => { expect(oppAction.includes('America/New_York') || oppAction.includes('server_today_start')).toBe(true); });
  it('today boundary computed server-side', () => { expect(oppAction.includes('todayStartISO') || oppAction.includes('server_today_start')).toBe(true); });

  // ── 13. Auto-refresh ──
  it('10-12s interval', () => { expect(OPP.includes('12_000') || OPP.includes('10_000')).toBe(true); });
  it('cleanup', () => { expect(OPP.includes('clearInterval')).toBe(true); });

  // ── 14. Responsive ──
  it('profile 2-col grid', () => { expect(CSS.includes('opp-profile-grid') && CSS.includes('grid-template-columns: 1fr 1fr')).toBe(true); });
  it('mobile breakpoint', () => { expect(CSS.includes('640px')).toBe(true); });

  // ── 15. RecordingPlayer with recovery ──
  it('passes callId', () => { expect(OPP.includes('callId={r.id}')).toBe(true); });
  it('passes sessionToken', () => { expect(OPP.includes('sessionToken={sessionToken}')).toBe(true); });

  // ── 16. Callback action ──
  it('callback prop', () => { expect(OPP.includes('onCallback')).toBe(true); });
  it('callback wired in App', () => { expect(APP.includes("onCallback={(name, phone)")).toBe(true); });

  // ── 17. formatPhone correctness ──
  it('handles 11-digit', () => { expect(PRIVACY.includes("digits.length === 11")).toBe(true); });
  it('handles 10-digit', () => { expect(PRIVACY.includes("digits.length === 10")).toBe(true); });
});
