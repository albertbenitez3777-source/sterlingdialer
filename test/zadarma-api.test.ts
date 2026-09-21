import { afterEach, describe, expect, it, vi } from 'vitest';
import { zadarma } from '../supabase/functions/federal-one-v2/zadarma';

function database() {
  const selections: Array<[string, string]> = [];
  const filters: Array<[string, string, unknown]> = [];
  const db = { from(table: string) {
    const data = table === 'agents' ? { zadarma_sip_login: '566918-101', talkroute_number: '+12029824430' }
      : table === 'system_config' ? [{ key: 'zadarma_api_key', value: 'test-key' }, { key: 'zadarma_api_secret', value: 'test-secret' }] : [];
    const chain: any = {
      select(value: string) { selections.push([table, value]); return chain; },
      eq(key: string, value: unknown) { filters.push([table, key, value]); return chain; },
      in() { return chain; }, order() { return chain; }, limit() { return chain; },
      single() { return Promise.resolve({ data, error: null }); },
      then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data, error: null }).then(resolve); },
    }; return chain;
  } };
  return { db, selections, filters };
}
const agent = { id: 'agent-101', role: 'agent' };
afterEach(() => vi.unstubAllGlobals());

describe('phone backend boundaries', () => {
  it('issues only the signed-in agent extension key without loading SIP passwords', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'success', key: 'temporary-test-key' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const { db, selections, filters } = database();
    const result = await zadarma(db, agent, { action: 'zadarma_webrtc_key', agent_id: 'another-agent' });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ sip: '566918-101', key: 'temporary-test-key' });
    expect(fetch.mock.calls[0][0]).toBe('https://api.zadarma.com/v1/webrtc/get_key/?sip=566918-101');
    expect(filters).toContainEqual(['agents', 'id', agent.id]);
    expect(selections.some(([, columns]) => columns.includes('password'))).toBe(false);
  });
  it('reports an API rejection instead of claiming the phone is ready', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'error', message: 'Invalid SIP' }), { status: 400 })));
    const { db } = database();
    expect(await zadarma(db, agent, { action: 'zadarma_webrtc_key' })).toEqual({ status: 502, data: { error: 'Invalid SIP' } });
  });
  it('keeps account-wide phone setup restricted to the owner', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { db } = database();
    const result = await zadarma(db, agent, { action: 'zadarma_setup_webrtc' });
    expect(result.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps caller searches within the signed-in agent data', async () => {
    const { db, filters } = database();
    const result = await zadarma(db, agent, { action: 'zadarma_caller_context', phone: '+1 (202) 555-0100' });
    expect(result.status).toBe(200);
    expect(filters).toContainEqual(['calls', 'agent_id', agent.id]);
    expect(filters).toContainEqual(['leads', 'assigned_agent_id', agent.id]);
  });
});
