export const PHONE_PREFILL_EVENT = 'f1:phone:prefill';
export type PrefillResult = 'ready' | 'busy' | 'unavailable' | 'invalid';
export type PrefillRequest = { phone: string; respond: (result: PrefillResult) => void };
export function normalizeDialNumber(value: string) {
 const number = value.trim().replace(/[\s().-]/g, '');
 return /^\+?\d{7,15}$/.test(number) ? number : null;
}
export function prefillPhone(phone: string, target: EventTarget = window): PrefillResult {
 const normalized = normalizeDialNumber(phone);
 if (!normalized) return 'invalid';
 let result: PrefillResult = 'unavailable';
 target.dispatchEvent(new CustomEvent<PrefillRequest>(PHONE_PREFILL_EVENT, { detail: { phone: normalized, respond: value => { result = value; } } }));
 return result;
}
