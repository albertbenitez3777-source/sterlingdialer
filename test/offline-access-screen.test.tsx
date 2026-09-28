import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
vi.mock('@/components', () => ({ PinInput: () => <input aria-label="PIN" /> }));
vi.mock('@/components/MatrixField', () => ({ MatrixField: () => null }));
import { LoginScreen } from '../src/modules/login/LoginScreen';
import { OFFLINE_ACCESS_MESSAGE } from '../src/modules/login/OfflineAccessScreen';

function render(loginError: string, session: any = null) {
  let root!: ReturnType<typeof create>;
  act(() => { root = create(<LoginScreen model={{ loginError, session, ownerNeedsSetup: false } as any} />); });
  return root;
}
it('shows the offline illustration and exact message only for a retired PIN', () => {
  const root = render(OFFLINE_ACCESS_MESSAGE);
  expect(root.root.findByType('h1').children).toEqual([OFFLINE_ACCESS_MESSAGE]);
  expect(root.root.findByProps({ role: 'img' }).props['aria-label']).toBe('System offline');
  expect(root.root.findAllByType('input')).toHaveLength(0);
  act(() => root.unmount());
});
it('keeps the normal login form for an ordinary invalid PIN', () => {
  const root = render('Invalid PIN. Please try again.');
  expect(root.root.findAllByType('input')).toHaveLength(1);
  expect(root.root.findAllByType('h1')).toHaveLength(0);
  act(() => root.unmount());
});
it('never substitutes an offline screen for an existing valid session', () => {
  const root = render(OFFLINE_ACCESS_MESSAGE, { valid: true });
  expect(root.toJSON()).toBeNull();
  act(() => root.unmount());
});
