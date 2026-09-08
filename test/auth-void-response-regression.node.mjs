import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../supabase/functions/wolf-auth/index.ts', import.meta.url), 'utf8')
  .replace(/^import[^;]*;\s*/gm, '');

function authHandler(reply) {
  let handler;
  const requests = [];
  const context = vm.createContext({
    Request, Response, URL, AbortController, AbortSignal, DOMException,
    crypto, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: () => 'synthetic-config' }, serve: fn => { handler = fn; } },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return reply();
    },
  });
  new vm.Script(stripTypeScriptTypes(source)).runInContext(context);
  return {
    requests,
    run: body => handler(new Request('https://offline.invalid/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })),
  };
}

for (const status of [200, 204]) {
  test('logout accepts a successful empty database response with HTTP ' + status, async () => {
    const auth = authHandler(() => new Response(null, { status }));
    const response = await auth.run({ action: 'logout', session_token: 'synthetic-session' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(auth.requests[0].url, 'synthetic-config/rest/v1/rpc/agent_logout');
    assert.deepEqual(auth.requests[0].body, { p_session_token: 'synthetic-session' });
  });
}

test('logout retains a real database failure as service unavailable', async () => {
  const auth = authHandler(() => new Response('database unavailable', { status: 503 }));
  const response = await auth.run({ action: 'logout', session_token: 'synthetic-session' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).success, false);
});

test('login still forwards a valid JSON result', async () => {
  const result = { success: true, session_token: 'synthetic-session', agent: { role: 'owner' } };
  const auth = authHandler(() => Response.json(result));
  const response = await auth.run({ action: 'login', pin: '4826' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
});

test('a rejected PIN is still unauthorized', async () => {
  const auth = authHandler(() => Response.json({ success: false, error: 'Invalid PIN' }));
  const response = await auth.run({ action: 'login', pin: '4826' });
  assert.equal(response.status, 401);
});

for (const action of ['login', 'verify']) {
  test(action + ' does not treat an empty database response as successful', async () => {
    const auth = authHandler(() => new Response(null, { status: 204 }));
    const response = await auth.run({ action, pin: '4826', session_token: 'synthetic-session' });
    assert.equal(response.status, 503);
  });
}

test('malformed JSON remains a service failure', async () => {
  const auth = authHandler(() => new Response('invalid-json', { status: 200 }));
  const response = await auth.run({ action: 'verify', session_token: 'synthetic-session' });
  assert.equal(response.status, 503);
});
