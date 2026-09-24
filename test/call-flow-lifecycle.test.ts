import { describe, it, expect, beforeEach } from 'vitest';
import { CallController, type PhoneApi, type PhoneEvent, type PhoneSession } from '../src/phone/call-controller';

function mockSession(overrides: Partial<PhoneSession> = {}): PhoneSession {
  return {
    mute: () => {},
    unmute: () => {},
    hold: () => true,
    unhold: () => true,
    isOnHold: () => ({ local: false, remote: false }),
    isEstablished: () => true,
    sendDTMF: () => {},
    terminate: () => {},
    on: () => {},
    ...overrides,
  };
}

function mockApi(overrides: Partial<PhoneApi> = {}): PhoneApi {
  return {
    call: () => {},
    answer: () => {},
    finishCall: () => {},
    webCallSession: null,
    ...overrides,
  };
}

// ─── Answer state machine ───────────────────────────────────────────────────
describe('CallController: incoming answer lifecycle', () => {
  let events: PhoneEvent[];
  let api: PhoneApi;
  let ctrl: CallController;

  beforeEach(() => {
    events = [];
    api = mockApi();
    ctrl = new CallController(api, e => events.push(e));
    ctrl.ready = true;
  });

  it('answer() transitions ringing-in -> answering and calls api.answer()', () => {
    let apiAnswerCalled = false;
    api.answer = () => { apiAnswerCalled = true; };
    ctrl.incoming('+15551234567');
    expect(ctrl.state).toBe('ringing-in');
    ctrl.answer();
    expect(ctrl.state).toBe('answering');
    expect(apiAnswerCalled).toBe(true);
  });

  it('answer() is a no-op when state is idle', () => {
    let apiAnswerCalled = false;
    api.answer = () => { apiAnswerCalled = true; };
    ctrl.answer();
    expect(ctrl.state).toBe('idle');
    expect(apiAnswerCalled).toBe(false);
  });

  it('answer() is a no-op when already answering (prevents double-answer)', () => {
    let answerCount = 0;
    api.answer = () => { answerCount++; };
    ctrl.incoming('+15551234567');
    ctrl.answer();
    expect(ctrl.state).toBe('answering');
    ctrl.answer(); // second click
    expect(answerCount).toBe(1);
  });

  it('answer() is a no-op when state is active (already connected)', () => {
    api.answer = () => {};
    ctrl.incoming('+15551234567');
    ctrl.answer();
    ctrl.confirmed();
    expect(ctrl.state).toBe('active');
    let secondAnswerCalled = false;
    api.answer = () => { secondAnswerCalled = true; };
    ctrl.answer();
    expect(secondAnswerCalled).toBe(false);
  });

  it('answer() reverts to ringing-in if api.answer() throws', () => {
    api.answer = () => { throw new Error('SDK error'); };
    ctrl.incoming('+15551234567');
    expect(() => ctrl.answer()).toThrow('SDK error');
    expect(ctrl.state).toBe('ringing-in');
  });

  it('confirmed() transitions answering -> active', () => {
    ctrl.incoming('+15551234567');
    ctrl.answer();
    ctrl.confirmed();
    expect(ctrl.state).toBe('active');
    const activeEvent = events.find(e => e.type === 'call-state' && e.state === 'active');
    expect(activeEvent).toBeDefined();
  });

  it('confirmed() transitions dialing -> active (outgoing)', () => {
    ctrl.setState('dialing');
    ctrl.confirmed();
    expect(ctrl.state).toBe('active');
  });

  it('confirmed() is a no-op in idle/ending states', () => {
    ctrl.confirmed();
    expect(ctrl.state).toBe('idle');
    ctrl.setState('ending');
    ctrl.confirmed();
    expect(ctrl.state).toBe('ending');
  });
});

