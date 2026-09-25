import { CINEMATIC_HERO,ContactResult,fmtDateTime,fmtDuration,initials,queueLabel } from "@/app/shared";
import { SectionHero } from "@/app/views/SectionHero";
import { queueToPillVariant,RecordingPlayer,StatusPill } from '@/components';
import { contactEmails,contactFieldText } from '@/utils/contact-search';
import { formatPhone } from '@/utils/privacy';
import { useContactSearch } from '@/utils/useContactSearch';
import {
ChevronDown,
FileText,
Phone,
RefreshCw,Search,
X
} from 'lucide-react';
export function ContactsView({ searchQuery, searchResults, searching, searchError, searchTotal, hasMore,
  onSearchChange, onSearchKeyDown, loadMore, expandedContact, setExpandedContact, sessionToken, onPhoneClick, onUnauthorized, onNavTo, onExtraInfo,
}: ReturnType<typeof useContactSearch<ContactResult>> & {
  expandedContact: string | null; setExpandedContact: (v: string | null) => void;
  sessionToken: string; onPhoneClick: (name: string, phone: string, email?: string, address?: string) => void;
  onUnauthorized: () => void; onNavTo?: (tab: string) => void;
  onExtraInfo?: (prefill: { name?: string; phone?: string; address?: string; email?: string }) => void;

}) {
  return (
    <>
      <SectionHero image={CINEMATIC_HERO.commandCenter} eyebrow="CLIENT SEARCH" title="Find a Client" subtitle="Find saved clients, then search public sources for more possible information." />

      <div className="extra-info-banner">
        <div className="extra-info-banner-text">
          <strong>Extra client information</strong>
          <span>Paste name, phone, address — no file search needed</span>
        </div>
        <button className="extra-info-banner-btn" onClick={() => onNavTo?.('extra')}><FileText size={14} /> Open Extra Info</button>
      </div>
      <div className="hero-row">
        <div>
          <div className="eyebrow"><Search size={12} /> ALL CLIENTS</div>
          <h2>Who are you looking for?</h2>
          <p>Search, open a client, then choose Elizabeth, Zadarma, or Find More Information.</p>
        </div>
      </div>

      <div className="sourceview-intro">
        <div className="sourceview-intro-icon"><Search size={21} /></div>
        <div><small>SOURCEVIEW</small><strong>Find more information in one click</strong><p>Open a client to review saved information and optional external search links.</p></div>
        <span>ONE CLICK</span>
      </div>

      <div className="panel search-panel">
        <div className="search-bar-wrap">
          <Search size={20} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Type a name, phone, address, or email…"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            autoFocus
          />
          {searching && <RefreshCw size={18} className="search-spinner" />}
          {searchQuery && !searching && (
            <button className="search-clear" onClick={() => onSearchChange('')} aria-label="Clear contact search">
              <X size={16} />
            </button>
          )}
        </div>
        {searchQuery && (
          <div className="search-meta">
            {searching ? 'Searching...' : searchError ? 'Search failed — try again' : `${searchResults.length} of ${searchTotal} contact${searchTotal !== 1 ? 's' : ''}`}
          </div>
        )}
      </div>

      {searchResults.length > 0 && (
        <div className="queue-list">
          {searchResults.map(contact => (
            <div key={contact.id} className="queue-card">
              <div className="queue-card-header" onClick={() => setExpandedContact(expandedContact === contact.id ? null : contact.id)}>
                <div className="queue-card-left">
                  <div className="avatar green">{initials(contact.consumer_name || '?')}</div>
                  <div>
                    <button className="contact-name-link" onClick={(event) => {
                      event.stopPropagation();
                      onPhoneClick(contact.consumer_name || 'Contact', contact.phone_normalized || contact.phone, contactEmails(contact)[0], contact.address);
                    }}>{contact.consumer_name || 'Unknown'}</button>
                    {(contact.phone_normalized || contact.phone) ? (
                      <button className="phone-link" onClick={(event) => { event.stopPropagation(); onPhoneClick(contact.consumer_name || 'Contact', contact.phone_normalized || contact.phone, contactEmails(contact)[0], contact.address); }}>
                        <Phone size={11} /> {formatPhone(contact.phone || contact.phone_normalized)}
                      </button>
                    ) : <span className="card-address">No phone on file</span>}
                    {contactEmails(contact).length > 0 && (
                      <span className="card-address" style={{ color: '#6db8d4' }}> · {contactEmails(contact).join(', ')}</span>
                    )}
                    {contact.address && <span className="card-address"> · {contact.address}</span>}
                  </div>
                </div>
                <div className="queue-card-right">
                  {contact.is_priority && (
                    <span className="queue-badge" style={{ color: '#e2bc6d', borderColor: '#e2bc6d' }}>
                      PRIORITY
                    </span>
                  )}
                  {contact.call_queue && (
                    <StatusPill variant={queueToPillVariant(contact.call_queue || 'no_answer')}>
                      {queueLabel(contact.call_queue)}
                    </StatusPill>
                  )}
                  {contact.lead_status && (
                    <span className="queue-badge" style={{ color: '#9bc8dd', borderColor: '#9bc8dd' }}>
                      LEAD · {contact.lead_status.toUpperCase()}
                    </span>
                  )}
                  <ChevronDown size={16} className={expandedContact === contact.id ? 'chevron-up' : ''} />
                </div>
              </div>
              {expandedContact === contact.id && (
                <div className="queue-card-detail">
                  <div className="contact-detail-grid">
                    <div className="detail-row"><span>Name:</span><strong>{contact.consumer_name || 'Unknown'}</strong></div>
                    <div className="detail-row"><span>Phone:</span><strong>{(contact.phone || contact.phone_normalized) ? formatPhone(contact.phone || contact.phone_normalized) : 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Address:</span><strong>{contact.address || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Income Range:</span><strong>{contact.income_range || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Home Value:</span><strong>{contact.home_value || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Property Info:</span><strong>{contact.property_information || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Lead Source:</span><strong>{contact.lead_source || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Lead Status:</span><strong>{contact.lead_status ? contact.lead_status.toUpperCase() : 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Priority Lead:</span><strong>{contact.is_priority ? 'Yes' : 'No'}</strong></div>
                    {contact.original_agent_information && <div className="detail-row"><span>Original Agent Info:</span><strong>{contact.original_agent_information}</strong></div>}
                    {contactEmails(contact).length > 0 && (
                      <div className="detail-row"><span>Email:</span><strong>{contactEmails(contact).join(', ')}</strong></div>
                    )}
                  </div>
                  {contact.custom_fields && Object.keys(contact.custom_fields).length > 0 && (
                    <div className="detail-section">
                      <div className="detail-label">ADDITIONAL CONTACT INFORMATION</div>
                      <div className="contact-detail-grid">
                        {Object.entries(contact.custom_fields).filter(([, value]) => value != null && value !== '').map(([key, value]) => (
                          <div className="detail-row" key={key}><span>{key.replace(/_/g, ' ')}:</span><strong style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{contactFieldText(value)}</strong></div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="contact-detail-grid" style={{ marginTop: 12 }}>
                    <div className="detail-row"><span>Total Calls Made:</span><strong>{contact.total_call_count}</strong></div>
                    {contact.agent_name && <div className="detail-row"><span>Last Agent:</span><strong>{contact.agent_name}</strong></div>}
                    {contact.last_call_time && <div className="detail-row"><span>Last Call:</span><strong>{fmtDateTime(contact.last_call_time)}</strong></div>}
                    {contact.duration_seconds != null && contact.duration_seconds > 0 && <div className="detail-row"><span>Call Duration:</span><strong>{fmtDuration(contact.duration_seconds)}</strong></div>}
                    {contact.call_queue && <div className="detail-row"><span>Call Queue:</span><strong>{queueLabel(contact.call_queue)}</strong></div>}
                    {contact.call_disposition && <div className="detail-row"><span>Disposition:</span><strong>{contact.call_disposition}</strong></div>}
                    {contact.agent_disposition && <div className="detail-row"><span>Agent Disposition:</span><strong>{contact.agent_disposition}</strong></div>}
                    {contact.transfer_status && contact.transfer_status !== 'none' && <div className="detail-row"><span>Transfer Status:</span><strong>{contact.transfer_status}</strong></div>}
                    {contact.is_completed != null && <div className="detail-row"><span>Call Completed:</span><strong>{contact.is_completed ? 'Yes' : 'No'}</strong></div>}
                    {contact.callback_requested && <div className="detail-row"><span>Callback Requested:</span><strong>Yes</strong></div>}
                    {contact.is_wrong_number && <div className="detail-row"><span>Wrong Number:</span><strong>Yes</strong></div>}
                    {contact.created_at && <div className="detail-row"><span>Lead Added:</span><strong>{fmtDateTime(contact.created_at)}</strong></div>}
                  </div>
                  {contact.ai_summary && (
                    <div className="detail-section">
                      <div className="detail-label">AI SUMMARY</div>
                      <p>{contact.ai_summary}</p>
                    </div>
                  )}
                  {contact.agent_notes && contact.agent_notes.trim() && (
                    <div className="detail-section">
                      <div className="detail-label">AGENT NOTES</div>
                      <p>{contact.agent_notes}</p>
                    </div>
                  )}
                  {contact.notes && contact.notes.trim() && (
                    <div className="detail-section">
                      <div className="detail-label">LEAD NOTES</div>
                      <p>{contact.notes}</p>
                    </div>
                  )}
                  {contact.transcript && (
                    <div className="detail-section">
                      <div className="detail-label">CALL TRANSCRIPT</div>
                      <div className="transcript-text">{contact.transcript}</div>
                    </div>
                  )}
                  {(contact.phone || contact.phone_normalized) && (
                    <button className="contact-intelligence-action" onClick={() => onPhoneClick(contact.consumer_name || 'Contact', contact.phone_normalized || contact.phone, contactEmails(contact)[0], contact.address)}>
                      <Search size={16} /><span><strong>Open Client</strong><small>Elizabeth · Zadarma · Find More Information</small></span><ChevronDown size={15} />
                    </button>
                  )}
                  <button className="contact-intelligence-action extra-info-card-btn" onClick={() => { onExtraInfo?.({ name: contact.consumer_name || '', phone: contact.phone_normalized || contact.phone || '', address: contact.address || '', email: contactEmails(contact)[0] || '' }); }}>
                    <FileText size={16} /><span><strong>Extra Info</strong><small>That's Them · People Search · Save findings</small></span><ChevronDown size={15} />
                  </button>
                  <RecordingPlayer url={contact.recording_url} callId={contact.source === 'call' ? contact.id : undefined} sessionToken={sessionToken} onUnauthorized={onUnauthorized} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {hasMore && !searching && searchResults.length > 0 && (
        <div className="load-more-wrap">
          <button className="secondary-button load-more-btn" onClick={loadMore}>
            Load More Contacts
          </button>
        </div>
      )}

      {searchQuery && !searching && searchResults.length === 0 && !searchError && (
        <div className="panel">
          <div className="empty-state">No contacts found matching "{searchQuery}". Try a different name, phone number, email, or address.</div>
        </div>
      )}

      {searchError && !searching && (
        <div className="panel">
          <div className="empty-state error-banner">Search failed. Check your connection and try again. If the problem persists, your session may have expired.</div>
        </div>
      )}

      {!searchQuery && (
        <div className="panel">
          <div className="empty-state">Start typing a name, phone number, email, address, or another saved detail to search all contacts.</div>
        </div>
      )}
    </>
  );
}
