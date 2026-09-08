// v226 Premium Visual Pass Tests
// Mock-only — no database, no network, no production mutations.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const APP_TSC = readFileSync(join(PROJECT_ROOT, 'src', 'App.tsx'), 'utf-8');
const INDEX_CSS = readFileSync(join(PROJECT_ROOT, 'src', 'index.css'), 'utf-8');

describe('v226 visual pass', () => {
  // ── 1. Project-owned image files exist ────────────────────────────────────
  it('wolf-login-team.webp exists', () => { expect(existsSync(join(PROJECT_ROOT, 'public', 'wolf-login-team.webp'))).toBe(true); });
  it('wolf-agent-momentum.webp exists', () => { expect(existsSync(join(PROJECT_ROOT, 'public', 'wolf-agent-momentum.webp'))).toBe(true); });

  // ── 2. CINEMATIC_HERO references project-owned paths ──────────────────────
  it('loginTeam constant defined', () => { expect(APP_TSC.includes('loginTeam:')).toBe(true); });
  it('agentMomentum constant defined', () => { expect(APP_TSC.includes('agentMomentum:')).toBe(true); });
  it('loginTeam path is project-owned', () => { expect(APP_TSC.includes("'/wolf-login-team.webp'")).toBe(true); });
  it('agentMomentum path is project-owned', () => { expect(APP_TSC.includes("'/wolf-agent-momentum.webp'")).toBe(true); });

  // ── 3. Login split-screen visual panel ────────────────────────────────────
  it('login-card-visual element rendered', () => { expect(APP_TSC.includes('login-card-visual')).toBe(true); });
  it('login visual caption rendered', () => { expect(APP_TSC.includes('login-card-visual-caption')).toBe(true); });
  it('loginTeam image used in login card', () => { expect(APP_TSC.includes('wolf-login-team.webp') || APP_TSC.includes('CINEMATIC_HERO.loginTeam')).toBe(true); });
  it('login-card-visual CSS defined', () => { expect(INDEX_CSS.includes('.login-card-visual')).toBe(true); });
  it('login-card-visual img CSS defined', () => { expect(INDEX_CSS.includes('.login-card-visual img')).toBe(true); });
  it('login-card-visual overlay CSS defined', () => { expect(INDEX_CSS.includes('.login-card-visual-overlay')).toBe(true); });

  // ── 4. Both PIN login screens use the visual panel ────────────────────────
  it('both login screens have visual panel', () => {
    const visualCount = (APP_TSC.match(/login-card-visual/g) || []).length;
    expect(visualCount >= 6).toBe(true);
  });

  // ── 5. Agent momentum banner ──────────────────────────────────────────────
  it('agent-momentum-banner element rendered', () => { expect(APP_TSC.includes('agent-momentum-banner')).toBe(true); });
  it('agentMomentum image used', () => { expect(APP_TSC.includes('CINEMATIC_HERO.agentMomentum')).toBe(true); });
  it('momentum kicker copy present', () => { expect(APP_TSC.includes('OPERATOR MOMENTUM')).toBe(true); });
  it('momentum banner uses required copy', () => { expect(APP_TSC.includes('Discipline. Clarity. Results.')).toBe(true); });
  it('agent-momentum-banner CSS defined', () => { expect(INDEX_CSS.includes('.agent-momentum-banner')).toBe(true); });
  it('agent-momentum-copy CSS defined', () => { expect(INDEX_CSS.includes('.agent-momentum-copy')).toBe(true); });

  // ── 6. Agent controls remain accessible ───────────────────────────────────
  it('connection banner still rendered', () => { expect(APP_TSC.includes('conn-banner')).toBe(true); });
  it('availability toggle still in sidebar', () => { expect(APP_TSC.includes('availability-toggle-large')).toBe(true); });
  it('availability handler still wired', () => { expect(APP_TSC.includes('handleToggleAvailability')).toBe(true); });
  it('logout handler still wired', () => { expect(APP_TSC.includes('handleLogout')).toBe(true); });
  it('contacts nav accessible', () => { expect(APP_TSC.includes("activeNav === 'contacts'")).toBe(true); });
  it('secretary nav accessible', () => { expect(APP_TSC.includes("activeNav === 'secretary'")).toBe(true); });
  it('saved transfers nav accessible', () => { expect(APP_TSC.includes("activeNav === 'saved'")).toBe(true); });
  it('call now nav accessible', () => { expect(APP_TSC.includes("activeNav === 'calls'")).toBe(true); });

  // ── 7. SectionHero component ──────────────────────────────────────────────
  it('SectionHero component defined', () => { expect(APP_TSC.includes('function SectionHero')).toBe(true); });
  it('section-hero CSS defined', () => { expect(INDEX_CSS.includes('.section-hero')).toBe(true); });
  it('section-hero-title CSS defined', () => { expect(INDEX_CSS.includes('.section-hero-title')).toBe(true); });

  // ── 8. SectionHero replaces HeroBanner on key views ───────────────────────
  it('no HeroBanner overlay usages remain', () => { expect(APP_TSC.includes('HeroBanner overlay=')).toBe(false); });
  it('ContactsView uses SectionHero', () => {
    const contactsSection = APP_TSC.slice(APP_TSC.indexOf('function ContactsView'), APP_TSC.indexOf('function SecretaryView'));
    expect(contactsSection.includes('SectionHero')).toBe(true);
  });
  it('SavedTransfersView uses SectionHero', () => {
    const savedSection = APP_TSC.slice(APP_TSC.indexOf('function SavedTransfersView'), APP_TSC.indexOf('function AdminSavedTransfersView'));
    expect(savedSection.includes('SectionHero')).toBe(true);
  });
  it('SecretaryView uses SectionHero', () => {
    const secSection = APP_TSC.slice(APP_TSC.indexOf('function SecretaryView'));
    expect(secSection.includes('SectionHero')).toBe(true);
  });

  // ── 9. Mobile responsive fallbacks ────────────────────────────────────────
  it('login visual has mobile min-height fallback', () => { expect(INDEX_CSS.includes('min-height: 200px')).toBe(true); });
  it('momentum banner 880px breakpoint', () => { expect(INDEX_CSS.includes('.agent-momentum-banner') && INDEX_CSS.includes('max-width: 880px')).toBe(true); });
  it('momentum banner 402px breakpoint', () => { expect(INDEX_CSS.includes('.agent-momentum-banner') && INDEX_CSS.includes('max-width: 402px')).toBe(true); });
  it('section-hero 880px breakpoint', () => { expect(INDEX_CSS.includes('.section-hero') && INDEX_CSS.includes('max-width: 880px')).toBe(true); });
  it('section-hero 402px breakpoint', () => { expect(INDEX_CSS.includes('.section-hero') && INDEX_CSS.includes('max-width: 402px')).toBe(true); });

  // ── 10. Accessibility ─────────────────────────────────────────────────────
  it('decorative images marked aria-hidden', () => { expect(APP_TSC.includes('aria-hidden="true"')).toBe(true); });
  it('momentum banner has aria-label', () => { expect(APP_TSC.includes('aria-label="Agent momentum"')).toBe(true); });
  it('SectionHero has role=banner', () => { expect(APP_TSC.includes('role="banner"')).toBe(true); });
  it('focus-visible styles preserved', () => { expect(INDEX_CSS.includes('focus-visible')).toBe(true); });

  // ── 11. Reduced motion support ────────────────────────────────────────────
  it('login visual respects reduced motion', () => { expect(INDEX_CSS.includes('login-card-visual img') && INDEX_CSS.includes('animation: none')).toBe(true); });
  it('momentum banner respects reduced motion', () => { expect(INDEX_CSS.includes('agent-momentum-banner img') && INDEX_CSS.includes('animation: none')).toBe(true); });
  it('section-hero respects reduced motion', () => { expect(INDEX_CSS.includes('section-hero img') && INDEX_CSS.includes('animation: none')).toBe(true); });

  // ── 12. Shared ContactsView preserved ─────────────────────────────────────
  it('owner contacts nav preserved', () => { expect(APP_TSC.includes("isOwner && activeNav === 'contacts'")).toBe(true); });
  it('agent contacts nav preserved', () => { expect(APP_TSC.includes("!isOwner && activeNav === 'contacts'")).toBe(true); });
  it('ContactsView component still used', () => { expect(APP_TSC.includes('ContactsView')).toBe(true); });

  // ── 13. Talkroute bridge truth preserved ──────────────────────────────────
  it('TalkrouteDeliveryTimeline still used', () => { expect(APP_TSC.includes('TalkrouteDeliveryTimeline')).toBe(true); });
  it('InboundVerificationPanel still used', () => { expect(APP_TSC.includes('InboundVerificationPanel')).toBe(true); });
  it('bridge_confirmed field still used', () => { expect(APP_TSC.includes('bridge_confirmed')).toBe(true); });

  // ── 14. Auth and safeguards preserved ─────────────────────────────────────
  it('authFetch still used', () => { expect(APP_TSC.includes('authFetch')).toBe(true); });
  it('secretary double-submit guard preserved', () => { expect(APP_TSC.includes('placingSecCall')).toBe(true); });
  it('search offset ref preserved', () => { expect(APP_TSC.includes('searchOffsetRef')).toBe(true); });

  // ── 15. Pagination preserved ──────────────────────────────────────────────
  it('hasMore state preserved', () => { expect(APP_TSC.includes('hasMore')).toBe(true); });
  it('load more button preserved', () => { expect(APP_TSC.includes('Load More Contacts')).toBe(true); });

  // ── 16. Privacy masking preserved ─────────────────────────────────────────
  it('maskPhone still used', () => { expect(APP_TSC.includes('maskPhone')).toBe(true); });
  it('maskAddressCoarse still used', () => {
    const privacySrc = readFileSync(join(PROJECT_ROOT, 'src', 'utils', 'privacy.ts'), 'utf-8');
    expect(privacySrc.includes('maskAddressCoarse')).toBe(true);
  });

  // ── 17. No purple/indigo colors ───────────────────────────────────────────
  it('no purple in CSS', () => { expect(INDEX_CSS.includes('purple')).toBe(false); });
  it('no indigo in CSS', () => { expect(INDEX_CSS.includes('indigo')).toBe(false); });

  // ── 18. Touch targets ─────────────────────────────────────────────────────
  it('44px min-height preserved', () => { expect(INDEX_CSS.includes('min-height: 44px')).toBe(true); });
});
