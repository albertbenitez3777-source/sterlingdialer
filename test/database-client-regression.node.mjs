import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createClient } from '@supabase/supabase-js';

function harness(result) {
  const requests = [];
  const context = vm.createContext({
    createClient, AbortSignal,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' } });
    },
  });
  const source = readFileSync(new URL('../supabase/functions/_shared/db-client.ts', import.meta.url), 'utf8')
    .replace(/^import[^\n]*\n/gm, '').replace('export function', 'function');
  new vm.Script(stripTypeScriptTypes(source) + '\nglobalThis.factory = createDbClient;').runInContext(context);
  const client = context.factory('unused-direct-database-url', 'https://fixture.supabase.test', 'synthetic-server-key');
  return { client, requests, context };
}

test('session RPC uses the server-authorized HTTP API and preserves named arguments', async () => {
  const h = harness({ valid: true, agent: { id: 'fixture-agent' } });
  const result = await h.client.rpc('verify_session', { p_session_token: 'synthetic-session' });
  assert.equal(result.error, null);
  assert.equal(result.data.valid, true);
  assert.match(h.requests[0].url, /\/rest\/v1\/rpc\/verify_session$/);
  assert.deepEqual(JSON.parse(h.requests[0].init.body), { p_session_token: 'synthetic-session' });
  const headers = new Headers(h.requests[0].init.headers);
  assert.equal(headers.get('apikey'), 'synthetic-server-key');
  assert.equal(headers.get('authorization'), 'Bearer synthetic-server-key');
  assert.ok(h.requests[0].init.signal);
  assert.equal(h.context.factory('other-unused-url', 'https://fixture.supabase.test', 'synthetic-server-key'), h.client);
});

test('secretary inserts return the created record using the real query builder', async () => {
  const h = harness({ id: 'fixture-secretary-call' });
  const result = await h.client.from('secretary_calls').insert({ agent_id: 'fixture-agent', client_name: 'Fixture', status: 'pending' }).select('id').single();
  assert.equal(result.error, null);
  assert.equal(result.data.id, 'fixture-secretary-call');
  assert.equal(h.requests[0].init.method, 'POST');
  assert.equal(JSON.parse(h.requests[0].init.body).agent_id, 'fixture-agent');
  assert.match(h.requests[0].url, /secretary_calls\?select=id/);
});

test('table updates keep filters and boolean values without constructing SQL fragments', async () => {
  const h = harness([]);
  const result = await h.client.from('agents').update({ available_for_transfer: true }).eq('id', 'fixture-agent');
  assert.equal(result.error, null);
  assert.equal(h.requests[0].init.method, 'PATCH');
  assert.equal(new URL(h.requests[0].url).searchParams.get('id'), 'eq.fixture-agent');
  assert.deepEqual(JSON.parse(h.requests[0].init.body), { available_for_transfer: true });
});

test('ordered filtered reads work with the real SDK and exact counts', async () => {
  const h = harness([{ id: 'fixture-secretary-call' }]);
  const result = await h.client.from('secretary_calls').select('id', { count: 'exact' }).eq('agent_id', 'fixture-agent').order('created_at', { ascending: false }).limit(10);
  assert.equal(result.error, null);
  assert.equal(result.count, 1);
  assert.equal(result.data.length, 1);
  const url = new URL(h.requests[0].url);
  assert.equal(url.searchParams.get('agent_id'), 'eq.fixture-agent');
  assert.equal(url.searchParams.get('order'), 'created_at.desc');
  assert.equal(url.searchParams.get('limit'), '10');
});
