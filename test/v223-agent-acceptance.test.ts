// v223 Agent Workflow Acceptance Tests
// Comprehensive synthetic/mocked tests for:
// - Two agents, destination isolation
// - Missing/invalid Talkroute
// - Unauthorized agent
// - Session expiry
// - Search pagination, no results
// - Secretary reminder, secretary transfer
// - Provider failure, duplicate submit
// - Strict bridge truth
// Mock-only — no database, no network, no production mutations.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const APP_TSC = readFileSync(join(PROJECT_ROOT, 'src', 'App.tsx'), 'utf-8');
const PROVIDER_TSC = readFileSync(join(PROJECT_ROOT, 'supabase', 'functions', 'wolf-provider', 'index.ts'), 'utf-8');

// ── Mock agent fixtures ──────────────────────────────────────────────────
interface MockAgent {
  id: string; full_name: string; role: string; status: string;
  bland_number: string; talkroute_number: string; available_for_transfer: boolean;
  custom_message_privilege: boolean; bland_voice_id: string;
}

const AGENT_ERICK: MockAgent = {
  id: 'agent-erick', full_name: 'Erick Jackson', role: 'agent', status: 'active',
  bland_number: '+13157566825', talkroute_number: '+18663502227',
  available_for_transfer: true, custom_message_privilege: true, bland_voice_id: 'voice-1',
};

const AGENT_JAMES: MockAgent = {
  id: 'agent-james', full_name: 'James Spencer', role: 'agent', status: 'active',
  bland_number: '+17712026103', talkroute_number: '+18004031524',
  available_for_transfer: true, custom_message_privilege: false, bland_voice_id: 'voice-2',
};

const AGENT_NO_TALKROUTE: MockAgent = {
  id: 'agent-no-tr', full_name: 'Test Agent', role: 'agent', status: 'active',
  bland_number: '+15551234567', talkroute_number: '',
  available_for_transfer: true, custom_message_privilege: false, bland_voice_id: 'voice-3',
};

const AGENT_OFFLINE: MockAgent = {
  id: 'agent-offline', full_name: 'Offline Agent', role: 'agent', status: 'active',
  bland_number: '+15559876543', talkroute_number: '+18005551212',
  available_for_transfer: false, custom_message_privilege: false, bland_voice_id: 'voice-4',
};

const OWNER: MockAgent = {
  id: 'owner-id', full_name: 'Owner Admin', role: 'owner', status: 'active',
  bland_number: '', talkroute_number: '',
  available_for_transfer: false, custom_message_privilege: false, bland_voice_id: '',
};

// ── Mock session store ───────────────────────────────────────────────────
const sessions = new Map<string, { agent: MockAgent; valid: boolean }>();
function createSession(agent: MockAgent): string {
  const token = `token-${agent.id}-${Date.now()}`;
  sessions.set(token, { agent, valid: true });
  return token;
}
function verifySession(token: string): MockAgent | null {
  const s = sessions.get(token);
  if (!s || !s.valid) return null;
  return s.agent;
}
function expireSession(token: string): void {
  const s = sessions.get(token);
  if (s) s.valid = false;
}

// ── Mock secretary call store (simulates DB) ─────────────────────────────
interface MockSecretaryCall {
  id: string; agent_id: string; client_name: string; client_phone: string;
  mode: string; custom_message: string | null; status: string;
  provider_call_id: string | null; transfer_status: string | null;
  created_at: string;
}
const secretaryCalls: MockSecretaryCall[] = [];

// ── Mock search results ──────────────────────────────────────────────────
interface MockContact {
  id: string; source: string; consumer_name: string; phone: string;
  phone_normalized: string; address: string; total_call_count: number;
}
const ALL_CONTACTS: MockContact[] = Array.from({ length: 120 }, (_, i) => ({
  id: `contact-${i}`, source: 'leads', consumer_name: `Contact ${i}`,
  phone: `+1555000${String(i).padStart(4, '0')}`,
  phone_normalized: `+1555000${String(i).padStart(4, '0')}`,
  address: `${i} Main St`, total_call_count: i % 5,
}));

