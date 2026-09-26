import React, { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  model: {} as Record<string, any>,
  crashWorkspace: false,
  crashChat: false,
  mounted: { phone: 0, chat: 0, camera: 0 },
  unmounted: { phone: 0, chat: 0, camera: 0 },
}));
function Communication({ kind }: { kind: 'phone' | 'chat' | 'camera' }) {
  useEffect(() => {
    state.mounted[kind]++;
    return () => { state.unmounted[kind]++; };
  }, []);
  return <span>{kind}</span>;
}
vi.mock('@/app/useApplicationModel', () => ({ useApplicationModel: () => state.model }));
vi.mock('@/components/MatrixField', () => ({ MatrixField: () => null }));
vi.mock('@/modules/login/LoginScreen', () => ({ LoginScreen: () => <span>Sign in</span> }));
vi.mock('@/modules/navigation/MainNavigation', () => ({ MainNavigation: () => <span>Navigation</span> }));
vi.mock('@/modules/navigation/StatusBar', () => ({ StatusBar: () => null }));
vi.mock('@/app/SharedWorkspace', () => ({ SharedWorkspace: () => null }));
vi.mock('@/app/WorkspaceDialogs', () => ({ WorkspaceDialogs: () => null }));
vi.mock('@/modules/owner/OwnerDashboard', () => ({ OwnerDashboard: () => <span>Owner</span> }));
vi.mock('@/modules/agent/AgentWorkspace', () => ({ AgentWorkspace: () => {
  if (state.crashWorkspace) throw new Error('test workspace failure');
  return <span>{state.model.activeNav}</span>;
} }));
vi.mock('@/components/IPhone', () => ({ IPhone: () => <Communication kind="phone" /> }));
vi.mock('@/components/WhatsUp', () => ({ WhatsUp: () => {
  if (state.crashChat) throw new Error('test chat failure');
  return <Communication kind="chat" />;
} }));
vi.mock('@/components/CameraWidget', () => ({ default: () => <Communication kind="camera" /> }));

vi.mock('@/modules/monitoring/api', () => ({canMonitor: () => true, useMonitoringAttendance: () => {}}));
vi.mock('@/modules/monitoring/AgentMonitoring', () => ({AgentMonitoring: () => <span>Monitoring</span>}));
import App from '../src/App';

beforeEach(() => {
  state.model = { session: { valid: true, agent: { id: 'test-agent', full_name: 'Test Agent' } }, sessionToken: 'test-only', isOwner: false, isStrictOwner: false, ownerNeedsSetup: false, activeNav: 'dashboard', atomicLogout: vi.fn() };
  state.crashWorkspace = state.crashChat = false;
  state.mounted = { phone: 0, chat: 0, camera: 0 };
  state.unmounted = { phone: 0, chat: 0, camera: 0 };
});

describe('persistent communication modules', () => {
  it('keeps one phone, chat and camera mounted across page changes and token renewal', () => {
    let root: ReturnType<typeof create>;
    act(() => { root = create(<App />); });
    for (const activeNav of ['contacts', 'calls', 'saved', 'monitoring', 'inbox', 'dashboard']) {
      state.model = { ...state.model, activeNav, sessionToken: 'renewed-test-only' };
      act(() => root.update(<App />));
    }
    expect(state.mounted).toEqual({ phone: 1, chat: 1, camera: 1 });
    expect(state.unmounted).toEqual({ phone: 0, chat: 0, camera: 0 });
    act(() => root.unmount());
  });

  it('contains a workspace rendering failure without unmounting communications', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof create>;
    act(() => { root = create(<App />); });
    state.crashWorkspace = true;
    act(() => root.update(<App />));
    expect(root!.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
    expect(state.mounted.phone).toBe(1);
    expect(state.unmounted).toEqual({ phone: 0, chat: 0, camera: 0 });
    state.crashWorkspace = false;
    act(() => root.root.findByProps({ className: 'secondary-button' }).props.onClick());
    expect(root!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    act(() => root.unmount());
    consoleError.mockRestore();
  });

  it('contains a chat failure without restarting phone or camera', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof create>;
    act(() => { root = create(<App />); });
    state.crashChat = true;
    act(() => root.update(<App />));
    expect(state.unmounted.phone).toBe(0);
    expect(state.unmounted.camera).toBe(0);
    act(() => root.unmount());
    consoleError.mockRestore();
  });

  it('unmounts all communication modules at logout', () => {
    let root: ReturnType<typeof create>;
    act(() => { root = create(<App />); });
    state.model = { ...state.model, session: null, sessionToken: '' };
    act(() => root.update(<App />));
    expect(state.unmounted).toEqual({ phone: 1, chat: 1, camera: 1 });
    expect(root!.toJSON()).toEqual({ type: 'span', props: {}, children: ['Sign in'] });
    act(() => root.unmount());
  });

  it('does not mount an agent phone for the owner', () => {
    state.model = { ...state.model, isOwner: true, isStrictOwner: true };
    let root: ReturnType<typeof create>;
    act(() => { root = create(<App />); });
    expect(state.mounted).toEqual({ phone: 0, chat: 1, camera: 1 });
    act(() => root.unmount());
  });
});
