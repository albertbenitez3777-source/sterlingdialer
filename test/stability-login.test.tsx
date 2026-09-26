import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as shared from '../src/app/shared';
import { useLoginLifecycle, useLoginState } from '../src/modules/login/useLoginSession';

let current: ReturnType<typeof useLoginState> & ReturnType<typeof useLoginLifecycle>;
const onLogout = vi.fn();
function Harness() {
  const login = useLoginState();
  const lifecycle = useLoginLifecycle({ ...login, setAgentAvailable: vi.fn(), setActiveNav: vi.fn(), setShowOfflineModal: vi.fn(), atomicLogout: onLogout });
  current = { ...login, ...lifecycle };
  return null;
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let root: ReturnType<typeof create> | undefined;
let saved: Map<string, string>;
beforeEach(() => {
  saved = new Map();
  onLogout.mockClear();
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) });
  vi.stubGlobal('window', { location: { search: '', pathname: '/' }, addEventListener: vi.fn(), removeEventListener: vi.fn(), history: { replaceState: vi.fn() } });
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('restores a valid saved login through the unchanged verify action', async () => {
  saved.set('sterling_session_token', 'synthetic-saved-session');
  const request = vi.spyOn(shared, 'fetchWithRetry').mockImplementation(async (_url, body) => response(body.action === 'verify' ? { valid: true, agent: { id: 'test-agent', role: 'agent', available_for_transfer: true } } : { needs_setup: false }));
  await act(async () => { root = create(<Harness />); });
  expect(current.session?.valid).toBe(true);
  expect(current.sessionToken).toBe('synthetic-saved-session');
  expect(request).toHaveBeenCalledWith(shared.AUTH_URL, { action: 'verify', session_token: 'synthetic-saved-session' }, 1, 25000);
});

it('keeps a saved login during a temporary verification outage', async () => {
  saved.set('sterling_session_token', 'synthetic-saved-session');
  vi.spyOn(shared, 'fetchWithRetry').mockImplementation(async (_url, body) => { if (body.action === 'verify') throw new Error('temporary network outage'); return response({ needs_setup: false }); });
  await act(async () => { root = create(<Harness />); });
  expect(saved.get('sterling_session_token')).toBe('synthetic-saved-session');
  expect(current.session).toBe(null);
  expect(current.loginError).toContain('Reconnecting');
});

it('clears explicitly expired saved authorization', async () => {
  saved.set('sterling_session_token', 'synthetic-expired-session');
  vi.spyOn(shared, 'fetchWithRetry').mockImplementation(async (_url, body) => response(body.action === 'verify' ? { valid: false } : { needs_setup: false }));
  await act(async () => { root = create(<Harness />); });
  expect(saved.has('sterling_session_token')).toBe(false);
  expect(current.loginError).toContain('Session expired');
});

it('rejects incomplete PINs locally and logs out even if the server is unavailable', async () => {
  const request = vi.spyOn(shared, 'fetchWithRetry').mockResolvedValue(response({ needs_setup: false }));
  await act(async () => { root = create(<Harness />); });
  await act(async () => { await current.handleLogin('12'); });
  expect(current.loginError).toBe('PIN must be 4 digits');
  expect(request).toHaveBeenCalledTimes(1);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await act(async () => { await current.handleLogout(); });
  expect(onLogout).toHaveBeenCalledTimes(1);
});
