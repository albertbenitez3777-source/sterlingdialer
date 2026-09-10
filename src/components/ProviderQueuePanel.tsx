import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';

type QueueEntry = {
  queue: string;
  count: number;
  items?: Array<{
    id: string;
    consumer_name: string;
    phone: string;
    status: string;
    created_at: string;
  }>;
};

interface ProviderQueuePanelProps {
  providerUrl: string;
  sessionToken: string;
  onUnauthorized: () => void;
}

export function ProviderQueuePanel({ providerUrl, sessionToken, onUnauthorized }: ProviderQueuePanelProps) {
  const [queues, setQueues] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    const result = await authFetch(providerUrl, {
      body: { action: 'get_provider_queues', session_token: sessionToken },
      onUnauthorized,
    });
    if (result.ok && result.data) {
      const d = result.data as Record<string, unknown>;
      setQueues((d.queues || []) as QueueEntry[]);
    }
    setLoading(false);
  }, [providerUrl, sessionToken, onUnauthorized]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const total = queues.reduce((s, q) => s + q.count, 0);

  return (
    <div style={{
      background: 'rgba(15,15,25,0.6)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', cursor: 'pointer',
        }}
        onClick={() => setExpanded(v => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 14, fontWeight: 600 }}>
          <Activity size={16} />
          <span>Provider Queues</span>
          {total > 0 && (
            <span style={{
              background: 'rgba(234,179,8,0.12)', color: '#eab308', fontSize: 11,
              fontWeight: 700, padding: '2px 8px', borderRadius: 99,
            }}>{total}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.4)' }}>
          <button onClick={e => { e.stopPropagation(); setLoading(true); load(); }} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}>
            <RefreshCw size={14} className={loading ? 'ica-spin' : ''} />
          </button>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 14px' }}>
          {queues.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: 16 }}>
              {loading ? 'Loading...' : 'No active queues'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {queues.map(q => (
                <div key={q.queue} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8,
                  fontSize: 13, color: 'rgba(255,255,255,0.7)',
                }}>
                  <span style={{ textTransform: 'capitalize' }}>{q.queue.replace(/_/g, ' ')}</span>
                  <span style={{ fontWeight: 600, color: q.count > 0 ? '#eab308' : 'rgba(255,255,255,0.3)' }}>{q.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
