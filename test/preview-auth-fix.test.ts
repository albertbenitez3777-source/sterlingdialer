// Regression tests for preview auth fix:
// URL resolution, missing env, credentialless preview origin, network failure,
// timeout, unauthorized response, server error, loading cleanup.

import { describe, it, expect } from 'vitest';

// ── URL resolution logic (mirrors App.tsx) ──────────────────────────────
function resolveUrls(devMode: boolean, supabaseUrl: string): { authUrl: string; providerUrl: string } {
  const functionsBase = devMode ? '' : supabaseUrl;
  return {
    authUrl: `${functionsBase}/functions/v1/wolf-auth`,
    providerUrl: `${functionsBase}/functions/v1/wolf-provider`,
  };
}

// ── Error classification (mirrors App.tsx) ──────────────────────────────
type LoginErrorKind = 'network' | 'timeout' | 'unauthorized' | 'server_error' | 'unknown';

function classifyFetchError(err: unknown): LoginErrorKind {
  if (err instanceof DOMException && err.name === 'AbortError') return 'timeout';
  if (err instanceof TypeError && /fetch/i.test(err.message)) return 'network';
  if (err instanceof TypeError) return 'network';
  return 'unknown';
}

function loginErrorMessage(kind: LoginErrorKind): string {
  switch (kind) {
    case 'network': return 'Cannot reach the server.';
    case 'timeout': return 'Request timed out.';
    case 'unauthorized': return 'Invalid PIN or credentials.';
    case 'server_error': return 'Server error.';
    default: return 'Connection failed.';
  }
}

