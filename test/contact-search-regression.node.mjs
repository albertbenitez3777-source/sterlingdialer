import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { contactEmails, contactFieldText } from '../src/utils/contact-search.ts';

async function searchCase(body, { authorized = true, fail = false, role = 'agent' } = {}) {
  let handler;
  const calls = [];
  const fetches = [];
  const context = vm.createContext({
    URL, Request, Response, AbortSignal, console: { error() {} },
    Deno: { env: { get: name => name === 'BLAND_API_KEY' ? 'fixture-provider-key' : '' }, serve: fn => { handler = fn; } },
    createDbClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'verify_session') return { data: { valid: authorized, agent: authorized ? { id: 'fixture-agent', role } : null }, error: null };
      const admin = ['owner','administrator'].includes(role);
      assert.equal(name, admin ? 'search_contacts' : 'search_contacts_scoped');
      assert.deepEqual(Object.keys(args).sort(), admin ? ['p_limit', 'p_offset', 'p_search'] : ['p_agent_id','p_limit', 'p_offset', 'p_search']);
      if (!admin) assert.equal(args.p_agent_id, 'fixture-agent');
      if (fail) return { data: null, error: { message: 'synthetic failure' } };
      return { data: { results: [{ id: 'fixture-contact', email: 'client@example.test', custom_fields: { email: 'client@example.test', account: 'fixture' } }], total: 1200 }, error: null };
    } }),
    fetch: async (url, options) => {
      if (body.action !== 'provider_queue_health') throw new Error('Search must never contact a dialer');
      assert.equal(options.method, 'GET');
      fetches.push(url);
      assert.ok(['https://api.bland.ai/v1/me', 'https://api.bland.ai/v1/calls/active'].includes(url));
      const data = url.endsWith('/me')
        ? { status: 'active', billing: { current_balance: 123 }, api_key: 'must-not-leak' }
        : { data: [{ status: 'QUEUED', timestamp: 1788890400000, to: 'must-not-leak' }, { status: 'IN_PROGRESS' }] };
      return new Response(JSON.stringify(data), { status: 200 });
    },
  });
  const source = readFileSync(new URL('../supabase/functions/wolf-provider/index.ts', import.meta.url), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '');
  new vm.Script(stripTypeScriptTypes(source)).runInContext(context);
  const response = await handler(new Request('https://offline.invalid/wolf-provider', { method: 'POST', body: JSON.stringify({ action: 'search_contacts', session_token: 'fixture-token', ...body }) }));
  return { status: response.status, data: await response.json(), calls, fetches };
}

test('provider queue diagnostics use authenticated read-only requests and redact sensitive fields', async () => {
  const r = await searchCase({ action: 'provider_queue_health' }, { role: 'owner' });
  assert.equal(r.status, 200);
  assert.equal(r.data.queued, 1);
  assert.equal(r.data.in_progress, 1);
  assert.equal(r.data.balance, 123);
  assert.equal(r.fetches.length, 2);
  assert.equal(JSON.stringify(r.data).includes('must-not-leak'), false);
});
test('provider account diagnostics reject agent and invalid sessions without contacting provider', async () => {
  const agent = await searchCase({ action: 'provider_queue_health' });
  assert.equal(agent.status, 403);
  assert.equal(agent.fetches.length, 0);
  const invalid = await searchCase({ action: 'provider_queue_health' }, { authorized: false });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.fetches.length, 0);
});

test('actual search handler uses matching database signature and retains full response', async () => {
  const r = await searchCase({ search_text: '  client_name+tag@example.test  ', offset: 1000 });
  assert.equal(r.status, 200);
  assert.equal(r.calls[1].args.p_search, 'client_name+tag@example.test');
  assert.equal(r.calls[1].args.p_offset, 1000);
  assert.equal(r.calls[1].args.p_limit, 50);
  assert.equal(r.data.count, 1200);
  assert.equal(r.data.results[0].custom_fields.account, 'fixture');
});
test('search preserves literal percent, underscore, and backslash', async () => {
  const value = String.raw`client%_reference\name`;
  const r = await searchCase({ search_text: value });
  assert.equal(r.calls[1].args.p_search, value);
});
test('search rejects missing or invalid sessions before reading contacts', async () => {
  const r = await searchCase({ search_text: 'client' }, { authorized: false });
  assert.equal(r.status, 401);
  assert.equal(r.calls.length, 1);
});
test('search surfaces database failure', async () => {
  const r = await searchCase({ search_text: 'client' }, { fail: true });
  assert.equal(r.status, 500);
  assert.equal(r.data.error, 'Search failed');
});
test('search sanitizes pagination and non-string input without throwing', async () => {
  const r = await searchCase({ search_text: { unexpected: true }, offset: -20 });
  assert.equal(r.status, 200);
  assert.equal(r.calls[1].args.p_search, '');
  assert.equal(r.calls[1].args.p_offset, 0);
  const fractional = await searchCase({ search_text: 'client', offset: 50.8 });
  assert.equal(fractional.calls[1].args.p_offset, 50);
});
test('email display includes normalized and imported email field variants', () => {
  assert.deepEqual(contactEmails({ emails: ['one@example.test'], custom_fields: { Email: 'one@example.test', 'E-mail Address': 'two@example.test', secondary_email: ['three@example.test'], email_verified: true } }), ['one@example.test', 'two@example.test', 'three@example.test']);
});
test('additional fields preserve nested data, zero, and false', () => {
  assert.equal(contactFieldText(0), '0');
  assert.equal(contactFieldText(false), 'false');
  assert.equal(JSON.parse(contactFieldText({ history: ['retained'] })).history[0], 'retained');
});

test('client intelligence always prepares email, phone, address, and relationship searches', () => {
  const source = readFileSync(new URL('../supabase/functions/federal-one-v2/index.ts', import.meta.url), 'utf8');
  assert.match(source, /id: "email"/);
  assert.match(source, /id: "email_bing"/);
  assert.match(source, /id: "phones"/);
  assert.match(source, /id: "address"/);
  assert.match(source, /id: "family"/);
  assert.match(source, /spouse\|associate\|relative/);
});

test('opening client intelligence checks internal records before showing public searches', () => {
  const source = readFileSync(new URL('../supabase/functions/federal-one-v2/index.ts', import.meta.url), 'utf8');
  assert.match(source, /collectKnownFields/);
  assert.match(source, /knownRows/);
  assert.match(source, /research: \{ \.\.\.data, known \}/);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /Found in Federal One/);
  assert.match(app, /SPOUSE \/ ASSOCIATES/);
  assert.match(app, /Email is always searched/);
});

test('agent cannot override search ownership in the request', async () => {
 const r=await searchCase({search_text:'client',agent_id:'another-agent',p_agent_id:'another-agent'});
 assert.equal(r.status,200);assert.equal(r.calls[1].args.p_agent_id,'fixture-agent');
});
test('owner retains whole-directory search',async()=>{
 const r=await searchCase({search_text:'client'},{role:'owner'});
 assert.equal(r.status,200);assert.equal(r.calls[1].name,'search_contacts');assert.equal('p_agent_id' in r.calls[1].args,false);
});
