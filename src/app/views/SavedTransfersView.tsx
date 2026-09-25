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
import { AdminSavedTransfersView } from "@/app/views/AdminSavedTransfersView";
import { CallLogView } from "@/app/views/CallLogView";
import { ContactsView } from "@/app/views/ContactsView";
import { SecretaryView } from "@/app/views/SecretaryView";
import { PhoneActionModal } from "@/app/views/PhoneActionModal";
import { ReportedMetrics } from "@/app/views/ReportedMetrics";
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
