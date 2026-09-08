/**
 * Centralized authenticated fetch. Enforces:
 * - Exactly one atomic logout on 401 (calls onUnauthorized once, never retries).
 * - 5xx and network errors do NOT log out — caller sees error, keeps session.
 * - No retry loop — single request, single result.
 * - Loading is caller-managed; this function never throws.
 */
export interface AuthFetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  loggedOut: boolean;
}

export interface AuthFetchOptions {
  onUnauthorized: () => void;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function authFetch<T = unknown>(
  url: string,
  opts: AuthFetchOptions,
): Promise<AuthFetchResult<T>> {
  const { onUnauthorized, body, signal, timeoutMs = 15000 } = opts;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort());

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 401) {
      onUnauthorized();
      return { ok: false, status: 401, data: null, error: 'Session expired', loggedOut: true };
    }

    let parsed: T = null as T;
    let parseError: string | null = null;
    try { parsed = await res.json() as T; } catch { parseError = 'Invalid response from server'; }

    if (res.status >= 500) {
      const errMsg = (parsed as unknown as Record<string, unknown>)?.error as string || parseError || `HTTP ${res.status}`;
      return { ok: false, status: res.status, data: null, error: errMsg, loggedOut: false };
    }
    if (res.status >= 400) {
      const errMsg = (parsed as unknown as Record<string, unknown>)?.error as string || parseError || `HTTP ${res.status}`;
      return { ok: false, status: res.status, data: parsed, error: errMsg, loggedOut: false };
    }
    if (parseError) {
      return { ok: false, status: res.status, data: null, error: parseError, loggedOut: false };
    }
    const errField = (parsed as unknown as Record<string, unknown>)?.error;
    if (errField && typeof errField === 'string') {
      return { ok: false, status: res.status, data: parsed, error: errField, loggedOut: false };
    }
    return { ok: true, status: res.status, data: parsed, error: null, loggedOut: false };
  } catch {
    clearTimeout(timeout);
    return { ok: false, status: 0, data: null, error: 'Cannot reach the server', loggedOut: false };
  }
}
