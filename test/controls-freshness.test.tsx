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

it('offers 25 total lines and saves the selected value without starting or stopping the run', () => {
  const props = { agents: [agent], lines: 12, running: true, saving: false, changingAgent: null, starting: false, stopping: false, notice: null, onLines: vi.fn(), onAgent: vi.fn(), onStart: vi.fn(), onStop: vi.fn() };
  let root: ReturnType<typeof create>;
  act(() => { root = create(<DialerControls {...props} />); });
  expect(root!.root.findAllByType('option').map(option => option.props.value)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  act(() => root!.root.findByType('select').props.onChange({ target: { value: '25' } }));
  expect(props.onLines).toHaveBeenLastCalledWith(25);
  act(() => root!.update(<DialerControls {...props} lines={25} />));
  const preset = root!.root.findAllByType('button').find(button => button.props['aria-pressed'] === true)!;
  act(() => preset.props.onClick());
  expect(props.onLines).toHaveBeenLastCalledWith(25);
  expect(props.onStart).not.toHaveBeenCalled();
  expect(props.onStop).not.toHaveBeenCalled();
  expect(props.onAgent).not.toHaveBeenCalled();
  act(() => root!.unmount());
});

it('allows the new admin range and rejects out-of-range or malformed settings', () => {
  for (const value of [1, 12, 13, 16, 20, 21, 25]) expect(isValidDialerLines(value)).toBe(true);
  for (const value of [0, 26, 1.5, '25', true, null, undefined, NaN]) expect(isValidDialerLines(value)).toBe(false);
});

for (const count of [1, 2, 3]) it(`${count} selected agents can use the full shared pool even with old small agent caps`, () => {
  const props = { agents: Array.from({ length: count }, (_, i) => ({ ...agent, id: `agent-${i}`, dialer_eligible: true, dialer_concurrency: 3 })), lines: 25, running: true, saving: false, changingAgent: null, starting: false, stopping: false, notice: null, onLines: vi.fn(), onAgent: vi.fn(), onStart: vi.fn(), onStop: vi.fn() };
  let root: ReturnType<typeof create>;
  act(() => { root = create(<DialerControls {...props} />); });
  const text = JSON.stringify(root!.toJSON());
  expect(text).toContain('One shared pool, even with one selected agent');
  expect(text).not.toContain('current capacity');
  act(() => root!.unmount());
});

it('does not report usable capacity without an eligible selected route', () => {
  const props = { agents: [{ ...agent, dialer_eligible: false }], lines: 25, running: true, saving: false, changingAgent: null, starting: false, stopping: false, notice: null, onLines: vi.fn(), onAgent: vi.fn(), onStart: vi.fn(), onStop: vi.fn() };
  let root: ReturnType<typeof create>;
  act(() => { root = create(<DialerControls {...props} />); });
  expect(JSON.stringify(root!.toJSON())).toContain('current capacity 0 lines');
  act(() => root!.unmount());
});
