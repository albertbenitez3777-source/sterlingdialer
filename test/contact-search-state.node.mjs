import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { setImmediate } from 'node:timers/promises';

// Execute the production hook with persistent React-style state slots and
// controllable HTTP responses/timers. No contacts or calls leave this process.
function harness() {
  const slots = [], effects = [], requests = [], timers = new Map();
  let cursor = 0, timerId = 0, session = 'first-session', unauthorized = 0;
  const context = vm.createContext({
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(effect, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) {
        effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
      }
    },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    authFetch(url, options) {
      return new Promise(resolve => { requests.push({ ...options, resolve }); });
    },
  });
  const source = readFileSync(new URL('../src/utils/useContactSearch.ts', import.meta.url), 'utf8')
    .replace(/^import[^\n]*\n/gm, '').replace('export function', 'function');
  new vm.Script(stripTypeScriptTypes(source) + '\nglobalThis.hook = useContactSearch;').runInContext(context);
  function render() {
    cursor = 0;
    const state = context.hook('https://offline.invalid', session, () => unauthorized++);
    while (effects.length) effects.shift()();
    return state;
  }
  render();
  return {
    render, requests, timers,
    get unauthorized() { return unauthorized; },
    changeSession(value) { session = value; render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    fireDebounce() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    async respond(index, results = [], count = results.length, ok = true) {
      requests[index].resolve({ ok, data: ok ? { results, count } : null });
      await setImmediate();
      return render();
    },
  };
}

test('typing a new query invalidates the old request before the debounce fires', async () => {
  const h = harness();
  h.render().onSearchChange('old'); h.fireDebounce();
  h.render().onSearchChange('new');
  let state = await h.respond(0, [{ id: 'old-contact' }]);
  assert.equal(state.searchResults.length, 0);
  assert.equal(state.searching, true);
  h.fireDebounce();
  state = await h.respond(1, [{ id: 'new-contact' }], 75);
  assert.equal(state.searchResults[0].id, 'new-contact');
  assert.equal(state.searchTotal, 75);
  assert.equal(state.hasMore, true);
});

test('clearing search cannot be undone by a late response', async () => {
  const h = harness();
  h.render().onSearchChange('contact'); h.fireDebounce();
  h.render().onSearchChange('');
  const state = await h.respond(0, [{ id: 'stale' }]);
  assert.equal(state.searchQuery, '');
  assert.equal(state.searchResults.length, 0);
  assert.equal(state.searching, false);
  assert.equal(h.timers.size, 0);
});

test('pagination survives rerenders and retries the same page after an error', async () => {
  const h = harness();
  h.render().onSearchChange('client'); h.fireDebounce();
  await h.respond(0, [{ id: 'first', contact_key: 'phone:1' }, { id: 'second', contact_key: 'phone:2' }], 4);
  let state = h.render();
  assert.equal(state.searchTotal, 4);
  state.loadMore();
  assert.equal(h.requests[1].body.offset, 2);
  state = await h.respond(1, [], 0, false);
  assert.equal(state.searchError, true);
  state.loadMore();
  assert.equal(h.requests[2].body.offset, 2);
  state = await h.respond(2, [{ id: 'new-id-same-contact', contact_key: 'phone:2' }, { id: 'third', contact_key: 'phone:3' }], 4);
  assert.equal(state.searchResults.length, 3);
  assert.equal(state.hasMore, false);
  assert.equal(state.searchError, false);
});

test('session changes clear contacts and ignore responses from the previous user', async () => {
  const h = harness();
  h.render().onSearchChange('private'); h.fireDebounce();
  h.changeSession('second-session');
  h.requests[0].onUnauthorized();
  const state = await h.respond(0, [{ id: 'first-users-contact' }]);
  assert.equal(state.searchResults.length, 0);
  assert.equal(state.searchQuery, '');
  assert.equal(h.unauthorized, 0);
});

test('leaving the app clears a pending debounce and invalidates active requests', async () => {
  const h = harness();
  h.render().onSearchChange('first'); h.fireDebounce();
  h.render().onSearchChange('second');
  h.unmount();
  assert.equal(h.timers.size, 0);
  const state = await h.respond(0, [{ id: 'late' }]);
  assert.equal(state.searchResults.length, 0);
});
