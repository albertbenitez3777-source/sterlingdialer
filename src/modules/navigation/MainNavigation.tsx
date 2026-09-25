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

export function MainNavigation({ model }: { model: Pick<ApplicationModel, "setActiveNav" | "isOwner" | "etClock" | "setMobileMenuOpen" | "mobileMenuOpen" | "navItems" | "activeNav" | "myAttendance" | "attendanceError" | "agentAvailable" | "handleToggleAvailability" | "togglingAvail" | "session" | "handleLogout" > }) {
const { setActiveNav, isOwner, etClock, setMobileMenuOpen, mobileMenuOpen, navItems, activeNav, myAttendance, attendanceError, agentAvailable, handleToggleAvailability, togglingAvail, session, handleLogout } = model;
if (!session?.valid) return null;
return (<>
<header className="f1-command-bar">
        <button className="f1-command-identity" onClick={() => setActiveNav('dashboard')} aria-label="Open home">
          <span className="f1-command-orb">01</span>
          <span><strong>FEDERAL ONE</strong><small>{isOwner ? 'ADMIN' : 'AGENT'} · {etClock} CR</small></span>
        </button>
        <button className="mobile-menu" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Open navigation">
          <Menu size={20} />
        </button>
        <nav className={`f1-command-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id}
                className={`f1-command-link ${activeNav === item.id ? 'active' : ''}`}
                onClick={() => { setActiveNav(item.id); setMobileMenuOpen(false); }}>
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="f1-command-user">
          {!isOwner && myAttendance && <span className={`f1-presence-dot ${attendanceError ? 'warn' : myAttendance.presence}`} title={attendanceError || `${presenceLabel(myAttendance.presence)} · Today ${fmtAttendanceDuration(myAttendance.todayTotalSeconds)}`} />}
          {!isOwner && <button className={`f1-ready-button ${agentAvailable ? 'available' : ''}`} onClick={handleToggleAvailability} disabled={togglingAvail}>
            {agentAvailable ? <><Phone size={14} /> At desk</> : <><PhoneOff size={14} /> Away</>}
          </button>}
          <span className={`avatar ${isOwner ? 'gold' : 'green'}`}>{initials(session.agent?.full_name || '')}</span>
          <button className="f1-exit-button" onClick={handleLogout} title={`Log out ${session.agent?.full_name || ''}`}><LogOut size={16} /></button>
        </div>
      </header>
</>);
}
