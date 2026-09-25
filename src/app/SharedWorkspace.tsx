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

export function SharedWorkspace({ model }: { model: Pick<ApplicationModel, "dialerError" | "setDialerError" | "notice" | "setNotice" | "availToast" | "setAvailToast" | "isOwner" | "activeNav" | "dataHealth" | "sessionToken" | "atomicLogout" | "setSecClientName" | "setSecClientPhone" | "setActiveNav" | "extraInfoPrefill" > }) {
const { dialerError, setDialerError, notice, setNotice, availToast, setAvailToast, isOwner, activeNav, dataHealth, sessionToken, atomicLogout, setSecClientName, setSecClientPhone, setActiveNav, extraInfoPrefill } = model;
return (<>
{dialerError && <div className="toast" role="alert"><PhoneOff size={14} />{dialerError}<button aria-label="Dismiss dialer error" onClick={() => setDialerError('')}><X size={14} /></button></div>}
{notice && (
            <div className="toast">
              <Check size={14} />
              {notice}
              <button onClick={() => setNotice('')}><X size={14} /></button>
            </div>
          )}
{availToast && (
            <div className="toast avail-toast-offline">
              <PhoneOff size={14} />
              {availToast}
              <button onClick={() => setAvailToast('')}><X size={14} /></button>
            </div>
          )}
{((isOwner && ['dashboard', 'system'].includes(activeNav)) || (!isOwner && activeNav === 'dashboard')) && (
            <DataHealthBanner health={dataHealth} />
          )}
{activeNav === 'opportunities' && (
            <OpportunitiesFeed
              sessionToken={sessionToken}
              onUnauthorized={atomicLogout}
              isOwner={isOwner}
              onCallback={(name, phone) => {
                setSecClientName(name);
                setSecClientPhone(phone);
                setActiveNav('secretary');
              }}
            />
          )}
{activeNav === 'extra' && (
            <ExtraInfo sessionToken={sessionToken} onUnauthorized={atomicLogout} prefill={extraInfoPrefill} />
          )}
</>);
}
