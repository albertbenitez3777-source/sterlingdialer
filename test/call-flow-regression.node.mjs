// Run with Node 24+: npm run test:call-flow
// Executes the production Edge Function handlers with mocked I/O. No live calls,
// database access, provider credentials, or dependency installation are needed.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const sourceRoot = process.env.CALL_FLOW_SOURCE_ROOT
  ? pathToFileURL(resolve(process.env.CALL_FLOW_SOURCE_ROOT) + '/')
  : new URL('../', import.meta.url);
const evidence = await import(new URL('supabase/functions/_shared/call-evidence.ts', sourceRoot));
const webhookSecret = 'synthetic-webhook-test-secret';
const providerId = 'synthetic-provider-call';

function loadHandler(file, overrides = {}, env = {}) {
  let handler;
  const context = vm.createContext({
    ...evidence, createHmac, timingSafeEqual,
    URL, Request, Response, Blob, TextEncoder, Uint8Array,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => { throw new Error('Unexpected network request'); },
    Deno: { env: { get: name => env[name] || '' }, serve: fn => { handler = fn; } },
    ...overrides,
  });
  // Remote runtime imports are replaced with mocked I/O and the real evidence
  // module above. The handler body is executed unchanged.
  const source = readFileSync(new URL(file, sourceRoot), 'utf8')
    .replace(/^import[\s\S]*?;\s*/gm, '');
  new vm.Script(stripTypeScriptTypes(source), { filename: file }).runInContext(context);
  assert.equal(typeof handler, 'function');
  return handler;
}

async function webhookCase(payload, { validSignature = true, secretary = false, inbound = false } = {}) {
  const queries = [];
  function sql(strings, ...values) {
    const query = strings.reduce((out, part, i) => out + (i ? '$' + i : '') + part, '')
      .replace(/\s+/g, ' ').trim();
    return { then(onSuccess, onError) {
      queries.push({ query, values });
      const result = async () => {
        // Reproduce the database boundary that rejected relative speech offsets.
        for (const match of query.matchAll(/\$(\d+)::timestamptz/g)) {
          const value = values[Number(match[1]) - 1];
          if (value != null && (!/^\d{4}-\d{2}-\d{2}T/.test(String(value)) || !Number.isFinite(Date.parse(String(value))))) {
            throw new Error('Invalid timestamptz parameter');
          }
        }
        if (query.startsWith('SELECT id, queue, agent_id') && query.includes(' FROM calls WHERE provider_call_id')) {
          return secretary || inbound ? [] : [{ id: 'synthetic-call', queue: 'pending', agent_id: null, lead_id: null, created_at: '2026-09-08T12:00:00Z' }];
        }
        if (query.startsWith('INSERT INTO calls')) {
          return [{ id: 'synthetic-inbound-call', queue: 'pending', agent_id: null, created_at: '2026-09-08T12:00:00Z' }];
        }
        if (query.startsWith('SELECT id, queue, ai_terminated FROM calls')) {
          return [{ id: 'synthetic-call', queue: 'pending', ai_terminated: false }];
        }
        if (query.startsWith('SELECT id, agent_id FROM secretary_calls')) {
          return secretary ? [{ id: 'synthetic-secretary', agent_id: null }] : [];
        }
        if (query.startsWith('SELECT agent_notes, duration_seconds, ai_terminated')) {
          return [{ agent_notes: '', duration_seconds: 0, ai_terminated: false }];
        }
        return [];
      };
      return result().then(onSuccess, onError);
    } };
  }
  sql.end = async () => {};
  const handler = loadHandler('supabase/functions/wolf-webhook/index.ts', { postgres: () => sql }, {
    BLAND_WEBHOOK_SECRET: webhookSecret,
  });
  const body = JSON.stringify({ call_id: providerId, ...payload });
  const signature = createHmac('sha256', webhookSecret).update(body).digest('hex');
  const response = await handler(new Request('https://offline.invalid/wolf-webhook', {
    method: 'POST', body,
    headers: { 'x-webhook-signature': validSignature ? signature : 'invalid-signature' },
  }));
  return {
    status: response.status,
    body: await response.json(),
    queries,
    outcome: queries.find(q => q.query.startsWith('UPDATE calls SET is_live_human')),
  };
}

