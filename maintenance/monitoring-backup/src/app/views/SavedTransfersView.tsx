import { CINEMATIC_HERO,fmtDateTime,initials,SavedTransfer } from "@/app/shared";
import { SectionHero } from "@/app/views/SectionHero";
import { queueToPillVariant,StatusPill } from '@/components';
import { formatPhone } from '@/utils/privacy';
import {
Bookmark,
ChevronDown,
Phone,
Send,
Trash2
} from 'lucide-react';
export function SavedTransfersView({ savedTransfers, loading, onDelete, onPhoneClick, expandedCall, setExpandedCall }: {
  savedTransfers: SavedTransfer[]; loading: boolean;
  onDelete: (id: string) => void;
  onPhoneClick: (name: string, phone: string) => void;
  expandedCall: string | null; setExpandedCall: (id: string | null) => void;
}) {
  if (loading && savedTransfers.length === 0) {
    return <div className="panel"><div className="empty-state">Loading saved transfers...</div></div>;
  }
  if (savedTransfers.length === 0) {
    return <div className="panel"><div className="empty-state">No saved transfers yet. Bookmark contacts from your Call Now list to save them here for later follow-up.</div></div>;
  }
  return (
    <>
      <SectionHero image={CINEMATIC_HERO.agentMomentum} eyebrow="SAVED TRANSFERS" title="Your Saved Transfers" subtitle="These are the transfers you bookmarked for later follow-up." />
      <div className="hero-row">
        <div>
          <div className="eyebrow"><Bookmark size={12} /> SAVED TRANSFERS</div>
          <h2>Saved Transfers</h2>
          <p>These are the transfers you bookmarked for later follow-up. Click a contact to see details, or remove them when you're done.</p>
        </div>
      </div>
      <div className="queue-list">
        {savedTransfers.map(st => {
          const isExpanded = expandedCall === st.id;
          return (
            <div key={st.id} className="queue-card flame-card">
              <div className="queue-card-header" onClick={() => setExpandedCall(isExpanded ? null : st.id)}>
                <div className="queue-card-left">
                  <div className="avatar green">{initials(st.consumer_name)}</div>
                  <div>
                    <strong>{st.consumer_name}</strong>
                    <button className="phone-link" onClick={(event) => { event.stopPropagation(); onPhoneClick(st.consumer_name, st.consumer_phone); }}>
                      <Phone size={11} /> {formatPhone(st.consumer_phone)}
                    </button>
                    <span className="card-address"> · {st.consumer_address || 'No address on file'}</span>
                    <span> · Saved {fmtDateTime(st.created_at)}</span>
                  </div>
                </div>
                <div className="queue-card-right">
                  <button className="quick-elizabeth-btn" onClick={(event) => { event.stopPropagation(); onPhoneClick(st.consumer_name, st.consumer_phone); }} title="Send Elizabeth to call & transfer">
                    <Send size={12} /> <span className="quick-elizabeth-label">ELIZABETH</span>
                  </button>
                  <StatusPill variant={queueToPillVariant(st.original_queue)} />
                  <button className="remove-saved-btn" onClick={(event) => { event.stopPropagation(); onDelete(st.id); }} title="Remove from saved">
                    <Trash2 size={14} />
                  </button>
                  <ChevronDown size={16} className={isExpanded ? 'chevron-up' : ''} />
                </div>
              </div>
              {isExpanded && (
                <div className="queue-card-detail">
                  <div className="detail-row"><span>Address:</span><strong>{st.consumer_address || 'Not on file'}</strong></div>
                  <div className="detail-row"><span>Income:</span><strong>{st.consumer_income_range || 'Not on file'}</strong></div>
                  <div className="detail-row"><span>Home Value:</span><strong>{st.consumer_home_value || 'Not on file'}</strong></div>
                  {st.notes && <div className="detail-section"><div className="detail-label">NOTES</div><p>{st.notes}</p></div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
