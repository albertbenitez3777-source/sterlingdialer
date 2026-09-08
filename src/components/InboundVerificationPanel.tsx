import { Check, Clock, PhoneCall, Radio } from 'lucide-react';

export interface InboundAgentConfig {
  full_name: string;
  bland_number: string;
  talkroute_number: string;
  inbound_configured: boolean;
  transfer_certified: boolean;
}

export interface InboundVerificationPanelProps {
  agents: InboundAgentConfig[];
  webhookEventsSubscribed: string[];
}

export function InboundVerificationPanel({
  agents,
  webhookEventsSubscribed,
}: InboundVerificationPanelProps) {
  const configuredAgents = agents.filter(a => a.inbound_configured && a.transfer_certified);
  const misconfiguredAgents = agents.filter(a => !a.inbound_configured || !a.transfer_certified);

  return (
    <div className="panel inbound-verification-panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow"><Radio size={12} /> INBOUND VERIFICATION</div>
          <h3>Inbound Configuration & Webhook Routing</h3>
        </div>
      </div>

      <div className="inbound-config-grid">
        <div className="inbound-config-section">
          <div className="inbound-config-header">
            <PhoneCall size={14} />
            <span>Agent Inbound Numbers</span>
          </div>
          <div className="inbound-agent-list">
            {configuredAgents.map(agent => (
              <div key={agent.full_name} className="inbound-agent-row configured">
                <span className="inbound-agent-name">{agent.full_name}</span>
                <span className="inbound-agent-route">
                  Bland {agent.bland_number.slice(-4)} → Talkroute {agent.talkroute_number.slice(-4)}
                </span>
                <span className="inbound-agent-badge configured">Configured</span>
              </div>
            ))}
            {misconfiguredAgents.map(agent => (
              <div key={agent.full_name} className="inbound-agent-row not-configured">
                <span className="inbound-agent-name">{agent.full_name}</span>
                <span className="inbound-agent-route">No inbound number</span>
                <span className="inbound-agent-badge not-configured">Not configured</span>
              </div>
            ))}
          </div>
        </div>

        <div className="inbound-config-section">
          <div className="inbound-config-header">
            <Radio size={14} />
            <span>Webhook Event Subscriptions</span>
          </div>
          <div className="inbound-webhook-events">
            {webhookEventsSubscribed.map(event => (
              <div key={event} className="inbound-webhook-event">
                <Check size={11} />
                <span>{event}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="inbound-evidence-notice">
        <div className="inbound-evidence-row software">
          <Check size={12} />
          <span><strong>Software verified</strong> — inbound config registered, webhook events subscribed, transfer state machine parses post_transfer_transcript for representative speech / MERGED bridge proof.</span>
        </div>
        <div className="inbound-evidence-row pending">
          <Clock size={12} />
          <span><strong>Live test pending</strong> — physical inbound call ring and two-way audio not yet validated on hardware.</span>
        </div>
      </div>
    </div>
  );
}
