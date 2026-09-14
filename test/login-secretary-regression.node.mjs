import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import ts from 'typescript';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const withoutImports = source => source.replace(/^import[\s\S]*?;\s*/gm, '');

function pinInputs(props) {
  const context = vm.createContext({
    React: { createElement: (tag, props, ...children) => ({ tag, props, children: children.flat() }) },
    useRef: initial => ({ current: initial }),
  });
  const source = withoutImports(read('src/components/PinInput.tsx')).replace('export function', 'function');
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  new vm.Script(compiled + '\nglobalThis.component = PinInput;').runInContext(context);
  return context.component(props).children;
}

test('the final digit submits the completed PIN once even before React rerenders', async () => {
  let finish;
  const requests = [], errors = [];
  const context = vm.createContext({
    pin: '482', loginInFlight: { current: false }, AUTH_URL: 'https://offline.invalid',
    fetchWithRetry: (url, body) => { requests.push(body); return new Promise(resolve => { finish = resolve; }); },
    setLoggingIn() {}, setLoginError: error => errors.push(error),
    setSessionToken() {}, setSession() {}, setAgentAvailable() {}, setActiveNav() {}, setShowOfflineModal() {}, setPin() {},
    localStorage: { setItem() {} },
    loginErrorMessage: () => 'error', classifyFetchError: () => 'network',
  });
  const source = read('src/App.tsx').split('  const handleLogin = ')[1].split('  const handleLogout = ')[0];
  new vm.Script(stripTypeScriptTypes('globalThis.login = ' + source)).runInContext(context);
  let submitted;
  const inputs = pinInputs({ value: '482', onChange() {}, onComplete: pin => { submitted = context.login(pin); } });
  inputs[3].props.onChange({ target: { value: '6' } });
  await context.login('4826');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pin, '4826');
  assert.ok(!errors.includes('PIN must be 4 digits'));
  finish(new Response(JSON.stringify({ success: true, session_token: 'synthetic-session', agent: { role: 'owner' } })));
  await submitted;
  assert.equal(context.loginInFlight.current, false);
});

test('PIN deletion keeps the remaining digit positions and does not submit', () => {
  let changed, completed = false;
  const inputs = pinInputs({ value: '4826', onChange: value => { changed = value; }, onComplete: () => { completed = true; } });
  inputs[1].props.onChange({ target: { value: '' } });
  assert.equal(changed, '4 26');
  assert.equal(completed, false);
});

test('pasting all four PIN digits works from any box', () => {
  let changed, completed;
  const inputs = pinInputs({ value: '', onChange: value => { changed = value; }, onComplete: value => { completed = value; } });
  inputs[2].props.onPaste({ preventDefault() {}, clipboardData: { getData: () => '4826' } });
  assert.equal(changed, '4826');
  assert.equal(completed, '4826');
});

test('PIN fields are masked and cannot trigger another request while submitting', () => {
  const inputs = pinInputs({ value: '', disabled: true, onChange: () => assert.fail('disabled change'), onComplete: () => assert.fail('disabled submission') });
  for (const input of inputs) {
    assert.equal(input.props.type, 'password');
    assert.equal(input.props.disabled, true);
    input.props.onChange({ target: { value: '4' } });
  }
});

function loadHandler(file, overrides = {}) {
  let handler;
  const context = vm.createContext({
    Request, Response, URL, AbortController, AbortSignal, DOMException, crypto, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: () => 'synthetic-config' }, serve: fn => { handler = fn; } },
    fetch: () => { throw new Error('Unexpected network request'); },
    ...overrides,
  });
  new vm.Script(stripTypeScriptTypes(withoutImports(read(file)))).runInContext(context);
  return body => handler(new Request('https://offline.invalid', { method: 'POST', body: JSON.stringify(body) }));
}

for (const action of ['login', 'verify']) {
  for (const failure of [500, 401, 'network']) {
    test(`${action}: upstream ${failure} is a service failure, not invalid credentials`, async () => {
      const handler = loadHandler('supabase/functions/wolf-auth/index.ts', {
        fetch: async () => { if (failure === 'network') throw new Error('offline'); return new Response('{}', { status: failure }); },
      });
      const response = await handler({ action, pin: '4826', session_token: 'synthetic-session' });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).valid, undefined);
    });
  }
}

test('an explicitly invalid session remains invalid', async () => {
  const handler = loadHandler('supabase/functions/wolf-auth/index.ts', { fetch: async () => new Response('{"valid":false}') });
  const response = await handler({ action: 'verify', session_token: 'synthetic-expired' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).valid, false);
});

