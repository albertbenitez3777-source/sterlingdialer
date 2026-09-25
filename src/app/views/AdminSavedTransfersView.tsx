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
import { CallLogView } from "@/app/views/CallLogView";
import { ContactsView } from "@/app/views/ContactsView";
import { SecretaryView } from "@/app/views/SecretaryView";
import { PhoneActionModal } from "@/app/views/PhoneActionModal";
import { ReportedMetrics } from "@/app/views/ReportedMetrics";
export function AdminSavedTransfersView({ savedTransfers, loading, onLoad, expandedCall, setExpandedCall, error }: {
  savedTransfers: SavedTransfer[]; loading: boolean; onLoad: () => void;
  expandedCall: string | null; setExpandedCall: (id: string | null) => void;
  error: string | null;
}) {
  useEffect(() => { onLoad(); }, [onLoad]);
  const activeCount = savedTransfers.filter(s => s.is_active).length;
  const removedCount = savedTransfers.length - activeCount;
  return (
    <>
      <SectionHero image={CINEMATIC_HERO.commandCenter} eyebrow="SAVED TRANSFER HISTORY" title="Saved Transfers" subtitle="Every transfer saved by any agent — including ones they removed." />
      <div className="hero-row">
        <div>
          <div className="eyebrow"><Bookmark size={12} /> SAVED TRANSFER HISTORY</div>
          <h2>Saved Transfers</h2>
          <p>Every transfer saved by any agent — including ones they removed. You always have the full history.</p>
        </div>
        <div className="hero-actions">
          <button className="secondary-button" onClick={onLoad}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>
      {error && (
        <div className="data-health-banner degraded" style={{ marginBottom: 12 }}>
          <WifiOff size={14} /> Failed to load saved transfers: {error}
        </div>
      )}
      <div className="stats-grid">
        <div className="stat-card">
          <Bookmark className="stat-icon" size={20} />
          <span className="stat-label">TOTAL SAVED</span>
          <span className="stat-value">{savedTransfers.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">ACTIVE</span>
          <span className="stat-value">{activeCount}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">REMOVED BY AGENT</span>
          <span className="stat-value">{removedCount}</span>
        </div>
      </div>
      {loading && savedTransfers.length === 0 ? (
        <div className="panel"><div className="empty-state">Loading saved transfers...</div></div>
      ) : savedTransfers.length === 0 ? (
        <div className="panel"><div className="empty-state">No saved transfers yet.</div></div>
      ) : (
        <div className="queue-list">
          {savedTransfers.map(st => {
            const isExpanded = expandedCall === st.id;
            const agentName = st.agent?.full_name || 'Unknown';
            return (
              <div key={st.id} className={`queue-card ${st.is_active ? 'flame-card' : 'saved-removed-card'}`}>
                <div className="queue-card-header" onClick={() => setExpandedCall(isExpanded ? null : st.id)}>
                  <div className="queue-card-left">
                    <div className="avatar green">{initials(st.consumer_name)}</div>
                    <div>
                      <strong>{st.consumer_name}</strong>
                      <span className="card-address"> · {formatPhone(st.consumer_phone)}</span>
                      <span> · {agentName}</span>
                      <span> · {fmtDateTime(st.created_at)}</span>
                    </div>
                  </div>
                  <div className="queue-card-right">
                    {!st.is_active && (
                      <span className="queue-badge" style={{ color: '#a4ada8', borderColor: '#a4ada8' }}>
                        REMOVED {st.deleted_at ? fmtDateTime(st.deleted_at) : ''}
                      </span>
                    )}
                    {st.is_active && (
                      <span className="queue-badge" style={{ color: '#41d38d', borderColor: '#41d38d' }}>
                        ACTIVE
                      </span>
                    )}
                    <StatusPill variant={queueToPillVariant(st.original_queue)} />
                    <ChevronDown size={16} className={isExpanded ? 'chevron-up' : ''} />
                  </div>
                </div>
                {isExpanded && (
                  <div className="queue-card-detail">
                    <div className="detail-row"><span>Agent:</span><strong>{agentName}</strong></div>
                    <div className="detail-row"><span>Phone:</span><strong>{formatPhone(st.consumer_phone)}</strong></div>
                    <div className="detail-row"><span>Address:</span><strong>{st.consumer_address || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Income:</span><strong>{st.consumer_income_range || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Home Value:</span><strong>{st.consumer_home_value || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Saved:</span><strong>{fmtDateTime(st.created_at)}</strong></div>
                    {st.deleted_at && <div className="detail-row"><span>Removed:</span><strong>{fmtDateTime(st.deleted_at)}</strong></div>}
                    {st.notes && <div className="detail-section"><div className="detail-label">NOTES</div><p>{st.notes}</p></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