async function backfillCase(providerResponse, { historicalFull = false } = {}) {
  const writes = [];
  const providerIds = [];
  const pendingCall = {
    id: 'synthetic-call', provider_call_id: providerId, queue: 'pending',
    agent_id: null, is_completed: false, recording_url: '', duration_seconds: 0, agent_notes: '',
  };
  const supabase = { from(table) {
    const filters = [];
    let patch;
    const q = {};
    for (const op of ['select', 'not', 'neq', 'eq', 'in', 'limit', 'maybeSingle', 'order']) {
      q[op] = (...args) => { filters.push([op, ...args]); return q; };
    }
    q.update = value => { patch = value; return q; };
    q.insert = () => { throw new Error('Unexpected inbox insertion'); };
    q.then = (onSuccess, onError) => {
      if (patch) {
        writes.push({ table, patch });
        return Promise.resolve({ data: null, error: null }).then(onSuccess, onError);
      }
      const includesPending = filters.some(f => f[0] === 'in' && f[1] === 'queue' && f[2].includes('pending'));
      const single = filters.some(f => f[0] === 'maybeSingle');
      const historical = historicalFull ? Array.from({ length: 50 }, (_, i) => ({ ...pendingCall,
        id: `historical-${i}`, provider_call_id: `synthetic-history-${i}`, queue: 'no_answer', is_completed: true,
      })) : [];
      return Promise.resolve({ data: includesPending ? [pendingCall] : single ? null : historical, error: null })
        .then(onSuccess, onError);
    };
    return q;
  } };
  const handler = loadHandler('supabase/functions/wolf-backfill/index.ts', {
    createClient: () => supabase,
    fetch: async (url, options) => {
      const id = String(url).split('/').at(-1);
      assert.ok(id === providerId || /^synthetic-history-\d+$/.test(id));
      providerIds.push(id);
      assert.equal(options.method ?? 'GET', 'GET');
      return new Response(JSON.stringify(id === providerId ? providerResponse : { completed: false }), { status: 200 });
    },
  }, { BLAND_API_KEY: 'synthetic-not-a-provider-credential' });
  const response = await handler(new Request('https://offline.invalid/wolf-backfill', {
    method: 'POST', body: JSON.stringify({ action: 'backfill_transcripts' }),
  }));
  return { status: response.status, body: await response.json(), writes, providerIds };
}

test('pending calls are recovered before a full historical zero-duration backlog', async () => {
  const result = await backfillCase({ completed: true, status: 'no_answer' }, { historicalFull: true });
  assert.equal(result.status, 200);
  assert.equal(result.providerIds[0], providerId);
  assert.equal(result.providerIds.length, 51);
  assert.equal(result.writes.length > 0, true);
});

for (const category of ['queue', 'call', 'tool', 'latency', 'webhook', 'dynamic_data']) {
  test(`webhook ignores live ${category} log without finalizing or requesting a transfer`, async () => {
    const result = await webhookCase({ category, message: 'Call connected', log_level: 'info' });
    assert.equal(result.status, 200);
    assert.equal(result.queries.length, 0);
  });
}

for (const payload of [
  { status: 'queued' },
  { type: 'call', status: 'in_progress', transcripts: [{ user: 'user', text: 'Hello' }] },
  { status: 'in-progress', completed: false, summary: 'Conversation still active' },
  { completed: false, queue_status: 'complete' },
]) {
  test(`webhook leaves active call untouched: ${JSON.stringify(payload)}`, async () => {
    const result = await webhookCase(payload);
    assert.equal(result.status, 200);
    assert.equal(result.queries.length, 0);
  });
}

for (const payload of [
  {},
  { event_type: 'citations', citations: [] },
  { summary: 'An incomplete callback', call_length: 1 },
  { event_type: 'post_transfer_transcript', post_transfer_transcript: [] },
  { event_type: 'post_transfer_transcript', post_transfer_transcript: [{ speaker: 1, text: 'Hello?' }] },
]) {
  test(`incomplete webhook preserves existing call outcomes: ${JSON.stringify(payload)}`, async () => {
    const result = await webhookCase(payload);
    assert.equal(result.status, 200);
    assert.equal(result.queries.length, 0);
  });
}

