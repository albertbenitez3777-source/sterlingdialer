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
import { AgentRole, SessionAgent, SessionData, QueueRecord, AdminAgentRow, FunnelStats, ErrorEntry, CampaignSummary, AdminStats, TeamHealth, DataHealth, RosterAttendanceRow, LeadPool, SecretaryCall, ContactResult, SourceFinding, SavedTransfer, fmtDuration, SUPABASE_URL, FUNCTIONS_BASE, AUTH_URL, PROVIDER_URL, DIALER_CONTROLS_URL, FEDERAL_ONE_V2_URL, TZ, CINEMATIC_HERO, fmtTime, fmtDateTime, getETTime, initials, queueLabel, LoginErrorKind, classifyFetchError, loginErrorMessage, fetchWithRetry, providerFetch } from "@/app/shared";
import { SkeletonCard } from "@/app/views/SkeletonCard";
import { SectionHero } from "@/app/views/SectionHero";
import { DataHealthBanner } from "@/app/views/DataHealthBanner";
import { CallList } from "@/app/views/CallList";
import { SavedTransfersView } from "@/app/views/SavedTransfersView";
import { AdminSavedTransfersView } from "@/app/views/AdminSavedTransfersView";
import { CallLogView } from "@/app/views/CallLogView";
import { ContactsView } from "@/app/views/ContactsView";
import { SecretaryView } from "@/app/views/SecretaryView";
import { PhoneActionModal } from "@/app/views/PhoneActionModal";
import { ReportedMetrics } from "@/app/views/ReportedMetrics";
import type { ApplicationModel } from "@/app/useApplicationModel";

