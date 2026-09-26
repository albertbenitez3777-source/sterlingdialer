import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { DialerControls } from '../src/components/DialerControls';

const agent = { id: 'test-agent', full_name: 'Test Agent', role: 'agent', status: 'active', active_for_dialer: true, dialer_concurrency: 3, transfer_certified: true, inbound_configured: true };
it('blocks starts and settings from stale data, while keeping Stop available', () => {
  const props = { agents: [agent], lines: 6, running: false, saving: false, changingAgent: null, starting: false, stopping: false, notice: null, onLines: vi.fn(), onAgent: vi.fn(), onStart: vi.fn(), onStop: vi.fn() };
  let root: ReturnType<typeof create>;
  act(() => { root = create(<DialerControls {...props} stale />); });
  expect(root!.root.findAllByType('button').every(button => button.props.disabled)).toBe(true);
  expect(root!.root.findByType('select').props.disabled).toBe(true);
  act(() => root.update(<DialerControls {...props} stale running />));
  const stop = root!.root.findByProps({ className: 'f1-control-stop' });
  expect(stop.props.disabled).toBe(false);
  act(() => stop.props.onClick());
  expect(props.onStop).toHaveBeenCalledTimes(1);
  expect(props.onStart).not.toHaveBeenCalled();
  act(() => root.update(<DialerControls {...props} stale={false} />));
  expect(root!.root.findByProps({ className: 'f1-control-start' }).props.disabled).toBe(false);
  act(() => root.unmount());
});
