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
import { SavedTransfersView } from "@/app/views/SavedTransfersView";
import { AdminSavedTransfersView } from "@/app/views/AdminSavedTransfersView";
import { CallLogView } from "@/app/views/CallLogView";
import { ContactsView } from "@/app/views/ContactsView";
import { SecretaryView } from "@/app/views/SecretaryView";
import { PhoneActionModal } from "@/app/views/PhoneActionModal";
import { ReportedMetrics } from "@/app/views/ReportedMetrics";
export function CallList({ records, loading, expandedCall, setExpandedCall, onPhoneClick, emptyText, selectable, selectedIds, onToggleSelect, onSaveTransfer, savingTransferIds, sessionToken, onUnauthorized }: {
  records: QueueRecord[]; loading: boolean; expandedCall: string | null;
  setExpandedCall: (id: string | null) => void; onPhoneClick: (name: string, phone: string) => void; emptyText: string;
  selectable?: boolean; selectedIds?: Set<string>; onToggleSelect?: (id: string) => void;
  onSaveTransfer?: (callId: string) => void; savingTransferIds?: Set<string>;
  sessionToken: string; onUnauthorized: () => void;
}) {
  if (loading && records.length === 0) {
    return <div className="panel"><div className="empty-state">Loading calls...</div></div>;
  }
  if (records.length === 0) {
    return <div className="panel"><div className="empty-state">{emptyText}</div></div>;
  }
  return (
    <div className="queue-list">
      {selectable && (
        <div className="redial-select-hint">
          {selectedIds && selectedIds.size > 0 ? `${selectedIds.size} of 3 selected` : 'Tap the circle to select up to 3 contacts for redial'}
        </div>
      )}
      {records.map(call => {
        const isSelected = selectedIds?.has(call.id) ?? false;
        const isFireTransfer = call.queue === 'fire_transfer';
        const isSaving = savingTransferIds?.has(call.id) ?? false;
        return (
        <div key={call.id} className={`queue-card ${isSelected ? 'selected-for-redial' : ''} ${isFireTransfer ? 'flame-card' : 'red-card'}`}>
          <div className="queue-card-header" onClick={() => setExpandedCall(expandedCall === call.id ? null : call.id)}>
            <div className="queue-card-left">
              {selectable && (
                <button
                  className={`redial-checkbox ${isSelected ? 'checked' : ''} ${(selectedIds?.size ?? 0) >= 3 && !isSelected ? 'disabled' : ''}`}
                  onClick={(event) => { event.stopPropagation(); onToggleSelect?.(call.id); }}
                  title={isSelected ? 'Selected for redial' : (selectedIds && selectedIds.size >= 3) ? 'Max 3 selected' : 'Select for redial'}
                >
                  {isSelected && <Check size={14} />}
                </button>
              )}
              <div className="avatar green">{initials(call.consumer_name)}</div>
              <div>
                <strong>{call.consumer_name}</strong>
                <button className="phone-link" onClick={(event) => { event.stopPropagation(); onPhoneClick(call.consumer_name, call.consumer_phone); }}>
                  <Phone size={11} /> {formatPhone(call.consumer_phone)}
                </button>
                <span className="card-address"> · {call.consumer_address || 'No address on file'}</span>
                <span> · {fmtDateTime(call.created_at)}</span>
              </div>
            </div>
            <div className="queue-card-right">
              <span className={`heat-status ${isFireTransfer ? 'hot' : 'warm'}`}>
                <Flame size={12} /> {isFireTransfer ? 'HOT TRANSFER' : call.queue === 'human_drop' ? 'LIVE HUMAN' : 'CALL RECORD'}
              </span>
              {isFireTransfer && (
                <span className="call-now-alert">
                  <Flame size={12} /> CALL NOW
                </span>
              )}
              {onSaveTransfer && (
                <button
                  className={`save-transfer-btn ${isSaving ? 'saving' : ''}`}
                  onClick={(event) => { event.stopPropagation(); onSaveTransfer(call.id); }}
                  title="Save this transfer for later"
                  disabled={isSaving}
                >
                  {isSaving ? <RefreshCw size={12} className="search-spinner" /> : <Bookmark size={12} />}
                  <span className="save-transfer-label">SAVE</span>
                </button>
              )}
              <button className="quick-elizabeth-btn" onClick={(event) => { event.stopPropagation(); onPhoneClick(call.consumer_name, call.consumer_phone); }} title="Send Elizabeth to call & transfer">
                <Send size={12} /> <span className="quick-elizabeth-label">ELIZABETH</span>
              </button>
              <StatusPill variant={queueToPillVariant(call.queue)} />
              <ChevronDown size={16} className={expandedCall === call.id ? 'chevron-up' : ''} />
            </div>
          </div>
          {expandedCall === call.id && (
            <div className="queue-card-detail">
              <div className="detail-row"><span>Address:</span><strong>{call.consumer_address || 'Not on file'}</strong></div>
              <div className="detail-row"><span>Income:</span><strong>{call.consumer_income_range || 'Not on file'}</strong></div>
              <div className="detail-row"><span>Home Value:</span><strong>{call.consumer_home_value || 'Not on file'}</strong></div>
              <div className="detail-row"><span>Property Info:</span><strong>{call.consumer_property_info || 'Not on file'}</strong></div>
              {call.consumer_custom_fields && Object.keys(call.consumer_custom_fields).length > 0 && (
                <div className="detail-row"><span>Custom Fields:</span><strong>{JSON.stringify(call.consumer_custom_fields)}</strong></div>
              )}
              <div className="detail-row"><span>Queue:</span><strong>{queueLabel(call.queue)}</strong></div>
              {call.transfer_status && call.transfer_status !== 'none' && <div className="detail-row"><span>Transfer Status:</span><strong>{call.transfer_status}</strong></div>}
              {call.callback_requested && <div className="detail-row"><span>Callback Requested:</span><strong>Yes</strong></div>}
              {call.is_wrong_number && <div className="detail-row"><span>Wrong Number:</span><strong>Yes</strong></div>}
              {call.agent_notes && call.agent_notes.trim() && <div className="detail-row"><span>Agent Notes:</span><strong>{call.agent_notes}</strong></div>}
              {call.agent_disposition && <div className="detail-row"><span>Agent Disposition:</span><strong>{call.agent_disposition}</strong></div>}
              {call.duration_seconds > 0 && <div className="detail-row"><span>Duration:</span><strong>{fmtDuration(call.duration_seconds)}</strong></div>}
              <div className="detail-row"><span>Called:</span><strong>{fmtDateTime(call.created_at)}</strong></div>
              {call.ai_summary && <div className="detail-section"><div className="detail-label">AI SUMMARY</div><p>{call.ai_summary}</p></div>}
              {call.transcript && (
                <div className="detail-section">
                  <div className="detail-label">TRANSCRIPT</div>
                  <div className="transcript-text">{call.transcript}</div>
                </div>
              )}
              <RecordingPlayer url={call.recording_url} callId={call.id} sessionToken={sessionToken} onUnauthorized={onUnauthorized} />
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}
