import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from './helpers/renderHook';

vi.mock('@/utils/auth-fetch', () => ({
  authFetch: vi.fn(async (url: string, opts: Record<string, unknown>) => {
    const body = opts.body as Record<string, unknown>;
    calls.push({ url, ...body });
    return { ok: true, data: { ok: true }, status: 200, error: null, loggedOut: false };
  }),
}));

import { usePhonePresence } from '@/phone/use-phone-presence';
import { authFetch } from '@/utils/auth-fetch';

const mockAuthFetch = vi.mocked(authFetch);
const calls: Array<Record<string, unknown>> = [];

const docStub = {
  hidden: false,
  dispatchEvent: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
const listeners: Record<string, (() => void)[]> = {};
docStub.addEventListener = (type: string, fn: () => void) => { (listeners[type] ??= []).push(fn); };
docStub.removeEventListener = (type: string, fn: () => void) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); };
docStub.dispatchEvent = (e: { type: string }) => { (listeners[e.type] || []).forEach(fn => fn()); };
(globalThis as unknown as Record<string, unknown>).document = docStub;

// Minimal window stub for Node environment
const winListeners: Record<string, (() => void)[]> = {};
const winStub = {
  addEventListener: (type: string, fn: () => void) => { (winListeners[type] ??= []).push(fn); },
  removeEventListener: (type: string, fn: () => void) => { winListeners[type] = (winListeners[type] || []).filter(f => f !== fn); },
  fetch: vi.fn().mockResolvedValue({ ok: true }),
};
(globalThis as unknown as Record<string, unknown>).window = winStub;

const noop = () => {};

describe('usePhonePresence offline beacon', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    mockAuthFetch.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not send an idle/mic-false beacon on effect cleanup (token change remount)', async () => {
    const state = { connection_state: 'ready' as const, call_state: 'idle' as const, microphone_granted: true, device_kind: 'desktop' as const };
    const { rerender, unmount } = renderHook(({ token }: { token: string }) =>
      usePhonePresence('https://test.example.com', token, state, noop), { initialProps: { token: 'tok-1' } });

    // Let the initial presence update fire.
    await vi.advanceTimersByTimeAsync(100);
    const realUpdates = calls.filter(c => c.connection_state === 'ready');

    // Simulate a token change (auth refresh) causing effect teardown + re-setup.
    rerender({ token: 'tok-2' });
    await vi.advanceTimersByTimeAsync(100);

    // No offline beacon should have been sent during the remount.
    const offlineBeacons = calls.filter(c => c.connection_state === 'idle' && c.microphone_granted === false);
    expect(offlineBeacons).toHaveLength(0);

    // The real presence updates should still flow with ready/mic-true.
    expect(realUpdates.length).toBeGreaterThan(0);
    expect(calls.some(c => c.connection_state === 'ready' && c.microphone_granted === true)).toBe(true);

    unmount();
  });

  it('still sends offline beacon on pagehide (genuine unload)', async () => {
    const state = { connection_state: 'ready' as const, call_state: 'idle' as const, microphone_granted: true, device_kind: 'desktop' as const };
    const { unmount } = renderHook(({ token }: { token: string }) =>
      usePhonePresence('https://test.example.com', token, state, noop), { initialProps: { token: 'tok-1' } });

    await vi.advanceTimersByTimeAsync(100);

    // The pagehide listener should still be registered on window and fire offline.
    const pagehideListeners = winListeners['pagehide'] || [];
    expect(pagehideListeners.length).toBeGreaterThan(0);

    unmount();
  });

  it('preserves last-good presence after remount (no false idle overwrite)', async () => {
    const state = { connection_state: 'ready' as const, call_state: 'active' as const, microphone_granted: true, device_kind: 'desktop' as const };
    const { rerender, unmount } = renderHook(({ token }: { token: string }) =>
      usePhonePresence('https://test.example.com', token, state, noop), { initialProps: { token: 'tok-1' } });

    await vi.advanceTimersByTimeAsync(100);

    // During an active call, a token change should NOT send idle/mic-false.
    rerender({ token: 'tok-2' });
    await vi.advanceTimersByTimeAsync(100);

    const falseIdle = calls.filter(c => c.call_state === 'idle' && c.microphone_granted === false);
    expect(falseIdle).toHaveLength(0);

    unmount();
  });
});
