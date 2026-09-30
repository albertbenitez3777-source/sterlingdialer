import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../supabase/functions/zadarma-events/index.ts', import.meta.url), 'utf8');
const baseline = readFileSync(new URL('../maintenance/zadarma-events-v6-before-diagnostics.ts', import.meta.url), 'utf8');
const testSecret = 'synthetic-webhook-test-only';
const agent = { id: 'synthetic-agent', talkroute_number: '12025550101', zadarma_sip_login: 'test-102' };
const baseEvent = {
  event: 'NOTIFY_OUT_END', pbx_call_id: 'synthetic-pbx-001', internal: '102',
  caller_id: '12025550102', destination: '12025550103', called_did: agent.talkroute_number,
  call_start: '2026-09-30 08:00:00', disposition: 'cancel', duration: '5', status_code: '28',
};

function harness(code = source, options = {}) {
  const rpc = []; const logs = []; let handler;
  const db = {
    from(table) {
      const result = table === 'system_config' ? { data: { value: testSecret }, error: null }
        : table === 'agents' ? { data: options.noRoute ? [] : [agent], error: null }
        : { data: null, error: null };
      const builder = { select() { return this; }, eq() { return this; }, maybeSingle: async () => result,
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
      return builder;
    },
    async rpc(name, args) { rpc.push({ name, args: JSON.parse(JSON.stringify(args)) }); return { data: { ok: true }, error: null }; },
  };
  const js = transformSync(code.replace(/^import .*;\n/gm, ''), { loader: 'ts', target: 'es2022' }).code;
  vm.runInNewContext(js, {
    Deno: { serve(fn) { handler = fn; }, env: { get(key) { return key === 'ZADARMA_API_SECRET' ? testSecret : 'synthetic-test-value'; } } },
    createClient: () => db, createHash, createHmac, timingSafeEqual, Request, Response, URL, URLSearchParams,
    TextDecoder, TextEncoder, btoa, console: { info(message) { if (options.throwLog) throw new Error('test logger failure'); logs.push(message); }, error() {} },
  });
  return { rpc, logs, async send(overrides = {}, invalidSignature = false) {
    const payload = { ...baseEvent, ...overrides };
    const signed = payload.event === 'NOTIFY_RECORD' ? payload.pbx_call_id + payload.call_id_with_rec
      : payload.event.startsWith('NOTIFY_OUT_') ? payload.internal + payload.destination + payload.call_start
      : payload.event === 'NOTIFY_ANSWER' ? payload.caller_id + payload.destination + payload.call_start
      : payload.caller_id + payload.called_did + payload.call_start;
    const signature = invalidSignature ? 'invalid' : btoa(createHmac('sha1', testSecret).update(signed).digest('hex'));
    return handler(new Request('https://synthetic.test/zadarma-events', { method: 'POST', headers: { 'content-type': 'application/json', Signature: signature }, body: JSON.stringify(payload) }));
  } };
}

test('valid signed outbound ending logs only bounded diagnostic fields and preserves the event', async () => {
  const h = harness(); assert.equal((await h.send()).status, 200);
  assert.equal(h.logs.length, 1);
  const diagnostic = JSON.parse(h.logs[0].slice('zadarma_call_end_v1 '.length));
  assert.deepEqual(diagnostic, {
    call_ref: createHash('sha256').update(baseEvent.pbx_call_id).digest('hex').slice(0, 16),
    event: 'NOTIFY_OUT_END', extension: '102', direction: 'outbound', status_code: 28, disposition: 'cancel', duration_seconds: 5,
  });
  assert.equal(h.rpc.length, 1);
  for (const privateValue of [baseEvent.caller_id, baseEvent.destination, baseEvent.called_did, baseEvent.pbx_call_id, testSecret]) assert.ok(!h.logs[0].includes(privateValue));
  assert.ok(!('status_code' in h.rpc[0].args.p_event));
});

test('invalid signature creates neither diagnostics nor a saved call', async () => {
  const h = harness(); assert.equal((await h.send({}, true)).status, 401);
  assert.equal(h.logs.length, 0); assert.equal(h.rpc.length, 0);
});

test('unassigned route creates neither diagnostics nor a saved call', async () => {
  const h = harness(source, { noRoute: true }); assert.equal((await h.send()).status, 200);
  assert.equal(h.logs.length, 0); assert.equal(h.rpc.length, 0);
});

test('invalid or missing cause codes are null and arbitrary payload text cannot enter logs', async () => {
  for (const code of [undefined, null, '', '-1', '128', '999', '28 extra-private-text', { private: 'not-for-logs' }]) {
    const h = harness(); await h.send({ status_code: code, disposition: 'secret-value-not-a-disposition' });
    const diagnostic = JSON.parse(h.logs[0].slice('zadarma_call_end_v1 '.length));
    assert.equal(diagnostic.status_code, null); assert.equal(diagnostic.disposition, 'unknown');
    assert.ok(!h.logs[0].includes('private')); assert.ok(!h.logs[0].includes('secret-value'));
  }
});

test('all supported event types retain the exact existing database input and HTTP result', async () => {
  for (const event of ['NOTIFY_START', 'NOTIFY_INTERNAL', 'NOTIFY_ANSWER', 'NOTIFY_END', 'NOTIFY_OUT_START', 'NOTIFY_OUT_END', 'NOTIFY_RECORD']) {
    const old = harness(baseline); const current = harness();
    const payload = { event, call_id_with_rec: 'synthetic-recording' };
    const before = await old.send(payload); const after = await current.send(payload);
    assert.equal(after.status, before.status); assert.deepEqual(await after.json(), await before.json());
    assert.deepEqual(current.rpc, old.rpc, event);
    assert.equal(current.logs.length, ['NOTIFY_END', 'NOTIFY_OUT_END'].includes(event) ? 1 : 0);
  }
});

test('a diagnostic logger failure never stops saving the call event', async () => {
  const h = harness(source, { throwLog: true }); assert.equal((await h.send()).status, 200); assert.equal(h.rpc.length, 1);
});

test('inbound endings retain inbound identity and numeric zero remains an explicit code', async () => {
  const h = harness(); await h.send({ event: 'NOTIFY_END', status_code: 0 });
  const diagnostic = JSON.parse(h.logs[0].slice('zadarma_call_end_v1 '.length));
  assert.equal(diagnostic.direction, 'inbound'); assert.equal(diagnostic.status_code, 0);
});
