import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/utils/auth-fetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/phone/use-phone-presence', () => ({ usePhonePresence: () => null }));
vi.mock('@/phone/useVoicemailCount', () => ({ useVoicemailCount: () => 0 }));
vi.mock('@/components/PhoneActivity', () => ({ PhoneActivity: () => null, usePhoneActivityCount: () => 0 }));
vi.mock('@/components/PhoneVoicemail', () => ({ PhoneVoicemail: () => null }));
import { IPhone } from '../src/components/IPhone';

const origin = 'https://wolf-of-wall-street-ssy3.bolt.host';
const listeners = new Map<string, Set<(event: any) => void>>();
let root: ReturnType<typeof create>;
let frame: any;
function message(data: Record<string, unknown>) {
  for (const callback of listeners.get('message') || []) callback({ origin, source: frame.contentWindow, data: { channel: 'wolf-zadarma-v1', ...data } });
}
async function ready() {
  await act(async () => {
    root = create(<IPhone agentName="Test Agent" sessionToken="dummy-session" providerUrl="https://example.invalid" onUnauthorized={vi.fn()} />, { createNodeMock: el => el.type === 'iframe' ? frame : null });
  });
  await act(async () => { message({ type: 'connection', state: 'ready' }); });
}
async function dial() {
  await act(async () => root.root.findByProps({ 'aria-label': 'Number to call' }).props.onChange({ target: { value: '+1 (202) 555-0100' } }));
  await act(async () => root.root.findByProps({ 'aria-label': 'Call number' }).props.onClick());
}
const outboundRequests = () => mocks.authFetch.mock.calls.filter(([, options]) => options.body.action === 'zadarma_callback');

beforeEach(() => {
  vi.useFakeTimers(); listeners.clear(); mocks.authFetch.mockReset();
  mocks.authFetch.mockImplementation(async (_url, options) => ({ ok: true, data: options.body.action === 'get_federal_one_v2' ? { route: { zadarma_sip_login: '566918-102', talkroute_number: '+12025550102' } } : options.body.action === 'zadarma_caller_context' ? { caller: null } : { ok: true } }));
  frame = { contentWindow: { postMessage: vi.fn(), wolfPhone: { unlockAudio: vi.fn() } } };
  const host: any = { location: { origin, hostname: 'wolf-of-wall-street-ssy3.bolt.host' }, isSecureContext: true,
    addEventListener: (name: string, fn: any) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    removeEventListener: (name: string, fn: any) => listeners.get(name)?.delete(fn),
  };
  host.self = host; host.top = host;
  vi.stubGlobal('window', host);
  vi.stubGlobal('navigator', { userAgent: 'Desktop', platform: 'MacIntel', maxTouchPoints: 0, mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } });
});
afterEach(() => { if (root) act(() => root.unmount()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('actual outbound phone component', () => {
  it('sends one normalized callback and keeps an answered call alive beyond every UI cleanup deadline', async () => {
    await ready(); await dial();
    expect(outboundRequests()).toHaveLength(1);
    expect(outboundRequests()[0][1].body.to).toBe('12025550100');
    await act(async () => { message({ type: 'call-state', state: 'ringing-in' }); message({ type: 'incoming', number: '102' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(frame.contentWindow.postMessage.mock.calls.map(([d]: any[]) => d.command)).toEqual(['answer']);
    await act(async () => { message({ type: 'call-state', state: 'answering' }); message({ type: 'call-state', state: 'active' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    expect(root.root.findAllByProps({ 'aria-label': 'End call' })).toHaveLength(1);
    expect(frame.contentWindow.postMessage.mock.calls.map(([d]: any[]) => d.command)).toEqual(['answer']);
    expect(outboundRequests()).toHaveLength(1);
  });

  it('permits three consecutive provider-ended calls without duplicate requests or automatic hangup', async () => {
    await ready();
    for (let i = 0; i < 3; i++) {
      await dial();
      await act(async () => { message({ type: 'call-state', state: 'ringing-in' }); message({ type: 'incoming', number: '102' }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      await act(async () => { message({ type: 'call-state', state: 'active' }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
      await act(async () => { message({ type: 'call-state', state: 'idle' }); });
    }
    expect(outboundRequests()).toHaveLength(3);
    expect(frame.contentWindow.postMessage.mock.calls.map(([d]: any[]) => d.command)).toEqual(['answer', 'answer', 'answer']);
  });

  it('does not retry or send hangup when the callback API fails', async () => {
    await ready();
    mocks.authFetch.mockImplementation(async (_url, options) => options.body.action === 'zadarma_callback' ? { ok: false, error: 'Synthetic provider rejection' } : { ok: true, data: { caller: null } });
    await dial();
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    expect(outboundRequests()).toHaveLength(1);
    expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
    expect(root.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  });
});
