import { useState, useEffect, useRef } from 'react';
import { X, Play, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Lock } from 'lucide-react';

export interface PreflightCheck {
  key: string;
  label: string;
  value: string;
  passed: boolean;
  detail?: string;
}

export function StartPreflightModal({ open, onClose, checks, onConfirm, starting, error }: {
  open: boolean;
  onClose: () => void;
  checks: PreflightCheck[];
  onConfirm: () => void;
  starting: boolean;
  error: string | null;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [checksVersion, setChecksVersion] = useState(0);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const allPassed = checks.length > 0 && checks.every(c => c.passed);

  useEffect(() => {
    if (open) { setConfirmed(false); setChecksVersion(v => v + 1); }
  }, [open]);

  useEffect(() => {
    if (allPassed && confirmed && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [allPassed, confirmed]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="preflight-title">
      <div className="preflight-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="preflight-header">
          <Play size={24} className="preflight-icon" />
          <h2 id="preflight-title">Start Campaign Preflight</h2>
          <p>Read-only checks run before starting. All gates must pass.</p>
        </div>

        <div className="preflight-checks" key={checksVersion}>
          {checks.length === 0 ? (
            <div className="preflight-loading"><RefreshCw size={16} className="search-spinner" /> Running checks...</div>
          ) : (
            checks.map(c => (
              <div key={c.key} className={`preflight-check-row ${c.passed ? 'pass' : 'fail'}`}>
                <div className="preflight-check-icon">
                  {c.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                </div>
                <div className="preflight-check-text">
                  <strong>{c.label}</strong>
                  <span>{c.value}</span>
                  {c.detail && <em>{c.detail}</em>}
                </div>
              </div>
            ))
          )}
        </div>

        {error && (
          <div className="preflight-error">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <div className="preflight-confirm-area">
          <label className="preflight-checkbox-row">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!allPassed || starting}
              onChange={e => setConfirmed(e.target.checked)}
              aria-label="Confirm all preflight checks passed"
            />
            <span>I confirm all preflight checks have passed and I want to start the campaign.</span>
          </label>
          <button
            ref={confirmRef}
            className="primary-button preflight-confirm-btn"
            disabled={!allPassed || !confirmed || starting}
            onClick={onConfirm}
          >
            {starting ? <><RefreshCw size={14} className="search-spinner" /> Starting...</> : <><Play size={14} /> Start Campaign</>}
          </button>
          {!allPassed && (
            <p className="preflight-locked-hint"><Lock size={11} /> Start is locked until all gates pass.</p>
          )}
        </div>
      </div>
    </div>
  );
}
