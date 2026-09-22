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

function loadProvider(overrides = {}, controls = false) {
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

  const source = read(controls ? 'supabase/functions/dialer-controls/index.ts' : 'supabase/functions/wolf-provider/index.ts')
    .replace(/^import[\s\S]*?;\s*/gm, '');
  new vm.Script(stripTypeScriptTypes(source), { filename: 'wolf-provider/index.ts' }).runInContext(context);
  return { handler, dbCalls };
}

async function callAction(overrides, body) {
  const { handler, dbCalls } = loadProvider(overrides, body.action !== 'set_dialer_speed');
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

test('start_campaign: defaults concurrency to 3 when not provided', async () => {
  const { dbCalls } = await callAction(
    { _sessionRole: 'owner' },
    { action: 'start_campaign', session_token: 'valid', call_limit: 100 },
  );
  const startCall = dbCalls.find(c => c.rpc === 'campaign_start');
  assert.equal(startCall.params.p_concurrency, 3);
});

test('start_campaign: rejects invalid concurrency without starting', async () => {
 const {status, dbCalls}=await callAction({}, {action:'start_campaign',session_token:'valid',call_limit:100,concurrency:99});
 assert.equal(status,400); assert.ok(!dbCalls.some(c=>c.rpc==='campaign_start'));
});

for(const lines of [1,2,4,7,11,12]) test(`line limit ${lines} is saved exactly without changing batch limit or campaign state`, async()=>{
 const {status,data,dbCalls}=await callAction({}, {action:'set_dialer_lines',session_token:'valid',concurrency:lines});
 assert.equal(status,200); assert.equal(data.concurrency,lines);
 const update=dbCalls.find(c=>c.table==='campaigns'&&c.op==='update');
 assert.deepEqual(Object.keys(update.data).sort(),['concurrency','updated_at']);
 assert.equal(update.data.concurrency,lines);
 assert.ok(dbCalls.some(c=>c.table==='audit_logs'&&c.data.action==='set_dialer_lines'));
});
for(const lines of [0,13,-1,1.5,'7',true,null]) test(`invalid line limit ${JSON.stringify(lines)} is rejected`,async()=>{
 const {status,dbCalls}=await callAction({}, {action:'set_dialer_lines',session_token:'valid',concurrency:lines});
 assert.equal(status,400);assert.ok(!dbCalls.some(c=>c.op==='update'));
});
for(const role of ['agent','supervisor']) for(const action of ['set_dialer_lines','set_agent_dialer_selection']) test(`${role} cannot change ${action}`,async()=>{
 const {status,dbCalls}=await callAction({_sessionRole:role},{action,session_token:'valid',concurrency:2,agent_id:'c242abef-c01e-490b-bab6-859cd89bd08a',selected:true});
 assert.equal(status,403);assert.ok(!dbCalls.some(c=>c.op==='update'||c.rpc==='set_agent_dialer_selection'));
});
test('line limit database rejection returns error',async()=>{
 const {status,data}=await callAction({_updateError:{message:'database write failed'}},{action:'set_dialer_lines',session_token:'valid',concurrency:2});
 assert.equal(status,400);assert.ok(data.error.includes('database write failed'));
});
test('one-line start reaches the database unchanged',async()=>{
 const {status,dbCalls}=await callAction({}, {action:'start_campaign',session_token:'valid',concurrency:1,call_limit:200});
 assert.equal(status,200);assert.equal(dbCalls.find(c=>c.rpc==='campaign_start').params.p_concurrency,1);
});
test('agent selection rejects malformed boolean',async()=>{
 const {status,dbCalls}=await callAction({}, {action:'set_agent_dialer_selection',session_token:'valid',agent_id:'c242abef-c01e-490b-bab6-859cd89bd08a',selected:'false'});
 assert.equal(status,400);assert.ok(!dbCalls.some(c=>c.rpc==='set_agent_dialer_selection'));
});