test('webhook never clears a prior DNC flag and honors explicit provider DNC', async () => {
  for (const payload of [{ completed: true }, { completed: true, is_dnc: true }]) {
    const result = await webhookCase(payload);
    assert.equal(result.status, 200);
    assert.ok(result.queries.every(q => !/is_dnc\s*=\s*false/i.test(q.query)));
    assert.equal(result.queries.some(q => q.query.startsWith('UPDATE calls SET is_dnc = true')), payload.is_dnc === true);
  }
});

test('provider connection time is persisted without substituting request creation time', async () => {
  for (const startedAt of ['2026-09-08T12:00:00Z', '9.544', 'invalid', undefined]) {
    const payload = { completed: true, started_at: startedAt, created_at: '2026-09-08T11:59:00Z' };
    const result = await webhookCase(payload);
    assert.equal(result.status, 200);
    const match = result.outcome.query.match(/started_at = COALESCE\(\$(\d+)::timestamptz/);
    assert.ok(match);
    const expected = startedAt === '2026-09-08T12:00:00Z' ? startedAt : null;
    assert.equal(result.outcome.values[Number(match[1]) - 1], expected);
    const backfill = await backfillCase(payload);
    assert.equal(backfill.writes[0].patch.started_at ?? null, expected);
  }
});

test('backfill honors explicit provider DNC even when transcript is absent', async () => {
  const result = await backfillCase({ completed: true, is_dnc: true });
  assert.equal(result.writes[0].patch.is_dnc, true);
});

test('malformed transfer timestamps cannot reject a confirmed bridge update', async () => {
  const payload = { completed: true, transferred_at: '9.544', warm_transfer_call: { state: 'MERGED' } };
  const result = await webhookCase(payload);
  assert.equal(result.status, 200);
  assert.equal(result.body.detected.transfer_state, 'bridge_confirmed');
  const backfill = await backfillCase(payload);
  assert.ok(Number.isFinite(Date.parse(backfill.writes[0].patch.talkroute_answered_at)));
});

function dialerCase({ available = 0, running = true, stale = false, providerStatus = 200, providerResponse = {}, continuationFailures = 0 } = {}) {
  const timers = [];
  const retained = [];
  const requests = [];
  const queries = [];
  let continuationAttempts = 0;
  const sql = async (strings) => {
    const query = strings.join('$').replace(/\s+/g, ' ').trim();
    queries.push(query);
    if (query.startsWith('SELECT id, provider_call_id, created_at')) return stale ? [{ id: 'stale-call', provider_call_id: providerId }] : [];
    if (query.startsWith('SELECT state, provider_call_limit')) return [{ state: running ? 'running' : 'stopped' }];
    if (query.includes('count_available_agents()')) return [{ cnt: available }];
    if (query.includes('dialer_next_batch()')) return [{ dialer_next_batch: { success: true, calls: [] } }];
    return [];
  };
  sql.end = async () => {};
  const handler = loadHandler('supabase/functions/wolf-dialer-loop/index.ts', {
    postgres: () => sql,
    Date: class extends Date { static now() { return 46000; } },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    EdgeRuntime: { waitUntil(promise) { retained.push(promise); } },
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method ?? 'GET' });
      if (url === `https://api.bland.ai/v1/calls/${providerId}`) {
        return new Response(JSON.stringify(providerResponse), { status: providerStatus });
      }
      assert.equal(url, 'https://offline.invalid/functions/v1/wolf-dialer-loop', 'No customer call or stop request is allowed');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { continue: true });
      continuationAttempts++;
      return new Response('{}', { status: continuationAttempts <= continuationFailures ? 503 : 200 });
    },
  }, { SUPABASE_URL: 'https://offline.invalid', BLAND_API_KEY: 'synthetic-not-a-provider-credential' });
  return { handler, timers, retained, requests, queries };
}

for (const available of [0, 1]) {
  test(`dialer retains its delayed continuation after responding (${available} available agents)`, async () => {
    const fixture = dialerCase({ available });
    const response = await fixture.handler(new Request('https://offline.invalid/dialer', { method: 'POST' }));
    assert.equal(response.status, 200);
    assert.equal(fixture.retained.length, 1);
    assert.equal(typeof fixture.retained[0].then, 'function');
    assert.equal(fixture.timers[0].delay, 20000);
    assert.equal(fixture.requests.length, 0);
    let settled = false;
    fixture.retained[0].then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    fixture.timers[0].fn();
    await fixture.retained[0];
    assert.equal(fixture.requests.length, 1);
  });
}

