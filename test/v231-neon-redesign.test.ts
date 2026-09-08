// v231 Neon Command Center Redesign — Visual Regression Tests
// Verifies: neon palette tokens, login brass preservation, no gold in authenticated,
// 44px touch targets, reduced-motion, responsive breakpoints, no purple/indigo.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(PROJECT_ROOT, 'src', 'index.css'), 'utf-8');
const APP = readFileSync(join(PROJECT_ROOT, 'src', 'App.tsx'), 'utf-8');

describe('v231 Neon Command Center Redesign', () => {
  // ── 1. Neon color tokens defined ──────────────────────────────────────────
  it('neon-cyan token defined', () => { expect(CSS.includes('--neon-cyan: #2ee8ff')).toBe(true); });
  it('neon-magenta token defined', () => { expect(CSS.includes('--neon-magenta: #f556a8')).toBe(true); });
  it('neon-violet token defined', () => { expect(CSS.includes('--neon-violet: #9d8cff')).toBe(true); });
  it('neon-lime token defined', () => { expect(CSS.includes('--neon-lime: #ccff66')).toBe(true); });
  it('neon-cyan-glow token defined', () => { expect(CSS.includes('--neon-cyan-glow')).toBe(true); });
  it('neon-magenta-glow token defined', () => { expect(CSS.includes('--neon-magenta-glow')).toBe(true); });
  it('neon-violet-glow token defined', () => { expect(CSS.includes('--neon-violet-glow')).toBe(true); });
  it('neon-lime-glow token defined', () => { expect(CSS.includes('--neon-lime-glow')).toBe(true); });

  // ── 2. Gold tokens rebound to neon cyan in :root ──────────────────────────
  it('gold-400 rebound to cyan', () => { expect(CSS.includes('--gold-400: #2ee8ff')).toBe(true); });
  it('gold-300 rebound to light cyan', () => { expect(CSS.includes('--gold-300: #67f0ff')).toBe(true); });
  it('gold-100 rebound to ice white', () => { expect(CSS.includes('--gold-100: #e6fdff')).toBe(true); });

  // ── 3. Steel tokens rebound to ultraviolet ────────────────────────────────
  it('steel-400 rebound to violet', () => { expect(CSS.includes('--steel-400: #9d8cff')).toBe(true); });
  it('steel-300 rebound to light violet', () => { expect(CSS.includes('--steel-300: #c4b3ff')).toBe(true); });

  // ── 4. Sage tokens rebound to acid lime ───────────────────────────────────
  it('sage-400 rebound to lime', () => { expect(CSS.includes('--sage-400: #e4ffa8')).toBe(true); });
  it('sage-500 rebound to lime', () => { expect(CSS.includes('--sage-500: #ccff66')).toBe(true); });

  // ── 5. Rust tokens rebound to vivid magenta ───────────────────────────────
  it('rust-400 rebound to magenta', () => { expect(CSS.includes('--rust-400: #ff82e2')).toBe(true); });
  it('rust-500 rebound to magenta', () => { expect(CSS.includes('--rust-500: #f556a8')).toBe(true); });

  // ── 6. Login page uses neon (no brass restoration) ─────────────────────────
  it('no brass gold-100 override', () => { expect(CSS.includes('--gold-100: #f7ecd0')).toBe(false); });
  it('no brass gold-400 override', () => { expect(CSS.includes('--gold-400: #d9aa57')).toBe(false); });
  it('no gold rgba in login scrim', () => {
    const scrimIdx = CSS.indexOf('.login-hero-scrim');
    const scrimBlock = scrimIdx >= 0 ? CSS.slice(scrimIdx, CSS.indexOf('}', scrimIdx) + 1) : '';
    expect(scrimBlock.includes('rgba(217')).toBe(false);
  });
  it('login inherits neon cyan gold-400', () => { expect(CSS.includes('--gold-400: #2ee8ff')).toBe(true); });
  it('login inherits neon brushed gradient', () => { expect(CSS.includes('--gold-brushed: linear-gradient(135deg, #2ee8ff')).toBe(true); });

  // ── 7. No hardcoded gold rgba anywhere in CSS ──────────────────────────────
  it('no gold rgba in login or token sections', () => {
    const rootBlock = CSS.slice(0, CSS.indexOf('.login-hero-fullbleed') || 500);
    expect(rootBlock.includes('rgba(217,170,87')).toBe(false);
  });
  it('no brass hex values in token overrides', () => { expect(CSS.includes('#f7ecd0') || CSS.includes('#c69340')).toBe(false); });

  // ── 8. Animated background uses neon ──────────────────────────────────────
  it('animated bg uses cyan', () => { expect(CSS.includes('rgba(46, 232, 255') && CSS.includes('.animated-bg-aurora-gold')).toBe(true); });
  it('animated bg uses violet', () => { expect(CSS.includes('rgba(157, 140, 255') && CSS.includes('.animated-bg-aurora-steel')).toBe(true); });

  // ── 9. 44px touch targets ─────────────────────────────────────────────────
  it('44px min-height exists', () => { expect(CSS.includes('min-height: 44px')).toBe(true); });

  // ── 10. Reduced motion support ────────────────────────────────────────────
  it('reduced-motion media query exists', () => { expect(CSS.includes('prefers-reduced-motion')).toBe(true); });

  // ── 11. Responsive breakpoints ────────────────────────────────────────────
  it('390px/380px mobile breakpoint', () => { expect(CSS.includes('@media (max-width: 390px)') || CSS.includes('@media (max-width: 380px)')).toBe(true); });
  it('760px tablet breakpoint', () => { expect(CSS.includes('@media (max-width: 760px)')).toBe(true); });
  it('600px breakpoint', () => { expect(CSS.includes('@media (max-width: 600px)')).toBe(true); });

  // ── 12. No purple/indigo ──────────────────────────────────────────────────
  it('no purple in CSS', () => { expect(CSS.includes('purple')).toBe(false); });
  it('no indigo in CSS', () => { expect(CSS.includes('indigo')).toBe(false); });

  // ── 13. Neon used for focus states ────────────────────────────────────────
  it('focus states use neon cyan (via --gold-400)', () => { expect(CSS.includes('focus') && CSS.includes('var(--gold-400)')).toBe(true); });

  // ── 14. Selection uses neon ───────────────────────────────────────────────
  it('selection uses cyan rgba', () => { expect(CSS.includes('::selection') && CSS.includes('rgba(46, 232, 255')).toBe(true); });

  // ── 15. Redial timeframe bar uses neon ────────────────────────────────────
  it('timeframe active uses neon', () => { expect(CSS.includes('.redial-timeframe-btn.active') && CSS.includes('var(--gold-200)')).toBe(true); });

  // ── 16. Sidebar brand uses neon cyan ──────────────────────────────────────
  it('sidebar brand uses neon-cyan', () => { expect(CSS.includes('.sidebar-brand strong span { color: var(--neon-cyan)')).toBe(true); });

  // ── 17. v231 redial features still present ────────────────────────────────
  it('redialTimeframe state exists', () => { expect(APP.includes('redialTimeframe')).toBe(true); });
  it('redial_preview action called', () => { expect(APP.includes('redial_preview')).toBe(true); });
  it('preview button text', () => { expect(APP.includes('PREVIEW TRANSFER REDIAL')).toBe(true); });
  it('historical grid in JSX', () => { expect(APP.includes('redial-historical-grid')).toBe(true); });
  it('all-time attempts used', () => { expect(APP.includes('outbound_attempts_all')).toBe(true); });
  it('all-time bridge confirmed used', () => { expect(APP.includes('bridge_confirmed_all')).toBe(true); });
  it('all-time TR leg used', () => { expect(APP.includes('talkroute_leg_created_all')).toBe(true); });

  // ── 18. Font system preserved ─────────────────────────────────────────────
  it('display font preserved', () => { expect(CSS.includes('Cormorant Garamond')).toBe(true); });
  it('sans font preserved', () => { expect(CSS.includes('Space Grotesk')).toBe(true); });
  it('mono font preserved', () => { expect(CSS.includes('JetBrains Mono')).toBe(true); });

  // ── 19. No obsolete authenticated palette literals ─────────────────────────
  it('no gold rgba in token overrides (19)', () => {
    const rootBlock = CSS.slice(0, CSS.indexOf('.login-hero-fullbleed') || 500);
    expect(rootBlock.includes('rgba(217,170,87')).toBe(false);
  });
  it('no old sage rgba anywhere', () => { expect(CSS.includes('rgba(94, 196, 138') || CSS.includes('rgba(94,196,138')).toBe(false); });
  it('no old rust rgba anywhere', () => { expect(CSS.includes('rgba(232, 66, 20') || CSS.includes('rgba(232,66,20')).toBe(false); });
  it('no old sage hex anywhere', () => { expect(CSS.includes('#5ec48a') || CSS.includes('#44a872')).toBe(false); });
  it('no old dark green rgba', () => { expect(CSS.includes('rgba(36, 107, 72') || CSS.includes('rgba(36,107,72')).toBe(false); });
  it('no old dark brown rgba', () => { expect(CSS.includes('rgba(27, 82, 56') || CSS.includes('rgba(27,82,56')).toBe(false); });
  it('no old cream hex', () => { expect(CSS.includes('#fff3df')).toBe(false); });
  it('no brass hex in token overrides (19)', () => { expect(CSS.includes('#f7ecd0') || CSS.includes('#c69340')).toBe(false); });
  it('neon cyan gold-400 in :root', () => { expect(CSS.includes('--gold-400: #2ee8ff')).toBe(true); });
  it('neon brushed gradient in :root', () => { expect(CSS.includes('--gold-brushed: linear-gradient(135deg, #2ee8ff')).toBe(true); });

  // ── 20. Neon lime used for success states ──────────────────────────────────
  it('neon lime used for success', () => { expect(CSS.includes('rgba(204, 255, 102') || CSS.includes('rgba(204,255,102') || CSS.includes('#ccff66')).toBe(true); });
  it('neon lime hex used for success indicators', () => { expect(CSS.includes('#ccff66')).toBe(true); });
});
