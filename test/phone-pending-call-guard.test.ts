import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the pendingCallRef self-healing logic in IPhone.tsx.
 *
 * The component uses a pendingCallRef flag to block double-dialing during the
 * callback-dial flow. These tests verify that the flag never gets permanently
 * stuck, even when the engine's call-state:idle message is lost.
 *
 * Because IPhone.tsx is a large React component with an iframe engine, we test
 * the state-machine logic extracted into a minimal model that mirrors the
 * component's ref management and timer behavior.
 */

const CHANNEL = 'wolf-phone';

interface PendingCallState {
  stateRef: string;
  pendingCallRef: boolean;
  callbackDialRef: boolean;
  callbackTimer: ReturnType<typeof setTimeout> | undefined;
  autoAnswerTimer: ReturnType<typeof setTimeout> | undefined;
  pendingWatchdog: ReturnType<typeof setTimeout> | undefined;
  error: string;
}

function createState(): PendingCallState {
  return {
    stateRef: 'idle',
    pendingCallRef: false,
    callbackDialRef: false,
    callbackTimer: undefined,
    autoAnswerTimer: undefined,
    pendingWatchdog: undefined,
    error: '',
  };
}

function canDial(s: PendingCallState): boolean {
  return s.stateRef === 'idle' && !s.pendingCallRef;
}

function startCallbackDial(s: PendingCallState): void {
  s.pendingCallRef = true;
  s.callbackDialRef = true;
  clearTimeout(s.pendingWatchdog);
  s.pendingWatchdog = setTimeout(() => {
    if (s.pendingCallRef && s.stateRef === 'idle' && !s.callbackDialRef) {
      s.pendingCallRef = false;
      clearTimeout(s.autoAnswerTimer);
    }
  }, 30000);
  clearTimeout(s.callbackTimer);
  s.callbackTimer = setTimeout(() => {
    if (s.callbackDialRef) {
      s.callbackDialRef = false;
      s.pendingCallRef = false;
      clearTimeout(s.pendingWatchdog);
      s.error = 'Zadarma did not ring back in time.';
    }
  }, 20000);
}

function receiveCallState(s: PendingCallState, next: string): void {
  s.stateRef = next;
  if (next === 'idle') {
    s.pendingCallRef = false;
    s.callbackDialRef = false;
    clearTimeout(s.callbackTimer);
    clearTimeout(s.autoAnswerTimer);
    clearTimeout(s.pendingWatchdog);
  }
}

function receiveIncomingCallback(s: PendingCallState, answerFn: () => void): void {
  if (s.callbackDialRef) {
    s.callbackDialRef = false;
    clearTimeout(s.callbackTimer);
    clearTimeout(s.autoAnswerTimer);
    s.autoAnswerTimer = setTimeout(answerFn, 800);
  }
}

function receiveConnectionReady(s: PendingCallState): void {
  if (s.stateRef === 'idle' && s.pendingCallRef && !s.callbackDialRef) {
    s.pendingCallRef = false;
    clearTimeout(s.autoAnswerTimer);
    clearTimeout(s.pendingWatchdog);
  }
}

function callbackApiFailed(s: PendingCallState): void {
  s.callbackDialRef = false;
  clearTimeout(s.callbackTimer);
  s.pendingCallRef = false;
  clearTimeout(s.pendingWatchdog);
}