test('dialer retains one delayed retry after a failed continuation response', async () => {
  const fixture = dialerCase({ continuationFailures: 2 });
  await fixture.handler(new Request('https://offline.invalid/dialer', { method: 'POST' }));
  fixture.timers[0].fn();
  await new Promise(setImmediate);
  assert.equal(fixture.timers[1].delay, 10000);
  fixture.timers[1].fn();
  await fixture.retained[0];
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.timers.length, 2);
});

for (const [providerStatus, providerResponse] of [
  [503, {}], [200, {}], [200, { completed: false }], [200, { queue_status: 'started' }],
]) {
  test(`watchdog never stops calls with unconfirmed completion: ${providerStatus} ${JSON.stringify(providerResponse)}`, async () => {
    const fixture = dialerCase({ running: false, stale: true, providerStatus, providerResponse });
    const response = await fixture.handler(new Request('https://offline.invalid/dialer', { method: 'POST' }));
    assert.equal(response.status, 200);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0].method, 'GET');
    assert.equal(fixture.retained.length, 0);
  });
}

test('watchdog reconciles a completed no-answer without hanging up or inventing duration', async () => {
  const fixture = dialerCase({ running: false, stale: true, providerResponse: { completed: true, status: 'no-answer' } });
  await fixture.handler(new Request('https://offline.invalid/dialer', { method: 'POST' }));
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].method, 'GET');
  const update = fixture.queries.find(q => q.startsWith('UPDATE calls'));
  assert.ok(update);
  assert.ok(!update.includes('duration_seconds'));
  assert.ok(!update.includes('agent_notes'));
});

test('watchdog leaves ended human calls for evidence-preserving backfill', async () => {
  const fixture = dialerCase({ running: false, stale: true, providerResponse: { completed: true, answered_by: 'human' } });
  await fixture.handler(new Request('https://offline.invalid/dialer', { method: 'POST' }));
  assert.equal(fixture.requests.length, 1);
  assert.ok(!fixture.queries.some(q => q.startsWith('UPDATE calls')));
});

test('webhook authenticates live log entries before acknowledging them', async () => {
  const result = await webhookCase({ category: 'call', message: 'Call connected' }, { validSignature: false });
  assert.equal(result.status, 401);
  assert.equal(result.queries.length, 0);
});

test('explicit live transfer event still records transfer progress without finalizing', async () => {
  const result = await webhookCase({ type: 'transfer', status: 'transferring', completed: false });
  assert.equal(result.status, 200);
  assert.ok(result.queries.some(q => q.query.startsWith("UPDATE calls SET transfer_state = 'transfer_api_accepted'")));
  assert.equal(result.outcome, undefined);
});

test('completed webhook retains human evidence during transfer acceptance', async () => {
  const result = await webhookCase({ completed: true, answered_by: 'human', transfer_status: 'accepted' });
  assert.equal(result.status, 200);
  assert.equal(result.outcome.values[0], true);
  assert.equal(result.body.detected.queue, 'human_drop');
  assert.equal(result.body.detected.transfer_state, 'transfer_api_accepted');
});

test('transfer acceptance alone does not become human or bridge evidence', async () => {
  const result = await webhookCase({ completed: true, transfer_status: 'accepted' });
  assert.equal(result.status, 200);
  assert.equal(result.outcome.values[0], false);
  assert.equal(result.body.detected.queue, 'no_answer');
});

test('completed voicemail still reaches the voicemail queue', async () => {
  const result = await webhookCase({ completed: true, answered_by: 'voicemail' });
  assert.equal(result.status, 200);
  assert.equal(result.body.detected.queue, 'voice_message');
});

test('completed secretary call still saves its outcome', async () => {
  const result = await webhookCase({ completed: true, status: 'completed' }, { secretary: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'completed');
  assert.ok(result.queries.some(q => q.query.startsWith('UPDATE secretary_calls')));
});

test('new completed inbound call records its creation time without a runtime error', async () => {
  const result = await webhookCase({ completed: true, status: 'completed', answered_by: 'human', inbound: true }, { inbound: true });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.created, true);
  assert.equal(result.body.call_id, 'synthetic-inbound-call');
});