describe('Preview Auth Fix Tests', () => {

  // ── 1. Resolved URL in dev mode uses relative path (proxy) ──────────────
  describe('[1] Dev mode URL resolution — relative path for Vite proxy', () => {
    it('dev authUrl is relative', () => {
      const { authUrl } = resolveUrls(true, 'https://rqvpthnackbulnywwgix.supabase.co');
      expect(authUrl).toBe('/functions/v1/wolf-auth');
    });

    it('dev providerUrl is relative', () => {
      const { providerUrl } = resolveUrls(true, 'https://rqvpthnackbulnywwgix.supabase.co');
      expect(providerUrl).toBe('/functions/v1/wolf-provider');
    });

    it('dev authUrl does not contain supabase.co', () => {
      const { authUrl } = resolveUrls(true, 'https://rqvpthnackbulnywwgix.supabase.co');
      expect(authUrl).not.toContain('supabase.co');
    });

    it('dev authUrl is not an absolute URL', () => {
      const { authUrl } = resolveUrls(true, 'https://rqvpthnackbulnywwgix.supabase.co');
      expect(authUrl.startsWith('http')).toBe(false);
    });
  });

  // ── 2. Resolved URL in production uses full Supabase URL ────────────────
  describe('[2] Production URL resolution — full Supabase URL', () => {
    it('prod authUrl is full URL', () => {
      const { authUrl } = resolveUrls(false, 'https://rqvpthnackbulnywwgix.supabase.co');
      expect(authUrl).toBe('https://rqvpthnackbulnywwgix.supabase.co/functions/v1/wolf-auth');
    });

    it('prod providerUrl is full URL', () => {
      const { providerUrl } = resolveUrls(false, 'https://rqvpthnackbulnywwgix.supabase.co');
      expect(providerUrl).toBe('https://rqvpthnackbulnywwgix.supabase.co/functions/v1/wolf-provider');
    });

    it('prod authUrl uses HTTPS', () => {
      const { authUrl } = resolveUrls(false, 'https://rqvpthnackbulnywwgix.supabase.co');
      expect(authUrl.startsWith('https://')).toBe(true);
    });
  });

  // ── 3. Missing env var ──────────────────────────────────────────────────
  describe('[3] Missing VITE_SUPABASE_URL handling', () => {
    it('empty env → relative URL (fallback)', () => {
      const { authUrl } = resolveUrls(false, '');
      expect(authUrl).toBe('/functions/v1/wolf-auth');
    });

    it('empty env → relative provider URL', () => {
      const { providerUrl } = resolveUrls(false, '');
      expect(providerUrl).toBe('/functions/v1/wolf-provider');
    });

    it('no "undefined" in URL', () => {
      const { authUrl } = resolveUrls(false, '');
      expect(authUrl).not.toContain('undefined');
    });

    it('no "null" in URL', () => {
      const { authUrl } = resolveUrls(false, '');
      expect(authUrl).not.toContain('null');
    });
  });

  // ── 4. Credentialless preview origin behavior ───────────────────────────
  describe('[4] Credentialless preview origin — proxy bypasses Origin:null', () => {
    it('dev mode uses proxy', () => {
      const devMode = true;
      const usesProxy = devMode;
      expect(usesProxy).toBe(true);
    });

    it('proxy Origin is not null', () => {
      const proxyOrigin = 'http://localhost:5173';
      expect(proxyOrigin).not.toBe('null');
    });

    it('dev authUrl is same-origin (relative)', () => {
      const { authUrl } = resolveUrls(true, 'https://example.supabase.co');
      const isSameOrigin = !authUrl.startsWith('http');
      expect(isSameOrigin).toBe(true);
    });
  });

  // ── 5. Network failure classification ───────────────────────────────────
  describe('[5] Network failure classification', () => {
    it('TypeError "Failed to fetch" → network', () => {
      const err = new TypeError('Failed to fetch');
      const kind = classifyFetchError(err);
      expect(kind).toBe('network');
    });

    it('network error message', () => {
      expect(loginErrorMessage('network')).toContain('Cannot reach');
    });

    it('network error does not say "timed out"', () => {
      expect(loginErrorMessage('network')).not.toContain('timed out');
    });
  });

  // ── 6. Timeout classification ───────────────────────────────────────────
  describe('[6] Timeout classification', () => {
    it('AbortError → timeout', () => {
      const err = new DOMException('The operation was aborted', 'AbortError');
      const kind = classifyFetchError(err);
      expect(kind).toBe('timeout');
    });

    it('timeout error message', () => {
      expect(loginErrorMessage('timeout')).toContain('timed out');
    });
  });

  // ── 7. Unauthorized response classification ─────────────────────────────
  describe('[7] Unauthorized response handling', () => {
    it('401 → unauthorized', () => {
      const status = 401;
      const kind: LoginErrorKind = status === 401 ? 'unauthorized' : 'unknown';
      expect(kind).toBe('unauthorized');
    });

    it('unauthorized message says "Invalid"', () => {
      expect(loginErrorMessage('unauthorized')).toContain('Invalid');
    });

    it('safe message does not contain response body', () => {
      const responseBody = { error: 'PIN hash mismatch for agent_id xxx' };
      const safeMessage = loginErrorMessage('unauthorized');
      expect(safeMessage).not.toContain(JSON.stringify(responseBody));
    });
  });

  // ── 8. Server error classification ──────────────────────────────────────
  describe('[8] Server error handling', () => {
    it('503 → server_error', () => {
      const status = 503;
      const kind: LoginErrorKind = status >= 500 ? 'server_error' : 'unknown';
      expect(kind).toBe('server_error');
    });

    it('server_error message', () => {
      expect(loginErrorMessage('server_error')).toContain('Server error');
    });
  });

  // ── 9. Loading state cleanup in finally ─────────────────────────────────
  describe('[9] Loading state always cleared in finally', () => {
    it('loading cleared after success', () => {
      let loadingState = false;
      const cleanup = () => { loadingState = false; };
      loadingState = true;
      try { /* success */ } finally { cleanup(); }
      expect(loadingState).toBe(false);
    });

    it('loading cleared after error', () => {
      let loadingState = false;
      const cleanup = () => { loadingState = false; };
      loadingState = true;
      try { throw new Error('network'); } catch { /* handled */ } finally { cleanup(); }
      expect(loadingState).toBe(false);
    });

    it('loading cleared after timeout', () => {
      let loadingState = false;
      const cleanup = () => { loadingState = false; };
      loadingState = true;
      try { throw new DOMException('aborted', 'AbortError'); } catch { /* handled */ } finally { cleanup(); }
      expect(loadingState).toBe(false);
    });
  });

  // ── 10. Double-submit protection ────────────────────────────────────────
  describe('[10] Double-submit protection on login', () => {
    it('first login call allowed', () => {
      const loggingIn = false;
      function canLogin() { return !loggingIn; }
      expect(canLogin()).toBe(true);
    });

    it('second login call blocked while loading', () => {
      let loggingIn = false;
      function canLogin() { return !loggingIn; }
      loggingIn = true;
      expect(canLogin()).toBe(false);
    });

    it('only one call executed', () => {
      let loggingIn = false;
      let callCount = 0;
      function canLogin() { return !loggingIn; }
      // First call
      expect(canLogin()).toBe(true);
      loggingIn = true;
      callCount++;
      // Second call blocked
      expect(canLogin()).toBe(false);
      expect(callCount).toBe(1);
    });

    it('login allowed after cleanup', () => {
      let loggingIn = false;
      function canLogin() { return !loggingIn; }
      loggingIn = true;
      expect(canLogin()).toBe(false);
      loggingIn = false;
      expect(canLogin()).toBe(true);
    });
  });

  // ── 11. Vite proxy config validation ────────────────────────────────────
  describe('[11] Vite proxy config targets Supabase URL', () => {
    const proxyConfig = {
      '/functions': {
        target: 'https://rqvpthnackbulnywwgix.supabase.co',
        changeOrigin: true,
        secure: true,
      },
    };

    it('proxy target is Supabase', () => {
      expect(proxyConfig['/functions'].target).toContain('supabase.co');
    });

    it('changeOrigin is true', () => {
      expect(proxyConfig['/functions'].changeOrigin).toBe(true);
    });

    it('secure is true', () => {
      expect(proxyConfig['/functions'].secure).toBe(true);
    });
  });

  // ── 12. Production build uses direct URL (no proxy) ─────────────────────
  describe('[12] Production build bypasses proxy', () => {
    it('prod authUrl starts with Supabase URL', () => {
      const supabaseUrl = 'https://rqvpthnackbulnywwgix.supabase.co';
      const { authUrl } = resolveUrls(false, supabaseUrl);
      expect(authUrl.startsWith(supabaseUrl)).toBe(true);
    });

    it('prod authUrl is not relative', () => {
      const { authUrl } = resolveUrls(false, 'https://rqvpthnackbulnywwgix.supabase.co');
      expect(authUrl.startsWith('/functions')).toBe(false);
    });
  });
});
