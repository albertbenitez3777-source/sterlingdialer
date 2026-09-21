import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PHONE_ROUTES, callEvidence, testCallPayload, testCalls, testPhone, verifiedTestRoute } from '../supabase/functions/federal-one-v2/test-calls';
import { mailbox, validMailboxEmail } from '../supabase/functions/federal-one-v2/mailbox';
const agentId = 'c242abef-c01e-490b-bab6-859cd89bd08a';
const requestId = 'bcb18276-3c4c-4702-832b-2c59773db0cb';
const supervisor = { id: agentId, role: 'supervisor' };
const routeRow = { id: agentId, full_name: 'James Spencer', bland_number: '+1 (771) 202-6103', talkroute_number: '+12027739590', zadarma_sip_login: '566918-100' };
const testRow = { id: requestId, requested_by: agentId, agent_id: agentId, client_name: 'Test Person', client_phone: '+18669991670', agent_name: 'James Spencer', from_number: '+17712026103', transfer_number: '+12027739590', extension: '100', status: 'submitting' };
function database(options: { duplicate?: boolean; route?: unknown; message?: unknown } = {}) {
  const filters: unknown[][] = []; const writes: unknown[][] = [];
  const signed = vi.fn(async () => ({ data: { signedUrl: 'https://storage.example/private' }, error: null }));
  const rpc = vi.fn(async () => ({ data: { created: !options.duplicate, call: testRow }, error: null }));
  const db = { rpc, storage: { from: vi.fn(() => ({ createSignedUrl: signed })) }, from(table: string) {
    let data: any = table === 'agents' ? options.route || routeRow : table === 'system_config' ? [{ key: 'zadarma_api_key', value: 'test-key' }, { key: 'zadarma_api_secret', value: 'test-secret' }] : table === 'federal_one_voicemails' ? (options.message === undefined ? [] : options.message) : testRow;
    const chain: any = { select() { return chain; }, eq(...args: unknown[]) { filters.push([table, ...args]); return chain; },
      in() { return chain; }, order() { return chain; }, limit() { return chain; },
      update(patch: unknown) { writes.push([table, patch]); return chain; },
      single() { return Promise.resolve({ data, error: null }); },
      then(resolve: (x: unknown) => unknown) { return Promise.resolve({ data, error: null }).then(resolve); } };
    return chain;
  } };
  return { db, filters, writes, signed, rpc };
}
afterEach(() => vi.unstubAllGlobals());
const init = () => vi.stubGlobal('Deno', { env: { get: (key: string) => key === 'BLAND_API_KEY' ? 'server-test-key' : undefined } });
describe('manual transfer tests', () => {
  it.each(Object.entries(AGENT_PHONE_ROUTES))('uses the approved route for %s', (name, expected) => {
    expect(verifiedTestRoute({ ...routeRow, full_name: name, bland_number: expected.from, talkroute_number: expected.transfer, zadarma_sip_login: `566918-${expected.extension}` })).toMatchObject(expected);
  });
  it('rejects a drifted or swapped assignment', () => {
    expect(() => verifiedTestRoute({ ...routeRow, talkroute_number: '+12029824430' })).toThrow(/assignment/);
  });
  it('normalizes the authorized US test number and rejects dial codes', () => {
    expect(testPhone('866 999 1670')).toBe('+18669991670');
    expect(() => testPhone('911')).toThrow(); expect(() => testPhone('*100#')).toThrow();
  });
  it('requires supervisor access before touching the database or provider', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await testCalls({}, { id: agentId, role: 'agent' }, { action: 'phone_test_start' })).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('replays the saved result without placing another call', async () => {
    init(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const { db } = database({ duplicate: true });
    const result = await testCalls(db, supervisor, { action: 'phone_test_start', request_id: requestId, agent_id: agentId, name: 'Test Person', phone: '8669991670' });
    expect(result.data).toMatchObject({ duplicate: true }); expect(fetch).not.toHaveBeenCalled();
  });
  it('ignores caller-supplied from and transfer numbers and uses the server route', async () => {
    init(); const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'success', call_id: 'provider-test' }))); vi.stubGlobal('fetch', fetch);
    const { db } = database();
    expect((await testCalls(db, supervisor, { action: 'phone_test_start', request_id: requestId, agent_id: agentId, name: 'Test Person', phone: '8669991670', from: '+19999999999', transfer_phone_number: '+18888888888' })).status).toBe(200);
    const payload = JSON.parse((fetch.mock.calls[0] as any)[1].body);
    expect(payload).toMatchObject({ from: '+17712026103', transfer_phone_number: '+12027739590', phone_number: '+18669991670' });
    expect(payload.webhook).toBeUndefined(); expect(payload.metadata.purpose).toBe('manual_transfer_test');
  });
  it('does not repeat a timed-out chargeable request', async () => {
    init(); const fetch = vi.fn(async () => { throw new Error('timeout'); }); vi.stubGlobal('fetch', fetch);
    const { db } = database();
    const result = await testCalls(db, supervisor, { action: 'phone_test_start', request_id: requestId, agent_id: agentId, name: 'Test Person', phone: '8669991670' });
    expect(result.data).toMatchObject({ call: { status: 'unknown' } }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('prevents loops through any of the six agent numbers', async () => {
    init(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const route of Object.values(AGENT_PHONE_ROUTES)) for (const phone of [route.from, route.transfer]) {
      expect((await testCalls({}, supervisor, { action: 'phone_test_start', request_id: requestId, agent_id: agentId, name: 'Test Person', phone })).status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not turn an ended call or a configured transfer into transfer evidence', () => {
    expect(callEvidence({ status: 'completed', completed: true, request_data: { transfer_phone_number: '+12027739590' } })).toMatchObject({ completed: true, transferred_to: null });
    expect(callEvidence({ transferred_to: '+12027739590', transferred_at: '2026-09-21T12:00:00Z' }).transferred_to).toBe('+12027739590');
  });
  it('hangs up on the customer’s answering machine and asks before transfer', () => {
    const payload = testCallPayload(testRow);
    expect(payload.voicemail).toEqual({ action: 'hangup', sensitive: true });
    expect(payload.task).toContain('May I connect you now?');
  });
});
describe('private agent voicemail', () => {
  it('rejects placeholder mailboxes', () => {
    expect(() => validMailboxEmail('james@wolfdialer.local')).toThrow(/real/);
    expect(() => validMailboxEmail('a@b.com,c@d.com')).toThrow();
    expect(validMailboxEmail(' Person@Company.com ')).toBe('person@company.com');
  });
  it('ignores another agent ID supplied to the inbox', async () => {
    const { db, filters } = database();
    const result = await mailbox(db, supervisor, { action: 'mailbox_list', agent_id: 'someone-else' });
    expect(filters).toContainEqual(['federal_one_voicemails', 'agent_id', agentId]);
    expect(result.data).toMatchObject({ messages: [], delivery_verified: false });
  });
  it('does not issue a playback URL for an unowned or missing message', async () => {
    const { db, signed, filters } = database({ message: null });
    expect((await mailbox(db, supervisor, { action: 'mailbox_audio', id: 'another-message' })).status).toBe(404);
    expect(filters).toContainEqual(['federal_one_voicemails', 'agent_id', agentId]); expect(signed).not.toHaveBeenCalled();
  });
  it('issues a short-lived private URL for an owned message', async () => {
    const { db, signed } = database({ message: { id: 'owned', storage_path: 'agent/private.mp3' } });
    expect((await mailbox(db, supervisor, { action: 'mailbox_audio', id: 'owned' })).status).toBe(200);
    expect(signed).toHaveBeenCalledWith('agent/private.mp3', 300);
  });
  it('keeps voicemail configuration restricted to supervisors', async () => {
    expect((await mailbox({}, { id: agentId, role: 'agent' }, { action: 'mailbox_setup', agent_id: agentId, email: 'x@y.com' })).status).toBe(403);
  });
  it('configures conditional voicemail, never unconditional forwarding to the agent DID', async () => {
    init(); const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'success', current_status: 'on', type: 'voicemail', condition: 'noanswer', destination: 'james@company.com' }))); vi.stubGlobal('fetch', fetch);
    const { db } = database();
    const result = await mailbox(db, supervisor, { action: 'mailbox_setup', agent_id: agentId, email: 'james@company.com' });
    expect(result.data).toMatchObject({ configured: true });
    const params = new URLSearchParams((fetch.mock.calls[0] as any)[1].body);
    expect(Object.fromEntries(params)).toMatchObject({ pbx_number: '100', condition: 'noanswer', type: 'voicemail', destination: 'james@company.com' });
  });
});
