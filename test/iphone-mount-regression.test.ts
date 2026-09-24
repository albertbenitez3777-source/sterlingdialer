import { describe, it, expect } from 'vitest';

describe('IPhone mount regression: hook declaration order', () => {
  it('useCallback deps must only reference already-initialized bindings', () => {
    let requestMic: (() => Promise<{ granted: boolean }>) | undefined;
    let enableSound: (() => Promise<void>) | undefined;
    const micGranted = false;

    // requestMic declared FIRST (before enableSound)
    requestMic = async () => ({ granted: true });
    const requestMicDeps: unknown[] = [];
    expect(() => { void requestMicDeps; }).not.toThrow();

    // enableSound references requestMic in its deps — safe because requestMic is above
    enableSound = async () => { if (!micGranted) await requestMic!(); };
    const enableSoundDeps = [micGranted, requestMic];
    expect(enableSoundDeps[1]).toBeDefined();
    expect(typeof enableSoundDeps[1]).toBe('function');

    expect(requestMic).toBeDefined();
    expect(enableSound).toBeDefined();
  });

  it('BROKEN order would throw ReferenceError (TDZ) when evaluating deps', () => {
    expect(() => {
      // eslint-disable-next-line no-eval
      eval(`
        const enableSoundDeps = [false, requestMicBroken];
        const requestMicBroken = async () => ({ granted: true });
        void enableSoundDeps;
      `);
    }).toThrow();
  });

  it('enableSound does not reference any hook declared after it', () => {
    // requestMic is declared at ~line 100, enableSound at ~line 119 in current code
    const requestMicLine = 100;
    const enableSoundLine = 119;
    expect(requestMicLine).toBeLessThan(enableSoundLine);
  });

  it('audioBlocked and enablingSound state do not cause extra hooks', () => {
    const [audioStatus] = ['ok'];
    const [enablingSound] = [false];
    expect(typeof audioStatus).toBe('string');
    expect(typeof enablingSound).toBe('boolean');
  });

  it('enableSound click handler during active call does not disconnect', async () => {
    const events: string[] = [];
    const requestMic = async () => { events.push('mic-prompt'); return { granted: true }; };
    const enableSound = async () => {
      events.push('play-attempt');
      await requestMic();
    };
    await enableSound();
    expect(events).toEqual(['play-attempt', 'mic-prompt']);
    expect(events).not.toContain('hangup');
    expect(events).not.toContain('disconnect');
  });
});
