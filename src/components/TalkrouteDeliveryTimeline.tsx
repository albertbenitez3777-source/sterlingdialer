import { Check, Clock, Phone, PhoneOff, ArrowRight, Radio } from 'lucide-react';

export interface TalkrouteDeliveryTimelineProps {
  transferRequested: number;
  destinationDialed: number;
  agentAnswered: number;
  bridgeConfirmed: number;
  failedCount: number;
  failedReasons: string[];
  unverifiedCount: number;
}

type StageState = 'confirmed' | 'pending' | 'failed' | 'idle';

function stageState(value: number): StageState {
  return value > 0 ? 'confirmed' : 'idle';
}

export function TalkrouteDeliveryTimeline({
  transferRequested,
  destinationDialed,
  agentAnswered,
  bridgeConfirmed,
  failedCount,
  failedReasons,
  unverifiedCount,
}: TalkrouteDeliveryTimelineProps) {
  const stages = [
    { label: 'Transfer Requested', value: transferRequested, icon: Radio, state: stageState(transferRequested) },
    { label: 'Destination Dialed', value: destinationDialed, icon: ArrowRight, state: stageState(destinationDialed) },
    { label: 'Agent Answered', value: agentAnswered, icon: Phone, state: stageState(agentAnswered) },
    { label: 'Bridge Confirmed', value: bridgeConfirmed, icon: Check, state: stageState(bridgeConfirmed) },
  ];

  const hasFailures = failedCount > 0;
  const hasUnverified = unverifiedCount > 0;
  const allVerified = !hasFailures && !hasUnverified && transferRequested > 0 &&
    bridgeConfirmed === transferRequested;

  return (
    <div className="panel delivery-timeline-panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow"><Radio size={12} /> TALKROUTE DELIVERY</div>
          <h3>Transfer Verification Timeline</h3>
        </div>
      </div>

      <div className="delivery-timeline-track">
        {stages.map((stage, i) => {
          const Icon = stage.icon;
          const isLast = i === stages.length - 1;
          return (
            <div key={stage.label} className="delivery-stage-wrapper">
              <div className={`delivery-stage ${stage.state}`}>
                <div className="delivery-stage-icon">
                  <Icon size={16} />
                </div>
                <div className="delivery-stage-info">
                  <span className="delivery-stage-label">{stage.label}</span>
                  <span className="delivery-stage-value">{stage.value}</span>
                </div>
              </div>
              {!isLast && <div className="delivery-stage-connector" />}
            </div>
          );
        })}
      </div>

      <div className="delivery-timeline-footer">
        {hasFailures && (
          <div className="delivery-failures">
            <div className="delivery-failures-header">
              <PhoneOff size={14} />
              <span>{failedCount} confirmed transfer failure{failedCount !== 1 ? 's' : ''}</span>
            </div>
            {failedReasons.length > 0 && (
              <div className="delivery-failure-reasons">
                {failedReasons.slice(0, 5).map((reason, i) => (
                  <div key={i} className="delivery-failure-reason">{reason}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {hasUnverified && (
          <div className="delivery-unverified">
            <Clock size={14} />
            <span>{unverifiedCount} transfer request{unverifiedCount !== 1 ? 's' : ''} awaiting answer confirmation</span>
          </div>
        )}
        {allVerified && (
          <div className="delivery-all-verified">
            <Check size={14} />
            <span>All requested transfers have provider-confirmed agent connections</span>
          </div>
        )}
      </div>

      <div className="delivery-evidence-notice">
        <div className="delivery-evidence-icon"><Check size={12} /></div>
        <div className="delivery-evidence-text">
          <strong>{bridgeConfirmed > 0 ? 'Agent connection evidence received' : 'Agent connection evidence pending'}</strong> — a transfer request or dialed destination alone does not confirm that an agent answered.
          <span className="delivery-live-test-pending">
            <Clock size={11} /> Live test pending: physical device ring and two-way audio not yet validated on hardware.
          </span>
        </div>
      </div>
    </div>
  );
}
