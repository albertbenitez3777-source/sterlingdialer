import React from 'react';
import { act } from 'react-test-renderer';

// Minimal renderHook for testing React hooks without @testing-library/react.
export function renderHook<T, P>(
  hook: (props: P) => T,
  options: { initialProps: P },
): {
  rerender: (props: P) => void;
  unmount: () => void;
  result: { current: T };
} {
  let current: T;
  const Comp = (props: P) => {
    current = hook(props);
    return null;
  };

  let container: ReturnType<typeof React.createElement> | null = null;
  const rerender = (props: P) => {
    act(() => {
      container = React.createElement(Comp, props);
      // Force re-render by creating a new element with new key
      void container;
    });
  };

  // Use react-test-renderer
  const TestRenderer = require('react-test-renderer');
  let root: ReturnType<typeof TestRenderer.create>;
  act(() => {
    root = TestRenderer.create(React.createElement(Comp, options.initialProps));
  });

  return {
    rerender: (props: P) => {
      act(() => { root.update(React.createElement(Comp, props)); });
    },
    unmount: () => {
      act(() => { root.unmount(); });
    },
    result: { get current() { return current!; } },
  };
}
