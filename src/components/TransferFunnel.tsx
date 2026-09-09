import { useState } from 'react';
import { Check, AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { type FunnelStage } from '@/utils/funnel';

export function TransferFunnel({ stages, exceptions, sideOutcome, exceptionsExplanation }: {
  stages: FunnelStage[];
  exceptions: number;
  sideOutcome: number;
  exceptionsExplanation?: string[];
}) {
  const [showExceptions, setShowExceptions] = useState(false);
  const max = Math.max(stages[0]?.value ?? 1, 1);

  return (
    <div className="funnel-container">
      {stages.map((s, i) => {
        const pct = s.value > 0 ? Math.round((s.value / max) * 100) : 0;
        const prev = i > 0 ? stages[i - 1].value : 0;
        const drop = prev > 0 ? Math.round(((prev - s.value) / prev) * 100) : 0;
        return (
          <div key={s.key} className={`funnel-stage ${s.isHeadline ? 'headline' : ''} ${s.isEstimate ? 'estimate' : ''}`}>
            <div className="funnel-stage-label" title={s.description}>
              {s.isHeadline && <Check size={14} className="funnel-headline-icon" />}
              {s.label}
              <Info size={11} className="funnel-info-icon" />
              {s.isEstimate && <span className="funnel-estimate-tag">EST.</span>}
            </div>
            <div className="funnel-bar-wrap">
              <div className="funnel-bar" style={{ width: `${pct}%`, background: s.color }} />
              <span className="funnel-value">{s.value}</span>
            </div>
            {drop > 0 && <span className="funnel-drop">↓ {drop}% drop</span>}
          </div>
        );
      })}

      {/* Side outcome — Transfer Failed / Unverified */}
      <div className="funnel-side-outcome">
        <div className="funnel-side-label">
          <AlertTriangle size={12} /> Awaiting Answer Confirmation
          <span className="funnel-side-hint">excludes confirmed connections and explicit failures</span>
        </div>
        <span className="funnel-side-value">{sideOutcome}</span>
      </div>

      {/* Data quality exceptions */}
      {exceptions > 0 && (
        <div className="funnel-exceptions">
          <button className="funnel-exceptions-toggle" onClick={() => setShowExceptions(!showExceptions)} aria-expanded={showExceptions}>
            {showExceptions ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <AlertTriangle size={12} /> {exceptions} data quality exception{exceptions !== 1 ? 's' : ''}
          </button>
          {showExceptions && (
            <div className="funnel-exceptions-detail">
              <p className="funnel-exceptions-intro">
                Records with downstream flags (e.g. bridge_confirmed) but missing prerequisite evidence (e.g. no talkroute_answered).
                These are excluded from the funnel above to maintain monotonic integrity.
              </p>
              {exceptionsExplanation && exceptionsExplanation.length > 0 ? (
                <ul className="funnel-exceptions-list">
                  {exceptionsExplanation.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              ) : (
                <p className="funnel-exceptions-list">Detailed breakdown not available for this window.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
