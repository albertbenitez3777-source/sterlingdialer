// v235 Responsive Regression Tests
// Validates CSS responsive fixes for iPhone 320/375/390/430 and iPad 768/820/1024.
// Mock-only — reads CSS and TSX source; no network, no database, no production mutations.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const INDEX_CSS = readFileSync(join(PROJECT_ROOT, 'src', 'index.css'), 'utf-8');
const APP_TSX = readFileSync(join(PROJECT_ROOT, 'src', 'App.tsx'), 'utf-8');

describe('v235 Responsive Regression', () => {
  // ── 1. Global overflow containment ──────────────────────────────────────
  it('html has overflow-x: hidden', () => { expect(INDEX_CSS.includes('overflow-x: hidden')).toBe(true); });
  it('webkit text-size-adjust set', () => { expect(INDEX_CSS.includes('-webkit-text-size-adjust: 100%')).toBe(true); });
  it('body min-width 320px preserved', () => { expect(INDEX_CSS.includes('min-width: 320px')).toBe(true); });

  // ── 2. Safe-area padding ────────────────────────────────────────────────
  it('safe-area-inset-left applied', () => { expect(INDEX_CSS.includes('env(safe-area-inset-left)')).toBe(true); });
  it('safe-area-inset-right applied', () => { expect(INDEX_CSS.includes('env(safe-area-inset-right)')).toBe(true); });
  it('safe-area-inset-bottom applied', () => { expect(INDEX_CSS.includes('env(safe-area-inset-bottom)')).toBe(true); });

  // ── 3. 44px touch targets ───────────────────────────────────────────────
  it('nav-item in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.nav-item,')).toBe(true);
  });
  it('logout-btn in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.logout-btn,')).toBe(true);
  });
  it('filter-select in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.filter-select,')).toBe(true);
  });
  it('search-clear in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.search-clear,')).toBe(true);
  });
  it('glow-button in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.glow-button,')).toBe(true);
  });
  it('redial-action-btn in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.redial-action-btn,')).toBe(true);
  });
  it('mobile-menu-toggle in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.mobile-menu-toggle,')).toBe(true);
  });
  it('conn-go-available in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.conn-go-available,')).toBe(true);
  });
  it('mode-btn in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.mode-btn,')).toBe(true);
  });
  it('phone-action-option in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.phone-action-option,')).toBe(true);
  });
  it('remove-saved-btn in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.remove-saved-btn,')).toBe(true);
  });
  it('save-transfer-btn in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.save-transfer-btn,')).toBe(true);
  });
  it('quick-elizabeth-btn in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.quick-elizabeth-btn,')).toBe(true);
  });
  it('redial-checkbox in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.redial-checkbox,')).toBe(true);
  });
  it('secondary-button in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.secondary-button,')).toBe(true);
  });
  it('primary-button in 44px targets', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('.primary-button {')).toBe(true);
  });
  it('min-height 44px declared', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('min-height: 44px')).toBe(true);
  });
  it('min-width 44px declared', () => {
    const touchBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('Universal 44px touch targets'), INDEX_CSS.indexOf('iPad portrait'));
    expect(touchBlock.includes('min-width: 44px')).toBe(true);
  });

  // ── 4. iPhone breakpoints exist ─────────────────────────────────────────
  it('430px breakpoint exists', () => { expect(INDEX_CSS.includes('max-width: 430px')).toBe(true); });
  it('340px breakpoint exists', () => { expect(INDEX_CSS.includes('max-width: 340px')).toBe(true); });

  // ── 5. iPad portrait breakpoint ─────────────────────────────────────────
  it('761-820px media query', () => { expect(INDEX_CSS.includes('min-width: 761px') && INDEX_CSS.includes('max-width: 820px')).toBe(true); });

  // ── 6. Content padding reduces on mobile ────────────────────────────────
  it('content-wrap tighter at 430px', () => { expect(INDEX_CSS.includes('padding: 12px 12px 32px')).toBe(true); });
  it('content-wrap tightest at 340px', () => { expect(INDEX_CSS.includes('padding: 10px 8px 28px')).toBe(true); });

  // ── 7. Tables have overflow-x: auto wraps ───────────────────────────────
  it('perf-table-wrap exists', () => { expect(INDEX_CSS.includes('.perf-table-wrap')).toBe(true); });
  it('live-monitor-table-wrap exists', () => { expect(INDEX_CSS.includes('.live-monitor-table-wrap')).toBe(true); });
  it('errors-table-wrap exists', () => { expect(INDEX_CSS.includes('.errors-table-wrap')).toBe(true); });
  it('redial-batch-table-wrap exists', () => { expect(INDEX_CSS.includes('.redial-batch-table-wrap')).toBe(true); });
  it('momentum scrolling', () => { expect(INDEX_CSS.includes('-webkit-overflow-scrolling: touch')).toBe(true); });

  // ── 8. Charts don't overflow ────────────────────────────────────────────
  it('chart-panel constrained', () => { expect(INDEX_CSS.includes('.chart-panel { min-width: 0; overflow: hidden; }')).toBe(true); });
  it('recharts-wrapper constrained', () => { expect(INDEX_CSS.includes('.recharts-wrapper { max-width: 100%; }')).toBe(true); });

  // ── 9. Responsive images ────────────────────────────────────────────────
  it('global img max-width and height: auto', () => { expect(INDEX_CSS.includes('max-width: 100%') && INDEX_CSS.includes('height: auto')).toBe(true); });

  // ── 10. Modals bounded on mobile ────────────────────────────────────────
  it('preflight-modal bounded', () => { expect(INDEX_CSS.includes('.preflight-modal') && INDEX_CSS.includes('max-width: calc(100vw - 24px)')).toBe(true); });
  it('redial-confirm-modal referenced', () => { expect(INDEX_CSS.includes('.redial-confirm-modal')).toBe(true); });
  it('offline-modal bounded', () => { expect(INDEX_CSS.includes('.offline-modal') && INDEX_CSS.includes('max-width: calc(100vw - 24px)')).toBe(true); });
  it('phone-action-modal bounded', () => { expect(INDEX_CSS.includes('.phone-action-modal { max-width: calc(100vw - 24px)')).toBe(true); });

  // ── 11. Landscape phone fixes ───────────────────────────────────────────
  it('landscape media query', () => { expect(INDEX_CSS.includes('max-height: 430px') && INDEX_CSS.includes('orientation: landscape')).toBe(true); });

  // ── 12. Funnel responsive ───────────────────────────────────────────────
  it('funnel label full-width on mobile', () => { expect(INDEX_CSS.includes('.funnel-stage-label { width: 100%')).toBe(true); });
  it('funnel label 160px on iPad portrait', () => { expect(INDEX_CSS.includes('.funnel-stage-label { width: 160px')).toBe(true); });

  // ── 13. Reduced motion ─────────────────────────────────────────────────
  it('prefers-reduced-motion >= 5 occurrences', () => {
    const reducedMotionCount = (INDEX_CSS.match(/prefers-reduced-motion/g) || []).length;
    expect(reducedMotionCount >= 5).toBe(true);
  });
  it('delivery-stage in reduced motion', () => { expect(INDEX_CSS.includes('.delivery-stage,')).toBe(true); });
  it('glass-card-hover-lift in reduced motion', () => { expect(INDEX_CSS.includes('.glass-card-hover-lift,')).toBe(true); });

  // ── 14. Redial panel responsive ─────────────────────────────────────────
  it('redial agent card stacks', () => { expect(INDEX_CSS.includes('.redial-agent-card { flex-direction: column')).toBe(true); });
  it('redial actions stack', () => { expect(INDEX_CSS.includes('.redial-actions { flex-direction: column')).toBe(true); });

  // ── 15. Desktop layout preserved ────────────────────────────────────────
  it('desktop sidebar 240px preserved', () => { expect(INDEX_CSS.includes('width: 240px')).toBe(true); });
  it('4-column stats grid preserved', () => { expect(INDEX_CSS.includes('grid-template-columns: repeat(4, 1fr)')).toBe(true); });

  // ── 16. Login card responsive ───────────────────────────────────────────
  it('login h1 28px at 430px', () => { expect(INDEX_CSS.includes('.login-card-copy h1 { font-size: 28px')).toBe(true); });
  it('login h1 24px at 340px', () => { expect(INDEX_CSS.includes('.login-card-copy h1 { font-size: 24px')).toBe(true); });

  // ── 17. Existing breakpoints preserved ──────────────────────────────────
  it('1040px breakpoint', () => { expect(INDEX_CSS.includes('max-width: 1040px')).toBe(true); });
  it('860px breakpoint', () => { expect(INDEX_CSS.includes('max-width: 860px')).toBe(true); });
  it('760px breakpoint', () => { expect(INDEX_CSS.includes('max-width: 760px')).toBe(true); });
  it('600px breakpoint', () => { expect(INDEX_CSS.includes('max-width: 600px')).toBe(true); });
  it('380px breakpoint', () => { expect(INDEX_CSS.includes('max-width: 380px')).toBe(true); });

  // ── 18. Delivery timeline stacks on mobile ──────────────────────────────
  it('delivery timeline stacks', () => { expect(INDEX_CSS.includes('.delivery-timeline-track { flex-direction: column')).toBe(true); });
  it('connectors hidden', () => { expect(INDEX_CSS.includes('.delivery-stage-connector { display: none')).toBe(true); });

  // ── 19. Pin input responsive ────────────────────────────────────────────
  it('pin input 44px at 430px', () => { expect(INDEX_CSS.includes('.pin-input-box { width: 44px')).toBe(true); });
  it('pin input 40px at 340px', () => { expect(INDEX_CSS.includes('.pin-input-box { width: 40px')).toBe(true); });

  // ── 20. Focus visible preserved ─────────────────────────────────────────
  it('button focus-visible exists', () => { expect(INDEX_CSS.includes('button:focus-visible')).toBe(true); });
  it('input focus-visible exists', () => { expect(INDEX_CSS.includes('input:focus-visible')).toBe(true); });
  it('gold focus ring', () => { expect(INDEX_CSS.includes('outline: 2px solid var(--gold-400)')).toBe(true); });

  // ── 21. Queue card responsive ───────────────────────────────────────────
  it('queue-card-header wraps on mobile', () => { expect(INDEX_CSS.includes('.queue-card-header { flex-wrap: wrap')).toBe(true); });
  it('queue-card-left has min-width: 0', () => { expect(INDEX_CSS.includes('.queue-card-left { min-width: 0')).toBe(true); });
  it('queue-card-right wraps on mobile', () => { expect(INDEX_CSS.includes('.queue-card-right { flex-wrap: wrap')).toBe(true); });

  // ── 22. Call Now banner responsive ──────────────────────────────────────
  it('callnow title 28px at 430px', () => { expect(INDEX_CSS.includes('.callnow-banner-copy .callnow-title { font-size: 28px')).toBe(true); });
  it('callnow title 22px at 340px', () => { expect(INDEX_CSS.includes('.callnow-banner-copy .callnow-title { font-size: 22px')).toBe(true); });
  it('callnow stats wrap at 430px', () => { expect(INDEX_CSS.includes('.callnow-stat-strip { flex-wrap: wrap')).toBe(true); });
  it('callnow stats stack at 340px', () => { expect(INDEX_CSS.includes('.callnow-stat-strip { flex-direction: column')).toBe(true); });

  // ── 23. Hero row responsive ─────────────────────────────────────────────
  it('hero-row stacks on mobile', () => { expect(INDEX_CSS.includes('.hero-row { flex-direction: column')).toBe(true); });
  it('hero-actions full-width on mobile', () => { expect(INDEX_CSS.includes('.hero-actions { width: 100%')).toBe(true); });

  // ── 24. Transcript panel responsive ─────────────────────────────────────
  it('transcript header wraps', () => { expect(INDEX_CSS.includes('.redial-transcript-header { flex-wrap: wrap')).toBe(true); });
  it('transcript panel tighter padding', () => { expect(INDEX_CSS.includes('.redial-transcript-panel { padding: 12px 10px')).toBe(true); });

  // ── 25. Section hero responsive ─────────────────────────────────────────
  it('section-hero 100px at 430px', () => { expect(INDEX_CSS.includes('.section-hero { height: 100px')).toBe(true); });
  it('section-hero 80px at 340px', () => { expect(INDEX_CSS.includes('.section-hero { height: 80px')).toBe(true); });

  // ── 26. No auth/security/database changes ───────────────────────────────
  it('wolf-auth reference preserved', () => { expect(APP_TSX.includes('wolf-auth')).toBe(true); });
  it('session token auth preserved', () => { expect(APP_TSX.includes('sessionToken')).toBe(true); });
  it('atomic logout preserved', () => { expect(APP_TSX.includes('atomicLogout')).toBe(true); });
  it('authFetch calls preserved', () => { expect(APP_TSX.includes('authFetch')).toBe(true); });
  it('onUnauthorized guards preserved', () => { expect(APP_TSX.includes('onUnauthorized')).toBe(true); });

  // ── 27. Secretary form responsive ───────────────────────────────────────
  it('secretary-form-row stacks on mobile', () => { expect(INDEX_CSS.includes('.secretary-form-row { flex-direction: column')).toBe(true); });
  it('secretary-form tighter on mobile', () => { expect(INDEX_CSS.includes('.secretary-form { padding: 16px 12px')).toBe(true); });

  // ── 28. Contact detail grid responsive ──────────────────────────────────
  it('contact detail 1-col on mobile', () => { expect(INDEX_CSS.includes('.contact-detail-grid { grid-template-columns: 1fr; }')).toBe(true); });

  // ── 29. Callnow toolbar responsive ──────────────────────────────────────
  it('callnow toolbar stacks on mobile', () => { expect(INDEX_CSS.includes('.callnow-toolbar { flex-direction: column')).toBe(true); });

  // ── 30. iPad portrait extras ────────────────────────────────────────────
  it('iPad portrait sidebar 190px', () => {
    const ipadBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('min-width: 761px'), INDEX_CSS.indexOf('iPad landscape'));
    expect(ipadBlock.includes('.sidebar { width: 190px')).toBe(true);
  });
  it('iPad callnow stat scaled', () => {
    const ipadBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('min-width: 761px'), INDEX_CSS.indexOf('iPad landscape'));
    expect(ipadBlock.includes('.callnow-stat strong { font-size: 22px')).toBe(true);
  });
  it('iPad redial grid responsive', () => {
    const ipadBlock = INDEX_CSS.substring(INDEX_CSS.indexOf('min-width: 761px'), INDEX_CSS.indexOf('iPad landscape'));
    expect(ipadBlock.includes('.redial-overall-grid')).toBe(true);
  });
});
