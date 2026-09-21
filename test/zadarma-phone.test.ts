import { describe, expect, it, vi } from 'vitest';
import { CallController, normalizeDialNumber, type PhoneEvent, type PhoneSession } from '../src/phone/call-controller';

function fixture() {
  const events: PhoneEvent[] = [];
  let held = false;
  const session: PhoneSession = {
    mute: vi.fn(), unmute: vi.fn(), terminate: vi.fn(), on: vi.fn(), sendDTMF: vi.fn(),
    isEstablished: () => true, isOnHold: () => ({ local: held, remote: false }),
    hold: vi.fn((_options, done) => { held = true; done?.(); return true; }),
    unhold: vi.fn((_options, done) => { held = false; done?.(); return true; }),
  };
  const api = { call: vi.fn(), answer: vi.fn(), finishCall: vi.fn(), webCallSession: session };
  const controller = new CallController(api, event => events.push(event));
  return { controller, api, session, events };
}

describe('real phone controls', () => {
  it('blocks calls before connection and blocks double-click duplicate calls', () => {
    const { controller, api } = fixture();
    expect(() => controller.dial('2025550100')).toThrow(/Enable/);
    controller.ready = true; controller.dial('(202) 555-0100');
    expect(api.call).toHaveBeenCalledWith('12025550100');
    expect(() => controller.dial('2025550100')).toThrow(/Finish/);
    expect(api.call).toHaveBeenCalledTimes(1);
    expect(controller.state).toBe('dialing');
  });
  it('rings from an incoming event and waits for SIP confirmation after Answer', () => {
    const { controller, api } = fixture();
    controller.incoming('12025550100', 'Test Caller');
    expect(controller.state).toBe('ringing-in');
    controller.answer(); controller.answer();
    expect(api.answer).toHaveBeenCalledTimes(1);
    expect(controller.state).toBe('answering');
    controller.confirmed(); expect(controller.state).toBe('active');
  });
  it('hangup reaches the provider and does not report completion before its event', () => {
    const { controller, api } = fixture();
    controller.incoming('12025550100'); controller.answer(); controller.confirmed();
    controller.hangup();
    expect(api.finishCall).toHaveBeenCalledTimes(1);
    expect(controller.state).toBe('ending');
    controller.ended(); expect(controller.state).toBe('idle');
  });
  it('controls the microphone and negotiates hold on the live session', () => {
    const { controller, session, events } = fixture();
    controller.confirmed(); controller.mute(); controller.mute();
    expect(session.mute).toHaveBeenCalledWith({ audio: true });
    expect(session.unmute).toHaveBeenCalledWith({ audio: true });
    controller.hold(); controller.hold();
    expect(session.hold).toHaveBeenCalledTimes(1); expect(session.unhold).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: 'controls', held: true });
    expect(events).toContainEqual({ type: 'controls', held: false });
  });
  it('sends numeric, star and pound keypad tones instead of just logging them', () => {
    const { controller, session } = fixture(); controller.confirmed();
    for (const tone of '0123456789*#') controller.dtmf(tone);
    expect(session.sendDTMF).toHaveBeenCalledTimes(12);
    expect(session.sendDTMF).toHaveBeenCalledWith('*'); expect(session.sendDTMF).toHaveBeenCalledWith('#');
  });
  it('rejects controls when no call is connected', () => {
    const { controller, session } = fixture();
    expect(() => controller.mute()).toThrow(/connected/);
    expect(() => controller.hold()).toThrow(/connected/);
    expect(() => controller.dtmf('1')).toThrow(/connected/);
    expect(session.mute).not.toHaveBeenCalled();
  });
  it('recovers from a rejected call without triggering another call', () => {
    const { controller, api } = fixture(); controller.ready = true;
    api.call.mockImplementation(() => { throw new Error('Rejected'); });
    expect(() => controller.dial('2025550100')).toThrow('Rejected');
    expect(controller.state).toBe('idle'); expect(api.call).toHaveBeenCalledTimes(1);
  });
});

describe('dialing destinations', () => {
  it.each([['(202) 555-0100', '12025550100'], ['+1 202 555 0100', '12025550100'], ['+506 2222 2222', '50622222222'], ['100', '100']])('%s becomes %s', (input, output) => expect(normalizeDialNumber(input)).toBe(output));
  it.each(['', 'abc2025550100', '12', '1234', '2025550100;call', '*123#'])('rejects %s', value => expect(() => normalizeDialNumber(value)).toThrow());
});
