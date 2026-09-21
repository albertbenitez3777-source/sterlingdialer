import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CHANNEL = 'wolf-zadarma-v1';
const SIP = '566918-100';
const ORIGIN = 'https://wolf-of-wall-street-ssy3.bolt.host';

async function engine() {
  const events: any[] = [];
  const listeners: Record<string, (event: any) => void> = {};
  const socketListeners: Record<string, (...args: any[]) => void> = {};
  const socket = {
    on: vi.fn((name, callback) => { socketListeners[name] = callback; return socket; }),
    close: vi.fn(() => socketListeners.disconnect?.()),
  };
  let options: any;
  const parent = { postMessage: vi.fn(message => events.push(message)) };
  const api = {
    init: vi.fn(value => { options = value; }),
    reg: vi.fn(() => host.io('https://ws.zadarma.com', {})),
    unreg: vi.fn(), unreg_old: vi.fn(), unreg_flag: false,
    call: vi.fn(), answer: vi.fn(), finishCall: vi.fn(),
    zadarmaCallbackCall: vi.fn(), zadarmaCallbackAnswer: vi.fn(), zadarmaCallbackCancel: vi.fn(),
    webCallSession: null as any,
  };
  const cancelLookup = api.zadarmaCallbackCancel;
  const host = {
    parent, location: { origin: ORIGIN },
    addEventListener: vi.fn((name, callback) => { listeners[name] = callback; }),
    io: vi.fn(() => socket),
    ZadarmaWebphoneAPI: function () { return api; },
  };
  vi.stubGlobal('window', host);
  vi.stubGlobal('document', {
    createElement: vi.fn(() => ({ setAttribute: vi.fn() })),
    getElementById: vi.fn(() => ({ appendChild: vi.fn() })),
    head: { appendChild: vi.fn(script => queueMicrotask(() => script.onload())) },
    querySelectorAll: vi.fn(() => []),
  });
  await import('../src/phone/engine');
  listeners.message({ source: parent, origin: ORIGIN, data: { channel: CHANNEL, command: 'connect', key: 'test-key', sip: SIP } });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(options).toBeDefined();
  const authorize = () => options.getSipsCallback({ all: [{ name: SIP }] }, undefined);
  const states = () => events.filter(event => event.type === 'connection').map(event => event.state);
  const command = (command: string, extra = {}) => listeners.message({ source: parent, origin: ORIGIN, data: { channel: CHANNEL, command, ...extra } });
  return { options, api, authorize, socket, socketListeners, states, events, command, cancelLookup };
}

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Zadarma website authorization and recovery', () => {
  it('uses website integration and waits for authorization plus push confirmation', async () => {
    const f = await engine();
    expect(f.options.type).toBe('site');
    expect(f.api.reg).not.toHaveBeenCalled();
    f.authorize();
    expect(f.api.reg).toHaveBeenCalledWith(SIP);
    expect(f.states()).toEqual(['connecting']);
    f.socketListeners.init();
    expect(f.states()).toEqual(['connecting', 'ready']);
  });
  it('reports the actual authorization code and never registers a rejected extension', async () => {
    const f = await engine();
    f.options.getSipsCallback({ disabled: true }, 'integrationDisabled');
    expect(f.api.reg).not.toHaveBeenCalled();
    expect(f.states().at(-1)).toBe('failed');
    expect(f.events.find(event => event.type === 'error').message).toContain('integrationDisabled');
    f.authorize();
    await vi.advanceTimersByTimeAsync(25000);
    expect(f.api.reg).not.toHaveBeenCalled();
    expect(f.states()).toEqual(['connecting', 'failed']);
  });
  it('does not use another extension returned in the account list', async () => {
    const f = await engine();
    f.options.getSipsCallback({ all: [{ name: '566918-101' }] }, undefined);
    expect(f.api.reg).not.toHaveBeenCalled();
    expect(f.states().at(-1)).toBe('failed');
  });
  it('keeps a push rejection failed despite disconnect and late init events', async () => {
    const f = await engine(); f.authorize();
    f.socketListeners.update({ errorCode: 'integrationDisabled' });
    f.socketListeners.disconnect(); f.socketListeners.init();
    await vi.advanceTimersByTimeAsync(25000);
    expect(f.api.unreg_flag).toBe(true);
    expect(f.socket.close).toHaveBeenCalled();
    expect(f.states()).toEqual(['connecting', 'failed']);
  });
  it('allows a temporary disconnect to recover before its deadline', async () => {
    const f = await engine(); f.authorize(); f.socketListeners.init();
    f.socketListeners.disconnect(); f.socketListeners.init();
    await vi.advanceTimersByTimeAsync(25000);
    expect(f.states()).toEqual(['connecting', 'ready', 'connecting', 'ready']);
  });
  it('times out an unconfirmed connection and ignores a late handshake', async () => {
    const f = await engine(); f.authorize();
    await vi.advanceTimersByTimeAsync(21000);
    f.socketListeners.init();
    expect(f.states()).toEqual(['connecting', 'failed']);
  });
  it('disconnects and permits recovery when declining never receives a completion event', async () => {
    const f = await engine(); f.authorize(); f.socketListeners.init();
    f.options.getStatusMessage('incoming', { caller: '18669991670' });
    f.command('hangup');
    expect(f.events.filter(e => e.type === 'call-state').at(-1).state).toBe('ending');
    await vi.advanceTimersByTimeAsync(15001);
    expect(f.api.unreg_old).toHaveBeenCalled();
    expect(f.states().at(-1)).toBe('failed');
    expect(f.events.filter(e => e.type === 'call-state').at(-1).state).toBe('idle');
    expect(f.events.some(e => e.type === 'error' && /ending could not be confirmed/.test(e.message))).toBe(true);
  });
  it('clears the recovery timer when a declined call ends normally', async () => {
    const f = await engine(); f.authorize(); f.socketListeners.init();
    f.options.getStatusMessage('incoming', { caller: '18669991670' }); f.command('hangup');
    f.options.getStatusMessage('canceled');
    await vi.advanceTimersByTimeAsync(16000);
    expect(f.states().at(-1)).toBe('ready');
    expect(f.api.unreg_old).not.toHaveBeenCalled();
  });
  it('binds each SDK session only once and ignores late events from a replaced session', async () => {
    const f = await engine(); f.authorize(); f.socketListeners.init();
    f.command('dial', {number:'18669991670'});
    const handlers: Record<string, () => void> = {};
    const first = { on: vi.fn((name, fn) => { handlers[name] = fn; }), isOnHold: () => ({local:false}) };
    f.api.webCallSession = first; f.api.webCallSession = first;
    expect(first.on.mock.calls.filter(([name]) => name === 'confirmed')).toHaveLength(1);
    f.api.webCallSession = {on: vi.fn()};
    handlers.confirmed(); handlers.ended();
    expect(f.events.filter(e => e.type === 'call-state').at(-1).state).toBe('dialing');
  });
  it('does not start a late cancel lookup after the phone has disconnected', async () => {
    const f = await engine(); f.authorize(); f.socketListeners.init();
    f.options.getStatusMessage('incoming', { caller: '18669991670' }); f.command('hangup');
    await vi.advanceTimersByTimeAsync(15001);
    f.api.zadarmaCallbackCancel({domain:'late.example'});
    expect(f.cancelLookup).not.toHaveBeenCalled();
    expect(f.states().at(-1)).toBe('failed');
    expect(f.events.filter(e => e.type === 'call-state').at(-1).state).toBe('idle');
  });
});
