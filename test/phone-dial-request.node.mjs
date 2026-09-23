import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHONE_DIAL_EVENT, requestPhoneDial } from '../src/phone/dial-request.ts';

test('missing phone listener fails without claiming a call request', async () => {
  const result = await requestPhoneDial('2025550100', {}, new EventTarget());
  assert.equal(result.status, 'failed');
  assert.match(result.error, /unavailable/);
});

test('waits for phone acceptance and returns its readiness error', async () => {
  const target = new EventTarget();
  let request;
  target.addEventListener(PHONE_DIAL_EVENT, event => { event.preventDefault(); request = event.detail; });
  let resolved = false;
  const result = requestPhoneDial('2025550100', {}, target).then(value => { resolved = true; return value; });
  await Promise.resolve();
  assert.equal(resolved, false);
  request.respond({ status: 'failed', error: 'Enable your phone and wait for Ready.' });
  assert.match((await result).error, /Ready/);
});

test('a phone acknowledgement means requested, not answered', async () => {
  const target = new EventTarget();
  target.addEventListener(PHONE_DIAL_EVENT, event => { event.preventDefault(); event.detail.respond({ status: 'requested' }); });
  assert.deepEqual(await requestPhoneDial('2025550100', {}, target), { status: 'requested' });
});

test('closing a request aborts delayed phone work and ignores a late acknowledgement', async () => {
  const target = new EventTarget();
  const abort = new AbortController();
  let request;
  target.addEventListener(PHONE_DIAL_EVENT, event => { event.preventDefault(); request = event.detail; });
  const pending = requestPhoneDial('2025550100', { signal: abort.signal }, target);
  abort.abort();
  assert.equal(request.signal.aborted, true);
  request.respond({ status: 'requested' });
  assert.equal((await pending).status, 'cancelled');
});

test('timeouts abort delayed phone work without leaving the button waiting', async () => {
  const target = new EventTarget();
  let request;
  target.addEventListener(PHONE_DIAL_EVENT, event => { event.preventDefault(); request = event.detail; });
  const result = await requestPhoneDial('2025550100', { timeoutMs: 10 }, target);
  assert.equal(result.status, 'failed');
  assert.equal(request.signal.aborted, true);
});

test('an already cancelled request never reaches the phone', async () => {
  const target = new EventTarget();
  const abort = new AbortController(); abort.abort();
  let received = false;
  target.addEventListener(PHONE_DIAL_EVENT, () => { received = true; });
  assert.equal((await requestPhoneDial('2025550100', { signal: abort.signal }, target)).status, 'cancelled');
  assert.equal(received, false);
});
