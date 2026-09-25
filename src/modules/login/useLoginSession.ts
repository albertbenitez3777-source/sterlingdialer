import { AUTH_URL,classifyFetchError,fetchWithRetry,LoginErrorKind,loginErrorMessage,SessionData } from "@/app/shared";
import { useEffect,useRef,useState } from 'react';

import type { Dispatch,SetStateAction } from 'react';
export function useLoginState() {
const [session, setSession] = useState<SessionData | null>(null);
const [pin, setPin] = useState('');
const [loginError, setLoginError] = useState('');
const [loggingIn, setLoggingIn] = useState(false);
const loginInFlight = useRef(false);
const [sessionToken, setSessionToken] = useState('');
const [ownerNeedsSetup, setOwnerNeedsSetup] = useState(false);
const [setupPin, setSetupPin] = useState('');
const [setupConfirm, setSetupConfirm] = useState('');
const [setupError, setSetupError] = useState('');
const [settingUp, setSettingUp] = useState(false);
return {session,setSession,pin,setPin,loginError,setLoginError,loggingIn,setLoggingIn,loginInFlight,sessionToken,setSessionToken,ownerNeedsSetup,setOwnerNeedsSetup,setupPin,setSetupPin,setupConfirm,setSetupConfirm,setupError,setSetupError,settingUp,setSettingUp};
}
type LoginState = ReturnType<typeof useLoginState>;
type LoginLifecycle = LoginState & { setAgentAvailable: Dispatch<SetStateAction<boolean>>; setActiveNav: Dispatch<SetStateAction<string>>; setShowOfflineModal: Dispatch<SetStateAction<boolean>>; atomicLogout: () => void; };
export function useLoginLifecycle({session,setSession,pin,setPin,loginError,setLoginError,loggingIn,setLoggingIn,loginInFlight,sessionToken,setSessionToken,ownerNeedsSetup,setOwnerNeedsSetup,setupPin,setSetupPin,setupConfirm,setSetupConfirm,setupError,setSetupError,settingUp,setSettingUp,setAgentAvailable,setActiveNav,setShowOfflineModal,atomicLogout}: LoginLifecycle) {
useEffect(() => {
    fetchWithRetry(AUTH_URL, { action: 'owner_needs_setup' })
      .then(r => r.json()).then(d => { if (d.needs_setup) setOwnerNeedsSetup(true); }).catch(() => {});
  }, []);
useEffect(() => {
    const token = localStorage.getItem('sterling_session_token');
    if (!token) return;
    let cancelled = false;
    let pending = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const stillCurrent = () => !cancelled && !loginInFlight.current
      && localStorage.getItem('sterling_session_token') === token;
    const restore = async () => {
      if (pending || !stillCurrent()) return;
      clearTimeout(retryTimer);
      pending = true;
      try {
        const response = await fetchWithRetry(AUTH_URL, { action: 'verify', session_token: token });
        if (!response.ok) throw new Error('Session verification unavailable');
        const data = await response.json();
        if (!stillCurrent()) return;
        if (data.valid === true && data.agent) {
          setSession(data);
          setSessionToken(token);
          setAgentAvailable(!!data.agent.available_for_transfer);
          setActiveNav('dashboard');
          setLoginError('');
          if (data.agent.role !== 'owner' && data.agent.role !== 'administrator' && !data.agent.available_for_transfer) {
            setShowOfflineModal(true);
          }
        } else if (data.valid === false) {
          localStorage.removeItem('sterling_session_token');
          setLoginError('Session expired. Enter your PIN to sign in.');
        } else {
          throw new Error('Session verification unavailable');
        }
      } catch {
        if (stillCurrent()) {
          setLoginError('Connection interrupted. Reconnecting your saved login…');
          retryTimer = setTimeout(() => { void restore(); }, 10000);
        }
      } finally {
        pending = false;
      }
    };
    const reconnect = () => { void restore(); };
    void restore();
    window.addEventListener('online', reconnect);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      window.removeEventListener('online', reconnect);
    };
  }, []);
useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('key');
    if (!token || token.length < 30) return;
    // Clear the token from the URL immediately so it's not visible/bookmarkable with token
    window.history.replaceState({}, '', window.location.pathname);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithRetry(AUTH_URL, { action: 'login_by_token', token });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.success && data.session_token && data.agent) {
          localStorage.setItem('sterling_session_token', data.session_token);
          setSessionToken(data.session_token);
          setSession({ valid: true, agent: data.agent });
          setAgentAvailable(!!data.agent.available_for_transfer);
          setActiveNav('dashboard');
          if (data.agent.role !== 'owner' && data.agent.role !== 'administrator' && !data.agent.available_for_transfer) setShowOfflineModal(true);
        } else {
          setLoginError(data.error || 'Invalid or expired link');
        }
      } catch {
        if (!cancelled) setLoginError('Connection error. Please try the link again.');
      }
    })();
    return () => { cancelled = true; };
  }, []);
const handleLogin = async (completedPin = pin) => {
    if (loginInFlight.current) return;
    if (!/^\d{4}$/.test(completedPin)) { setLoginError('PIN must be 4 digits'); return; }
    loginInFlight.current = true;
    setLoggingIn(true); setLoginError('');
    try {
      const res = await fetchWithRetry(AUTH_URL, { action: 'login', pin: completedPin });
      const data = await res.json();
      if (res.ok && data.success && data.session_token && data.agent) {
        localStorage.setItem('sterling_session_token', data.session_token);
        setSessionToken(data.session_token);
        setSession({ valid: true, agent: data.agent });
        setAgentAvailable(!!data.agent.available_for_transfer);
        setActiveNav('dashboard');
        if (data.agent.role !== 'owner' && data.agent.role !== 'administrator' && !data.agent.available_for_transfer) setShowOfflineModal(true);
        setPin('');
      } else {
        const kind: LoginErrorKind = res.status === 401 ? 'unauthorized' : res.status >= 500 ? 'server_error' : 'unknown';
        setLoginError(data.error || loginErrorMessage(kind));
      }
    } catch (err) {
      const kind = classifyFetchError(err);
      setLoginError(loginErrorMessage(kind));
    }
    finally { loginInFlight.current = false; setLoggingIn(false); }
  };
const handleLogout = async () => {
    try {
      await fetch(AUTH_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout', session_token: sessionToken }),
      });
    } catch { /* ignore */ }
    atomicLogout();
  };
const handleOwnerSetup = async () => {
    if (setupPin !== setupConfirm) { setSetupError('PINs do not match'); return; }
    if (!/^\d{4}$/.test(setupPin)) { setSetupError('PIN must be 4 digits'); return; }
    setSettingUp(true); setSetupError('');
    try {
      const res = await fetch(AUTH_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'owner_setup', pin: setupPin }),
      });
      const data = await res.json();
      if (data.success) { setOwnerNeedsSetup(false); setSetupPin(''); setSetupConfirm(''); }
      else { setSetupError(data.error || 'Setup failed'); }
    } catch { setSetupError('Network error'); }
    finally { setSettingUp(false); }
  };
return { handleLogin, handleLogout, handleOwnerSetup };
}
