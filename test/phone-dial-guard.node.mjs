import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/components/IPhone.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const dial = useCallback(');
const end = source.indexOf('\n\n  useEffect(', start);
const code = stripTypeScriptTypes(source.slice(start, end)) + '\nthis.dial = dial;';

function fixture(connection = 'ready') {
  let microphoneResolve;
  const commands = [], results = [];
  const abort = new AbortController();
  const context = vm.createContext({
    useCallback: value => value, setOpen() {}, setView() {}, setError() {}, setDigits() {}, unlockAudio() {},
    companionOnly: false, connection, stateRef: { current: 'idle' },
    pendingCallRef: { current: false }, pendingRequestRef: { current: null },
    phoneIdentityRef: { current: 0 }, dialGenerationRef: { current: 0 },
    normalizeDialNumber: value => value, requestMic: () => new Promise(resolve => { microphoneResolve = resolve; }),
    command: (...args) => commands.push(args),
  });
  new vm.Script(code).runInContext(context);
  const request = { requestId: 'synthetic-dial', expiresAt: Date.now() + 10000, signal: abort.signal, respond: result => results.push(result) };
  return { context, commands, results, request, abort, resolveMic: value => microphoneResolve({ granted: value }) };
}

test('not-ready phones reject without posting any dial command', async () => {
  const f = fixture('failed'); await f.context.dial('2025550100', f.request);
  assert.equal(f.commands.length, 0); assert.equal(f.results[0].status, 'failed');
});
test('cancelled microphone prompts cannot start delayed calls', async () => {
  const f = fixture(); const pending = f.context.dial('2025550100', f.request);
  f.abort.abort(); f.resolveMic(true); await pending;
  assert.equal(f.commands.length, 0); assert.equal(f.context.pendingCallRef.current, false);
});
test('a session change during microphone permission prevents dialing', async () => {
  const f = fixture(); const pending = f.context.dial('2025550100', f.request);
  f.context.phoneIdentityRef.current++; f.resolveMic(true); await pending;
  assert.equal(f.commands.length, 0);
});
test('an incoming call during microphone permission prevents a new outbound call', async () => {
  const f = fixture(); const pending = f.context.dial('2025550100', f.request);
  f.context.stateRef.current = 'ringing-in'; f.resolveMic(true); await pending;
  assert.equal(f.commands.length, 0); assert.equal(f.results[0].status, 'failed');
});
test('duplicate clicks cannot send a second dial while the first is pending', async () => {
  const f = fixture(); const pending = f.context.dial('2025550100', f.request);
  let secondResult;
  await f.context.dial('2025550101', { ...f.request, requestId: 'second', respond: r => { secondResult = r; } });
  f.resolveMic(true); await pending;
  assert.equal(secondResult.status, 'failed'); assert.equal(f.commands.length, 1);
  assert.equal(f.commands[0][1].requestId, 'synthetic-dial'); assert.equal(f.results.length, 0);
});