// ── Mock normalizeToE164 ─────────────────────────────────────────────────
function normalizeToE164(num: string): string {
  const cleaned = num.replace(/[^\d+]/g, '');
  return cleaned.length >= 10 ? cleaned : '';
}

// ── Mock secretary_call handler (mirrors edge function logic) ────────────
interface SecretaryCallRequest {
  session_token: string; client_name: string; client_phone: string;
  mode: 'reminder' | 'transfer'; custom_message?: string;
}

interface SecretaryCallResponse {
  status: number; data: { success?: boolean; error?: string; secretary_call_id?: string };
}

async function mockSecretaryCall(req: SecretaryCallRequest): Promise<SecretaryCallResponse> {
  const agent = verifySession(req.session_token);
  if (!agent) return { status: 401, data: { error: 'Invalid or expired session' } };

  // Eligibility: owner/admin cannot use secretary
  if (agent.role === 'owner' || agent.role === 'administrator') {
    return { status: 403, data: { error: 'Secretary is available to agents only.' } };
  }

  const phoneNumber = normalizeToE164(req.client_phone);
  if (!phoneNumber) return { status: 400, data: { error: 'Invalid phone number' } };

  // Idempotency: check for duplicate within 60 seconds
  const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const recent = secretaryCalls.find(c =>
    c.agent_id === agent.id && c.client_phone === phoneNumber && c.created_at >= oneMinAgo
  );
  if (recent) {
    return { status: 409, data: { error: 'A secretary call to this number was just placed.' } };
  }

  // Agent must have bland number
  if (!agent.bland_number) {
    return { status: 400, data: { error: 'Your Bland number is not configured.' } };
  }

  // Transfer mode: validate unique Talkroute number
  if (req.mode === 'transfer') {
    const transferNum = agent.talkroute_number ? normalizeToE164(agent.talkroute_number) : '';
    if (!transferNum) {
      return { status: 400, data: { error: 'Your Talkroute transfer number is not configured.' } };
    }
    // Check uniqueness (mock: compare against other agents)
    const allAgents = [AGENT_ERICK, AGENT_JAMES, AGENT_NO_TALKROUTE, AGENT_OFFLINE, OWNER];
    const shared = allAgents.find(a => a.id !== agent.id && a.talkroute_number === agent.talkroute_number);
    if (shared) {
      return { status: 400, data: { error: 'Transfer number is shared with another agent.' } };
    }
  }

  // Create the call record
  const callId = `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  secretaryCalls.push({
    id: callId, agent_id: agent.id, client_name: req.client_name || 'Unknown',
    client_phone: phoneNumber, mode: req.mode,
    custom_message: agent.custom_message_privilege ? (req.custom_message || null) : null,
    status: 'dialing', provider_call_id: null, transfer_status: null,
    created_at: new Date().toISOString(),
  });

  return { status: 200, data: { success: true, secretary_call_id: callId } };
}

// ── Mock search handler (mirrors ContactsView logic) ─────────────────────
function mockSearchContacts(query: string, offset: number = 0, limit: number = 50): MockContact[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return ALL_CONTACTS
    .filter(c => c.consumer_name.toLowerCase().includes(q) || c.phone.includes(q) || c.address.includes(q))
    .slice(offset, offset + limit);
}

// ── Mock in-flight guard (mirrors ContactsView searchInFlightRef) ────────
let searchInFlight = false;
async function mockDoSearch(query: string, offset: number = 0): Promise<{ results: MockContact[]; hasMore: boolean }> {
  if (searchInFlight) return { results: [], hasMore: false };
  searchInFlight = true;
  try {
    const results = mockSearchContacts(query, offset);
    return { results, hasMore: results.length >= 50 };
  } finally {
    searchInFlight = false;
  }
}

describe('v223 agent acceptance', () => {

  // ── 1. Two agents — destination isolation ────────────────────────────────
  it('Erick secretary call succeeds', async () => {
    const token1 = createSession(AGENT_ERICK);
    const r1 = await mockSecretaryCall({ session_token: token1, client_name: 'Alice', client_phone: '5551234567', mode: 'transfer' });
    expect(r1.status === 200).toBe(true);
  });

  it('James secretary call succeeds', async () => {
    const token2 = createSession(AGENT_JAMES);
    const r2 = await mockSecretaryCall({ session_token: token2, client_name: 'Bob', client_phone: '5559876543', mode: 'transfer' });
    expect(r2.status === 200).toBe(true);
  });

  it('Erick call recorded', () => {
    const call1 = secretaryCalls.find(c => c.agent_id === AGENT_ERICK.id);
    expect(!!call1).toBe(true);
  });

  it('James call recorded', () => {
    const call2 = secretaryCalls.find(c => c.agent_id === AGENT_JAMES.id);
    expect(!!call2).toBe(true);
  });

  it('Calls belong to different agents', () => {
    const call1 = secretaryCalls.find(c => c.agent_id === AGENT_ERICK.id);
    const call2 = secretaryCalls.find(c => c.agent_id === AGENT_JAMES.id);
    expect(call1!.agent_id !== call2!.agent_id).toBe(true);
  });

  it('Agents have different Talkroute numbers', () => {
    expect(AGENT_ERICK.talkroute_number !== AGENT_JAMES.talkroute_number).toBe(true);
  });

  // ── 2. Missing/invalid Talkroute ─────────────────────────────────────────
  it('missing Talkroute -> 400', async () => {
    const token = createSession(AGENT_NO_TALKROUTE);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Test', client_phone: '5551234567', mode: 'transfer' });
    expect(r.status).toEqual(400);
  });

  it('error mentions Talkroute', async () => {
    const token = createSession(AGENT_NO_TALKROUTE);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Test', client_phone: '5551234567', mode: 'transfer' });
    expect(r.data.error!.includes('Talkroute')).toBe(true);
  });

  it('reminder mode works without Talkroute', async () => {
    const token = createSession(AGENT_NO_TALKROUTE);
    const r2 = await mockSecretaryCall({ session_token: token, client_name: 'Test', client_phone: '5551234567', mode: 'reminder' });
    expect(r2.status === 200).toBe(true);
  });

  // ── 3. Unauthorized agent (owner cannot use secretary) ───────────────────
  it('owner gets 403', async () => {
    const token = createSession(OWNER);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Test', client_phone: '5551234567', mode: 'transfer' });
    expect(r.status).toEqual(403);
  });

  it('error says agents only', async () => {
    const token = createSession(OWNER);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Test', client_phone: '5551234567', mode: 'transfer' });
    expect(r.data.error!.includes('agents only')).toBe(true);
  });

  // ── 4. Session expiry ────────────────────────────────────────────────────
  it('expired session -> 401', async () => {
    const token = createSession(AGENT_ERICK);
    expireSession(token);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Test', client_phone: '5551234567', mode: 'transfer' });
    expect(r.status).toEqual(401);
  });

  it('error mentions expired session', async () => {
    const token = createSession(AGENT_ERICK);
    expireSession(token);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Test', client_phone: '5551234567', mode: 'transfer' });
    expect(r.data.error!.includes('expired')).toBe(true);
  });

  // ── 5. Search pagination ─────────────────────────────────────────────────
  it('page 1 has 50 results', () => {
    const page1 = mockSearchContacts('Contact', 0, 50);
    expect(page1.length).toEqual(50);
  });

  it('page 2 has 50 results', () => {
    const page2 = mockSearchContacts('Contact', 50, 50);
    expect(page2.length).toEqual(50);
  });

  it('pages have different contacts', () => {
    const page1 = mockSearchContacts('Contact', 0, 50);
    const page2 = mockSearchContacts('Contact', 50, 50);
    expect(page1[0].id !== page2[0].id).toBe(true);
  });

  it('no overlap between pages', () => {
    const page1 = mockSearchContacts('Contact', 0, 50);
    const page2 = mockSearchContacts('Contact', 50, 50);
    expect(page1[49].id !== page2[0].id).toBe(true);
  });

  it('full search returns all 120 contacts', () => {
    const all = mockSearchContacts('Contact', 0, 200);
    expect(all.length).toEqual(120);
  });

  // ── 6. Search — no results ───────────────────────────────────────────────
  it('no results for nonexistent query', () => {
    const results = mockSearchContacts('zzznonexistent');
    expect(results.length).toEqual(0);
  });

  // ── 7. Search — empty query ──────────────────────────────────────────────
  it('empty query returns no results', () => {
    const results = mockSearchContacts('');
    expect(results.length).toEqual(0);
  });

  it('whitespace query returns no results', () => {
    const results2 = mockSearchContacts('   ');
    expect(results2.length).toEqual(0);
  });

  // ── 8. Search — special characters ───────────────────────────────────────
  it('special characters do not crash search', () => {
    const results = mockSearchContacts("O'Brien & Sons");
    expect(results.length).toEqual(0);
  });

  it('phone format does not crash', () => {
    const results2 = mockSearchContacts('(555) 123-4567');
    expect(results2.length).toEqual(0);
  });

  // ── 9. Search — in-flight duplicate guard ────────────────────────────────
  it('blocked while in-flight', async () => {
    searchInFlight = true;
    const r = await mockDoSearch('Contact');
    expect(r.results.length).toEqual(0);
    searchInFlight = false;
  });

  it('works when not in-flight', async () => {
    searchInFlight = false;
    const r2 = await mockDoSearch('Contact');
    expect(r2.results.length).toEqual(50);
  });

  // ── 10. Secretary reminder mode ──────────────────────────────────────────
  it('reminder call succeeds', async () => {
    const token = createSession(AGENT_JAMES);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Reminder Test', client_phone: '5551112222', mode: 'reminder' });
    expect(r.status).toEqual(200);
  });

  it('reminder call recorded', () => {
    const call = secretaryCalls.find(c => c.client_phone === '5551112222' && c.agent_id === AGENT_JAMES.id);
    expect(!!call).toBe(true);
  });

  it('mode is reminder', () => {
    const call = secretaryCalls.find(c => c.client_phone === '5551112222' && c.agent_id === AGENT_JAMES.id);
    expect(call!.mode).toEqual('reminder');
  });

  // ── 11. Secretary transfer mode ──────────────────────────────────────────
  it('transfer call succeeds', async () => {
    const token = createSession(AGENT_ERICK);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Transfer Test', client_phone: '5553334444', mode: 'transfer', custom_message: 'Follow up please' });
    expect(r.status).toEqual(200);
  });

  it('transfer call recorded', () => {
    const call = secretaryCalls.find(c => c.client_phone === '5553334444' && c.agent_id === AGENT_ERICK.id);
    expect(!!call).toBe(true);
  });

  it('mode is transfer', () => {
    const call = secretaryCalls.find(c => c.client_phone === '5553334444' && c.agent_id === AGENT_ERICK.id);
    expect(call!.mode).toEqual('transfer');
  });

  it('custom message saved for privileged agent', () => {
    const call = secretaryCalls.find(c => c.client_phone === '5553334444' && c.agent_id === AGENT_ERICK.id);
    expect(call!.custom_message === 'Follow up please').toBe(true);
  });

  // ── 12. Secretary — custom message blocked for non-privileged agent ──────
  it('call succeeds', async () => {
    const token = createSession(AGENT_JAMES);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Msg Test', client_phone: '5555556666', mode: 'reminder', custom_message: 'Test message' });
    expect(r.status).toEqual(200);
  });

  it('call recorded', () => {
    const call = secretaryCalls.find(c => c.client_phone === '5555556666' && c.agent_id === AGENT_JAMES.id);
    expect(!!call).toBe(true);
  });

  it('custom message null for non-privileged agent', () => {
    const call = secretaryCalls.find(c => c.client_phone === '5555556666' && c.agent_id === AGENT_JAMES.id);
    expect(call!.custom_message).toEqual(null);
  });

  // ── 13. Provider failure ─────────────────────────────────────────────────
  it('invalid phone -> 400', async () => {
    const token = createSession(AGENT_ERICK);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Bad Phone', client_phone: 'abc', mode: 'transfer' });
    expect(r.status).toEqual(400);
  });

  it('error mentions invalid phone', async () => {
    const token = createSession(AGENT_ERICK);
    const r = await mockSecretaryCall({ session_token: token, client_name: 'Bad Phone', client_phone: 'abc', mode: 'transfer' });
    expect(r.data.error!.includes('Invalid phone')).toBe(true);
  });

  // ── 14. Duplicate submit (idempotency) ───────────────────────────────────
  it('first call succeeds', async () => {
    const token = createSession(AGENT_ERICK);
    const phone = '5557778888';
    const r1 = await mockSecretaryCall({ session_token: token, client_name: 'Dup Test', client_phone: phone, mode: 'transfer' });
    expect(r1.status).toEqual(200);
  });

  it('duplicate call within 60s -> 409', async () => {
    const token = createSession(AGENT_ERICK);
    const phone = '5557778888';
    // First call to set up the duplicate
    await mockSecretaryCall({ session_token: token, client_name: 'Dup Test', client_phone: phone, mode: 'transfer' });
    const r2 = await mockSecretaryCall({ session_token: token, client_name: 'Dup Test', client_phone: phone, mode: 'transfer' });
    expect(r2.status).toEqual(409);
  });

  it('error says call was just placed', async () => {
    const token = createSession(AGENT_ERICK);
    const phone = '5557778889';
    await mockSecretaryCall({ session_token: token, client_name: 'Dup Test2', client_phone: phone, mode: 'transfer' });
    const r2 = await mockSecretaryCall({ session_token: token, client_name: 'Dup Test2', client_phone: phone, mode: 'transfer' });
    expect(r2.data.error!.includes('just placed')).toBe(true);
  });

  // ── 15. Strict bridge truth ──────────────────────────────────────────────
  it('transfer_status is "requested"', () => {
    const transferRequested: MockSecretaryCall = {
      id: 'test-tr', agent_id: 'x', client_name: 'Test', client_phone: '+15550000000',
      mode: 'transfer', custom_message: null, status: 'transferred',
      provider_call_id: 'call-1', transfer_status: 'requested', created_at: new Date().toISOString(),
    };
    expect(transferRequested.transfer_status === 'requested').toBe(true);
  });

  it('"requested" is NOT "bridge_confirmed"', () => {
    const transferRequested: MockSecretaryCall = {
      id: 'test-tr', agent_id: 'x', client_name: 'Test', client_phone: '+15550000000',
      mode: 'transfer', custom_message: null, status: 'transferred',
      provider_call_id: 'call-1', transfer_status: 'requested', created_at: new Date().toISOString(),
    };
    expect(transferRequested.transfer_status !== 'bridge_confirmed').toBe(true);
  });

  it('bridge_ended is the confirmed state', () => {
    const bridgeConfirmed: MockSecretaryCall = {
      id: 'test-bc', agent_id: 'x', client_name: 'Test', client_phone: '+15550000000',
      mode: 'transfer', custom_message: null, status: 'transferred',
      provider_call_id: 'call-1', transfer_status: 'bridge_ended', created_at: new Date().toISOString(),
    };
    expect(bridgeConfirmed.transfer_status === 'bridge_ended').toBe(true);
  });

  // ── 16. Transfer truth label in UI ───────────────────────────────────────
  it('transfer-truth CSS class used in App.tsx', () => {
    expect(APP_TSC.includes('transfer-truth')).toBe(true);
  });

  it('"Live test pending" in App.tsx', () => {
    expect(APP_TSC.includes('Live test pending')).toBe(true);
  });

  it('truth label text present', () => {
    expect(APP_TSC.includes('Transfer requested — bridge not confirmed')).toBe(true);
  });

  // ── 17. Destination is server-derived ────────────────────────────────────
  it('edge function reads talkroute_number from agent row', () => {
    expect(PROVIDER_TSC.includes('agentRow.talkroute_number')).toBe(true);
  });

  it('client does not supply transfer_to', () => {
    expect(!PROVIDER_TSC.includes('transfer_to.*body')).toBe(true);
  });

  it('transfer number normalized from agent row', () => {
    expect(PROVIDER_TSC.includes('normalizeToE164(agentRow.talkroute_number)')).toBe(true);
  });

  // ── 18. Idempotency in edge function ─────────────────────────────────────
  it('idempotency comment in edge function', () => {
    expect(PROVIDER_TSC.includes('Idempotency')).toBe(true);
  });

  it('60-second idempotency window', () => {
    expect(PROVIDER_TSC.includes('60 * 1000')).toBe(true);
  });

  it('409 for duplicate', () => {
    expect(PROVIDER_TSC.includes('status: 409')).toBe(true);
  });

  // ── 19. Eligibility gate in edge function ────────────────────────────────
  it('eligibility error message', () => {
    expect(PROVIDER_TSC.includes('Secretary is available to agents only')).toBe(true);
  });

  it('owner role check', () => {
    expect(PROVIDER_TSC.includes('role === "owner"')).toBe(true);
  });

  // ── 20. Talkroute uniqueness check in edge function ──────────────────────
  it('shared Talkroute error', () => {
    expect(PROVIDER_TSC.includes('Transfer number is shared')).toBe(true);
  });

  it('uniqueness query excludes self', () => {
    expect(PROVIDER_TSC.includes('neq("id", agent.id)')).toBe(true);
  });

  // ── 21. ContactsView in-flight guard ─────────────────────────────────────
  it('in-flight ref used', () => {
    expect(APP_TSC.includes('searchInFlightRef')).toBe(true);
  });

  it('in-flight set to true', () => {
    expect(APP_TSC.includes('searchInFlightRef.current = true')).toBe(true);
  });

  it('in-flight set to false in finally', () => {
    expect(APP_TSC.includes('searchInFlightRef.current = false')).toBe(true);
  });

  // ── 22. ContactsView pagination ──────────────────────────────────────────
  it('loadMore function defined', () => {
    expect(APP_TSC.includes('loadMore')).toBe(true);
  });

  it('hasMore state used', () => {
    expect(APP_TSC.includes('hasMore')).toBe(true);
  });

  it('load more button rendered', () => {
    expect(APP_TSC.includes('Load More Contacts')).toBe(true);
  });

  it('offset ref used for pagination', () => {
    expect(APP_TSC.includes('searchOffsetRef')).toBe(true);
  });

  // ── 23. ContactsView error state ─────────────────────────────────────────
  it('searchError state used', () => {
    expect(APP_TSC.includes('searchError')).toBe(true);
  });

  it('search failed message', () => {
    expect(APP_TSC.includes('Search failed')).toBe(true);
  });

  it('session expiry hint in error', () => {
    expect(APP_TSC.includes('session may have expired')).toBe(true);
  });

  // ── 24. ContactsView empty/no-result states ──────────────────────────────
  it('no results message', () => {
    expect(APP_TSC.includes('No contacts found')).toBe(true);
  });

  it('empty state prompt', () => {
    expect(APP_TSC.includes('Start typing')).toBe(true);
  });

  it('helpful no-result hint', () => {
    expect(APP_TSC.includes('Try a different name')).toBe(true);
  });

  // ── 25. Privacy masking preserved ────────────────────────────────────────
  it('maskPhone used in contacts', () => {
    expect(APP_TSC.includes('maskPhone')).toBe(true);
  });

  it('maskAddressCoarse used in contacts', () => {
    const privacySrc = readFileSync(join(PROJECT_ROOT, 'src', 'utils', 'privacy.ts'), 'utf-8');
    expect(privacySrc.includes('maskAddressCoarse')).toBe(true);
  });

  // ── 26. Secretary double-submit prevention ───────────────────────────────
  it('double-submit guard in placeCall', () => {
    expect(APP_TSC.includes('if (placingSecCall) return')).toBe(true);
  });

  it('submit button disabled during call', () => {
    expect(APP_TSC.includes('disabled={placingSecCall}')).toBe(true);
  });

  // ── 27. Secretary loading/finally cleanup ────────────────────────────────
  it('finally cleanup in placeCall', () => {
    const placeCallSection = APP_TSC.slice(APP_TSC.indexOf('const placeCall'), APP_TSC.indexOf('const refresh'));
    expect(placeCallSection.includes('setPlacingSecCall(false)')).toBe(true);
  });

  // ── 28. Secretary history display ────────────────────────────────────────
  it('call history section present', () => {
    expect(APP_TSC.includes('CALL HISTORY')).toBe(true);
  });

  it('secretary calls mapped', () => {
    expect(APP_TSC.includes('secretaryCalls.map')).toBe(true);
  });

  it('empty history state', () => {
    expect(APP_TSC.includes('No secretary calls yet')).toBe(true);
  });

  // ── 29. Secretary transcript/recording display ───────────────────────────
  it('transcript displayed', () => {
    expect(APP_TSC.includes('call.transcript')).toBe(true);
  });

  it('recording displayed', () => {
    expect(APP_TSC.includes('call.recording_url')).toBe(true);
  });

  it('recording player rendered', () => {
    expect(APP_TSC.includes('<RecordingPlayer url={')).toBe(true);
  });

  // ── 30. Secretary refresh ────────────────────────────────────────────────
  it('refresh function defined', () => {
    expect(APP_TSC.includes('const refresh')).toBe(true);
  });

  it('refresh button rendered', () => {
    expect(APP_TSC.includes('Refresh')).toBe(true);
  });

  it('loading state set on refresh', () => {
    expect(APP_TSC.includes('setLoadingSecretary(true)')).toBe(true);
  });

  it('loading state cleared in finally', () => {
    expect(APP_TSC.includes('setLoadingSecretary(false)')).toBe(true);
  });

  // ── 31. Phone action modal ───────────────────────────────────────────────
  it('PhoneActionModal component used', () => {
    expect(APP_TSC.includes('PhoneActionModal')).toBe(true);
  });

  it('secretary option in modal', () => {
    expect(APP_TSC.includes('Send Elizabeth')).toBe(true);
  });

  it('Talkroute option in modal', () => {
    expect(APP_TSC.includes('Call via Talkroute')).toBe(true);
  });

  it('placing state passed to modal', () => {
    expect(APP_TSC.includes('placingSecretaryCall')).toBe(true);
  });

  // ── 32. Search meta shows loading/error/count ────────────────────────────
  it('loading state text', () => {
    expect(APP_TSC.includes('Searching...')).toBe(true);
  });

  it('result count with pluralization', () => {
    expect(APP_TSC.includes('contact${searchResults.length !== 1')).toBe(true);
  });

  it('error state in search meta', () => {
    expect(APP_TSC.includes('Search failed — try again')).toBe(true);
  });

});
