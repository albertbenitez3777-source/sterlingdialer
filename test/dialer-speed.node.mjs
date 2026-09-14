// Dialer Speed control — authorization, validation, and UI regression tests
// Run: node --test test/dialer-speed.node.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const withoutImports = source => source.replace(/^import[\s\S]*?;\s*/gm, '');

// ── Edge Function handler loader ────────────────────────────────────────────

function loadProvider(overrides = {}) {
  let handler;
  const dbCalls = [];
  const supabase = {
    from(table) {
      const chain = {
        _table: table, _op: null, _data: null, _filters: [],
        select(...args) { chain._op = 'select'; chain._cols = args; return chain; },
        insert(data) { chain._op = 'insert'; chain._data = data; dbCalls.push({ table, op: 'insert', data }); return chain; },
        update(data) { chain._op = 'update'; chain._data = data; dbCalls.push({ table, op: 'update', data }); return chain; },
        eq(col, val) { chain._filters.push({ col, val }); return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() {
          if (table === 'campaigns' && chain._op === 'select') {
            const campaignState = overrides._campaignState ?? 'running';
            const campaignConc = overrides._campaignConcurrency ?? 6;
            if (overrides._noCampaign) return Promise.resolve({ data: null, error: null });
            return Promise.resolve({ data: { id: 'campaign-1', concurrency: campaignConc, state: campaignState }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve, reject) {
          const err = overrides._updateError || null;
          return Promise.resolve({ data: null, error: err }).then(resolve, reject);
        },
        catch(fn) { return Promise.resolve({ data: null, error: null }).catch(fn); },
      };
      return chain;
    },
    rpc(name, params) {
      dbCalls.push({ rpc: name, params });
      if (name === 'verify_session') {
        const role = overrides._sessionRole ?? 'owner';
        if (overrides._noSession) return Promise.resolve({ data: null, error: null });
        if (overrides._sessionError) return Promise.resolve({ data: null, error: { message: 'DB error' } });
        return Promise.resolve({ data: { valid: true, agent: { id: 'agent-1', role, full_name: 'Test' } }, error: null });
      }
      if (name === 'campaign_start') {
        return Promise.resolve({ data: { success: true, ...params }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  const context = vm.createContext({
    URL, Request, Response, Blob, TextEncoder, Uint8Array, AbortSignal, Headers,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => new Response(JSON.stringify({}), { status: 200 }),
    Deno: { env: { get: name => name === 'SUPABASE_URL' ? 'https://offline.invalid' : name === 'SUPABASE_SERVICE_ROLE_KEY' ? 'test-key' : '' }, serve: fn => { handler = fn; } },
    globalThis: { crypto: globalThis.crypto },
    crypto: globalThis.crypto,
    Array, Object, JSON, Math, Number, String, Boolean, Date, Error, Promise, Set, Map, RegExp, Symbol,
    setTimeout, clearTimeout,
    // Provide the imported modules
    createDbClient: () => supabase,
  });

  const source = read('supabase/functions/wolf-provider/index.ts')
    .replace(/^import[\s\S]*?;\s*/gm, '')
    .replace(/createDbClient\([^)]*\)/g, 'createDbClient()');
  new vm.Script(stripTypeScriptTypes(source), { filename: 'wolf-provider/index.ts' }).runInContext(context);
  return { handler, dbCalls };
}

async function callAction(overrides, body) {
  const { handler, dbCalls } = loadProvider(overrides);
  const response = await handler(new Request('https://offline.invalid/wolf-provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  const data = await response.json();
  return { status: response.status, data, dbCalls };
}

// ── Authorization tests ─────────────────────────────────────────────────────

test('set_dialer_speed: owner can set speed', async () => {
  const { status, data } = await callAction(
    { _sessionRole: 'owner', _campaignConcurrency: 6 },
    { action: 'set_dialer_speed', session_token: 'valid', multiplier: 3 },
  );
  assert.equal(status, 200);
  assert.equal(data.success, true);
  assert.equal(data.multiplier, 3);
  assert.equal(data.concurrency, 9);
  assert.equal(data.previous_concurrency, 6);
});

test('set_dialer_speed: administrator can set speed', async () => {
  const { status, data } = await callAction(
    { _sessionRole: 'administrator', _campaignConcurrency: 3 },
    { action: 'set_dialer_speed', session_token: 'valid', multiplier: 2 },
  );
  assert.equal(status, 200);
  assert.equal(data.success, true);
  assert.equal(data.multiplier, 2);
  assert.equal(data.concurrency, 6);
});

test('set_dialer_speed: supervisor is denied', async () => {
  const { status, data } = await callAction(
    { _sessionRole: 'supervisor' },
    { action: 'set_dialer_speed', session_token: 'valid', multiplier: 2 },
  );
  assert.equal(status, 403);
  assert.ok(data.error.toLowerCase().includes('owner') || data.error.toLowerCase().includes('administrator'));
});

test('set_dialer_speed: agent is denied', async () => {
  const { status } = await callAction(
    { _sessionRole: 'agent' },
    { action: 'set_dialer_speed', session_token: 'valid', multiplier: 2 },
  );
  assert.equal(status, 403);
});

test('set_dialer_speed: invalid session returns 401', async () => {
  const { status } = await callAction(
    { _noSession: true },
    { action: 'set_dialer_speed', session_token: 'bad', multiplier: 2 },
  );
  assert.equal(status, 401);
});

// ── Validation tests ────────────────────────────────────────────────────────

test('set_dialer_speed: multiplier 0 is rejected', async () => {
  const { status, data } = await callAction(
    { _sessionRole: 'owner' },
    { action: 'set_dialer_speed', session_token: 'valid', multiplier: 0 },
  );
  assert.equal(status, 400);
  assert.ok(data.error.includes('1 to 4'));
});

test('set_dialer_speed: multiplier 5 is rejected', async () => {
  const { status, data } = await callAction(
    { _sessionRole: 'owner' },
    { action: 'set_dialer_speed', session_token: 'valid', multiplier: 5 },
  );
  assert.equal(status, 400);
  assert.ok(data.error.includes('1 to 4'));
});

test('set_dialer_speed: float multiplier is rejected', async () => {
  const { status } = await callAction(
    { _sessionRole: 'owner' },
    { action: 'set_dialer_speed', session_token: 'valid', multiplier: 2.5 },
  );
  assert.equal(status, 400);
});

test('set_dialer_speed: string multiplier is rejected', async () => {
  const { status } = await callAction(
    { _sessionRole: 'owner' },
    { action: 'set_dialer_speed', session_token: 'valid', multiplier: 'two' },
  );
  assert.equal(status, 400);
});

test('set_dialer_speed: no campaign returns 404', async () => {
  const { status, data } = await callAction(
    { _sessionRole: 'owner', _noCampaign: true },
    { action: 'set_dialer_speed', session_token: 'valid', multiplier: 2 },
  );
  assert.equal(status, 404);
  assert.ok(data.error.toLowerCase().includes('no campaign'));
});

// ── Concurrency mapping tests ───────────────────────────────────────────────

for (const [m, expected] of [[1, 3], [2, 6], [3, 9], [4, 12]]) {
  test(`set_dialer_speed: multiplier ${m} maps to concurrency ${expected}`, async () => {
    const { data } = await callAction(
      { _sessionRole: 'owner', _campaignConcurrency: 3 },
      { action: 'set_dialer_speed', session_token: 'valid', multiplier: m },
    );
    assert.equal(data.concurrency, expected);
  });
}

// ── Audit log test ──────────────────────────────────────────────────────────

test('set_dialer_speed: writes audit log entry', async () => {
  const { dbCalls } = await callAction(
    { _sessionRole: 'owner', _campaignConcurrency: 6 },
    { action: 'set_dialer_speed', session_token: 'valid', multiplier: 4 },
  );
  const auditInsert = dbCalls.find(c => c.table === 'audit_logs' && c.op === 'insert');
  assert.ok(auditInsert, 'audit_logs insert should exist');
  assert.equal(auditInsert.data.action, 'set_dialer_speed');
  assert.equal(auditInsert.data.metadata.multiplier, 4);
  assert.equal(auditInsert.data.metadata.previous_concurrency, 6);
  assert.equal(auditInsert.data.metadata.new_concurrency, 12);
});

// ── start_campaign passes selected concurrency ──────────────────────────────

test('start_campaign: passes concurrency parameter from client', async () => {
  const { dbCalls, data } = await callAction(
    { _sessionRole: 'owner' },
    { action: 'start_campaign', session_token: 'valid', call_limit: 100, concurrency: 9 },
  );
  const startCall = dbCalls.find(c => c.rpc === 'campaign_start');
  assert.ok(startCall, 'campaign_start RPC should be called');
  assert.equal(startCall.params.p_concurrency, 9);
});

test('start_campaign: defaults concurrency to 5 when not provided', async () => {
  const { dbCalls } = await callAction(
    { _sessionRole: 'owner' },
    { action: 'start_campaign', session_token: 'valid', call_limit: 100 },
  );
  const startCall = dbCalls.find(c => c.rpc === 'campaign_start');
  assert.equal(startCall.params.p_concurrency, 5);
});

test('start_campaign: rejects out-of-range concurrency and falls back to 5', async () => {
  const { dbCalls } = await callAction(
    { _sessionRole: 'owner' },
    { action: 'start_campaign', session_token: 'valid', call_limit: 100, concurrency: 99 },
  );
  const startCall = dbCalls.find(c => c.rpc === 'campaign_start');
  assert.equal(startCall.params.p_concurrency, 5);
});

// ── UI regression: speed control visibility ─────────────────────────────────

test('UI: dialer speed control is rendered only for owner role', () => {
  const appSource = read('src/App.tsx');
  assert.ok(appSource.includes('dialer-speed-control'), 'speed control class should exist');
  assert.ok(appSource.includes('isOwner && adminStats'), 'speed control should be gated by isOwner');
  assert.ok(appSource.includes('handleDialerSpeed'), 'speed handler should exist');
});

test('UI: speed buttons render 1x through 4x', () => {
  const appSource = read('src/App.tsx');
  assert.ok(appSource.includes('[1, 2, 3, 4].map'), 'should render four speed buttons');
  assert.ok(appSource.includes('dialerSpeed === m'), 'active state should compare to m');
});

test('UI: start_campaign sends concurrency from dialerSpeed', () => {
  const appSource = read('src/App.tsx');
  assert.ok(appSource.includes("concurrency: dialerSpeed * 3"), 'start_campaign should pass speed-derived concurrency');
});

test('UI: speed control shows lines count', () => {
  const appSource = read('src/App.tsx');
  assert.ok(appSource.includes('dialerSpeed * 3'), 'should display lines count');
  assert.ok(appSource.includes('dialer-speed-lines'), 'should have lines display class');
});

test('CSS: speed control styles exist', () => {
  const css = read('src/index.css');
  assert.ok(css.includes('.dialer-speed-control'), 'speed control class should exist in CSS');
  assert.ok(css.includes('.dialer-speed-btn.active'), 'active state should be styled');
  assert.ok(css.includes('.dialer-speed-notice.error'), 'error notice should be styled');
  assert.ok(css.includes('.dialer-speed-notice.success'), 'success notice should be styled');
});

// ── 24-hour session and 30s polling preservation ─────────────────────────────

test('preservation: 30s polling and protected logout still in place', () => {
  const source = read('src/App.tsx');
  assert.ok(source.includes('30000'), '30-second polling interval should remain');
  const authFetchSource = read('src/utils/auth-fetch.ts');
  assert.ok(
    authFetchSource.includes('verify_session') ||
    authFetchSource.includes('verifySession') ||
    authFetchSource.includes('verify-session') ||
    authFetchSource.includes('wolf-auth'),
    'auth-fetch should verify session before logout',
  );
});
