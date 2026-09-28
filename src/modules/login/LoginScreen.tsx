import type { ApplicationModel } from "@/app/useApplicationModel";
import { PinInput } from '@/components';
import { MatrixField } from '@/components/MatrixField';
import { OfflineAccessScreen, OFFLINE_ACCESS_MESSAGE } from './OfflineAccessScreen';

export function LoginScreen({ model }: { model: Pick<ApplicationModel, "restoringLogin" | "ownerNeedsSetup" | "setupPin" | "setSetupPin" | "handleOwnerSetup" | "setupConfirm" | "setSetupConfirm" | "setupError" | "settingUp" | "session" | "loginError" | "pin" | "setPin" | "setLoginError" | "handleLogin" | "loggingIn" > }) {
const { restoringLogin, ownerNeedsSetup, setupPin, setSetupPin, handleOwnerSetup, setupConfirm, setSetupConfirm, setupError, settingUp, session, loginError, pin, setPin, setLoginError, handleLogin, loggingIn } = model;
if (!session?.valid && loginError === OFFLINE_ACCESS_MESSAGE) return <OfflineAccessScreen />;
if (ownerNeedsSetup) {
    return (
      <div className="matrix-access-page">
        <MatrixField />
        <main className="matrix-access-card setup-card">
          <p className="matrix-access-brand">FEDERAL ONE</p>
          <span className="matrix-access-kicker">INITIALIZE ACCESS</span>
          <div className="matrix-access-form stacked">
            <label>CREATE 4-DIGIT PIN</label>
            <input className="matrix-pin-single" type="password" inputMode="numeric" maxLength={4}
              value={setupPin} onChange={e => setSetupPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && handleOwnerSetup()} autoFocus />
            <label>CONFIRM PIN</label>
            <input className="matrix-pin-single" type="password" inputMode="numeric" maxLength={4}
              value={setupConfirm} onChange={e => setSetupConfirm(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && handleOwnerSetup()} />
            {setupError && <div className="matrix-access-error">{setupError}</div>}
            <button className="matrix-enter" onClick={handleOwnerSetup} disabled={settingUp}>
              {settingUp ? 'INITIALIZING…' : 'CREATE ACCESS'}
            </button>
          </div>
        </main>
      </div>
    );
  }
if (!session?.valid) {
    return (
      <div className="matrix-access-page">
        <MatrixField />
        <main className={`matrix-access-card ${loginError ? 'has-error' : ''}`}>
          <p className="matrix-access-brand">FEDERAL ONE</p>
          <span className="matrix-access-kicker">SECURE ACCESS</span>
          {restoringLogin && <p role="status" style={{color:'#bdd8cc',fontSize:13}}>Restoring your login… You can also enter your PIN below.</p>}
          <div className="matrix-access-form">
            <PinInput length={4} value={pin} onChange={value => { setPin(value); setLoginError(''); }} onComplete={handleLogin} hasError={!!loginError} disabled={loggingIn} />
            {loginError && <div className="matrix-access-error">{loginError}</div>}
            <button className="matrix-enter" onClick={() => handleLogin()} disabled={loggingIn}>
              {loggingIn ? 'VERIFYING…' : 'ENTER'}
            </button>
          </div>
        </main>
      </div>
    );
  }
return null;
}
