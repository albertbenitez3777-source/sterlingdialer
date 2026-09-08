// v229 Login/Homepage Redesign — Regression Tests
// Verifies that the login redesign preserved all auth handlers, fields,
// role switch, validation, loading states, and error display.
// Mock-only — no database, no network, no production mutations.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const APP_TSC = readFileSync(join(PROJECT_ROOT, 'src', 'App.tsx'), 'utf-8');
const CSS_TSC = readFileSync(join(PROJECT_ROOT, 'src', 'index.css'), 'utf-8');

describe('v229 Login/Homepage Redesign', () => {
  // ── 1. Owner Login handler preserved ──────────────────────────────────────
  it('handleLogin function exists', () => { expect(APP_TSC.includes('const handleLogin = async')).toBe(true); });
  it('PIN 4-digit validation preserved', () => { expect(APP_TSC.includes("if (!pin || !/^\\d{4}$/.test(pin))")).toBe(true); });
  it('PIN validation error message preserved', () => { expect(APP_TSC.includes("setLoginError('PIN must be 4 digits')")).toBe(true); });
  it('setLoggingIn loading state preserved', () => { expect(APP_TSC.includes('setLoggingIn(true)')).toBe(true); });
  it('setLoggingIn(false) in finally preserved', () => { expect(APP_TSC.includes('setLoggingIn(false)')).toBe(true); });
  it('login action payload preserved', () => { expect(APP_TSC.includes("action: 'login'")).toBe(true); });
  it('session token storage preserved', () => { expect(APP_TSC.includes('localStorage.setItem(\'sterling_session_token\'')).toBe(true); });
  it('session state set preserved', () => { expect(APP_TSC.includes('setSession({ valid: true, agent: data.agent })')).toBe(true); });
  it('agent availability set preserved', () => { expect(APP_TSC.includes('setAgentAvailable(!!data.agent.available_for_transfer)')).toBe(true); });
  it('both roles default to dashboard nav', () => { expect(APP_TSC.includes("setActiveNav('dashboard')")).toBe(true); });
  it('agent offline modal trigger preserved', () => { expect(APP_TSC.includes("data.agent.role !== 'owner' && data.agent.role !== 'supervisor' && !data.agent.available_for_transfer")).toBe(true); });
  it('PIN clear after login preserved', () => { expect(APP_TSC.includes('setPin(\'\')')).toBe(true); });

  // ── 2. Login error handling preserved ─────────────────────────────────────
  it('401 → unauthorized error kind preserved', () => { expect(APP_TSC.includes("res.status === 401 ? 'unauthorized'")).toBe(true); });
  it('500+ → server_error kind preserved', () => { expect(APP_TSC.includes('res.status >= 500')).toBe(true); });
  it('loginErrorMessage mapping preserved', () => { expect(APP_TSC.includes('loginErrorMessage(kind)')).toBe(true); });
  it('classifyFetchError for catch preserved', () => { expect(APP_TSC.includes('classifyFetchError(err)')).toBe(true); });
  it('error message set from data or kind preserved', () => { expect(APP_TSC.includes('setLoginError(data.error || loginErrorMessage(kind))')).toBe(true); });

  // ── 3. Owner Setup handler preserved ──────────────────────────────────────
  it('handleOwnerSetup function exists', () => { expect(APP_TSC.includes('const handleOwnerSetup = async')).toBe(true); });
  it('PIN match validation preserved', () => { expect(APP_TSC.includes("setupPin !== setupConfirm")).toBe(true); });
  it('PIN mismatch error preserved', () => { expect(APP_TSC.includes("setSetupError('PINs do not match')")).toBe(true); });
  it('setup PIN 4-digit validation preserved', () => { expect(APP_TSC.includes("!/^\\d{4}$/.test(setupPin)")).toBe(true); });
  it('setup PIN validation error preserved', () => { expect(APP_TSC.includes("setSetupError('PIN must be 4 digits')")).toBe(true); });
  it('setSettingUp loading state preserved', () => { expect(APP_TSC.includes('setSettingUp(true)')).toBe(true); });
  it('setSettingUp(false) in finally preserved', () => { expect(APP_TSC.includes('setSettingUp(false)')).toBe(true); });
  it('owner_setup action payload preserved', () => { expect(APP_TSC.includes("action: 'owner_setup'")).toBe(true); });
  it('owner needs setup flag cleared on success', () => { expect(APP_TSC.includes('setOwnerNeedsSetup(false)')).toBe(true); });
  it('network error in catch preserved', () => { expect(APP_TSC.includes("setSetupError('Network error')")).toBe(true); });

  // ── 4. PIN input fields preserved ─────────────────────────────────────────
  it('PinInput component with length=4, value=pin, onChange=setPin, onComplete=handleLogin preserved', () => { expect(APP_TSC.includes('PinInput length={4} value={pin} onChange={setPin} onComplete={handleLogin}')).toBe(true); });
  it('PinInput hasError prop bound to loginError preserved', () => { expect(APP_TSC.includes('hasError={!!loginError}')).toBe(true); });
  it('pin-input-single class for owner setup preserved', () => { expect(APP_TSC.includes('pin-input-single')).toBe(true); });
  it('setupPin value binding preserved', () => { expect(APP_TSC.includes('value={setupPin}')).toBe(true); });
  it('setupConfirm value binding preserved', () => { expect(APP_TSC.includes('value={setupConfirm}')).toBe(true); });
  it('setupPin digit-only filter preserved', () => { expect(APP_TSC.includes('setSetupPin(e.target.value.replace(/\\D/g, \'\'))')).toBe(true); });
  it('setupConfirm digit-only filter preserved', () => { expect(APP_TSC.includes('setSetupConfirm(e.target.value.replace(/\\D/g, \'\'))')).toBe(true); });
  it('Enter key triggers handleOwnerSetup preserved', () => { expect(APP_TSC.includes('e.key === \'Enter\' && handleOwnerSetup()')).toBe(true); });
  it('autoFocus on first setup input preserved', () => { expect(APP_TSC.includes('autoFocus')).toBe(true); });

  // ── 5. GlowButton login button preserved ──────────────────────────────────
  it('GlowButton fullWidth onClick=handleLogin disabled=loggingIn preserved', () => { expect(APP_TSC.includes('GlowButton fullWidth onClick={handleLogin} disabled={loggingIn}')).toBe(true); });
  it('loading/normal button text preserved', () => { expect(APP_TSC.includes("loggingIn ? 'Connecting — please wait...' : 'Enter Dashboard'")).toBe(true); });
  it('GlowButton fullWidth onClick=handleOwnerSetup disabled=settingUp preserved', () => { expect(APP_TSC.includes('GlowButton fullWidth onClick={handleOwnerSetup} disabled={settingUp}')).toBe(true); });
  it('setup loading/normal button text preserved', () => { expect(APP_TSC.includes("settingUp ? 'Setting up...' : 'Create Admin PIN'")).toBe(true); });

  // ── 6. Error display preserved ────────────────────────────────────────────
  it('loginError notice div preserved', () => { expect(APP_TSC.includes('loginError && <div className="notice"')).toBe(true); });
  it('setupError notice div preserved', () => { expect(APP_TSC.includes('setupError && <div className="notice"')).toBe(true); });

  // ── 7. Login foot note preserved ──────────────────────────────────────────
  it('login-foot class preserved', () => { expect(APP_TSC.includes('login-foot')).toBe(true); });
  it('4-digit PIN access only text preserved', () => { expect(APP_TSC.includes('4-digit PIN access only')).toBe(true); });

  // ── 8. Owner setup screen preserved ───────────────────────────────────────
  it('ownerNeedsSetup conditional render preserved', () => { expect(APP_TSC.includes('if (ownerNeedsSetup)')).toBe(true); });
  it('first-time setup eyebrow preserved', () => { expect(APP_TSC.includes('FIRST-TIME SETUP')).toBe(true); });
  it('set your admin PIN heading preserved', () => { expect(APP_TSC.includes('Set Your')).toBe(true); });
  it('admin PIN heading preserved', () => { expect(APP_TSC.includes('Admin PIN')).toBe(true); });
  it('enter 4-digit pin label preserved', () => { expect(APP_TSC.includes('ENTER 4-DIGIT PIN')).toBe(true); });
  it('confirm pin label preserved', () => { expect(APP_TSC.includes('CONFIRM PIN')).toBe(true); });

  // ── 9. Session check / role switch preserved ──────────────────────────────
  it('session.valid check preserved', () => { expect(APP_TSC.includes('if (!session?.valid)')).toBe(true); });
  it('isOwner role check preserved', () => { expect(APP_TSC.includes("const isOwner = session.agent?.role === 'owner'")).toBe(true); });
  it('login defaults to dashboard nav', () => { expect(APP_TSC.includes("setActiveNav('dashboard')")).toBe(true); });

  // ── 10. New design elements present ───────────────────────────────────────
  it('Brand says STERLING COLLECTIONS', () => { expect(APP_TSC.includes('STERLING <span>COLLECTIONS</span>')).toBe(true); });
  it('PRIVATE SALES FLOOR tagline present', () => { expect(APP_TSC.includes('PRIVATE SALES FLOOR')).toBe(true); });
  it('Built From headline present', () => { expect(APP_TSC.includes('Built From')).toBe(true); });
  it('Pressure headline present', () => { expect(APP_TSC.includes('Pressure')).toBe(true); });
  it('Trained headline present', () => { expect(APP_TSC.includes('Trained')).toBe(true); });
  it('Perform headline present', () => { expect(APP_TSC.includes('Perform')).toBe(true); });
  it('Discipline over excuses copy present', () => { expect(APP_TSC.includes('Discipline over excuses')).toBe(true); });
  it('Consistency over hype copy present', () => { expect(APP_TSC.includes('Consistency over hype')).toBe(true); });
  it('Every conversation copy present', () => { expect(APP_TSC.includes('Every conversation is an opportunity')).toBe(true); });
  it('login-chip class present', () => { expect(APP_TSC.includes('login-chip')).toBe(true); });
  it('HUSTLE SMART chip present', () => { expect(APP_TSC.includes('HUSTLE SMART')).toBe(true); });
  it('STAY SHARP chip present', () => { expect(APP_TSC.includes('STAY SHARP')).toBe(true); });
  it('FINISH STRONG chip present', () => { expect(APP_TSC.includes('FINISH STRONG')).toBe(true); });
  it('login-hero-fullbleed class present', () => { expect(APP_TSC.includes('login-hero-fullbleed')).toBe(true); });
  it('wolf-login-team.webp hero image referenced', () => { expect(APP_TSC.includes('wolf-login-team.webp')).toBe(true); });
  it('wolf-agent-momentum.webp editorial image referenced', () => { expect(APP_TSC.includes('wolf-agent-momentum.webp')).toBe(true); });

  // ── 11. CSS: full-bleed hero, chips, responsive, 44px targets ─────────────
  it('login-hero-fullbleed CSS rule exists', () => { expect(CSS_TSC.includes('.login-hero-fullbleed')).toBe(true); });
  it('login-hero-scrim CSS rule exists', () => { expect(CSS_TSC.includes('.login-hero-scrim')).toBe(true); });
  it('login-chip CSS rule exists', () => { expect(CSS_TSC.includes('.login-chip')).toBe(true); });
  it('860px breakpoint exists', () => { expect(CSS_TSC.includes('@media (max-width: 860px)')).toBe(true); });
  it('380px breakpoint exists', () => { expect(CSS_TSC.includes('@media (max-width: 380px)')).toBe(true); });
  it('44px min-height for touch targets exists', () => { expect(CSS_TSC.includes('min-height: 44px')).toBe(true); });
  it('reduced-motion support exists', () => { expect(CSS_TSC.includes('prefers-reduced-motion')).toBe(true); });

  // ── 12. Old backdrop removed ──────────────────────────────────────────────
  it('login-backdrop div removed from JSX', () => { expect(APP_TSC.includes('login-backdrop')).toBe(false); });

  // ── 13. No purple/indigo in login CSS ─────────────────────────────────────
  it('No purple in CSS', () => { expect(CSS_TSC.includes('purple')).toBe(false); });
  it('No indigo in CSS', () => { expect(CSS_TSC.includes('indigo')).toBe(false); });

  // ── 14. No AnimatedBackground in login ────────────────────────────────────
  it('AnimatedBackground not in login screens', () => {
    const loginSection = APP_TSC.slice(APP_TSC.indexOf('if (ownerNeedsSetup)'), APP_TSC.indexOf('const isOwner'));
    expect(loginSection.includes('<AnimatedBackground')).toBe(false);
  });

  // ── 15. Auth URL and fetchWithRetry preserved ─────────────────────────────
  it('AUTH_URL constant still referenced', () => { expect(APP_TSC.includes('AUTH_URL')).toBe(true); });
  it('fetchWithRetry for login preserved', () => { expect(APP_TSC.includes('fetchWithRetry(AUTH_URL')).toBe(true); });
  it('owner_needs_setup check preserved', () => { expect(APP_TSC.includes('fetchWithRetry(AUTH_URL, { action: \'owner_needs_setup\' })')).toBe(true); });

  // ── 16. No 320px overflow ─────────────────────────────────────────────────
  it('body min-width 320px preserved', () => { expect(CSS_TSC.includes('body { min-width: 320px')).toBe(true); });
  it('380px breakpoint uses 16px margins', () => { expect(CSS_TSC.includes('width: calc(100% - 16px)')).toBe(true); });
});
