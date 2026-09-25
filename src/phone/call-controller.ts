// Call state follows provider events, never a script's load event.
export type PhoneState = 'idle' | 'dialing' | 'ringing-in' | 'answering' | 'active' | 'ending';
export interface PhoneSession {
  mute(options: { audio: boolean }): void;
  unmute(options: { audio: boolean }): void;
  hold(options?: object, done?: () => void): boolean;
  unhold(options?: object, done?: () => void): boolean;
  isOnHold(): { local: boolean; remote: boolean };
  isEstablished(): boolean;
  sendDTMF(tone: string): void;
  terminate(): void;
  answer?(options?: object): void;
  on(event: string, callback: (...args: any[]) => void): void;
  connection?: RTCPeerConnection;
}
export interface PhoneApi {
  call(number: string): unknown;
  answer(): unknown;
  finishCall(): unknown;
  webCallSession?: PhoneSession | null;
}
export type PhoneEvent = { type: string; [key: string]: unknown };

export function normalizeDialNumber(value: string): string {
  const input = value.trim();
  if (!/^[+\d\s().-]+$/.test(input)) throw new Error('Enter a phone number or a 3-digit extension.');
  const digits = input.replace(/\D/g, '');
  if (/^\d{3}$/.test(input)) return input;
  const normalized = !input.startsWith('+') && digits.length === 10 ? `1${digits}` : digits;
  if (!/^[1-9]\d{7,14}$/.test(normalized)) throw new Error('Enter the full phone number, including country code.');
  return normalized;
}

export class CallController {
  ready = false;
  state: PhoneState = 'idle';
  muted = false;
  private holdPending = false;
  constructor(public api: PhoneApi, private emit: (event: PhoneEvent) => void) {}
  setState(state: PhoneState) { this.state = state; this.emit({ type: 'call-state', state }); }
  dial(value: string) {
    if (!this.ready) throw new Error('Enable your phone and wait for Ready before dialing.');
    if (this.state !== 'idle') throw new Error('Finish the current call before starting another.');
    const number = normalizeDialNumber(value);
    this.setState('dialing');
    this.emit({ type: 'outgoing', number });
    try { this.api.call(number); } catch (error) { this.ended(); throw error; }
  }
  incoming(number: string, name = '') {
    if (this.state !== 'idle') return;
    this.setState('ringing-in');
    this.emit({ type: 'incoming', number, name });
  }
  answer() {
    if (this.state !== 'ringing-in') return;
    this.setState('answering');
    try { this.api.answer(); } catch (error) { this.setState('ringing-in'); throw error; }
  }
  confirmed() {
    if (this.state === 'dialing' || this.state === 'answering') this.setState('active');
  }
  ended() {
    this.muted = false; this.holdPending = false;
    this.setState('idle'); this.emit({ type: 'controls', muted: false, held: false });
  }
  hangup() {
    if (this.state === 'idle' || this.state === 'ending') return;
    const previous = this.state;
    this.setState('ending');
    try { this.api.finishCall(); }
    catch (error) { this.setState(previous); throw error; }
  }
  private session() {
    const session = this.api.webCallSession;
    if (this.state !== 'active' || !session?.isEstablished()) throw new Error('Wait until the call is connected.');
    return session;
  }
  mute() {
    const session = this.session();
    if (this.muted) session.unmute({ audio: true }); else session.mute({ audio: true });
    this.muted = !this.muted;
    this.emit({ type: 'controls', muted: this.muted });
  }
  hold() {
    const session = this.session();
    if (this.holdPending) return;
    this.holdPending = true;
    const done = () => {
      this.holdPending = false;
      this.emit({ type: 'controls', held: session.isOnHold().local });
    };
    try {
      const accepted = session.isOnHold().local ? session.unhold({}, done) : session.hold({}, done);
      if (!accepted) throw new Error('Hold could not be changed. Try again.');
    } catch (error) { this.holdPending = false; throw error; }
  }
  dtmf(tone: string) {
    if (!/^[0-9*#]$/.test(tone)) throw new Error('Invalid keypad tone.');
    this.session().sendDTMF(tone);
  }
}
