import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

async function run(source, owner = true) {
  let handler;
  const requests = [];
  const tables = [];
  const database = {
    rpc: async () => ({ data: { valid: true, agent: { id: 'agent-a', role: owner ? 'owner' : 'agent' } } }),
    from(table) {
      tables.push(table);
      const chain = { insert() { return this; }, select() { return this; }, eq() { return this; }, update() { return this; },
        maybeSingle: async () => ({ data: { id: 'call-a', agent_id: 'agent-b', provider_call_id: 'provider-a' } }) };
      return chain;
    },
  };
  const context = vm.createContext({ URL, Blob, Request, Response, AbortSignal, setTimeout,
    console: { error() {}, log() {} }, createDbClient: () => database,
    Deno: { env: { get: () => 'fixture-value' }, serve: fn => { handler = fn; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === 'https://api.bland.ai/v1/recordings/provider-a') return Response.json({ recording_url: 'https://api.bland.ai/audio/fixture' });
      if (url === 'https://api.bland.ai/audio/fixture') {
        assert.equal(options.headers.authorization, 'fixture-value');
        return new Response(new Uint8Array([79, 103, 103, 83, 1]), { headers: { 'content-type': 'audio/ogg' } });
      }
      if (url.includes('/storage/')) return Response.json({ success: true });
      throw new Error('Unexpected request');
    },
  });
  const code = readFileSync(new URL('../supabase/functions/wolf-provider/index.ts', import.meta.url), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '');
  new vm.Script(stripTypeScriptTypes(code)).runInContext(context);
  const response = await handler(new Request('https://fixture.invalid', { method: 'POST', body: JSON.stringify({ action: 'recover_recording', session_token: 'fixture-token', call_id: 'call-a', recording_source: source }) }));
  return { status: response.status, data: await response.json(), requests, tables };
}
for (const source of ['calls', 'secretary_calls']) test(`recovers authenticated audio for ${source}`, async () => {
  const r = await run(source);
  assert.equal(r.status, 200);
  assert.equal(r.tables.find(t => t !== 'audit_logs'), source);
  assert.equal(r.tables.at(-1), source);
  assert.ok(r.data.recording_url.endsWith(`/${source}/call-a.ogg`));
  assert.equal(r.requests.length, 3);
});
test('denies another agent recording before any provider request', async () => {
  const r = await run('calls', false);
  assert.equal(r.status, 403);
  assert.equal(r.requests.length, 0);
});
