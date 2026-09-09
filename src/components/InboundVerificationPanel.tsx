import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Radio, RefreshCw } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';
import { currentInboundHealth, inboundRouteProblems, type InboundHealth } from '@/utils/inbound-health';

export interface InboundAgentConfig {
  id: string; full_name: string; bland_number: string; talkroute_number: string;
}
export interface InboundVerificationPanelProps {
  agents: InboundAgentConfig[]; providerUrl: string; sessionToken: string; onUnauthorized: () => void;
}

export function InboundVerificationPanel({ agents, providerUrl, sessionToken, onUnauthorized }: InboundVerificationPanelProps) {
  const [health, setHealth] = useState<InboundHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const checkRoutes = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true); setError(''); setHealth(null);
    const result = await authFetch(providerUrl, {
      body: { action: 'inbound_health', session_token: sessionToken }, onUnauthorized, signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    const checked = result.ok ? currentInboundHealth(result.data) : null;
    setHealth(checked);
    setError(checked ? '' : 'Current route verification is unavailable. Do not rely on saved configuration flags.');
    setLoading(false);
    requestRef.current = null;
  }, [providerUrl, sessionToken, onUnauthorized]);

  useEffect(() => {
    void checkRoutes();
    const interval = setInterval(() => void checkRoutes(), 60000);
    return () => { requestRef.current?.abort(); clearInterval(interval); };
  }, [checkRoutes]);

  return (
    <section className="panel inbound-verification-panel" aria-label="Live inbound and agent readiness">
      <div className="panel-heading">
        <div><div className="eyebrow"><Radio size={12} /> LIVE ROUTE CHECK</div><h3>Inbound routes & agent availability</h3></div>
        <button className="secondary-button" disabled={loading} onClick={() => void checkRoutes()}>
          <RefreshCw size={14} className={loading ? 'search-spinner' : ''} /> {loading ? 'Checking…' : 'Check live routes'}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {error && <p>{error}</p>}
        {health && <p>{health.ready_agent_count} of {health.selected_agent_count} selected agents have campaign phone routes. Browser login is not required for active campaigns.
          {' '}{health.configuration_ready ? 'Selected routes pass the current provider checks.' : 'Selected routes need attention before opening.'}</p>}
        <div className="inbound-agent-list">
          {agents.map(agent => {
            const route = health?.results.find(r => r.agent_id === agent.id);
            const verified = route?.configuration_ready === true;
            const problems = route ? inboundRouteProblems(route) : [];
            return <div key={agent.id} className={'inbound-agent-row live-route-row ' + (verified ? 'configured' : 'not-configured')}>
              <span className="inbound-agent-name">{agent.full_name}</span>
              <span className="inbound-agent-route">{agent.bland_number ? `Bland ${agent.bland_number.slice(-4)}` : 'No inbound line'} → {agent.talkroute_number ? `Talkroute ${agent.talkroute_number.slice(-4)}` : 'No destination'}
                <br />{route ? (route.agent_ready ? 'Selected for campaign phone delivery' : 'Not selected or phone routing incomplete') : 'Availability not verified'}
                {problems.length > 0 && <><br />{problems.join(' · ')}</>}
              </span>
              <span className={'inbound-agent-badge ' + (verified ? 'configured' : 'not-configured')}>
                {verified ? 'Route verified' : route ? 'Needs repair' : loading ? 'Checking' : 'Not verified'}
              </span>
            </div>;
          })}
        </div>
        {health && <p>Provider checked {new Date(health.checked_at).toLocaleTimeString()}. Rechecks every minute; settings can change after a check.</p>}
      </div>
      <div className="inbound-evidence-notice"><div className="inbound-evidence-row pending">
        <Clock size={12} /><span><strong>Staffed phone test still required.</strong> Configuration checks do not prove ringing, pickup or two-way audio. Confirm an answered transfer through each agent's phone before normal volume.</span>
      </div></div>
    </section>
  );
}