const repSegments = [{ start: 9.544, end: 17.804, speaker: 2, speaker_label: 'representative', text: 'Hello, this is the representative.' }];
for (const [timing, expected] of [
  [{ started_at: '2026-09-08T12:00:00Z', transfer_offset_seconds: 9.573 }, '2026-09-08T12:00:19.117Z'],
  [{ transferred_at: '2026-09-08T12:00:10Z' }, '2026-09-08T12:00:19.544Z'],
  [{}, null],
]) {
  test(`relative transcript timestamp is safe at the database boundary: ${JSON.stringify(timing)}`, async () => {
    const result = await webhookCase({
      event_type: 'post_transfer_transcript', ...timing, post_transfer_transcript: repSegments,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.detected.transfer_state, 'bridge_confirmed');
    const match = result.outcome.query.match(/rep_first_speech_at = COALESCE\(\$(\d+)::timestamptz/);
    assert.ok(match);
    assert.equal(result.outcome.values[Number(match[1]) - 1], expected);
  });
}

test('representative speech accepts zero offsets and validates missing or malformed timestamps', () => {
  const segment = [{ speaker: 2, text: 'Hello', start: 0 }];
  assert.equal(evidence.extractRepFirstSpeechAt(segment, { started_at: '2026-09-08T12:00:00Z', transfer_offset_seconds: 0 }), '2026-09-08T12:00:00.000Z');
  assert.equal(evidence.extractRepFirstSpeechAt([{ speaker: 2, text: 'Hello', timestamp: '9.544' }]), null);
  assert.equal(evidence.extractRepFirstSpeechAt([{ speaker: 2, text: 'Hello', timestamp: '2026-09-04T12:00:05Z' }]), '2026-09-04T12:00:05Z');
  assert.equal(evidence.extractRepFirstSpeechAt(segment, { transferred_at: 'invalid' }), null);
  assert.equal(evidence.extractRepFirstSpeechAt([{ speaker: 1, text: 'Hello', start: 0 }], { transferred_at: '2026-09-08T12:00:00Z' }), null);
});

for (const payload of [
  { status: 'in-progress', completed: false, call_length: 0, transcripts: [] },
  { status: 'in-progress', completed: false, call_length: 1, transcripts: [{ user: 'user', text: 'Hello' }] },
  { status: 'queued' },
  { queue_status: 'allocated' },
  { completed: false, queue_status: 'complete' },
  { end_at: '2026-09-08T12:08:00Z' },
  { status: 'success' },
]) {
  test(`backfill leaves active or unknown provider call untouched: ${JSON.stringify(payload)}`, async () => {
    const result = await backfillCase(payload);
    assert.equal(result.status, 200);
    assert.equal(result.writes.length, 0);
    assert.equal(result.body.skipped, 1);
    assert.equal(result.body.updated, 0);
    assert.equal(result.body.failed, 0);
  });
}

for (const payload of [
  { completed: true, queue_status: 'started' },
  { completed: true, status: 'completed', call_length: 1, transcripts: [] },
  { status: 'completed' },
  { status: 'no-answer' },
  { queue_status: 'complete' },
  { queue_status: 'queue_error' },
]) {
  test(`backfill still finalizes completed calls: ${JSON.stringify(payload)}`, async () => {
    const result = await backfillCase(payload);
    assert.equal(result.status, 200);
    assert.equal(result.body.updated, 1);
    assert.equal(result.body.skipped, 0);
    assert.equal(result.writes[0].patch.is_completed, true);
  });
}

test('completion flags take precedence and unknown responses are not completion evidence', () => {
  assert.equal(evidence.getBlandCallCompletion({ completed: false, queue_status: 'complete' }), false);
  assert.equal(evidence.getBlandCallCompletion({ completed: true, queue_status: 'started' }), true);
  assert.equal(evidence.getBlandCallCompletion({ status: 'in-progress', queue_status: 'complete' }), false);
  assert.equal(evidence.getBlandCallCompletion({ status: 'future-provider-status' }), null);
});
