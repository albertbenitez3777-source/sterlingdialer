import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';

type ProviderHealth = {
  checked_at: string; account_http_status: number; account_status: string | null;
  balance: number | null; queue_http_status: number; queued: number | null;
  in_progress: number | null; oldest_queued_at: string | null;
};

export function ProviderQueuePanel({ providerUrl, sessionToken, onUnauthorized }: {
  providerUrl: string; sessionToken: string; onUnauthorized: () => void;
}) {
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const checkQueue = async () => {
    if (loading) return;
    setLoading(true); setError('');
    try {
      const result = await authFetch<ProviderHealth>(providerUrl, {
        body: { action: 'provider_queue_health', session_token: sessionToken }, onUnauthorized,
      });
      if (result.ok && result.data) setHealth(result.data);
      else { setHealth(null); setError('Could not check the provider queue. Please try again.'); }
    } catch { setHealth(null); setError('Could not reach the provider. Please try again.'); }
    finally { setLoading(false); }
  };
  return (
    <section className="panel" aria-label="Provider queue">
      <div className="panel-heading">
        <div><h3>Provider queue</h3><p>Check whether Bland has started the submitted calls.</p></div>
        <button className="secondary-button" onClick={checkQueue} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'search-spinner' : ''} />
          {loading ? 'Checking...' : 'Check provider queue'}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {error && <p>{error}</p>}
        {health && <>
          <div className="contact-detail-grid">
            <div className="detail-row"><span>Waiting at Bland:</span><strong>{health.queued ?? 'Unavailable'}</strong></div>
            <div className="detail-row"><span>Calls in progress:</span><strong>{health.in_progress ?? 'Unavailable'}</strong></div>
            <div className="detail-row"><span>Account status:</span><strong>{health.account_status ?? 'Unavailable'}</strong></div>
            <div className="detail-row"><span>Provider balance:</span><strong>{health.balance == null ? 'Unavailable' : '$' + Number(health.balance).toFixed(2)}</strong></div>
          </div>
          {health.oldest_queued_at && <p>Oldest queued call: {new Date(health.oldest_queued_at).toLocaleString()}</p>}
          {(health.queued ?? 0) > 0 && health.in_progress === 0 && <p>Bland has queued calls but none are in progress. Check the account queue and service status in Bland.</p>}
          {health.queue_http_status !== 200 && <p>The provider queue is temporarily unavailable.</p>}
          <p>Checked {new Date(health.checked_at).toLocaleTimeString()}</p>
        </>}
      </div>
    </section>
  );
}
