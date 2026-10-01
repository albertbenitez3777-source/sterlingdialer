import { describe, expect, it } from 'vitest';
import { callDateDetails } from '../src/modules/records/call-date';

describe('call dates in the owner business timezone', () => {
  const now = new Date('2026-10-01T16:28:00Z');
  it('distinguishes a September recording from today even when viewed today', () => {
    const result = callDateDetails('2026-09-01T19:13:00Z', now);
    expect(result.isToday).toBe(false);
    expect(result.label).toContain('Earlier call');
    expect(result.label).toContain('Sep 1, 2026');
    expect(result.label).toContain('1:13 PM CR');
  });
  it('uses Costa Rica midnight rather than UTC or the viewer timezone', () => {
    expect(callDateDetails('2026-10-01T05:59:59Z', now).isToday).toBe(false);
    expect(callDateDetails('2026-10-01T06:00:00Z', now).isToday).toBe(true);
  });
  it('does not label invalid or future timestamps as today', () => {
    expect(callDateDetails('invalid', now).isToday).toBe(false);
    expect(callDateDetails('2026-10-02T18:00:00Z', now).period).toBe('Future timestamp');
  });
});
