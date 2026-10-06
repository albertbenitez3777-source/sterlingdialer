import type { ApplicationModel } from "@/app/useApplicationModel";
import { PinInput } from '@/components';
import { CINEMATIC_HERO } from '@/app/shared';
import { ShieldCheck, LockKeyhole, Phone, CalendarCheck, TrendingUp } from 'lucide-react';
import { OfflineAccessScreen, OFFLINE_ACCESS_MESSAGE } from './OfflineAccessScreen';

export function LoginScreen({ model }: { model: Pick<ApplicationModel, "restoringLogin" | "ownerNeedsSetup" | "setupPin" | "setSetupPin" | "handleOwnerSetup" | "setupConfirm" | "setSetupConfirm" | "setupError" | "settingUp" | "session" | "loginError" | "pin" | "setPin" | "setLoginError" | "handleLogin" | "loggingIn" > }) {
  const { restoringLogin, ownerNeedsSetup, setupPin, setSetupPin, handleOwnerSetup, setupConfirm, setSetupConfirm, setupError, settingUp, session, loginError, pin, setPin, setLoginError, handleLogin, loggingIn } = model;

  if (!session?.valid && loginError === OFFLINE_ACCESS_MESSAGE) return <OfflineAccessScreen />;

  if (ownerNeedsSetup) {
    return (
      <div className="login-page">
        <div className="login-hero-fullbleed">
          <img src={CINEMATIC_HERO.commandCenter} alt="" />
          <div className="login-hero-scrim" />
        </div>
        <div className="login-aurora" />
        <div className="login-grid" />
        <div className="login-shell">
          <div className="login-brand">
            <span className="brand-mark">01</span>
            <div className="brand-copy">
              <strong>FEDERAL <span>ONE</span></strong>
              <small>PRIVATE OPERATIONS · APPOINTMENT DIVISION</small>
            </div>
          </div>
          <div className="login-card">
            <div className="login-card-visual">
              <img src={CINEMATIC_HERO.callCenter} alt="" />
              <div className="login-card-visual-overlay" />
              <div className="login-card-visual-caption">
                <span>INITIALIZE ACCESS</span>
                <strong>Set your secure PIN</strong>
                <small>Create a 4-digit PIN to lock down your command center.</small>
              </div>
            </div>
            <div className="login-card-copy" style={{ padding: '56px 52px' }}>
              <div className="eyebrow"><ShieldCheck size={12} /> FIRST-TIME SETUP</div>
              <h1>Initialize <em>access</em></h1>
              <p>Choose a 4-digit PIN. You'll use it every time you sign in to Federal One.</p>
              <div className="login-form" style={{ padding: 0, marginTop: '32px' }}>
                <label>CREATE 4-DIGIT PIN</label>
                <input className="pin-input-single" type="password" inputMode="numeric" maxLength={4}
                  value={setupPin} onChange={e => setSetupPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && handleOwnerSetup()} autoFocus />
                <label style={{ marginTop: '16px' }}>CONFIRM PIN</label>
                <input className="pin-input-single" type="password" inputMode="numeric" maxLength={4}
                  value={setupConfirm} onChange={e => setSetupConfirm(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && handleOwnerSetup()} />
                {setupError && <div className="notice"><LockKeyhole size={14} /> {setupError}</div>}
                <button className="primary-button login-button" onClick={handleOwnerSetup} disabled={settingUp} style={{ marginTop: '24px' }}>
                  {settingUp ? 'INITIALIZING…' : 'CREATE ACCESS'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!session?.valid) {
    return (
      <div className="login-page">
        <div className="login-hero-fullbleed">
          <img src={CINEMATIC_HERO.skyline} alt="" />
          <div className="login-hero-scrim" />
        </div>
        <div className="login-aurora" />
        <div className="login-grid" />
        <div className="login-shell">
          <div className="login-brand">
            <span className="brand-mark">01</span>
            <div className="brand-copy">
              <strong>FEDERAL <span>ONE</span></strong>
              <small>PRIVATE OPERATIONS · APPOINTMENT DIVISION</small>
            </div>
          </div>
          <div className="login-card">
            <div className="login-card-visual">
              <img src={CINEMATIC_HERO.agentHero} alt="" />
              <div className="login-card-visual-overlay" />
              <div className="login-card-visual-caption">
                <span>AI-POWERED DIALER</span>
                <strong>Elizabeth Sterling</strong>
                <small>PCH appointment booking · FDCPA compliant</small>
              </div>
            </div>
            <div className="login-card-copy">
              <div className="eyebrow"><LockKeyhole size={12} /> SECURE ACCESS</div>
              <h1>Sign in to <em>Federal One</em></h1>
              <p>Enter your 4-digit PIN to access the dialer, live calls, callbacks, and appointment scheduling.</p>
              {restoringLogin && <p role="status" style={{ color: 'var(--gold-300)', fontSize: 13, marginTop: 16 }}>Restoring your login… You can also enter your PIN below.</p>}
              <div className="login-form" style={{ padding: 0, marginTop: '36px' }}>
                <label>ENTER PIN</label>
                <PinInput length={4} value={pin} onChange={value => { setPin(value); setLoginError(''); }} onComplete={handleLogin} hasError={!!loginError} disabled={loggingIn} />
                {loginError && <div className="notice"><LockKeyhole size={14} /> {loginError}</div>}
                <button className="primary-button login-button" onClick={() => handleLogin()} disabled={loggingIn} style={{ marginTop: '24px' }}>
                  {loggingIn ? 'VERIFYING…' : 'ENTER'}
                </button>
                <div className="login-features">
                  <span><Phone size={12} /> AI dialer with 2 lines</span>
                  <span><CalendarCheck size={12} /> Appointment booking</span>
                  <span><TrendingUp size={12} /> Live stats & callbacks</span>
                </div>
                <div className="login-foot"><ShieldCheck size={11} /> <span>FEDERAL ONE</span> · SECURE OPERATIONS</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
