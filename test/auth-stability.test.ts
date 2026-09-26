import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch } from '../src/utils/auth-fetch';
import { fetchWithRetry } from '../src/app/shared';

const feature = 'https://example.test/functions/v1/report';
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const action = (opts: RequestInit) => JSON.parse(String(opts.body)).action;
let saved: string | null;
beforeEach(() => {
  saved = 'test-session';
  vi.stubGlobal('localStorage', { getItem: () => saved });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('session preservation and request budgets', () => {
  it('verifies concurrent 401s once and never replays the original actions', async () => {
    let release!: (value: Response) => void;
    const fetcher = vi.fn(async (_url, opts) => action(opts) === 'verify'
      ? new Promise<Response>(resolve => { release = resolve; }) : response({}, 401));
    vi.stubGlobal('fetch', fetcher);
    const logout = vi.fn();
    const calls = [1, 2, 3].map(n => authFetch(feature, {
      body: { action: `action-${n}`, session_token: saved }, onUnauthorized: logout,
    }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(fetcher).toHaveBeenCalledTimes(4);
    release(response({ valid: true }));
    const results = await Promise.all(calls);
    expect(results.every(r => !r.loggedOut && !r.ok)).toBe(true);
    expect(logout).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(4);
    // A later failure must verify afresh; this is not an authorization cache.
    fetcher.mockImplementation(async (_url, opts) => response(action(opts) === 'verify' ? { valid: true } : {}, action(opts) === 'verify' ? 200 : 401));
    await authFetch(feature, { body: { action: 'later', session_token: saved }, onUnauthorized: logout });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it.each([503, 504])('keeps the login when authentication returns %i', async status => {
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => response({}, action(opts) === 'verify' ? status : 401)));
    const logout = vi.fn();
    const result = await authFetch(feature, { body: { session_token: saved }, onUnauthorized: logout });
    expect(result.loggedOut).toBe(false);
    expect(logout).not.toHaveBeenCalled();
  });

  it('logs out only on explicit invalidity for the currently saved login', async () => {
    const logout = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => response(action(opts) === 'verify' ? { valid: false } : {}, action(opts) === 'verify' ? 200 : 401)));
    const result = await authFetch(feature, { body: { session_token: saved }, onUnauthorized: logout });
    expect(result.loggedOut).toBe(true);
    expect(logout).toHaveBeenCalledTimes(1);
    saved = 'new-login';
    const stale = await authFetch(feature, { body: { session_token: 'old-login' }, onUnauthorized: logout });
    expect(stale.loggedOut).toBe(false);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('gives verification its own 25-second budget after a slow feature 401', async () => {
    vi.useFakeTimers();
    const logout = vi.fn();
    vi.stubGlobal('fetch', vi.fn((_url, opts) => new Promise<Response>((resolve, reject) => {
      const verify = action(opts) === 'verify';
      setTimeout(() => resolve(response(verify ? { valid: true } : {}, verify ? 200 : 401)), verify ? 20000 : 14000);
      opts.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
    })));
    const request = authFetch(feature, { body: { session_token: saved }, onUnauthorized: logout });
    await vi.advanceTimersByTimeAsync(34000);
    expect((await request).error).toContain('your login has been kept');
    expect(logout).not.toHaveBeenCalled();
  });

  it('bounds stalled verification and preserves login', async () => {
    vi.useFakeTimers();
    const logout = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => action(opts) === 'verify'
      ? new Promise<Response>((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }))
      : response({}, 401)));
    const request = authFetch(feature, { body: { session_token: saved }, onUnauthorized: logout });
    await vi.advanceTimersByTimeAsync(25001);
    expect((await request).status).toBe(503);
    expect(logout).not.toHaveBeenCalled();
  });

  it('does not let an unmounted page sign out the current account', async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => action(opts) === 'verify'
      ? new Promise<Response>(resolve => { release = resolve; }) : response({}, 401)));
    const controller = new AbortController();
    const logout = vi.fn();
    const request = authFetch(feature, { body: { session_token: saved }, signal: controller.signal, onUnauthorized: logout });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    controller.abort(); release(response({ valid: false }));
    expect((await request).loggedOut).toBe(false);
    expect(logout).not.toHaveBeenCalled();
  });

  it('zero attempts cannot silently suppress a login request', async () => {
    const fetcher = vi.fn(async () => response({ success: false }, 401));
    vi.stubGlobal('fetch', fetcher);
    expect((await fetchWithRetry(feature, { action: 'login', pin: '0000' }, 0)).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not automatically replay a failed login mutation', async () => {
    const fetcher = vi.fn(async () => response({}, 503));
    vi.stubGlobal('fetch', fetcher);
    expect((await fetchWithRetry(feature, { action: 'login', pin: '0000' })).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