export function AgentWorkspace({ model }: { model: Pick<ApplicationModel, "isOwner" | "activeNav" | "isOnline" | "agentAvailable" | "handleToggleAvailability" | "togglingAvail" | "contactSearch" | "expandedContact" | "setExpandedContact" | "sessionToken" | "setPhoneAction" | "atomicLogout" | "setActiveNav" | "setExtraInfoPrefill" | "secretaryCalls" | "setSecretaryCalls" | "loadingSecretary" | "setLoadingSecretary" | "secClientName" | "setSecClientName" | "secClientPhone" | "setSecClientPhone" | "secMode" | "setSecMode" | "secCustomMsg" | "setSecCustomMsg" | "placingSecCall" | "setPlacingSecCall" | "expandedSecCall" | "setExpandedSecCall" | "setNotice" | "transferAlerts" | "handleAlertAcknowledge" | "handleAlertSchedule" | "handleAlertDismiss" | "session" | "activeTransfers" | "activeTransfersLoading" | "activeTransfersError" | "setDismissedTransferIds" | "queues" | "agentTodayStats" | "expandedCall" | "setExpandedCall" | "handleSaveTransfer" | "savingTransferIds" | "selectedRedialIds" | "toggleRedialSelect" | "handleAgentRedial" | "agentRedialing" | "agentRedialBatchId" | "redialTranscripts" | "redialPollTimer" | "setRedialPollTimer" | "setAgentRedialBatchId" | "setRedialTranscripts" | "savedTransfers" | "loadingSaved" | "handleDeleteSavedTransfer" > }) {
const { isOwner, activeNav, isOnline, agentAvailable, handleToggleAvailability, togglingAvail, contactSearch, expandedContact, setExpandedContact, sessionToken, setPhoneAction, atomicLogout, setActiveNav, setExtraInfoPrefill, secretaryCalls, setSecretaryCalls, loadingSecretary, setLoadingSecretary, secClientName, setSecClientName, secClientPhone, setSecClientPhone, secMode, setSecMode, secCustomMsg, setSecCustomMsg, placingSecCall, setPlacingSecCall, expandedSecCall, setExpandedSecCall, setNotice, transferAlerts, handleAlertAcknowledge, handleAlertSchedule, handleAlertDismiss, session, activeTransfers, activeTransfersLoading, activeTransfersError, setDismissedTransferIds, queues, agentTodayStats, expandedCall, setExpandedCall, handleSaveTransfer, savingTransferIds, selectedRedialIds, toggleRedialSelect, handleAgentRedial, agentRedialing, agentRedialBatchId, redialTranscripts, redialPollTimer, setRedialPollTimer, setAgentRedialBatchId, setRedialTranscripts, savedTransfers, loadingSaved, handleDeleteSavedTransfer } = model;
if (!session?.valid) return null;
return (<>
{!isOwner && activeNav !== 'dashboard' && (
            <section className="agent-momentum-banner" aria-label="Agent momentum">
              <img src={CINEMATIC_HERO.agentMomentum} alt="" loading="eager" />
              <div className="agent-momentum-overlay" />
              <div className="agent-momentum-copy">
                <span className="agent-momentum-kicker"><Activity size={12} /> OPERATOR MOMENTUM</span>
                <strong>Discipline. Clarity. Results.</strong>
                <span>Stay ready. Let the verified work speak.</span>
              </div>
            </section>
          )}
{!isOwner && activeNav !== 'dashboard' && (
            <div className={`conn-banner ${!isOnline ? 'conn-disconnected' : agentAvailable ? 'conn-active' : 'conn-offline'}`}>
              {!isOnline ? (
                <>
                  <WifiOff size={28} className="conn-banner-icon" />
                  <div className="conn-banner-text">
                    <strong>DISCONNECTED</strong>
                    <span>Reconnect to answer on this computer. Your assigned number still receives calls and voicemail.</span>
                  </div>
                </>
              ) : agentAvailable ? (
                <>
                  <span className="conn-pulse-dot" />
                  <div className="conn-banner-text">
                    <strong>AT DESK</strong>
                    <span>Enable your desktop phone to answer calls. Unanswered calls go to your voicemail.</span>
                  </div>
                </>
              ) : (
                <>
                  <PhoneOff size={28} className="conn-banner-icon" />
                  <div className="conn-banner-text">
                    <strong>AWAY</strong>
                    <span>Calls assigned by your admin still reach your number and voicemail.</span>
                  </div>
                  <button className="conn-go-available" onClick={handleToggleAvailability} disabled={togglingAvail}>
                    {togglingAvail ? '...' : 'I’M AT MY DESK'}
                  </button>
                </>
              )}
            </div>
          )}
{!isOwner && activeNav === 'contacts' && (
            <ContactsView {...contactSearch}
              expandedContact={expandedContact} setExpandedContact={setExpandedContact}
              sessionToken={sessionToken}
              onPhoneClick={(name, phone, email, address) => setPhoneAction({ name, phone, email, address })}
              onUnauthorized={atomicLogout}
              onNavTo={setActiveNav}
              onExtraInfo={(p) => { setExtraInfoPrefill(p); setActiveNav('extra'); }}
            />
          )}
{!isOwner && activeNav === 'secretary' && (
            <SecretaryView
              secretaryCalls={secretaryCalls} setSecretaryCalls={setSecretaryCalls}
              onPhoneClick={(name, phone) => setPhoneAction({ name, phone })}
              loadingSecretary={loadingSecretary} setLoadingSecretary={setLoadingSecretary}
              secClientName={secClientName} setSecClientName={setSecClientName}
              secClientPhone={secClientPhone} setSecClientPhone={setSecClientPhone}
              secMode={secMode} setSecMode={setSecMode}
              secCustomMsg={secCustomMsg} setSecCustomMsg={setSecCustomMsg}
              placingSecCall={placingSecCall} setPlacingSecCall={setPlacingSecCall}
              expandedSecCall={expandedSecCall} setExpandedSecCall={setExpandedSecCall}
              sessionToken={sessionToken} setNotice={setNotice}
            />
          )}
{!isOwner && transferAlerts.length > 0 && (
            <IncomingCallAlert
              alerts={transferAlerts}
              onAcknowledge={handleAlertAcknowledge}
              onScheduleCallback={handleAlertSchedule}
              onDismiss={handleAlertDismiss}
              onExtraInfo={(name, phone, address) => { setExtraInfoPrefill({ name, phone, address }); setActiveNav('extra'); }}
              sessionToken={sessionToken}
              onUnauthorized={atomicLogout}
              agentName={session?.agent?.full_name ?? 'Agent'}
            />
          )}
{!isOwner && (
            <IncomingTransferPanel
              transfers={activeTransfers}
              loading={activeTransfersLoading}
              error={activeTransfersError}
              sessionToken={sessionToken}
              onUnauthorized={atomicLogout}
              onDismiss={(id) => setDismissedTransferIds(prev => new Set(prev).add(id))}
              onExtraInfo={(name, phone, address) => { setExtraInfoPrefill({ name, phone, address }); setActiveNav('extra'); }}
            />
          )}
{!isOwner && activeNav === 'dashboard' && (
            <AgentCockpit
              agentName={session?.agent?.full_name ?? 'Agent'}
              agentId={session?.agent?.id}
              available={agentAvailable}
              togglingAvail={togglingAvail}
              onToggleAvail={handleToggleAvailability}
              fireTransfers={(queues?.fire_transfers ?? []) as QueueRecord[]}
              humanDrops={(queues?.human_drop ?? []) as QueueRecord[]}
              todayStats={agentTodayStats}
              onNavTo={setActiveNav}
              activeNav={activeNav}
              providerUrl={FEDERAL_ONE_V2_URL}
              sessionToken={sessionToken}
              onUnauthorized={atomicLogout}
            />
          )}
{!isOwner && activeNav === 'calls' && (
            <AgentWorkspaceView
              providerUrl={PROVIDER_URL}
              sessionToken={sessionToken}
              onUnauthorized={atomicLogout}
              expandedCall={expandedCall}
              setExpandedCall={setExpandedCall}
              onPhoneClick={(name, phone) => setPhoneAction({ name, phone })}
              onSaveTransfer={handleSaveTransfer}
              savingTransferIds={savingTransferIds}
              selectedRedialIds={selectedRedialIds}
              onToggleSelect={toggleRedialSelect}
              onRedial={handleAgentRedial}
              redialing={agentRedialing}
              redialBatchId={agentRedialBatchId}
              redialTranscripts={redialTranscripts.map(call => ({ consumer_name: call.name, transcript: call.transcript, status: call.status }))}
              onCloseRedialPanel={() => { if (redialPollTimer) { clearInterval(redialPollTimer); setRedialPollTimer(null); } setAgentRedialBatchId(null); setRedialTranscripts([]); }}
            />
          )}
{!isOwner && activeNav === 'inbox' && (
            <AgentInbox
              sessionToken={sessionToken}
              onUnauthorized={atomicLogout}
              providerUrl={PROVIDER_URL}
              agentId={session?.agent?.id ?? ''}
            />
          )}
{!isOwner && activeNav === 'saved' && (
            <SavedTransfersView
              savedTransfers={savedTransfers}
              loading={loadingSaved}
              onDelete={handleDeleteSavedTransfer}
              onPhoneClick={(name, phone) => setPhoneAction({ name, phone })}
              expandedCall={expandedCall}
              setExpandedCall={setExpandedCall}
            />
          )}
</>);
}
