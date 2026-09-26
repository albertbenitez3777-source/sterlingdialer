// The authentication service allows 20 seconds upstream. Give it time to return
// a definite answer; a feature request's shorter timeout is not session expiry.
export const AUTH_TIMEOUT_MS = 25000;

type Verification = 'valid' | 'invalid' | 'unavailable';
const pending = new Map<string, Promise<Verification>>();

// Share only an in-flight read. Never cache authorization, retry a mutation, or
// let one cancelled report abort verification needed by another report.
export function verifySessionOnce(url: string, token: string): Promise<Verification> {
  const key = JSON.stringify([url, token]);
  const existing = pending.get(key);
  if (existing) return existing;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  const request = (async (): Promise<Verification> => {
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', session_token: token }),
        signal: controller.signal,
      });
      if (!response.ok || controller.signal.aborted) return 'unavailable';
      const session = await response.json();
      if (controller.signal.aborted) return 'unavailable';
      return session?.valid === false ? 'invalid' : session?.valid === true ? 'valid' : 'unavailable';
    } catch { return 'unavailable'; }
    finally { clearTimeout(timer); }
  })();
  pending.set(key, request);
  void request.finally(() => { if (pending.get(key) === request) pending.delete(key); });
  return request;
}
