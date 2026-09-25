import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, Bookmark, Check, ChevronDown, ChevronRight, CircleHelp, Clock, Download, FileText, FileUp, Flame, Inbox, LayoutDashboard, LogOut,
  Menu, Pause, Phone, PhoneOff, Play, RefreshCw, Search, Send, Square, Trash2, Upload, Users, WifiOff, X, Zap,
} from 'lucide-react';
import { GlassCard, GlowButton, StatusPill, PinInput, Reveal, AdminCharts, queueToPillVariant, TransferFunnel, RedialConfirmModal, InboundVerificationPanel, AgentCockpit, RecordingPlayer, OpportunitiesFeed, IncomingTransferPanel, AgentWorkspaceView, REDIAL_CAP, type RedialPreview, type ActiveTransfer, IncomingCallAlert, type TransferAlert, AgentInbox, OwnerAlertOverview } from '@/components';
import { maskPhone, formatPhone } from '@/utils/privacy';
import { useHeartbeat, type AttendanceInfo as HeartbeatAttendance } from '@/utils/useHeartbeat';
import { fmtAttendanceDuration, presenceLabel, presenceColor } from '@/utils/attendance';
import { buildMonotonicFunnel, capAgentMonotonic, type FunnelData } from '@/utils/funnel';
import { transferMetricsForWindow, type TransferMetricSummary } from '@/utils/transfer-metrics';
import { authFetch } from '@/utils/auth-fetch';
import { contactEmails, contactFieldText } from '@/utils/contact-search';
import { useContactSearch } from '@/utils/useContactSearch';
import { WhatsUp } from '@/components/WhatsUp';
import { IPhone } from '@/components/IPhone';
import { requestPhoneDial } from '@/phone/dial-request';
import { DialerControls } from '@/components/DialerControls';
import { OperationsDashboard } from '@/components/OperationsDashboard';
import { TestCallPanel } from '@/components/TestCallPanel';
import { ExtraInfo } from '@/components/ExtraInfo';
import CameraWidget from '@/components/CameraWidget';
import type { AgentTodayStats } from '@/components/AgentCockpit';
import { ShieldCheck, Settings } from 'lucide-react';
import { MatrixField } from '@/components/MatrixField';
import { AgentRole,SessionAgent,SessionData,QueueRecord,AdminAgentRow,FunnelStats,ErrorEntry,CampaignSummary,AdminStats,TeamHealth,DataHealth,RosterAttendanceRow,LeadPool,SecretaryCall,ContactResult,SourceFinding,SavedTransfer,fmtDuration,SUPABASE_URL,FUNCTIONS_BASE,AUTH_URL,PROVIDER_URL,DIALER_CONTROLS_URL,FEDERAL_ONE_V2_URL,TZ,CINEMATIC_HERO,fmtTime,fmtDateTime,getETTime,initials,queueLabel,LoginErrorKind,classifyFetchError,loginErrorMessage,fetchWithRetry,providerFetch } from "@/app/shared";
import { SkeletonCard } from "@/app/views/SkeletonCard";
import { SectionHero } from "@/app/views/SectionHero";
import { DataHealthBanner } from "@/app/views/DataHealthBanner";
import { CallList } from "@/app/views/CallList";
import { SavedTransfersView } from "@/app/views/SavedTransfersView";
import { AdminSavedTransfersView } from "@/app/views/AdminSavedTransfersView";
import { CallLogView } from "@/app/views/CallLogView";
import { ContactsView } from "@/app/views/ContactsView";
import { SecretaryView } from "@/app/views/SecretaryView";
import { ReportedMetrics } from "@/app/views/ReportedMetrics";
export function PhoneActionModal({ name, phone, email = '', address = '', canCall, onClose, onSecretaryCall, placingSecretaryCall, providerUrl, sessionToken, onUnauthorized }: {
  name: string; phone: string; email?: string; address?: string; canCall: boolean; onClose: () => void;
  onSecretaryCall: () => void; placingSecretaryCall: boolean;
  providerUrl: string; sessionToken: string; onUnauthorized: () => void;
}) {
  const [directDialStatus, setDirectDialStatus] = useState<'idle' | 'pending' | 'requested' | 'failed'>('idle');
  const [directDialError, setDirectDialError] = useState('');
  const directDialRef = useRef<AbortController | null>(null);
  const [directCallId, setDirectCallId] = useState('');
  const [directCallSaved, setDirectCallSaved] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(true);
  const [findingNotice, setFindingNotice] = useState('');
  const [startingSearch, setStartingSearch] = useState(false);
  const [researchSources, setResearchSources] = useState<Array<{ id: string; name: string; group: string; url: string }>>([]);
  const [knownProfile, setKnownProfile] = useState<{ emails: string[]; phones: string[]; addresses: string[]; associates: string[]; records_checked: number } | null>(null);
  const [sourceFindings, setSourceFindings] = useState<SourceFinding[]>([]);
  const [loadingFindings, setLoadingFindings] = useState(false);
  const autoSearchStarted = useRef(false);
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  const display = last10.length === 10 ? `(${last10.slice(0,3)}) ${last10.slice(3,6)}-${last10.slice(6)}` : phone;

  useEffect(() => () => { directDialRef.current?.abort(); }, [sessionToken, phone]);

  const handleZadarma = async () => {
    if (directDialRef.current && !directDialRef.current.signal.aborted) return;
    const abort = new AbortController();
    directDialRef.current = abort;
    setDirectDialStatus('pending'); setDirectDialError(''); setDirectCallId(''); setDirectCallSaved(false);
    const dialResult = await requestPhoneDial(phone, { signal: abort.signal });
    if (abort.signal.aborted) return;
    if (dialResult.status !== 'requested') {
      setDirectDialStatus('failed'); setDirectDialError(dialResult.error || 'The phone could not accept the call.');
      directDialRef.current = null;
      return;
    }
    setDirectDialStatus('requested');
    const result = await authFetch<{ direct_call: { id: string } }>(providerUrl, {
      body: { action: 'log_direct_call', session_token: sessionToken, client_name: name, client_phone: phone },
      onUnauthorized, signal: abort.signal,
    });
    if (abort.signal.aborted) return;
    if (result.ok && result.data?.direct_call?.id) setDirectCallId(result.data.direct_call.id);
    else setDirectDialError('Dial requested, but the call log could not be saved. Check the phone before trying again.');
    directDialRef.current = null;
  };

  const saveDirectOutcome = async (outcome: string) => {
    if (!directCallId) return;
    const result = await authFetch(providerUrl, {
      body: { action: 'complete_direct_call', session_token: sessionToken, direct_call_id: directCallId, outcome },
      onUnauthorized,
    });
    if (result.ok) setDirectCallSaved(true);
  };

  useEffect(() => {
    void authFetch(providerUrl, {
      body: { action: 'set_active_client', session_token: sessionToken, client_name: name, client_phone: phone },
      onUnauthorized,
    });
  }, [providerUrl, sessionToken, name, phone, onUnauthorized]);

  useEffect(() => {
    if (!sourceOpen) return;
    let cancelled = false;
    setLoadingFindings(true);
    authFetch<{ findings: SourceFinding[] }>(providerUrl, {
      body: { action: 'get_source_findings', session_token: sessionToken, client_name: name, client_phone: phone },
      onUnauthorized,
    }).then(result => {
      if (cancelled) return;
      if (result.ok && result.data) setSourceFindings(result.data.findings || []);
      else setFindingNotice(result.error || 'Saved results could not be loaded.');
    }).finally(() => { if (!cancelled) setLoadingFindings(false); });
    return () => { cancelled = true; };
  }, [sourceOpen, providerUrl, sessionToken, name, phone, onUnauthorized]);

  useEffect(() => {
    if (autoSearchStarted.current) return;
    autoSearchStarted.current = true;
    setStartingSearch(true);
    setFindingNotice('Searching saved records and preparing source links…');
    void authFetch<{ research: { sources: Array<{ id: string; name: string; group: string; url: string }>; known?: { emails: string[]; phones: string[]; addresses: string[]; associates: string[]; records_checked: number } } }>(providerUrl, {
      body: {
        action: 'start_source_search', session_token: sessionToken,
        client_name: name, client_phone: phone, client_email: email, client_address: address,
      },
      onUnauthorized,
    }).then(result => {
      const sources = result.data?.research?.sources || [];
      if (result.ok && sources.length) {
        setResearchSources(sources);
        if (result.data?.research?.known) setKnownProfile(result.data.research.known);
        setFindingNotice(`${sources.length} public searches are ready. Federal One also checked its own saved records.`);
      } else {
        setFindingNotice(result.error || 'Additional sources could not be prepared.');
      }
    }).finally(() => setStartingSearch(false));
  }, [providerUrl, sessionToken, name, phone, email, address, onUnauthorized]);

  const startEverywhereSearch = async () => {
    if (startingSearch) return;

    setStartingSearch(true);
    setFindingNotice('Preparing source links…');
    const result = await authFetch<{ research: { sources: Array<{ id: string; name: string; group: string; url: string }>; known?: { emails: string[]; phones: string[]; addresses: string[]; associates: string[]; records_checked: number } } }>(providerUrl, {
      body: {
        action: 'start_source_search', session_token: sessionToken,
        client_name: name, client_phone: phone, client_email: email, client_address: address,
      },
      onUnauthorized,
    });
    const sources = result.data?.research?.sources || [];
    if (result.ok && sources.length) {
      setResearchSources(sources);
      if (result.data?.research?.known) setKnownProfile(result.data.research.known);
      setFindingNotice(`${sources.length} public searches are ready. Use the source links below to open a search yourself. These are search links, not verified findings.`);

    } else {

      setFindingNotice(result.error || 'Search could not be prepared.');
    }
    setStartingSearch(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="phone-action-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="phone-action-header">
          <div className="phone-action-avatar">{initials(name || '?')}</div>
          <div>
            <strong>{name || 'Unknown'}</strong>
            <span>{display}</span>
          </div>
        </div>
        <div className="phone-action-options">
          {canCall && <button className="phone-action-option" onClick={onSecretaryCall} disabled={placingSecretaryCall}>
            <div className="phone-action-icon secretary-icon"><Send size={22} /></div>
            <div className="phone-action-text">
              <strong>Send Elizabeth</strong>
              <span>Secretary calls &amp; transfers to you</span>
            </div>
            {placingSecretaryCall && <RefreshCw size={16} className="search-spinner" />}
          </button>}
          {canCall && <button className="phone-action-option" onClick={() => void handleZadarma()} disabled={directDialStatus === 'pending'}>
            <div className="phone-action-icon talkroute-icon"><Phone size={22} /></div>
            <div className="phone-action-text">
              <strong>Call with my phone</strong>
              <span>{directDialStatus === 'pending' ? 'Waiting for your phone…' : directDialStatus === 'requested' ? 'Dial requested · check your phone for ringing or errors' : 'Call this client through your Zadarma line'}</span>
            </div>
            {directDialStatus === 'pending' && <RefreshCw size={16} className="search-spinner" />}
          </button>}
          {directDialError && <p role="alert" className="sourceview-notice">{directDialError}</p>}
          <button className="phone-action-option" onClick={() => { setSourceOpen(true); void startEverywhereSearch(); }}>
            <div className="phone-action-icon sourceview-icon"><Search size={22} /></div>
            <div className="phone-action-text">
              <strong>Find More Information</strong>
              <span>Prepared automatically when this client opens</span>
            </div>
            <ChevronDown size={16} style={{ transform: sourceOpen ? 'rotate(180deg)' : undefined }} />
          </button>
        </div>
        {directCallId && !directCallSaved && <div className="direct-call-result">
          <strong>What happened?</strong>
          <div>{[['answered','Answered'],['no_answer','No answer'],['voicemail','Voicemail'],['callback','Call back'],['wrong_number','Wrong number']].map(([value, label]) => <button key={value} onClick={() => void saveDirectOutcome(value)}>{label}</button>)}</div>
        </div>}
        {directCallSaved && <div className="sourceview-notice">Call result saved.</div>}
        {sourceOpen && (
          <div className="sourceview-panel">
            <div className="sourceview-heading"><div><small>CLIENT INTELLIGENCE</small><strong>More information</strong></div><span>{startingSearch ? 'SEARCHING' : 'READY'}</span></div>
            <p>Federal One searches your saved records, including stored email fields. External websites are not searched automatically; source links require manual review.</p>
            {knownProfile && <div className="sourceview-known">
              <div className="sourceview-known-title"><strong>Found in Federal One</strong><small>{knownProfile.records_checked} matching records checked</small></div>
              <div className="sourceview-known-grid">
                <div><span>EMAIL</span><strong>{knownProfile.emails.length ? knownProfile.emails.join(', ') : 'Not found yet'}</strong></div>
                <div><span>PHONE NUMBERS</span><strong>{knownProfile.phones.length ? knownProfile.phones.join(', ') : 'Not found yet'}</strong></div>
                <div><span>ADDRESSES</span><strong>{knownProfile.addresses.length ? knownProfile.addresses.join(' · ') : 'Not found yet'}</strong></div>
                <div><span>SPOUSE / ASSOCIATES</span><strong>{knownProfile.associates.length ? knownProfile.associates.join(', ') : 'Not found yet'}</strong></div>
              </div>
            </div>}
            <button className="sourceview-search-all" onClick={() => void startEverywhereSearch()} disabled={startingSearch}><Search size={15} /> {startingSearch ? 'Searching…' : 'Refresh saved information and links'}</button>
            <div className="sourceview-links">
              {[...researchSources].sort((a, b) => { const p = (s: typeof a) => s.group === "That's Them" ? 0 : s.group === 'Google Searches' ? 1 : 2; return p(a) - p(b); }).map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" className={source.group === "That's Them" ? 'sourceview-thatsthem' : ''}><span><strong>{source.name}</strong><small>{source.group} · ready</small></span><Search size={13} /></a>)}
            </div>
            {findingNotice && <div className="sourceview-notice">{findingNotice}</div>}
            <div className="sourceview-saved">
              <div className="sourceview-saved-head"><strong>Saved possible results</strong><span>{sourceFindings.length}</span></div>
              {loadingFindings ? <div className="sourceview-loading"><RefreshCw size={13} className="search-spinner" /> Loading saved research…</div> : sourceFindings.length === 0 ? (
                <div className="sourceview-empty">No possible results saved for this client yet.</div>
              ) : sourceFindings.map(finding => (
                <a className="sourceview-finding" key={finding.id} href={finding.source_url} target="_blank" rel="noopener noreferrer">
                  <div><strong>{finding.finding_value}</strong><small>{finding.source_name} · {finding.match_status || 'possible'}</small></div><Search size={13} />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
