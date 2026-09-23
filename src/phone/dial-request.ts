export const PHONE_DIAL_EVENT = 'wolf:phone:dial';

export type PhoneDialResult = { status: 'requested' | 'failed' | 'cancelled'; error?: string };
export interface PhoneDialRequest {
  phone: string;
  requestId: string;
  expiresAt: number;
  signal: AbortSignal;
  respond: (result: PhoneDialResult) => void;
}

// A local phone acknowledgement means a dial was requested, never that the
// destination rang or answered. Expired/cancelled requests cannot dial later.
export function requestPhoneDial(
  phone: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
  target: EventTarget = window,
): Promise<PhoneDialResult> {
  return new Promise(resolve => {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 20000;
    let settled = false;
    const finish = (result: PhoneDialResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      if (result.status !== 'requested') controller.abort(result.error);
      resolve(result);
    };
    const cancel = () => finish({ status: 'cancelled', error: 'Call request cancelled.' });
    const timer = setTimeout(() => finish({ status: 'failed', error: 'No confirmation from the phone. Check its call status before trying again.' }), timeoutMs);
    if (options.signal?.aborted) { cancel(); return; }
    options.signal?.addEventListener('abort', cancel, { once: true });
    const event = new CustomEvent<PhoneDialRequest>(PHONE_DIAL_EVENT, {
      cancelable: true,
      detail: { phone, requestId: crypto.randomUUID(), expiresAt: Date.now() + timeoutMs, signal: controller.signal, respond: finish },
    });
    target.dispatchEvent(event);
    if (!event.defaultPrevented) finish({ status: 'failed', error: 'The on-screen phone is unavailable. Open it on your desktop and wait for Ready.' });
  });
}
