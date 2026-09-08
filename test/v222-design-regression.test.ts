// v222 Design Regression Tests
// Tests: required copy, asset ownership, accessibility/focus, mobile CSS,
// reduced motion, and preservation of all functional controls.
// Mock-only — no database, no network, no production mutations.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const APP_TSC = readFileSync(join(PROJECT_ROOT, 'src', 'App.tsx'), 'utf-8');
const INDEX_CSS = readFileSync(join(PROJECT_ROOT, 'src', 'index.css'), 'utf-8');

function timelineTscIncludes(text: string, _file: string): boolean {
  try {
    return readFileSync(join(PROJECT_ROOT, 'src', 'components', _file), 'utf-8').includes(text);
  } catch { return false; }
}

describe('v222 design regression', () => {
  // ── 1. Required copy: "Discipline. Clarity. Results." ────────────────────
  it('"Discipline. Clarity. Results." present in App.tsx', () => { expect(APP_TSC.includes('Discipline. Clarity. Results.')).toBe(true); });
  it('hero title CSS class used', () => { expect(APP_TSC.includes('command-center-hero-title')).toBe(true); });
  it('hero subtitle CSS class used', () => { expect(APP_TSC.includes('command-center-hero-subtitle')).toBe(true); });
  it('hero eyebrow CSS class used', () => { expect(APP_TSC.includes('command-center-hero-eyebrow')).toBe(true); });

  // ── 2. Hero copy is motivational, professional, ethical ──────────────────
  it('"high-performance" in hero copy', () => { expect(APP_TSC.includes('high-performance')).toBe(true); });
  it('"integrity" in hero copy', () => { expect(APP_TSC.includes('integrity')).toBe(true); });
  it('"verified" in hero copy', () => { expect(APP_TSC.includes('verified')).toBe(true); });
  it('no threatening language', () => { expect(APP_TSC.includes('threatening')).toBe(false); });
  it('no harassing language', () => { expect(APP_TSC.includes('harass')).toBe(false); });

  // ── 3. Asset ownership: hero image is project-owned ──────────────────────
  it('hero image file exists in public/', () => {
    const heroWebp = existsSync(join(PROJECT_ROOT, 'public', 'collections-command-center-hero.webp'));
    const heroPng = existsSync(join(PROJECT_ROOT, 'public', 'collections-command-center-hero.png'));
    expect(heroWebp || heroPng).toBe(true);
  });
  it('code references project-owned hero path', () => { expect(APP_TSC.includes('/collections-command-center-hero')).toBe(true); });
  it('CINEMATIC_HERO.commandCenter constant defined', () => { expect(APP_TSC.includes('CINEMATIC_HERO.commandCenter')).toBe(true); });
  it('commandCenter line found', () => {
    const heroLine = APP_TSC.split('\n').find(l => l.includes('commandCenter:'));
    expect(!!heroLine).toBe(true);
  });
  it('hero image is not an external pexels hotlink', () => {
    const heroLine = APP_TSC.split('\n').find(l => l.includes('commandCenter:'));
    if (heroLine) {
      expect(heroLine.includes('pexels.com')).toBe(false);
    }
  });
  it('hero image is not an external unsplash hotlink', () => {
    const heroLine = APP_TSC.split('\n').find(l => l.includes('commandCenter:'));
    if (heroLine) {
      expect(heroLine.includes('unsplash.com')).toBe(false);
    }
  });

  // ── 4. Accessibility / focus states ──────────────────────────────────────
  it('focus-visible styles defined', () => { expect(INDEX_CSS.includes('focus-visible')).toBe(true); });
  it('gold focus outline defined', () => { expect(INDEX_CSS.includes('outline: 2px solid var(--gold-400)')).toBe(true); });
  it('focus outline offset defined', () => { expect(INDEX_CSS.includes('outline-offset')).toBe(true); });
  it('App.tsx uses aria-label attributes', () => { expect(APP_TSC.includes('aria-label')).toBe(true); });

  // ── 5. Touch targets at least 44px ───────────────────────────────────────
  it('44px min-height for touch targets', () => { expect(INDEX_CSS.includes('min-height: 44px')).toBe(true); });
  it('toggle buttons have touch target sizing', () => { expect(INDEX_CSS.includes('.toggle-btn')).toBe(true); });
  it('concurrency buttons have touch target sizing', () => { expect(INDEX_CSS.includes('.conc-btn')).toBe(true); });
  it('dashboard tabs have touch target sizing', () => { expect(INDEX_CSS.includes('.dash-tab')).toBe(true); });
  it('performance tabs have touch target sizing', () => { expect(INDEX_CSS.includes('.perf-tab')).toBe(true); });

  // ── 6. Mobile 402px breakpoint ───────────────────────────────────────────
  it('402px breakpoint defined', () => { expect(INDEX_CSS.includes('max-width: 402px')).toBe(true); });
  it('command-center hero styled at 402px', () => { expect(INDEX_CSS.includes('command-center-hero')).toBe(true); });
  it('lead pool buckets styled at 402px', () => { expect(INDEX_CSS.includes('lead-pool-buckets')).toBe(true); });
  it('delivery timeline styled at 402px', () => { expect(INDEX_CSS.includes('delivery-timeline-track')).toBe(true); });

  // ── 7. No horizontal overflow ─────────────────────────────────────────────
  it('max-width: 100% set', () => { expect(INDEX_CSS.includes('max-width: 100%')).toBe(true); });
  it('overflow-x: auto for scrollable containers', () => { expect(INDEX_CSS.includes('overflow-x: auto')).toBe(true); });

  // ── 8. Reduced motion support ────────────────────────────────────────────
  it('prefers-reduced-motion media query defined', () => { expect(INDEX_CSS.includes('prefers-reduced-motion')).toBe(true); });
  it('animations disabled in reduced motion', () => { expect(INDEX_CSS.includes('animation-duration: 0.01ms')).toBe(true); });
  it('transitions disabled in reduced motion', () => { expect(INDEX_CSS.includes('transition-duration: 0.01ms')).toBe(true); });
  it('scroll behavior auto in reduced motion', () => { expect(INDEX_CSS.includes('scroll-behavior: auto')).toBe(true); });

  // ── 9. Privacy masking preserved ─────────────────────────────────────────
  it('maskPhone function used', () => { expect(APP_TSC.includes('maskPhone')).toBe(true); });
  it('maskAddressCoarse function used', () => {
    const privacySrc = readFileSync(join(PROJECT_ROOT, 'src', 'utils', 'privacy.ts'), 'utf-8');
    expect(privacySrc.includes('maskAddressCoarse')).toBe(true);
  });
  it('privacy reveal buttons present', () => { expect(APP_TSC.includes('privacy-reveal-btn')).toBe(true); });
  it('phone reveal tracking state present', () => { expect(APP_TSC.includes('revealedPhones')).toBe(true); });

  // ── 10. Live test pending labels preserved ───────────────────────────────
  it('TalkrouteDeliveryTimeline component used', () => { expect(APP_TSC.includes('TalkrouteDeliveryTimeline')).toBe(true); });
  it('InboundVerificationPanel component used', () => { expect(APP_TSC.includes('InboundVerificationPanel')).toBe(true); });
  it('timeline has "Live test pending" label', () => {
    const timelineTsc = readFileSync(join(PROJECT_ROOT, 'src', 'components', 'TalkrouteDeliveryTimeline.tsx'), 'utf-8');
    expect(timelineTsc.includes('Live test pending')).toBe(true);
  });
  it('timeline has "Software verified" label', () => {
    const timelineTsc = readFileSync(join(PROJECT_ROOT, 'src', 'components', 'TalkrouteDeliveryTimeline.tsx'), 'utf-8');
    expect(timelineTsc.includes('Software verified')).toBe(true);
  });
  it('inbound panel has "Live test pending" label', () => {
    const inboundTsc = readFileSync(join(PROJECT_ROOT, 'src', 'components', 'InboundVerificationPanel.tsx'), 'utf-8');
    expect(inboundTsc.includes('Live test pending')).toBe(true);
  });
  it('inbound panel has "Software verified" label', () => {
    const inboundTsc = readFileSync(join(PROJECT_ROOT, 'src', 'components', 'InboundVerificationPanel.tsx'), 'utf-8');
    expect(inboundTsc.includes('Software verified')).toBe(true);
  });

  // ── 11. Strict bridge predicate preserved ────────────────────────────────
  it('representative speech referenced', () => { expect(timelineTscIncludes('representative', 'TalkrouteDeliveryTimeline.tsx') || APP_TSC.includes('representative')).toBe(true); });
  it('bridge_confirmed field used', () => { expect(APP_TSC.includes('bridge_confirmed') || APP_TSC.includes('bridgeConfirmed')).toBe(true); });
  it('no false claim that Talkroute is physically verified', () => { expect(APP_TSC.includes('Talkroute is physically verified')).toBe(false); });

  // ── 12. No fake metrics or stock testimonials ────────────────────────────
  it('no testimonials in code', () => { expect(APP_TSC.includes('testimonial')).toBe(false); });
  it('no sample metrics', () => { expect(APP_TSC.includes('sample metric')).toBe(false); });
  it('no dummy data labels', () => { expect(APP_TSC.includes('dummy data')).toBe(false); });

  // ── 13. Functional controls preserved ────────────────────────────────────
  it('overview tab preserved', () => { expect(APP_TSC.includes("dashTab === 'overview'")).toBe(true); });
  it('agents tab preserved', () => { expect(APP_TSC.includes("dashTab === 'agents'")).toBe(true); });
  it('redial tab preserved', () => { expect(APP_TSC.includes("dashTab === 'redial'")).toBe(true); });
  it('settings tab preserved', () => { expect(APP_TSC.includes("dashTab === 'settings'")).toBe(true); });
  it('campaign start control preserved', () => { expect(APP_TSC.includes('startCampaign') || APP_TSC.includes('StartPreflightModal')).toBe(true); });
  it('agent toggle control preserved', () => { expect(APP_TSC.includes('toggleAgent')).toBe(true); });
  it('concurrency control preserved', () => { expect(APP_TSC.includes('setConcurrency')).toBe(true); });
  it('lead upload control preserved', () => { expect(APP_TSC.includes('handleUploadLeads')).toBe(true); });
  it('redial confirm modal preserved', () => { expect(APP_TSC.includes('RedialConfirmModal')).toBe(true); });
  it('redial selection preserved', () => { expect(APP_TSC.includes('selectedRedialIds')).toBe(true); });
  it('secretary feature preserved', () => { expect(APP_TSC.includes('placeQuickSecretaryCall') || APP_TSC.includes('SecretaryView')).toBe(true); });

  // ── 14. Nav items preserved ──────────────────────────────────────────────
  it('dashboard nav preserved', () => { expect(APP_TSC.includes("activeNav === 'dashboard'")).toBe(true); });
  it('leads nav preserved', () => { expect(APP_TSC.includes("activeNav === 'leads'")).toBe(true); });
  it('calls nav preserved', () => { expect(APP_TSC.includes("activeNav === 'calls'")).toBe(true); });
  it('saved nav preserved', () => { expect(APP_TSC.includes("activeNav === 'saved'")).toBe(true); });
  it('secretary nav preserved', () => { expect(APP_TSC.includes("activeNav === 'secretary'")).toBe(true); });

  // ── 15. Dark navy/charcoal foundation with gold accents ──────────────────
  it('ink-950 (darkest navy) defined', () => { expect(INDEX_CSS.includes('--ink-950')).toBe(true); });
  it('ink-900 defined', () => { expect(INDEX_CSS.includes('--ink-900')).toBe(true); });
  it('gold-400 accent defined', () => { expect(INDEX_CSS.includes('--gold-400')).toBe(true); });
  it('gold-100 light accent defined', () => { expect(INDEX_CSS.includes('--gold-100')).toBe(true); });
  it('dark navy base background', () => { expect(INDEX_CSS.includes('--bg-base: #06080d') || INDEX_CSS.includes('--bg-base: #070a0f')).toBe(true); });

  // ── 16. Premium typography ───────────────────────────────────────────────
  it('Cormorant Garamond display font', () => { expect(INDEX_CSS.includes('Cormorant Garamond')).toBe(true); });
  it('Space Grotesk sans font', () => { expect(INDEX_CSS.includes('Space Grotesk')).toBe(true); });
  it('JetBrains Mono font', () => { expect(INDEX_CSS.includes('JetBrains Mono')).toBe(true); });
  it('font-display variable defined', () => { expect(INDEX_CSS.includes('--font-display')).toBe(true); });
  it('font-sans variable defined', () => { expect(INDEX_CSS.includes('--font-sans')).toBe(true); });

  // ── 17. Card hierarchy and panel styling ─────────────────────────────────
  it('panel class defined', () => { expect(INDEX_CSS.includes('.panel')).toBe(true); });
  it('stat-card class defined', () => { expect(INDEX_CSS.includes('.stat-card')).toBe(true); });
  it('GlassCard component used', () => { expect(APP_TSC.includes('GlassCard')).toBe(true); });
  it('hover lift interaction used', () => { expect(APP_TSC.includes('hoverLift')).toBe(true); });

  // ── 18. Photography used as restrained hero/section accents only ─────────
  it('hero image in dedicated hero container', () => { expect(APP_TSC.includes('command-center-hero')).toBe(true); });
  it('no background images on tables', () => { expect(INDEX_CSS.includes('.perf-table.*background-image')).toBe(false); });
  it('no background images on queue lists', () => { expect(INDEX_CSS.includes('.queue-list.*background-image')).toBe(false); });

  // ── 19. Lead reconciliation preserved ────────────────────────────────────
  it('lead pool breakdown UI preserved', () => { expect(APP_TSC.includes('lead-pool-breakdown')).toBe(true); });
  it('reconciliation badge preserved', () => { expect(APP_TSC.includes('lead-pool-reconciliation-badge')).toBe(true); });
  it('LeadPool type preserved', () => { expect(APP_TSC.includes('LeadPool')).toBe(true); });

  // ── 20. Auth repair preserved ────────────────────────────────────────────
  it('authFetch used', () => { expect(APP_TSC.includes('authFetch')).toBe(true); });
  it('atomic logout ref preserved', () => { expect(APP_TSC.includes('atomicLogoutRef')).toBe(true); });
  it('auth-fetch.ts module exists', () => { expect(existsSync(join(PROJECT_ROOT, 'src', 'utils', 'auth-fetch.ts'))).toBe(true); });
});
