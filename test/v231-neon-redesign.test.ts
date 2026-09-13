// Federal One matrix visual regression tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf-8');
const APP = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf-8');

describe('Federal One matrix operations design', () => {
  it('renders the animated matrix environment on public and private screens', () => {
    expect(APP.includes('function MatrixField')).toBe(true);
    expect((APP.match(/<MatrixField/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(CSS.includes('@keyframes matrix-fall')).toBe(true);
    expect(CSS.includes('@keyframes matrix-scan-right')).toBe(true);
    expect(CSS.includes('@keyframes matrix-scan-left')).toBe(true);
  });

  it('keeps the public entrance centered and limited to PIN access', () => {
    expect(APP.includes('matrix-access-page')).toBe(true);
    expect(APP.includes('ACCESS NODE')).toBe(true);
    expect(APP.includes('<PinInput')).toBe(true);
  });

  it('uses strong, glowing binary streams rather than thin decorative text', () => {
    expect(CSS).toMatch(/\.matrix-columns span[\s\S]*font:900 13px/);
    expect(CSS).toContain('.matrix-columns::before,.matrix-columns::after');
    expect(CSS).toContain('text-shadow:0 0 5px currentColor');
  });

  it('keeps matrix motion visible behind the authenticated workspace', () => {
    expect(CSS).toContain('.f1-v2-shell > .matrix-field');
    expect(CSS).toContain('opacity:.42');
    expect(APP).toContain('f1-v2-shell');
  });

  it('preserves responsive and reduced-motion behavior', () => {
    expect(CSS).toContain('prefers-reduced-motion');
    expect(CSS).toContain('@media (max-width:760px)');
    expect(CSS).toContain('min-height: 44px');
  });

  it('preserves operational controls and client intelligence', () => {
    expect(APP).toContain('redial_preview');
    expect(APP).toContain('Find More Information');
    expect(APP).toContain('start_source_search');
    expect(APP).toContain('TalkrouteDeliveryTimeline');
  });
});
