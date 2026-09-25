import { CINEMATIC_HERO,fmtDateTime,initials,PROVIDER_URL,providerFetch,SecretaryCall } from "@/app/shared";
import { SectionHero } from "@/app/views/SectionHero";
import { RecordingPlayer } from '@/components';
import { formatPhone } from '@/utils/privacy';
import {
ChevronDown,
Phone,
RefreshCw,
Send
} from 'lucide-react';
export function SecretaryView({ secretaryCalls, setSecretaryCalls, loadingSecretary, setLoadingSecretary,
  secClientName, setSecClientName, secClientPhone, setSecClientPhone,
  secMode, setSecMode, secCustomMsg, setSecCustomMsg,
  placingSecCall, setPlacingSecCall, expandedSecCall, setExpandedSecCall,
  sessionToken, setNotice, onPhoneClick,
}: {
  secretaryCalls: SecretaryCall[]; setSecretaryCalls: (v: SecretaryCall[]) => void;
  loadingSecretary: boolean; setLoadingSecretary: (v: boolean) => void;
  secClientName: string; setSecClientName: (v: string) => void;
  secClientPhone: string; setSecClientPhone: (v: string) => void;
  secMode: 'reminder' | 'transfer'; setSecMode: (v: 'reminder' | 'transfer') => void;
  secCustomMsg: string; setSecCustomMsg: (v: string) => void;
  placingSecCall: boolean; setPlacingSecCall: (v: boolean) => void;
  expandedSecCall: string | null; setExpandedSecCall: (v: string | null) => void;
  sessionToken: string; setNotice: (v: string) => void;
  onPhoneClick: (name: string, phone: string) => void;
}) {
  const placeCall = async () => {
    if (!secClientName.trim() || !secClientPhone.trim()) {
      setNotice('Enter a name and phone number');
      setTimeout(() => setNotice(''), 3000);
      return;
    }
    if (placingSecCall) return;
    setPlacingSecCall(true); setNotice('');
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'secretary_call', session_token: sessionToken,
          client_name: secClientName, client_phone: secClientPhone,
          mode: secMode, custom_message: secCustomMsg || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice(`Elizabeth's call to ${secClientName} is queued.`);
        setTimeout(() => setNotice(''), 4000);
        setSecClientName(''); setSecClientPhone(''); setSecCustomMsg('');
        const listRes = await providerFetch(PROVIDER_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_secretary_calls', session_token: sessionToken }),
        });
        if (listRes.ok) {
          const listData = await listRes.json();
          setSecretaryCalls(listData.secretary_calls || []);
        }
      } else {
        setNotice(data.error || 'Failed to place call');
        setTimeout(() => setNotice(''), 4000);
      }
    } catch {
      setNotice('Network error — could not reach the server');
      setTimeout(() => setNotice(''), 3000);
    } finally { setPlacingSecCall(false); }
  };

  const refresh = async () => {
    setLoadingSecretary(true);
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_secretary_calls', session_token: sessionToken }),
      });
      if (res.ok) {
        const data = await res.json();
        setSecretaryCalls(data.secretary_calls || []);
      }
    } catch { /* ignore */ }
    finally { setLoadingSecretary(false); }
  };

  const statusColor = (status: string): string => {
    const map: Record<string, string> = {
      pending: '#9bc8dd', dialing: '#9bc8dd', ringing: '#9bc8dd',
      answered: '#41d38d', transferred: '#41d38d', completed: '#41d38d',
      voicemail_left: '#e2bc6d', no_answer: '#a4ada8',
      failed: '#e8623a', dnc_blocked: '#e8623a',
    };
    return map[status] || '#77817a';
  };

  const statusLabel = (status: string): string => {
    const map: Record<string, string> = {
      pending: 'Pending', dialing: 'Dialing...', ringing: 'Ringing...',
      answered: 'Answered', transferred: 'Transferred', completed: 'Completed',
      voicemail_left: 'Voicemail', no_answer: 'No Answer',
      failed: 'Failed', dnc_blocked: 'Contact blocked',
    };
    return map[status] || status;
  };

  return (
    <>
      <SectionHero image={CINEMATIC_HERO.agentMomentum} eyebrow="YOUR SECRETARY" title="Elizabeth" subtitle="Have Elizabeth connect a live caller to your line or deliver a reminder when they answer." />
      <div className="hero-row">
        <div>
          <div className="eyebrow"><Send size={12} /> SECRETARY</div>
          <h2>Elizabeth Will Call for You</h2>
          <p>Give Elizabeth a name and number. She'll call on your behalf, introduce you, and transfer the prospect straight to your Zadarma line.</p>
          <p>Elizabeth also answers callbacks to your assigned inbound number. Keep your Zadarma line ready to answer transfers.</p>
        </div>
        <button className="secondary-button" onClick={refresh}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* New Call Form */}
      <div className="panel secretary-form-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow"><Phone size={12} /> NEW CALL</div>
            <h3>Ask Elizabeth to Call</h3>
          </div>
        </div>
        <div className="secretary-form">
          <div className="secretary-form-row">
            <div className="secretary-field">
              <label>CONTACT NAME</label>
              <input type="text" className="secretary-input" placeholder="John Smith"
                value={secClientName} onChange={e => setSecClientName(e.target.value)} />
            </div>
            <div className="secretary-field">
              <label>PHONE NUMBER</label>
              <input type="tel" className="secretary-input" placeholder="(555) 123-4567"
                value={secClientPhone} onChange={e => setSecClientPhone(e.target.value)} />
            </div>
          </div>
          <div className="secretary-form-row">
            <div className="secretary-field">
              <label>MODE</label>
              <div className="mode-toggle">
                <button className={`mode-btn ${secMode === 'transfer' ? 'active' : ''}`}
                  onClick={() => setSecMode('transfer')}>
                  Transfer to Me
                </button>
                <button className={`mode-btn ${secMode === 'reminder' ? 'active' : ''}`}
                  onClick={() => setSecMode('reminder')}>
                  Reminder Only
                </button>
              </div>
            </div>
          </div>
          <div className="secretary-field">
            <label>CUSTOM MESSAGE <span className="field-hint">(optional — Elizabeth will read this)</span></label>
            <textarea className="secretary-textarea" rows={2} placeholder="e.g. This is a follow-up about the financial review we discussed."
              value={secCustomMsg} onChange={e => setSecCustomMsg(e.target.value)} />
          </div>
          <button className="primary-button secretary-submit" onClick={placeCall} disabled={placingSecCall}>
            {placingSecCall ? <><RefreshCw size={14} className="search-spinner" /> Calling...</> : <><Send size={14} /> Have Elizabeth Call Now</>}
          </button>
        </div>
      </div>

      {/* Call History */}
      <div className="panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow"><Phone size={12} /> CALL HISTORY</div>
            <h3>Secretary Calls</h3>
          </div>
        </div>
        {loadingSecretary && secretaryCalls.length === 0 ? (
          <div className="empty-state">Loading secretary calls...</div>
        ) : secretaryCalls.length === 0 ? (
          <div className="empty-state">No secretary calls yet. Ask Elizabeth to call someone above.</div>
        ) : (
          <div className="queue-list">
            {secretaryCalls.map(call => (
              <div key={call.id} className="queue-card">
                <div className="queue-card-header" onClick={() => setExpandedSecCall(expandedSecCall === call.id ? null : call.id)}>
                  <div className="queue-card-left">
                    <div className="avatar green">{initials(call.client_name)}</div>
                    <div>
                      <strong>{call.client_name}</strong>
                      <button className="phone-link" onClick={(event) => { event.stopPropagation(); onPhoneClick(call.client_name, call.client_phone); }}>
                        <Phone size={11} /> {formatPhone(call.client_phone)}
                      </button>
                      <span> · {fmtDateTime(call.created_at)}</span>
                    </div>
                  </div>
                  <div className="queue-card-right">
                    <span className="queue-badge" style={{ color: statusColor(call.status), borderColor: statusColor(call.status) }}>
                      {statusLabel(call.status)}
                    </span>
                    <ChevronDown size={16} className={expandedSecCall === call.id ? 'chevron-up' : ''} />
                  </div>
                </div>
                {expandedSecCall === call.id && (
                  <div className="queue-card-detail">
                    <div className="contact-detail-grid">
                      <div className="detail-row"><span>Mode:</span><strong>{call.mode === 'transfer' ? 'Transfer' : 'Reminder'}</strong></div>
                      {call.duration_seconds > 0 && <div className="detail-row"><span>Duration:</span><strong>{Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s</strong></div>}
                      {call.transfer_status && <div className="detail-row"><span>Transfer:</span><strong>{call.transfer_status}</strong></div>}
                      {call.transfer_status && call.transfer_status !== 'none' && (
                        <div className="detail-row transfer-truth-label"><span></span><strong className="transfer-truth">Transfer requested — bridge not confirmed. Live test pending.</strong></div>
                      )}
                      {call.error_message && <div className="detail-row"><span>Error:</span><strong>{call.error_message}</strong></div>}
                    </div>
                    {call.custom_message && (
                      <div className="detail-section">
                        <div className="detail-label">CUSTOM MESSAGE</div>
                        <p>{call.custom_message}</p>
                      </div>
                    )}
                    {call.ai_summary && (
                      <div className="detail-section">
                        <div className="detail-label">AI SUMMARY</div>
                        <p>{call.ai_summary}</p>
                      </div>
                    )}
                    {call.transcript && (
                      <div className="detail-section">
                        <div className="detail-label">TRANSCRIPT</div>
                        <div className="transcript-text">{call.transcript}</div>
                      </div>
                    )}
                    {/* Recording recovery accepts calls-table IDs, not secretary_calls IDs. */}
                    <RecordingPlayer url={call.recording_url} callId={call.id} recordingSource="secretary_calls" sessionToken={sessionToken} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
