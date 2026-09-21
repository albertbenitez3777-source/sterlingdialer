import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Phone, PhoneOff, PhoneOutgoing, RotateCcw, X,
  ChevronDown, ChevronUp, Loader2, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { formatPhone } from '@/utils/privacy';
import { authFetch } from '@/utils/auth-fetch';
import './IPhone.css';

interface IPhoneProps {
  agentName: string;
  sessionToken: string;
  providerUrl: string;
  onUnauthorized: () => void;
}

interface RouteData {
  talkroute_number?: string;
  zadarma_sip_login?: string;
  zadarma_sip_password?: string;
}

type WidgetStatus = 'loading' | 'setting-up' | 'ready' | 'error';

function ts() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const WIDGET_DOMAIN = 'wolf-of-wall-street-ssy3.bolt.host';
const WIDGET_SCRIPT_BASE = 'https://my.zadarma.com/webphoneWebRTCWidget/v8/js/loader-phone-lib.js';

export function IPhone({ agentName, sessionToken, providerUrl, onUnauthorized }: IPhoneProps) {
  const [open, setOpen] = useState(false);
  const [widgetStatus, setWidgetStatus] = useState<WidgetStatus>('loading');
  const [route, setRoute] = useState<RouteData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState('');
  const [widgetLoaded, setWidgetLoaded] = useState(false);
  const [callbackDigits, setCallbackDigits] = useState('');
  const [callbackStatus, setCallbackStatus] = useState<'idle' | 'calling' | 'success' | 'error'>('idle');

  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const setupDoneRef = useRef(false);
  const scriptLoadedRef = useRef(false);

  const firstName = agentName.split(' ')[0] || 'Agent';
  const hasSipCreds = !!(route?.zadarma_sip_login);

  const log = useCallback((msg: string) => {
    const line = `${ts()} ${msg}`;
    console.log('[Phone]', msg);
    setLogs(prev => [...prev.slice(-50), line]);
  }, []);

  // Step 1: Load route data
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const r = await authFetch<{ route: RouteData }>(providerUrl, {
        body: { action: 'get_federal_one_v2', session_token: sessionToken },
        onUnauthorized: () => onUnauthorizedRef.current(),
      });
      if (!stop && r.ok && r.data?.route) {
        setRoute(r.data.route);
        log(`Agent SIP: ${r.data.route.zadarma_sip_login || 'none'}`);
      } else if (!stop) {
        log('Failed to load route data');
        setWidgetStatus('error');
        setError('Could not load phone settings');
      }
    };
    void load();
    return () => { stop = true; };
  }, [providerUrl, sessionToken, log]);

  // Step 2: Setup domain + get key + load widget
  useEffect(() => {
    if (!route?.zadarma_sip_login || setupDoneRef.current) return;
    setupDoneRef.current = true;

    const setup = async () => {
      setWidgetStatus('setting-up');
      log('Setting up phone connection...');

      // Setup domain (idempotent)
      try {
        const setupRes = await authFetch<{ ok: boolean; results?: Record<string, unknown> }>(providerUrl, {
          body: { action: 'zadarma_setup_webrtc', session_token: sessionToken },
          onUnauthorized: () => onUnauthorizedRef.current(),
        });
        if (setupRes.ok) {
          log(`Domain setup: ${JSON.stringify(setupRes.data?.results?.domain || 'done')}`);
        } else {
          log(`Domain setup issue: ${setupRes.error || 'unknown'}`);
        }
      } catch (e) {
        log(`Domain setup error: ${e}`);
      }

      // Get WebRTC key
      try {
        const keyRes = await authFetch<{ key?: string; sip?: string; error?: string }>(providerUrl, {
          body: { action: 'zadarma_webrtc_key', session_token: sessionToken },
          onUnauthorized: () => onUnauthorizedRef.current(),
        });

        if (keyRes.ok && keyRes.data?.key) {
          const key = keyRes.data.key;
          log(`Got WebRTC key for ${keyRes.data.sip}`);
          loadWidgetScript(key);
        } else {
          const errMsg = keyRes.data?.error || keyRes.error || 'Could not get phone key';
          log(`Key error: ${errMsg}`);
          setWidgetStatus('error');
          setError(errMsg);
        }
      } catch (e) {
        log(`Key fetch error: ${e}`);
        setWidgetStatus('error');
        setError('Could not connect to phone service');
      }
    };

    const loadWidgetScript = (key: string) => {
      if (scriptLoadedRef.current) return;
      scriptLoadedRef.current = true;

      log('Loading phone widget...');
      const script = document.createElement('script');
      script.id = 'zadarma-phone-lib';
      script.src = `${WIDGET_SCRIPT_BASE}?location_href=${encodeURIComponent(WIDGET_DOMAIN)}&key=${encodeURIComponent(key)}`;
      script.async = true;

      script.onload = () => {
        log('Phone widget loaded successfully');
        setWidgetStatus('ready');
        setWidgetLoaded(true);
      };

      script.onerror = () => {
        log('Phone widget failed to load');
        setWidgetStatus('error');
        setError('Phone widget could not be loaded. You can still use callback dialing below.');
      };

      document.body.appendChild(script);
    };

    void setup();
  }, [route, providerUrl, sessionToken, log]);

  // Cleanup widget script on unmount
  useEffect(() => {
    return () => {
      const existingScript = document.getElementById('zadarma-phone-lib');
      if (existingScript) existingScript.remove();
      // Remove widget DOM elements if any
      document.querySelectorAll('[class*="zadarma"], [id*="zadarma"], [class*="webrtc-phone"]').forEach(el => el.remove());
    };
  }, []);

  // Callback fallback
  const makeCallbackCall = useCallback(async (number: string) => {
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length < 10) { setError('Enter a valid number (10+ digits)'); return; }
    setCallbackStatus('calling');
    log(`Callback to ${cleaned}...`);

    const r = await authFetch<{ ok: boolean; message?: string; error?: string }>(providerUrl, {
      body: { action: 'zadarma_callback', session_token: sessionToken, to: cleaned },
      onUnauthorized: () => onUnauthorizedRef.current(),
    });

    if (r.ok && r.data?.ok) {
      log(`Callback success: ${r.data.message}`);
      setCallbackStatus('success');
      setTimeout(() => setCallbackStatus('idle'), 5000);
    } else {
      const errMsg = r.data?.error || r.error || 'Callback failed';
      log(`Callback error: ${errMsg}`);
      setError(errMsg);
      setCallbackStatus('error');
      setTimeout(() => setCallbackStatus('idle'), 3000);
    }
  }, [providerUrl, sessionToken, log]);

  const statusDot = widgetStatus === 'ready' ? 'connected' :
                    widgetStatus === 'error' ? 'callback' :
                    'connecting';

  // Closed state
  if (!open) {
    return (
      <aside className="ip17-shell ip17-closed" aria-label="Open phone">
        <button className="ip17-trigger" onClick={() => setOpen(true)}>
          <div className="ip17-trigger-icon">
            <Phone size={26} />
            <div className="ip17-trigger-waves">
              <span /><span /><span />
            </div>
          </div>
          <div className={`ip17-trigger-sip-dot ${statusDot}`} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="ip17-shell">
      {/* Dynamic Island */}
      <div className="ip17-island">
        <div className="ip17-island-pill">
          <div className={`ip17-island-dot ${statusDot}`} />
          <span className="ip17-island-label">{firstName}'s Phone</span>
          <button className="ip17-island-close" onClick={() => setOpen(false)} aria-label="Close phone">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="ip17-body">
        {/* Status bar */}
        <div className="ip17-statusbar">
          <span className={`ip17-sip-badge ${statusDot}`}>
            {widgetStatus === 'ready' ? 'Phone Ready' :
             widgetStatus === 'setting-up' ? 'Setting up...' :
             widgetStatus === 'error' ? 'Setup Issue' :
             'Loading...'}
          </span>
          {route?.talkroute_number && <span className="ip17-my-line">{formatPhone(route.talkroute_number)}</span>}
        </div>

        {/* Loading state */}
        {(widgetStatus === 'loading' || widgetStatus === 'setting-up') && (
          <div className="ip17-mode-notice" style={{ borderColor: '#1a2a3a', background: '#0a1520' }}>
            <Loader2 size={14} className="ip17-spin" />
            <span style={{ color: '#8ec0e0' }}>
              {widgetStatus === 'loading' ? 'Loading phone settings...' : 'Connecting to phone service...'}
            </span>
          </div>
        )}

        {/* Widget ready */}
        {widgetStatus === 'ready' && (
          <div className="ip17-mode-notice" style={{ borderColor: '#1a3a1a', background: '#0a1a0a' }}>
            <CheckCircle2 size={14} />
            <span style={{ color: '#8ee0a0' }}>
              Phone is connected. Use the Zadarma phone widget (floating button) to make and receive calls directly from your browser.
            </span>
          </div>
        )}

        {/* Error state with callback fallback */}
        {widgetStatus === 'error' && (
          <>
            <div className="ip17-mode-notice">
              <AlertTriangle size={14} />
              <span>
                {error || 'Could not connect the browser phone.'}
                {hasSipCreds && ' You can use callback dialing below as a backup.'}
              </span>
            </div>

            {hasSipCreds && (
              <div className="ip17-callback-section">
                <h4 className="ip17-callback-title">Callback Dialing</h4>
                <p className="ip17-callback-desc">
                  Enter a number and press Call. Your Zadarma extension will ring first, then it will connect you to the number.
                </p>
                <div className="ip17-callback-row">
                  <input
                    type="text"
                    value={callbackDigits}
                    onChange={e => setCallbackDigits(e.target.value.replace(/[^0-9+]/g, ''))}
                    placeholder="Phone number"
                    className="ip17-callback-input"
                  />
                  <button
                    className="ip17-callback-btn"
                    disabled={callbackStatus === 'calling' || callbackDigits.length < 10}
                    onClick={() => makeCallbackCall(callbackDigits)}
                  >
                    {callbackStatus === 'calling' ? (
                      <Loader2 size={16} className="ip17-spin" />
                    ) : callbackStatus === 'success' ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <PhoneOutgoing size={16} />
                    )}
                  </button>
                </div>
                {callbackStatus === 'success' && (
                  <div className="ip17-callback-msg success">Your extension is ringing. Answer to connect.</div>
                )}
              </div>
            )}

            <button
              className="ip17-retry-btn"
              onClick={() => {
                setupDoneRef.current = false;
                scriptLoadedRef.current = false;
                const s = document.getElementById('zadarma-phone-lib');
                if (s) s.remove();
                setWidgetStatus('loading');
                setError('');
                setWidgetLoaded(false);
                setRoute(r => r ? { ...r } : r);
              }}
            >
              <RotateCcw size={14} /> Retry Connection
            </button>
          </>
        )}

        {/* Debug log */}
        <div className="ip17-log-toggle">
          <button onClick={() => setShowLog(!showLog)}>
            {showLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span>Debug log</span>
          </button>
        </div>

        {showLog && (
          <div className="ip17-debug-log">
            {logs.length === 0 ? (
              <div className="ip17-log-line">Waiting...</div>
            ) : logs.map((line, i) => (
              <div key={i} className="ip17-log-line">{line}</div>
            ))}
          </div>
        )}

        {error && !['error'].includes(widgetStatus) && (
          <div className="ip17-error">{error}<button onClick={() => setError('')}>&times;</button></div>
        )}
      </div>
    </aside>
  );
}