test('a rejected PIN stays rejected without retrying authentication', async () => {
  let requests = 0;
  const handler = loadHandler('supabase/functions/wolf-auth/index.ts', { fetch: async () => { requests++; return new Response('{"success":false,"error":"Invalid PIN"}'); } });
  const response = await handler({ action: 'login', pin: '4826' });
  assert.equal(response.status, 401);
  assert.equal(requests, 1);
});

function secretaryHarness({ agentIndex = 0, mode = 'transfer', unavailable = false, authFailure = false, duplicate = false, dnc = false, phone = '+12025550199' } = {}) {
  const agent = { id: `fixture-agent-${agentIndex}`, full_name: `Fixture Agent ${agentIndex}`, role: 'agent', status: 'active', available_for_transfer: !unavailable,
    bland_number: `+1202555010${agentIndex}`, talkroute_number: `+1202555011${agentIndex}`, bland_voice_id: 'fixture-voice', custom_message_privilege: true };
  const requests = [], writes = [];
  const client = {
    rpc: async () => authFailure ? { error: { message: 'offline' }, data: null } : { data: { valid: true, agent }, error: null },
    from(table) {
      let op = 'select', payload, otherAgent = false;
      const chain = {
        select() { return chain; }, eq() { return chain; }, neq() { otherAgent = true; return chain; }, gte() { return chain; }, order() { return chain; }, limit() { return chain; },
        insert(value) { op = 'insert'; payload = value; return chain; }, update(value) { op = 'update'; payload = value; return chain; },
        single() { return chain; }, maybeSingle() { return chain; },
        then(resolve) {
          if (op !== 'select') writes.push({ table, op, payload });
          const data = op === 'insert' ? { id: 'fixture-secretary' } : table === 'agents' ? (otherAgent ? null : agent) : table === 'calls' ? (dnc ? { id: 'fixture-dnc' } : null) : (duplicate ? { id: 'fixture-recent' } : null);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
  const handler = loadHandler('supabase/functions/wolf-provider/index.ts', {
    createDbClient: () => client,
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.bland.ai/v1/calls');
      assert.equal(options.method, 'POST');
      requests.push(JSON.parse(options.body));
      return new Response('{"status":"success","call_id":"fixture-provider"}');
    },
  });
  return { requests, writes, agent, run: () => handler({ action: 'secretary_call', session_token: 'synthetic-session', client_name: 'Fixture Contact', client_phone: phone, mode, custom_message: 'Please return my call.' }) };
}

for (let i = 0; i < 3; i++) {
  test(`secretary uses agent ${i + 1}'s own caller ID, transfer destination, and live events`, async () => {
    const h = secretaryHarness({ agentIndex: i });
    assert.equal((await h.run()).status, 200);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].from, h.agent.bland_number);
    assert.equal(h.requests[0].transfer_phone_number, h.agent.talkroute_number);
    assert.deepEqual(h.requests[0].webhook_events, ['call', 'tool', 'post_transfer_transcript']);
    assert.match(h.requests[0].task, /Immediately use the transfer tool/);
    assert.equal(h.writes.find(w => w.op === 'insert').payload.agent_id, h.agent.id);
  });
}

test('reminder mode delivers a reminder without configuring a transfer', async () => {
  const h = secretaryHarness({ mode: 'reminder', unavailable: true });
  assert.equal((await h.run()).status, 200);
  assert.equal(h.requests[0].transfer_phone_number, undefined);
  assert.match(h.requests[0].task, /This call is a reminder/);
  assert.doesNotMatch(h.requests[0].task, /LIVE PERSON — TRANSFER FAST/);
});

for (const [options, status] of [[{ unavailable: true }, 409], [{ duplicate: true }, 409], [{ dnc: true }, 400], [{ phone: 'bad' }, 400], [{ mode: 'invalid' }, 400], [{ authFailure: true }, 503]]) {
  test(`secretary rejects ${JSON.stringify(options)} without placing a call`, async () => {
    const h = secretaryHarness(options);
    assert.equal((await h.run()).status, status);
    assert.equal(h.requests.length, 0);
  });
}

const sessionFailureCases = [
  {
    "expected": false,
    "name": "feature 401 with valid session",
    "status": 401,
    "verify": {
      "valid": true
    }
  },
  {
    "expected": true,
    "name": "confirmed expired session",
    "status": 401,
    "verify": {
      "valid": false
    }
  },
  {
    "expected": false,
    "name": "verification outage",
    "status": 401,
    "verify": {},
    "verifyStatus": 503
  },
  {
    "expected": false,
    "name": "verification network failure",
    "status": 401,
    "verifyThrows": true
  },
  {
    "expected": false,
    "name": "malformed verification",
    "status": 401,
    "verify": {}
  },
  {
    "expected": false,
    "name": "older response after new login",
    "saved": "new-session",
    "status": 401,
    "verify": {
      "valid": false
    }
  },
  {
    "expected": false,
    "name": "already signed out",
    "saved": null,
    "status": 401,
    "verify": {
      "valid": false
    }
  },
  {
    "expected": false,
    "name": "original server outage",
    "status": 503
  },
  {
    "expected": false,
    "name": "original network outage",
    "originalThrows": true
  },
  {
    "expected": false,
    "name": "successful response",
    "ok": true,
    "status": 200
  },
  {
    "expected": false,
    "name": "verification parse failure",
    "parseThrows": true,
    "status": 401
  },
  {
    "cancel": true,
    "expected": false,
    "name": "cancelled during verification",
    "status": 401,
    "verify": {
      "valid": false
    }
  }
];
for (const scenario of sessionFailureCases) {
  test('session retention: ' + scenario.name, async () => {
    let requests = 0, logouts = 0;
    const controller = new AbortController();
    const context = vm.createContext({
      AbortController, setTimeout, clearTimeout,
      localStorage: { getItem: () => Object.hasOwn(scenario, 'saved') ? scenario.saved : 'old-session' },
      fetch: async (url, options) => {
        requests++;
        if (requests === 1) {
          if (scenario.originalThrows) throw new Error('offline');
          return new Response('{"ok":true}', { status: scenario.status });
        }
        assert.equal(url, 'https://example.invalid/functions/v1/wolf-auth');
        assert.deepEqual(JSON.parse(options.body), { action: 'verify', session_token: 'old-session' });
        if (scenario.verifyThrows) throw new Error('offline');
        if (scenario.cancel) controller.abort();
        return new Response(scenario.parseThrows ? 'invalid-json' : JSON.stringify(scenario.verify), { status: scenario.verifyStatus || 200 });
      },
    });
    const source = stripTypeScriptTypes(read('src/utils/auth-fetch.ts')).replace('export async function', 'async function');
    new vm.Script(source + '\nglobalThis.run = authFetch;').runInContext(context);
    const result = await context.run('https://example.invalid/functions/v1/wolf-provider', {
      body: { action: 'get_admin_stats', session_token: 'old-session' },
      signal: controller.signal, onUnauthorized: () => { logouts++; },
    });
    assert.equal(result.loggedOut, scenario.expected);
    assert.equal(logouts, scenario.expected ? 1 : 0);
    assert.equal(result.ok, !!scenario.ok);
    assert.equal(requests, scenario.status === 401 ? 2 : 1);
  });
}

for (const scenario of ['recover', 'invalid', 'newer-login', 'cleanup']) {
  test('saved login restoration: ' + scenario, async () => {
    let saved = 'old', calls = 0, timer, cleanup, restored = false, removed = 0, resolvePending;
    const response = valid => ({ ok: true, json: async () => ({ valid, agent: valid ? { role: 'owner' } : undefined }) });
    const context = vm.createContext({
      useEffect: fn => { cleanup = fn(); },
      localStorage: { getItem: () => saved, removeItem: () => { saved = null; removed++; } },
      loginInFlight: { current: false },
      setTimeout: fn => { timer = fn; return 1; }, clearTimeout() {},
      fetchWithRetry: async () => {
        calls++;
        if (scenario === 'recover' && calls === 1) throw new Error('offline');
        if (scenario === 'newer-login' || scenario === 'cleanup') return await new Promise(resolve => { resolvePending = resolve; });
        return response(scenario !== 'invalid');
      },
      AUTH_URL: 'https://example.invalid/functions/v1/wolf-auth',
      setSession: () => { restored = true; }, setSessionToken() {}, setAgentAvailable() {},
      setActiveNav() {}, setLoginError() {}, setShowOfflineModal() {},
      window: { addEventListener() {}, removeEventListener() {} },
    });
    const app = read('src/App.tsx');
    const start = app.indexOf('  // Restore session;');
    const end = app.indexOf('  // Restore active redials', start);
    assert.ok(start >= 0 && end > start);
    new vm.Script(stripTypeScriptTypes(app.slice(start, end))).runInContext(context);
    const flush = () => new Promise(resolve => setImmediate(resolve));
    await flush();
    if (scenario === 'recover') {
      assert.equal(saved, 'old');
      assert.equal(typeof timer, 'function');
      timer();
    }
    if (scenario === 'newer-login') { saved = 'new'; resolvePending(response(false)); }
    if (scenario === 'cleanup') { cleanup(); resolvePending(response(true)); }
    await flush();
    if (scenario === 'recover') { assert.equal(restored, true); assert.equal(calls, 2); }
    if (scenario === 'invalid') { assert.equal(removed, 1); assert.equal(restored, false); }
    if (scenario === 'newer-login') { assert.equal(removed, 0); assert.equal(restored, false); assert.equal(saved, 'new'); }
    if (scenario === 'cleanup') assert.equal(restored, false);
    cleanup();
  });
}