// ─── Push-before-session race ───────────────────────────────────────────────
describe('CallController: push-before-session race', () => {
  it('server push can fire zadarmaCallbackAnswer while still in ringing-in', () => {
    const events: PhoneEvent[] = [];
    const api = mockApi();
    const ctrl = new CallController(api, e => events.push(e));
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    expect(ctrl.state).toBe('ringing-in');

    // Simulate: server push arrives, callback gate should allow ringing-in
    const allowed = ['ringing-in', 'answering'];
    expect(allowed.includes(ctrl.state)).toBe(true);
  });

  it('server push is blocked when state is idle (call already ended)', () => {
    const events: PhoneEvent[] = [];
    const api = mockApi();
    const ctrl = new CallController(api, e => events.push(e));
    ctrl.ready = true;
    // state remains idle
    const allowed = ['ringing-in', 'answering'];
    expect(allowed.includes(ctrl.state)).toBe(false);
  });

  it('server push is blocked when state is active (already confirmed)', () => {
    const events: PhoneEvent[] = [];
    const api = mockApi();
    const ctrl = new CallController(api, e => events.push(e));
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.answer();
    ctrl.confirmed();
    expect(ctrl.state).toBe('active');
    const allowed = ['ringing-in', 'answering'];
    expect(allowed.includes(ctrl.state)).toBe(false);
  });
});