describe('phone pending-call guard', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows dialing from clean idle state', () => {
    const s = createState();
    expect(canDial(s)).toBe(true);
  });

  it('blocks dialing while callback is pending', () => {
    const s = createState();
    startCallbackDial(s);
    expect(canDial(s)).toBe(false);
  });

  it('unblocks after full call lifecycle (normal path)', () => {
    const s = createState();
    startCallbackDial(s);
    receiveCallState(s, 'ringing-in');
    receiveIncomingCallback(s, () => {});
    vi.advanceTimersByTime(800);
    receiveCallState(s, 'answering');
    receiveCallState(s, 'active');
    receiveCallState(s, 'idle');
    expect(canDial(s)).toBe(true);
    expect(s.pendingCallRef).toBe(false);
    expect(s.callbackDialRef).toBe(false);
  });

  it('allows 5 consecutive calls without getting stuck', () => {
    const s = createState();
    for (let i = 0; i < 5; i++) {
      expect(canDial(s)).toBe(true);
      startCallbackDial(s);
      expect(canDial(s)).toBe(false);
      receiveCallState(s, 'ringing-in');
      receiveIncomingCallback(s, () => {});
      vi.advanceTimersByTime(800);
      receiveCallState(s, 'answering');
      receiveCallState(s, 'active');
      receiveCallState(s, 'idle');
    }
    expect(canDial(s)).toBe(true);
  });

  it('self-heals via 30s watchdog when idle message is lost', () => {
    const s = createState();
    startCallbackDial(s);
    receiveCallState(s, 'ringing-in');
    receiveIncomingCallback(s, () => {});
    vi.advanceTimersByTime(800);
    receiveCallState(s, 'answering');
    receiveCallState(s, 'active');
    // Simulate lost idle message: stateRef stays 'active', no idle received.
    // But the remote end hangs up and somehow stateRef goes to idle via
    // a different path (e.g., error event sets stateRef directly):
    s.stateRef = 'idle';
    // callbackDialRef is already false (cleared on incoming ring)
    expect(s.callbackDialRef).toBe(false);
    // pendingCallRef is still true because idle handler never ran
    expect(s.pendingCallRef).toBe(true);
    expect(canDial(s)).toBe(false);
    // After 30s watchdog fires, it self-heals
    vi.advanceTimersByTime(30000);
    expect(s.pendingCallRef).toBe(false);
    expect(canDial(s)).toBe(true);
  });

  it('self-heals on connection:ready when idle message was lost', () => {
    const s = createState();
    startCallbackDial(s);
    receiveCallState(s, 'ringing-in');
    receiveIncomingCallback(s, () => {});
    vi.advanceTimersByTime(800);
    receiveCallState(s, 'answering');
    receiveCallState(s, 'active');
    // Lost idle: force stateRef to idle without the handler
    s.stateRef = 'idle';
    expect(s.pendingCallRef).toBe(true);
    // Connection reconnects (e.g., after iframe remount)
    receiveConnectionReady(s);
    expect(s.pendingCallRef).toBe(false);
    expect(canDial(s)).toBe(true);
  });

  it('does NOT self-heal on connection:ready while callback ring is still pending', () => {
    const s = createState();
    startCallbackDial(s);
    // callbackDialRef is still true (waiting for ring)
    expect(s.callbackDialRef).toBe(true);
    receiveConnectionReady(s);
    // Should NOT clear because we're still waiting for the Zadarma callback ring
    expect(s.pendingCallRef).toBe(true);
  });

  it('clears via 20s timeout when Zadarma never rings', () => {
    const s = createState();
    startCallbackDial(s);
    expect(canDial(s)).toBe(false);
    vi.advanceTimersByTime(20000);
    expect(s.pendingCallRef).toBe(false);
    expect(s.callbackDialRef).toBe(false);
    expect(canDial(s)).toBe(true);
  });

  it('clears when callback API fails', () => {
    const s = createState();
    startCallbackDial(s);
    expect(canDial(s)).toBe(false);
    callbackApiFailed(s);
    expect(canDial(s)).toBe(true);
    expect(s.pendingCallRef).toBe(false);
    expect(s.callbackDialRef).toBe(false);
  });

  it('does not clear watchdog prematurely when call is still active', () => {
    const s = createState();
    startCallbackDial(s);
    receiveCallState(s, 'ringing-in');
    receiveIncomingCallback(s, () => {});
    vi.advanceTimersByTime(800);
    receiveCallState(s, 'answering');
    receiveCallState(s, 'active');
    // stateRef is 'active', not 'idle', so watchdog should not clear pendingCallRef
    vi.advanceTimersByTime(30000);
    expect(s.pendingCallRef).toBe(true); // still true because stateRef !== 'idle'
    // Normal idle eventually arrives
    receiveCallState(s, 'idle');
    expect(s.pendingCallRef).toBe(false);
    expect(canDial(s)).toBe(true);
  });

  it('cancels stale auto-answer timer when call goes idle before 800ms', () => {
    const s = createState();
    startCallbackDial(s);
    receiveCallState(s, 'ringing-in');
    let answerCalled = false;
    receiveIncomingCallback(s, () => { answerCalled = true; });
    // Call canceled before 800ms
    receiveCallState(s, 'idle');
    expect(s.pendingCallRef).toBe(false);
    // Advance past the 800ms
    vi.advanceTimersByTime(800);
    // Auto-answer timer was cleared by the idle handler, so it should not fire
    expect(answerCalled).toBe(false);
  });

  it('recovers from two consecutive rapid calls where second has lost idle', () => {
    const s = createState();
    // Call 1: normal
    startCallbackDial(s);
    receiveCallState(s, 'ringing-in');
    receiveIncomingCallback(s, () => {});
    vi.advanceTimersByTime(800);
    receiveCallState(s, 'answering');
    receiveCallState(s, 'active');
    receiveCallState(s, 'idle');
    expect(canDial(s)).toBe(true);

    // Call 2: idle lost
    startCallbackDial(s);
    receiveCallState(s, 'ringing-in');
    receiveIncomingCallback(s, () => {});
    vi.advanceTimersByTime(800);
    receiveCallState(s, 'answering');
    receiveCallState(s, 'active');
    // Simulate lost idle
    s.stateRef = 'idle';
    expect(canDial(s)).toBe(false);

    // Watchdog self-heals
    vi.advanceTimersByTime(30000);
    expect(canDial(s)).toBe(true);
  });

  it('connection:ready does not heal when stateRef is non-idle', () => {
    const s = createState();
    startCallbackDial(s);
    receiveCallState(s, 'ringing-in');
    receiveIncomingCallback(s, () => {});
    vi.advanceTimersByTime(800);
    receiveCallState(s, 'active');
    // stateRef is 'active' - connection ready should NOT reset
    receiveConnectionReady(s);
    expect(s.pendingCallRef).toBe(true);
  });
});
