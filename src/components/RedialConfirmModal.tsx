import { useState, useEffect, useRef } from 'react';
import { X, Phone, AlertTriangle, RefreshCw, ListChecks } from 'lucide-react';

export const REDIAL_CAP = 25;

export interface RedialPreview {
  sourceCohort: string;
  dateWindow: string;
  eligibleCount: number;
  excludedCount: number;
  excludedReasons: string[];
  cappedCount: number;
}

export function RedialConfirmModal({ open, onClose, preview, onConfirm, dialing, error }: {
  open: boolean;
  onClose: () => void;
  preview: RedialPreview | null;
  onConfirm: () => void;
  dialing: boolean;
  error: string | null;
}) {
  const [step, setStep] = useState(1);
  const [confirmed, setConfirmed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) { setStep(1); setConfirmed(false); }
  }, [open]);

  useEffect(() => {
    if (step === 2 && confirmed && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [step, confirmed]);

  if (!open) return null;

  const canProceed = preview && preview.cappedCount > 0 && preview.cappedCount <= REDIAL_CAP;
  const isCampaignActive = preview?.sourceCohort === 'campaign_active';

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="redial-confirm-title">
      <div className="redial-confirm-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="redial-confirm-header">
          <ListChecks size={24} className="redial-confirm-icon" />
          <h2 id="redial-confirm-title">Re-Dial Confirmation</h2>
        </div>

        {step === 1 && (
          <div className="redial-step">
            <h3>Step 1 — Preview</h3>
            {!preview ? (
              <div className="preflight-loading"><RefreshCw size={16} className="search-spinner" /> Building preview...</div>
            ) : (
              <>
                <div className="redial-preview-grid">
                  <div className="redial-preview-row"><span>Source Cohort:</span><strong>{preview.sourceCohort}</strong></div>
                  <div className="redial-preview-row"><span>Date Window:</span><strong>{preview.dateWindow}</strong></div>
                  <div className="redial-preview-row"><span>Eligible Records:</span><strong>{preview.eligibleCount}</strong></div>
                  <div className="redial-preview-row"><span>Excluded:</span><strong>{preview.excludedCount}</strong></div>
                  <div className="redial-preview-row redial-capped"><span>Will Dial (capped at {REDIAL_CAP}):</span><strong>{preview.cappedCount}</strong></div>
                </div>
                {preview.excludedReasons.length > 0 && (
                  <div className="redial-excluded-reasons">
                    <strong>Exclusion reasons:</strong>
                    <ul>{preview.excludedReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
                {isCampaignActive && (
                  <div className="redial-warning"><AlertTriangle size={14} /> Campaign is active — re-dial is disabled while dialing.</div>
                )}
                {preview.cappedCount === 0 && (
                  <div className="redial-warning"><AlertTriangle size={14} /> Zero eligible records — nothing to dial.</div>
                )}
                <div className="redial-step-actions">
                  <button className="secondary-button" onClick={onClose}>Cancel</button>
                  <button
                    className="primary-button"
                    disabled={!canProceed || isCampaignActive}
                    onClick={() => setStep(2)}
                  >
                    Proceed to Confirmation
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="redial-step">
            <h3>Step 2 — Final Confirmation</h3>
            <div className="redial-final-warning">
              <AlertTriangle size={20} />
              <p>You are about to place <strong>{preview?.cappedCount ?? 0} live call{preview?.cappedCount !== 1 ? 's' : ''}</strong> to {preview?.sourceCohort} contacts.</p>
              <p>This cannot be undone. Each number will be called once.</p>
            </div>
            <label className="preflight-checkbox-row">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={dialing}
                onChange={e => setConfirmed(e.target.checked)}
                aria-label="Confirm re-dial count"
              />
              <span>I understand and want to proceed with dialing {preview?.cappedCount ?? 0} records.</span>
            </label>
            {error && <div className="preflight-error"><AlertTriangle size={14} /> {error}</div>}
            <div className="redial-step-actions">
              <button className="secondary-button" onClick={() => setStep(1)} disabled={dialing}>Back</button>
              <button
                ref={confirmRef}
                className="primary-button redial-confirm-btn"
                disabled={!confirmed || dialing}
                onClick={onConfirm}
              >
                {dialing
                  ? <><RefreshCw size={14} className="search-spinner" /> Dialing...</>
                  : <><Phone size={14} /> Confirm re-dial of {preview?.cappedCount ?? 0}</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