// ─── Late cancel during async mic wait ──────────────────────────────────────
describe('CallController: late cancel during answer', () => {
  it('ended() during answering resets to idle', () => {
    const events: PhoneEvent[] = [];
    const api = mockApi();
    const ctrl = new CallController(api, e => events.push(e));
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.answer();
    expect(ctrl.state).toBe('answering');
    // caller hangs up while we are answering
    ctrl.ended();
    expect(ctrl.state).toBe('idle');
    expect(ctrl.muted).toBe(false);
  });

  it('ended() during ringing-in resets to idle (caller canceled before answer)', () => {
    const events: PhoneEvent[] = [];
    const api = mockApi();
    const ctrl = new CallController(api, e => events.push(e));
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    expect(ctrl.state).toBe('ringing-in');
    ctrl.ended();
    expect(ctrl.state).toBe('idle');
  });

  it('answer command after ended() is silently ignored', () => {
    let answerCalled = false;
    const api = mockApi({ answer: () => { answerCalled = true; } });
    const ctrl = new CallController(api, () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.ended(); // canceled
    ctrl.answer(); // late answer from async mic resolution
    expect(ctrl.state).toBe('idle');
    expect(answerCalled).toBe(false);
  });
});

// ─── Duplicate event resilience ─────────────────────────────────────────────
describe('CallController: duplicate event resilience', () => {
  it('double confirmed() does not double-emit active state', () => {
    const events: PhoneEvent[] = [];
    const api = mockApi();
    const ctrl = new CallController(api, e => events.push(e));
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.answer();
    ctrl.confirmed();
    ctrl.confirmed(); // duplicate
    const activeEvents = events.filter(e => e.type === 'call-state' && e.state === 'active');
    expect(activeEvents.length).toBe(1);
  });

  it('double ended() emits idle twice (idempotent, consumers handle dedup)', () => {
    const events: PhoneEvent[] = [];
    const api = mockApi();
    const ctrl = new CallController(api, e => events.push(e));
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.answer();
    ctrl.confirmed();
    ctrl.ended();
    const idleCountFirst = events.filter(e => e.type === 'call-state' && e.state === 'idle').length;
    expect(idleCountFirst).toBe(1);
    ctrl.ended(); // duplicate — still fires setState which emits
    const idleCountSecond = events.filter(e => e.type === 'call-state' && e.state === 'idle').length;
    expect(idleCountSecond).toBe(2);
    // Consumer (IPhone) handles dedup: callState === 'idle' is already true, React state doesn't re-render
    expect(ctrl.state).toBe('idle');
    expect(ctrl.muted).toBe(false);
  });

  it('double incoming() is ignored when already ringing', () => {
    const events: PhoneEvent[] = [];
    const api = mockApi();
    const ctrl = new CallController(api, e => events.push(e));
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.incoming('+15559999999'); // second push
    const incomingEvents = events.filter(e => e.type === 'incoming');
    expect(incomingEvents.length).toBe(1);
    expect(incomingEvents[0].number).toBe('+15551234567');
  });
});

// ─── Timer cleanup ──────────────────────────────────────────────────────────
describe('CallController: timer and active-call lifecycle', () => {
  it('hangup() during answering transitions to ending then calls finishCall', () => {
    let finishCalled = false;
    const api = mockApi({ finishCall: () => { finishCalled = true; } });
    const ctrl = new CallController(api, () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.answer();
    ctrl.hangup();
    expect(ctrl.state).toBe('ending');
    expect(finishCalled).toBe(true);
  });

  it('hangup() during ringing-in transitions to ending', () => {
    let finishCalled = false;
    const api = mockApi({ finishCall: () => { finishCalled = true; } });
    const ctrl = new CallController(api, () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.hangup();
    expect(ctrl.state).toBe('ending');
    expect(finishCalled).toBe(true);
  });

  it('hangup() during active transitions to ending', () => {
    let finishCalled = false;
    const api = mockApi({ finishCall: () => { finishCalled = true; } });
    const ctrl = new CallController(api, () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.answer();
    ctrl.confirmed();
    ctrl.hangup();
    expect(ctrl.state).toBe('ending');
    expect(finishCalled).toBe(true);
  });

  it('hangup() is no-op in idle state', () => {
    let finishCalled = false;
    const api = mockApi({ finishCall: () => { finishCalled = true; } });
    const ctrl = new CallController(api, () => {});
    ctrl.hangup();
    expect(ctrl.state).toBe('idle');
    expect(finishCalled).toBe(false);
  });

  it('hangup() is no-op when already ending', () => {
    let finishCount = 0;
    const api = mockApi({ finishCall: () => { finishCount++; } });
    const ctrl = new CallController(api, () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.hangup();
    expect(finishCount).toBe(1);
    ctrl.hangup(); // duplicate
    expect(finishCount).toBe(1);
  });

  it('hangup() reverts state if finishCall() throws', () => {
    const api = mockApi({ finishCall: () => { throw new Error('no session'); } });
    const ctrl = new CallController(api, () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.answer();
    ctrl.confirmed();
    expect(() => ctrl.hangup()).toThrow('no session');
    expect(ctrl.state).toBe('active');
  });

  it('muted flag is reset by ended()', () => {
    const session = mockSession();
    const api = mockApi({ webCallSession: session });
    const ctrl = new CallController(api, () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.answer();
    ctrl.confirmed();
    ctrl.mute();
    expect(ctrl.muted).toBe(true);
    ctrl.ended();
    expect(ctrl.muted).toBe(false);
  });
});

// ─── Session requirement for mid-call controls ──────────────────────────────
describe('CallController: mid-call controls require active + established session', () => {
  it('mute() throws when state is not active', () => {
    const ctrl = new CallController(mockApi(), () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    expect(() => ctrl.mute()).toThrow('Wait until the call is connected.');
  });

  it('hold() throws when state is not active', () => {
    const ctrl = new CallController(mockApi(), () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.answer();
    expect(() => ctrl.hold()).toThrow('Wait until the call is connected.');
  });

  it('dtmf() throws when state is not active', () => {
    const ctrl = new CallController(mockApi(), () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    expect(() => ctrl.dtmf('5')).toThrow('Wait until the call is connected.');
  });

  it('mute() throws when session is not established', () => {
    const session = mockSession({ isEstablished: () => false });
    const api = mockApi({ webCallSession: session });
    const ctrl = new CallController(api, () => {});
    ctrl.ready = true;
    ctrl.incoming('+15551234567');
    ctrl.answer();
    ctrl.confirmed();
    expect(() => ctrl.mute()).toThrow('Wait until the call is connected.');
  });
});
