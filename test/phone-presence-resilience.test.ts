import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from './helpers/renderHook';

// ── Global stubs for non-browser test environment ──
const docListeners: Record<string, Set<() => void>> = {};
const winListeners: Record<string, Set<() => void>> = {};
const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

(globalThis as unknown as Record<string, unknown>).document = {
  hidden: false,
  addEventListener: (type: string, fn: () => void) => { (docListeners[type] ??= new Set()).add(fn); },
  removeEventListener: (type: string, fn: () => void) => { docListeners[type]?.delete(fn); },
};
(globalThis as unknown as Record<string, unknown>).window = {
  addEventListener: (type: string, fn: () => void) => { (winListeners[type] ??= new Set()).add(fn); },
  removeEventListener: (type: string, fn: () => void) => { winListeners[type]?.delete(fn); },
  fetch: vi.fn(async (_url: string, opts: Record<string, unknown>) => {
    try { fetchCalls.push({ url: String(_url), body: JSON.parse(String(opts?.body || '{}')) }); } catch {}
    return { ok: true };
  }),
};

vi.mock('@/utils/auth-fetch', () => ({
  authFetch: vi.fn(async (_url: string, opts: Record<string, unknown>) => {
    const body = opts.body as Record<string, unknown>;
    fetchCalls.push({ url: String(_url), body });
    return { ok: true, data: { ok: true }, status: 200, error: null, loggedOut: false };
  }),
}));

import { usePhonePresence } from '@/phone/use-phone-presence';

const noop = () => {};
const ready = { connection_state: 'ready' as const, call_state: 'idle' as const, microphone_granted: true, device_kind: 'desktop' as const };
const active = { ...ready, call_state: 'active' as const };

beforeEach(() => { vi.useFakeTimers(); fetchCalls.length = 0; });
afterEach(() => { vi.useRealTimers(); });

describe('presence resilience during active calls', () => {
  it('continues sending ready/active state during normal heartbeat cycle', async () => {
    const { unmount } = renderHook(
      ({ token }: { token: string }) => usePhonePresence('https://test.example.com', token, active, noop),
      { initialProps: { token: 'tok-1' } },
    );
    await vi.advanceTimersByTimeAsync(100);
    const initial = fetchCalls.filter(c => c.body.call_state === 'active');
    expect(initial.length).toBeGreaterThan(0);

    // Advance past one heartbeat interval (20s)
    await vi.advanceTimersByTimeAsync(20000);
    const heartbeats = fetchCalls.filter(c => c.body.call_state === 'active');
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);

    unmount();
  });

  it('does not reset call_state to idle during an active call when component rerenders', async () => {
    const { rerender, unmount } = renderHook(
      ({ token }: { token: string }) => usePhonePresence('https://test.example.com', token, active, noop),
      { initialProps: { token: 'tok-1' } },
    );
    await vi.advanceTimersByTimeAsync(100);

    // Simulate parent rerender (same token) — should NOT produce false idle
    rerender({ token: 'tok-1' });
    await vi.advanceTimersByTimeAsync(100);

    const idleBeacons = fetchCalls.filter(c => c.body.connection_state === 'idle' && c.body.microphone_granted === false);
    expect(idleBeacons).toHaveLength(0);

    unmount();
  });

  it('sequence numbers increase monotonically across state changes', async () => {
    const { rerender, unmount } = renderHook(
      ({ state }: { state: typeof ready }) => usePhonePresence('https://test.example.com', 'tok-1', state, noop),
      { initialProps: { state: ready } },
    );
    await vi.advanceTimersByTimeAsync(100);

    rerender({ state: active });
    await vi.advanceTimersByTimeAsync(100);

    rerender({ state: ready });
    await vi.advanceTimersByTimeAsync(100);

    const sequences = fetchCalls
      .filter(c => typeof c.body.sequence === 'number')
      .map(c => c.body.sequence as number);
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
    }

    unmount();
  });

  it('pagehide listeners are properly cleaned up after unmount', async () => {
    const { unmount } = renderHook(
      ({ token }: { token: string }) => usePhonePresence('https://test.example.com', token, ready, noop),
      { initialProps: { token: 'tok-1' } },
    );
    await vi.advanceTimersByTimeAsync(100);

    const beforeCount = winListeners['pagehide']?.size ?? 0;
    expect(beforeCount).toBeGreaterThan(0);

    unmount();
    const afterCount = winListeners['pagehide']?.size ?? 0;
    expect(afterCount).toBe(beforeCount - 1);
  });

  it('fires immediate state update when connection_state changes', async () => {
    const connecting = { ...ready, connection_state: 'connecting' as const };
    const { rerender, unmount } = renderHook(
      ({ state }: { state: typeof ready }) => usePhonePresence('https://test.example.com', 'tok-1', state, noop),
      { initialProps: { state: connecting } },
    );
    await vi.advanceTimersByTimeAsync(100);
    const connectingCalls = fetchCalls.filter(c => c.body.connection_state === 'connecting');
    expect(connectingCalls.length).toBeGreaterThan(0);

    rerender({ state: ready });
    await vi.advanceTimersByTimeAsync(100);
    const readyCalls = fetchCalls.filter(c => c.body.connection_state === 'ready');
    expect(readyCalls.length).toBeGreaterThan(0);

    unmount();
  });
});
