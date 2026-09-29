import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { DialerControls } from '../src/components/DialerControls';
import { isValidDialerLines } from '../src/lib/dialerLimits';

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

it('offers 20 total lines and saves the selected value without starting or stopping the run', () => {
  const props = { agents: [agent], lines: 12, running: true, saving: false, changingAgent: null, starting: false, stopping: false, notice: null, onLines: vi.fn(), onAgent: vi.fn(), onStart: vi.fn(), onStop: vi.fn() };
  let root: ReturnType<typeof create>;
  act(() => { root = create(<DialerControls {...props} />); });
  expect(root!.root.findAllByType('option').map(option => option.props.value)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  act(() => root!.root.findByType('select').props.onChange({ target: { value: '20' } }));
  expect(props.onLines).toHaveBeenLastCalledWith(20);
  act(() => root!.update(<DialerControls {...props} lines={20} />));
  const preset = root!.root.findAllByType('button').find(button => button.props['aria-pressed'] === true)!;
  act(() => preset.props.onClick());
  expect(props.onLines).toHaveBeenLastCalledWith(20);
  expect(props.onStart).not.toHaveBeenCalled();
  expect(props.onStop).not.toHaveBeenCalled();
  expect(props.onAgent).not.toHaveBeenCalled();
  act(() => root!.unmount());
});

it('allows the new admin range and rejects out-of-range or malformed settings', () => {
  for (const value of [1, 12, 13, 16, 20]) expect(isValidDialerLines(value)).toBe(true);
  for (const value of [0, 21, 1.5, '20', true, null, undefined, NaN]) expect(isValidDialerLines(value)).toBe(false);
});
