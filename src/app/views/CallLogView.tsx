import { CINEMATIC_HERO,PROVIDER_URL,QueueRecord } from "@/app/shared";
import { CallList } from "@/app/views/CallList";
import { SectionHero } from "@/app/views/SectionHero";
import { authFetch } from '@/utils/auth-fetch';
import {
Download,
Phone,
RefreshCw,
WifiOff
} from 'lucide-react';
import { useEffect,useState } from 'react';
export function CallLogView({ expandedCall, setExpandedCall, sessionToken, onUnauthorized }: {
  expandedCall: string | null; setExpandedCall: (id: string | null) => void;
  sessionToken: string;
  onUnauthorized: () => void;
}) {
  const [allCalls, setAllCalls] = useState<QueueRecord[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [callLogError, setCallLogError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [agentFilter] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    let mounted = true;
    setOffset(0);
    const loadCalls = async () => {
      setLoadingAll(true);
      setCallLogError(null);
      try {
        const result = await authFetch(PROVIDER_URL, {
          body: {
            action: 'get_call_log', session_token: sessionToken,
            outcome: filter, agent_id: agentFilter !== 'all' ? agentFilter : undefined,
            limit: PAGE_SIZE, offset: 0,
          },
          onUnauthorized,
        });
        if (!mounted) return;
        if (result.ok && result.data) {
          const d = result.data as Record<string, unknown>;
          setAllCalls((d.records || []) as QueueRecord[]);
          setHasMore(!!d.has_more);
          setTotal((d.total as number) || ((d.records as unknown[]) || []).length);
        } else {
          if (!result.loggedOut) setCallLogError(result.error || `HTTP ${result.status}`);
          setAllCalls([]);
        }
      } catch {
        if (!mounted) return;
        setCallLogError('Unexpected error');
        setAllCalls([]);
      } finally {
        if (mounted) setLoadingAll(false);
      }
    };
    loadCalls();
    return () => { mounted = false; };
  }, [sessionToken, filter, agentFilter, onUnauthorized]);

  const loadMore = async () => {
    const nextOffset = offset + PAGE_SIZE;
    setLoadingAll(true);
    setCallLogError(null);
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: {
          action: 'get_call_log', session_token: sessionToken,
          outcome: filter, agent_id: agentFilter !== 'all' ? agentFilter : undefined,
          limit: PAGE_SIZE, offset: nextOffset,
        },
        onUnauthorized,
      });
      if (result.ok && result.data) {
        const d = result.data as Record<string, unknown>;
        setAllCalls(prev => [...prev, ...((d.records || []) as QueueRecord[])]);
        setHasMore(!!d.has_more);
        setTotal((d.total as number) || 0);
        setOffset(nextOffset);
      } else {
        if (!result.loggedOut) setCallLogError(result.error || `HTTP ${result.status}`);
      }
    } catch {
      setCallLogError('Unexpected error');
    } finally {
      setLoadingAll(false);
    }
  };

  return (
    <>
      <SectionHero image={CINEMATIC_HERO.commandCenter} eyebrow="CALL HISTORY" title="Call History — Every Connection" subtitle="Every call the dialer has placed, with full transcripts, recordings, and transfer status." />
      <div className="hero-row">
        <div>
          <div className="eyebrow"><Phone size={12} /> CALL HISTORY</div>
          <h2>Call History</h2>
          <p>Every call across all outcomes — transfers, drops, no-answers, and voicemails. Newest first.</p>
        </div>
        <div className="hero-actions">
          <select className="filter-select" value={filter} onChange={e => { setFilter(e.target.value); }}>
            <option value="all">All Calls</option>
            <option value="transfer_requested">Transfer Requests</option>
            <option value="fire_transfer">Transferred</option>
            <option value="human_drop">Dropped</option>
            <option value="no_answer">No Answer</option>
            <option value="voice_message">Voicemail</option>
            <option value="pending">Dialing</option>
          </select>
        </div>
      </div>
      {callLogError && (
        <div className="data-health-banner degraded" style={{ marginBottom: 12 }}>
          <WifiOff size={14} /> Failed to load call history: {callLogError}
        </div>
      )}
      <CallList records={allCalls} loading={loadingAll}
        sessionToken={sessionToken} onUnauthorized={onUnauthorized}
        expandedCall={expandedCall} setExpandedCall={setExpandedCall} onPhoneClick={() => {}}
        emptyText={callLogError ? 'Could not load calls — see error above.' : 'No calls match this filter.'} />
      {hasMore && (
        <div style={{ textAlign: 'center', margin: '16px 0' }}>
          <button className="secondary-button" onClick={loadMore} disabled={loadingAll}>
            {loadingAll ? <RefreshCw size={14} className="search-spinner" /> : <Download size={14} />} Load More
          </button>
        </div>
      )}
      {!loadingAll && allCalls.length > 0 && (
        <div style={{ textAlign: 'center', color: 'var(--steel-400)', fontSize: 12, marginBottom: 16 }}>
          Showing {allCalls.length} of {total} calls
        </div>
      )}
    </>
  );
}
