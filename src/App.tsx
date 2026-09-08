import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Activity, Bookmark, Check, ChevronDown, CircleHelp, Clock, Download, FileText, FileUp, Flame, LayoutDashboard, LogOut,
  Menu, Pause, Phone, PhoneOff, Play, RefreshCw, Search, Send, Square, Trash2, Upload, Users, WifiOff, X, Zap,
} from 'lucide-react';
import { AnimatedBackground, GlassCard, GlowButton, StatusPill, PinInput, Reveal, AdminCharts, queueToPillVariant, TransferFunnel, StartPreflightModal, RedialConfirmModal, TalkrouteDeliveryTimeline, InboundVerificationPanel, LiveHealthMap, AgentCockpit, RecordingPlayer, OpportunitiesFeed, IncomingTransferPanel, AgentWorkspaceView, REDIAL_CAP, type PreflightCheck, type RedialPreview, type ActiveTransfer } from '@/components';
import { maskPhone, formatPhone } from '@/utils/privacy';
import { useHeartbeat, type HeartbeatAttendance } from '@/utils/useHeartbeat';
import { fmtAttendanceDuration, presenceLabel, presenceColor } from '@/utils/attendance';
import { buildMonotonicFunnel, capAgentMonotonic, type FunnelData } from '@/utils/funnel';
import { authFetch } from '@/utils/auth-fetch';
import type { AgentTodayStats } from '@/components/AgentCockpit';
import { ShieldCheck, Settings } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────
type AgentRole = 'owner' | 'agent' | 'supervisor';
type SessionAgent = { id: string; full_name: string; role: AgentRole; status: string; is_owner?: boolean; available_for_transfer?: boolean; logged_in?: boolean };
type SessionData = { valid: boolean; agent?: SessionAgent };

type QueueRecord = {
  id: string; consumer_name: string; consumer_phone: string;
  consumer_address?: string; consumer_home_value?: string; consumer_income_range?: string;
  consumer_property_info?: string; consumer_custom_fields?: Record<string, unknown> | null;
  call_direction: string; duration_seconds: number; ai_summary: string; transcript: string;
  recording_url: string; is_completed?: boolean; is_dnc?: boolean; is_wrong_number?: boolean;
  created_at: string; transfer_status?: string; queue: string;
  agent_disposition?: string; agent_notes?: string;
  callback_requested?: boolean;
  originating_bland_number?: string; talkroute_destination?: string;
  agent?: { id: string; full_name: string };
};

type AdminAgentRow = {
  id: string; full_name: string; role: string; status: string;
  active_for_dialer: boolean; dialer_concurrency: number;
  bland_number: string; talkroute_number: string; transfer_certified: boolean;
  agent_direct_number?: string | null;
  outbound_attempts_today: number; live_humans: number; human_drops: number;
  fire_transfers: number; no_answers: number; voice_messages: number;
  pending_calls: number; currently_receiving: boolean; last_call_time: string | null;
  outbound_attempts_week: number; live_humans_week: number; human_drops_week: number;
  fire_transfers_week: number; no_answers_week: number; voice_messages_week: number;
  fire_transfers_all?: number; human_drops_all?: number; live_humans_all?: number;
  outbound_attempts_all?: number;
  transfers_requested_all?: number; transfers_requested_week?: number;
  talkroute_leg_created_today?: number; talkroute_leg_created_week?: number; talkroute_leg_created_all?: number;
  talkroute_answered_all?: number;
  bridge_confirmed_today?: number; talkroute_answered_today?: number;
  bridge_confirmed_week?: number; talkroute_answered_week?: number;
  bridge_confirmed_all?: number;
  inbound_configured?: boolean;
  transfers_requested_today?: number; likely_real_conversation_today?: number;
  productive_minutes_today?: number; wasted_minutes_today?: number; total_minutes_today?: number;
};

type FunnelStats = {
  calls_attempted: number; live_humans_reached: number; transfers_requested: number;
  talkroute_answered: number; bridge_confirmed: number; likely_real_conversation: number;
  total_minutes: number; productive_minutes: number; wasted_minutes: number; machine_minutes: number;
  avg_ai_leg_seconds: number; machines_detected: number; avg_machine_seconds: number;
  no_answer_count: number; human_drop_count: number; voice_message_count: number;
  fire_transfer_count: number; pending_count: number;
};

type ErrorEntry = {
  created_at: string; consumer_phone: string; consumer_name: string;
  agent_name: string | null; error_type: string; reason: string;
  queue: string; duration_seconds: number; talkroute_leg_created: boolean;
  talkroute_answered: boolean; bridge_confirmed: boolean;
};

type CampaignSummary = {
  campaign_state: string; dialer_activated: boolean; concurrency: number;
  provider_call_limit: number; leads_remaining: number; calls_attempted_today: number;
  live_humans_today: number; human_drops_today: number; fire_transfers_today: number;
  no_answers_today: number; voice_messages_today: number; blocking_reason: string; campaign_started_at: string | null;
  calls_attempted_week: number; live_humans_week: number; human_drops_week: number;
  fire_transfers_week: number; no_answers_week: number; voice_messages_week: number;
  fire_transfers_all?: number; human_drops_all?: number; live_humans_all?: number;
  funnel_today?: FunnelStats; funnel_week?: FunnelStats; funnel_all?: FunnelStats;
  errors_recent?: ErrorEntry[];
  dialer_status?: string; agents_reachable?: number;
  daily_minute_cap?: number | null; daily_minutes_used?: number;
  transfers_requested_today?: number; transfers_requested_week?: number;
  talkroute_dialed_today?: number; talkroute_dialed_week?: number;
  agent_answered_today?: number; agent_answered_week?: number;
  transfer_failed_unverified_today?: number; transfer_failed_unverified_week?: number;
};

type AdminStats = { summary: CampaignSummary; agents: AdminAgentRow[] };

type DataHealth = {
  status: 'loading' | 'healthy' | 'degraded';
  lastSuccess: number | null;
  failedAction: string | null;
  failedMessage: string | null;
};

type RosterAttendanceRow = {
  agent_id: string; full_name: string; role: string;
  presence: 'online' | 'disconnected' | 'signed-out' | 'unknown';
  last_confirmed_at: string | null;
  today_total_seconds: number; week_total_seconds: number;
  is_legacy_estimate: boolean;
  available_for_transfer: boolean; active_for_dialer: boolean;
};

type LeadPool = {
  total: number;
  fresh: number;
  called: number;
  suppressed: number;
  invalid: number;
  excluded_other: number;
  data_quality: number;
  // Legacy fields from old RPC (backward compat)
  new?: number;
  pending?: number;
  assigned?: number;
  unassigned?: number;
};

type SecretaryCall = {
  id: string; client_name: string; client_phone: string; mode: string;
  custom_message: string | null; status: string; provider_call_id: string | null;
  transfer_status: string | null; transcript: string | null;
  recording_url: string | null; ai_summary: string | null;
  error_message: string | null; duration_seconds: number;
  created_at: string; updated_at: string;
};

type ContactResult = {
  source: string; id: string; consumer_name: string; phone: string;
  phone_normalized: string; address: string; income_range: string;
  home_value: string; property_information: string; notes: string;
  original_agent_information: string | null;
  custom_fields: Record<string, unknown> | null;
  lead_source: string; lead_status: string; created_at: string;
  is_priority: boolean | null;
  call_queue: string | null; call_disposition: string | null;
  agent_disposition: string | null; agent_notes: string | null;
  last_call_time: string | null; agent_name: string | null;
  ai_summary: string | null; transcript: string | null;
  recording_url: string | null; duration_seconds: number | null;
  transfer_status: string | null; callback_requested: boolean | null;
  is_dnc: boolean | null; is_wrong_number: boolean | null;
  is_completed: boolean | null; total_call_count: number;
};

type SavedTransfer = {
  id: string; call_id: string | null; consumer_name: string; consumer_phone: string;
  consumer_address: string | null; consumer_income_range: string | null;
  consumer_home_value: string | null; consumer_property_info: string | null;
  original_queue: string; notes: string | null; created_at: string;
  is_active: boolean; deleted_at: string | null;
  agent?: { id: string; full_name: string } | null;
};

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 1) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}


// ── Constants ────────────────────────────────────────────────────────────
// In dev (Bolt preview), use relative URL so Vite proxy handles the request,
// bypassing credentialless-iframe Origin:null CORS restrictions.
// In production, use the full Supabase URL directly.
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? '';
const DEV_MODE = import.meta.env.DEV === true;
const FUNCTIONS_BASE = DEV_MODE ? '' : SUPABASE_URL;
const AUTH_URL = `${FUNCTIONS_BASE}/functions/v1/wolf-auth`;
const PROVIDER_URL = `${FUNCTIONS_BASE}/functions/v1/wolf-provider`;
const TZ = 'America/New_York';

const HERO_IMAGES = [
  'https://images.pexels.com/photos/5440420/pexels-photo-5440420.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
  'https://images.pexels.com/photos/28384940/pexels-photo-28384940.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
  'https://images.pexels.com/photos/4261563/pexels-photo-4261563.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
  'https://images.pexels.com/photos/32983561/pexels-photo-32983561.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
  'https://images.pexels.com/photos/21581764/pexels-photo-21581764.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
  'https://images.pexels.com/photos/6699772/pexels-photo-6699772.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
  'https://images.pexels.com/photos/31650383/pexels-photo-31650383.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
  'https://images.pexels.com/photos/14921310/pexels-photo-14921310.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
  'https://images.pexels.com/photos/2248589/pexels-photo-2248589.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
];

const CINEMATIC_HERO = {
  skyline: 'https://images.pexels.com/photos/33803478/pexels-photo-33803478.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&dpr=2',
  callCenter: 'https://images.pexels.com/photos/8867208/pexels-photo-8867208.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&dpr=2',
  agentHero: 'https://images.pexels.com/photos/7709268/pexels-photo-7709268.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&dpr=2',
  commandCenter: '/collections-command-center-hero.webp',
  loginTeam: '/wolf-login-team.webp',
  agentMomentum: '/wolf-agent-momentum.webp',
};

// ── Helpers ──────────────────────────────────────────────────────────────
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
}
function getETTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}
function queueLabel(queue: string): string {
  const map: Record<string, string> = {
    pending: 'Dialing', no_answer: 'No Answer', human_drop: 'Dropped', fire_transfer: 'Transferred',
    voice_message: 'Voicemail', completed: 'Completed',
  };
  return map[queue] || queue;
}
type LoginErrorKind = 'network' | 'timeout' | 'unauthorized' | 'server_error' | 'unknown';

function classifyFetchError(err: unknown): LoginErrorKind {
  if (err instanceof DOMException && err.name === 'AbortError') return 'timeout';
  if (err instanceof TypeError) return 'network';
  return 'unknown';
}

function loginErrorMessage(kind: LoginErrorKind): string {
  switch (kind) {
    case 'network': return 'Cannot reach the server. If using the Bolt preview, the connection is being routed through the dev proxy. Please wait a moment and try again.';
    case 'timeout': return 'Request timed out — the server may be waking up. Please try again.';
    case 'unauthorized': return 'Invalid PIN or credentials.';
    case 'server_error': return 'Server error. Please try again in a moment.';
    default: return 'Connection failed. Please try again.';
  }
}

async function fetchWithRetry(url: string, body: Record<string, unknown>, maxRetries = 2, timeoutMs = 15000): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      const isLast = attempt === maxRetries - 1;
      if (isLast) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error('Unreachable');
}

async function providerFetch(url: string, options: RequestInit, retries = 1, timeoutMs = 15000): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error('Unreachable');
}

// ── Skeleton Loader ───────────────────────────────────────────────────────
function SkeletonCard() {
  return <div className="skeleton skeleton-card" />;
}

// ── Section Hero (restrained image-led header) ───────────────────────────
function SectionHero({ image, eyebrow, title, subtitle }: { image: string; eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="section-hero" role="banner">
      <img src={image} alt="" loading="lazy" />
      <div className="section-hero-overlay" />
      <div className="section-hero-content">
        <div className="section-hero-eyebrow">{eyebrow}</div>
        <h2 className="section-hero-title">{title}</h2>
        <p className="section-hero-subtitle">{subtitle}</p>
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [sessionToken, setSessionToken] = useState('');
  const [activeNav, setActiveNav] = useState('dashboard');
  const [notice, setNotice] = useState('');
  const [etClock, setEtClock] = useState(getETTime());

  // Owner setup
  const [ownerNeedsSetup, setOwnerNeedsSetup] = useState(false);
  const [setupPin, setSetupPin] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [setupError, setSetupError] = useState('');
  const [settingUp, setSettingUp] = useState(false);

  // Admin data
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [, setLoadingAdmin] = useState(false);
  const [callLimit, setCallLimit] = useState(500);
  const [minuteCap, setMinuteCap] = useState<number | null>(null);
  const [savingCap, setSavingCap] = useState(false);
  // Heartbeat-driven attendance
  const [myAttendance, setMyAttendance] = useState<HeartbeatAttendance | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [rosterAttendance, setRosterAttendance] = useState<RosterAttendanceRow[]>([]);
  const [rosterTimezone, setRosterTimezone] = useState<string>('America/New_York');

  // Agent availability state
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [agentTodayStats, setAgentTodayStats] = useState<AgentTodayStats | null>(null);
  const [, setTodayActivity] = useState<QueueRecord[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [togglingAvail, setTogglingAvail] = useState(false);
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [availToast, setAvailToast] = useState('');

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Agent data
  const [queues, setQueues] = useState<{ human_drop: QueueRecord[]; fire_transfers: QueueRecord[] } | null>(null);
  const [, setLoadingQueues] = useState(false);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);

  // Lead upload
  const [leadPool, setLeadPool] = useState<LeadPool | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Performance view toggle
  const [perfView, setPerfView] = useState<'today' | 'week' | 'all'>('today');

  // Secretary
  const [secretaryCalls, setSecretaryCalls] = useState<SecretaryCall[]>([]);
  const [loadingSecretary, setLoadingSecretary] = useState(false);
  const [secClientName, setSecClientName] = useState('');
  const [secClientPhone, setSecClientPhone] = useState('');
  const [secMode, setSecMode] = useState<'reminder' | 'transfer'>('transfer');
  const [secCustomMsg, setSecCustomMsg] = useState('');
  const [placingSecCall, setPlacingSecCall] = useState(false);
  const [expandedSecCall, setExpandedSecCall] = useState<string | null>(null);
  const [phoneAction, setPhoneAction] = useState<{ name: string; phone: string } | null>(null);
  const [placingQuickSecretaryCall, setPlacingQuickSecretaryCall] = useState(false);

  // Dashboard sub-tabs (compact layout)
  const [dashTab, setDashTab] = useState<'overview' | 'agents' | 'redial' | 'transfers' | 'settings'>('overview');
  const [transferProof, setTransferProof] = useState<{ since: string; agents: Record<string,unknown>[]; totals: Record<string,number> } | null>(null);
  const [transferProofLoading, setTransferProofLoading] = useState(false);

  // Start campaign preflight modal
  const [showPreflight, setShowPreflight] = useState(false);
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  // Redial confirm modal
  const [showRedialModal, setShowRedialModal] = useState(false);
  const [redialPreview, setRedialPreview] = useState<RedialPreview | null>(null);
  const [, setRedialModalLoading] = useState(false);
  const [redialModalError, setRedialModalError] = useState<string | null>(null);
  const [pendingRedialAction, setPendingRedialAction] = useState<{ type: 'transfers' | 'humans'; agentId: string; agentName: string; sourceAgentId?: string } | null>(null);
  const [redialTimeframe, setRedialTimeframe] = useState<'today' | 'week' | 'all'>('all');

  // Privacy reveal tracking
  const [revealedPhones, setRevealedPhones] = useState<Set<string>>(new Set());
  const togglePhoneReveal = (id: string) => {
    setRevealedPhones(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const displayPhone = (id: string, phone: string): { text: string; masked: boolean } => {
    if (revealedPhones.has(id)) return { text: phone, masked: false };
    return { text: maskPhone(phone), masked: true };
  };

  // Re-dial live transfers — supports multiple simultaneous agent redials
  const [redialingAgent, setRedialingAgent] = useState<string | null>(null);
  const [redialingHumans, setRedialingHumans] = useState<string | null>(null);
  const [redialSourceAgent, setRedialSourceAgent] = useState<Record<string, string>>({});
  type RedialProgressEntry = { agentId: string; agentName: string; type: 'transfers' | 'humans'; total: number; dialed: number; failed: number; results: Array<{ phone: string; success: boolean; error?: string }>; batchId: string; pollData: { total: number; withCallId: number; pending: number; answered: number; noAnswer: number; failed: number; dialing: number; voicemails?: number; transfers?: number; liveHumans?: number } | null; calls: Array<{ id: string; name: string; phone: string; queue: string; is_completed: boolean; duration_seconds: number; transfer_status: string; is_live_human: boolean }> };
  const [redialProgresses, setRedialProgresses] = useState<RedialProgressEntry[]>([]);

  // localStorage persistence for active redials so they survive page refresh
  const REDIAL_STORAGE_KEY = 'sterling_active_redials';
  type StoredRedial = { batchId: string; agentId: string; agentName: string; type: 'transfers' | 'humans' };
  const saveRedialToStorage = (entry: StoredRedial) => {
    try {
      const existing: StoredRedial[] = JSON.parse(localStorage.getItem(REDIAL_STORAGE_KEY) || '[]');
      if (!existing.some(e => e.batchId === entry.batchId)) {
        existing.push(entry);
        localStorage.setItem(REDIAL_STORAGE_KEY, JSON.stringify(existing));
      }
    } catch { /* ignore */ }
  };
  const removeRedialFromStorage = (batchId: string) => {
    try {
      const existing: StoredRedial[] = JSON.parse(localStorage.getItem(REDIAL_STORAGE_KEY) || '[]');
      localStorage.setItem(REDIAL_STORAGE_KEY, JSON.stringify(existing.filter(e => e.batchId !== batchId)));
    } catch { /* ignore */ }
  };

  // Agent redial (select up to 3 contacts, see live transcripts)
  const [selectedRedialIds, setSelectedRedialIds] = useState<Set<string>>(new Set());
  const [agentRedialing, setAgentRedialing] = useState(false);
  const [agentRedialBatchId, setAgentRedialBatchId] = useState<string | null>(null);
  const [redialTranscripts, setRedialTranscripts] = useState<Array<{ id: string; name: string; phone: string; status: string; duration: number; transcript: string; ai_summary: string; is_completed: boolean; transfer_status: string; is_live_human: boolean; voicemail_status: string }>>([]);
  const [redialPollTimer, setRedialPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  // Redial analytics (historical, survives refresh)
  type RedialBatchStat = {
    batch_id: string; agent_id: string; agent_name: string; type: string;
    total: number; placed: number; pending: number; answered: number;
    transfer_requested: number; transfer_successful: number; transfer_failed: number;
    no_answer: number; failed: number; live_humans: number; voicemails: number;
    total_minutes: number; created_at: string; is_active: boolean; is_today: boolean;
  };
  type RedialOverall = {
    total_batches: number; total_calls: number; total_placed: number;
    total_transfer_requested: number; total_transfer_successful: number; total_transfer_failed: number;
    total_answered: number; total_no_answer: number; total_live_humans: number;
    total_voicemails: number; total_failed: number; total_minutes: number; active_batches: number;
    connect_rate: number; transfer_conversion_rate: number; cost_per_transfer: number;
  };
  type RedialAgentDaily = {
    agent_id: string; agent_name: string;
    transfer_redials_today: number; human_redials_today: number; agent_redials_today: number;
    transfer_redial_batches_today: number; human_redial_batches_today: number; agent_redial_batches_today: number;
    transfers_from_redial_today: number; live_humans_from_redial_today: number;
    answered_today: number; no_answer_today: number; failed_today: number; total_calls_today: number;
    voicemails_today: number; total_minutes_today: number;
    connect_rate_today: number; transfer_conversion_rate_today: number;
  };
  type RedialTodaySummary = {
    date: string;
    total_calls: number; transfer_redials: number; human_redials: number; agent_redials: number;
    transfer_batches: number; human_batches: number; agent_batches: number;
    transfers_from_redial: number; live_humans_from_redial: number;
    answered: number; no_answer: number; failed: number;
    voicemails: number; total_minutes: number;
    connect_rate: number; transfer_conversion_rate: number; cost_per_transfer: number;
  };
  const [redialStats, setRedialStats] = useState<{ batches: RedialBatchStat[]; overall: RedialOverall; agents_daily?: RedialAgentDaily[]; today?: RedialTodaySummary } | null>(null);

  const [redialStatsFilter, setRedialStatsFilter] = useState<'all' | 'active' | 'completed'>('all');

  // Contact search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ContactResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedContact, setExpandedContact] = useState<string | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active incoming transfers (agent view)
  const [activeTransfers, setActiveTransfers] = useState<ActiveTransfer[]>([]);
  const [activeTransfersLoading, setActiveTransfersLoading] = useState(false);
  const [activeTransfersError, setActiveTransfersError] = useState<string | null>(null);
  const [, setDismissedTransferIds] = useState<Set<string>>(new Set());

  // Saved transfers
  const [savedTransfers, setSavedTransfers] = useState<SavedTransfer[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [allSavedTransfers, setAllSavedTransfers] = useState<SavedTransfer[]>([]);
  const [loadingAllSaved, setLoadingAllSaved] = useState(false);
  const [savingTransferIds, setSavingTransferIds] = useState<Set<string>>(new Set());

  // Live call monitor (admin dashboard)
  const [liveActivity, setLiveActivity] = useState<{
    recent_50: Array<{
      id: string; consumer_name: string; consumer_phone: string; queue: string;
      is_live_human: boolean; is_completed: boolean; transfer_status: string;
      ai_terminated: boolean; talkroute_answered: boolean; agent_name: string | null;
      duration_seconds: number; created_at: string; seconds_ago: number;
    }>;
    outcome_breakdown: { fire_transfer: number; human_drop: number; no_answer: number; voice_message: number; pending: number };
    avg_duration_seconds: number; connect_rate: number;
    campaign_state: string; agents_activated: number;
  } | null>(null);

  // Mobile menu
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // In-flight guards for polling — prevent request pile-up
  const ownerPollingRef = useRef(false);
  const agentPollingRef = useRef(false);

  // Heartbeat hook — sends presence every 30s, receives attendance
  useHeartbeat({
    providerUrl: PROVIDER_URL,
    sessionToken,
    onUnauthorized: () => atomicLogoutRef.current?.(),
    onAttendance: useCallback((data: HeartbeatAttendance) => {
      setMyAttendance(data);
      setAttendanceError(null);
    }, []),
    onError: useCallback((msg: string) => {
      setAttendanceError(msg);
    }, []),
    enabled: !!session?.valid && !!sessionToken,
  });

  // Roster attendance poller (admin only, every 30s alongside admin stats)
  const rosterPollingRef = useRef(false);
  const loadRosterAttendance = useCallback(async (token: string) => {
    if (rosterPollingRef.current) return;
    rosterPollingRef.current = true;
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_roster_attendance', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        const raw = (result.data as Record<string, unknown>).roster_attendance as Record<string, unknown> | undefined;
        if (raw?.roster) {
          setRosterAttendance(raw.roster as RosterAttendanceRow[]);
          if (raw.timezone) setRosterTimezone(raw.timezone as string);
        }
      }
    } catch { /* authFetch handles 401 */ }
    finally { rosterPollingRef.current = false; }
  }, []);

  // Data health tracking
  const [dataHealth, setDataHealth] = useState<DataHealth>({
    status: 'loading', lastSuccess: null, failedAction: null, failedMessage: null,
  });
  const dataHealthRef = useRef(dataHealth);
  dataHealthRef.current = dataHealth;

  // Stable refs for polling — avoids effect restart on state changes
  const sessionTokenRef = useRef(sessionToken);
  sessionTokenRef.current = sessionToken;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // ── Atomic logout — called exactly once when a 401/expired session is detected ──
  const atomicLogoutRef = useRef<(() => void) | null>(null);
  const atomicLogout = useCallback(() => {
    localStorage.removeItem('sterling_session_token');
    setSession(null);
    setSessionToken('');
    setAdminStats(null);
    setQueues(null);
    setLeadPool(null);
    setLiveActivity(null);
    setRedialStats(null);
    setSavedTransfers([]);
    setAllSavedTransfers([]);
    setSearchResults([]);
    setSecretaryCalls([]);
    setAgentAvailable(false);
    setShowOfflineModal(false);
    setShowPreflight(false);
    setShowRedialModal(false);
    setPhoneAction(null);
    setExpandedCall(null);
    setExpandedContact(null);
    ownerPollingRef.current = false;
    agentPollingRef.current = false;
    // activeNav preserved as safe return destination
  }, []);
  atomicLogoutRef.current = atomicLogout;

  useEffect(() => {
    const interval = setInterval(() => setEtClock(getETTime()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Check owner setup
  useEffect(() => {
    fetchWithRetry(AUTH_URL, { action: 'owner_needs_setup' })
      .then(r => r.json()).then(d => { if (d.needs_setup) setOwnerNeedsSetup(true); }).catch(() => {});
  }, []);

  // Restore session
  useEffect(() => {
    const token = localStorage.getItem('sterling_session_token');
    if (!token) return;
    fetchWithRetry(AUTH_URL, { action: 'verify', session_token: token })
      .then(r => r.json()).then(d => {
        if (d.valid && d.agent) {
          setSession(d);
          setSessionToken(token);
          setAgentAvailable(!!d.agent.available_for_transfer);
          if (d.agent.role === 'owner' || d.agent.role === 'supervisor') setActiveNav('dashboard');
          else {
            setActiveNav('dashboard');
            if (!d.agent.available_for_transfer) setShowOfflineModal(true);
          }
        } else {
          localStorage.removeItem('sterling_session_token');
        }
      }).catch(() => {});
  }, []);

  // Restore active redials from localStorage on page load (survives refresh)
  useEffect(() => {
    if (!session?.valid || !sessionToken) return;
    if (session.agent?.role !== 'owner' && session.agent?.role !== 'supervisor') return;
    try {
      const stored: StoredRedial[] = JSON.parse(localStorage.getItem(REDIAL_STORAGE_KEY) || '[]');
      if (stored.length === 0) return;
      // For each stored redial, fetch current progress and resume polling
      stored.forEach(entry => {
        providerFetch(PROVIDER_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'redial_progress', session_token: sessionToken, target_agent_id: entry.agentId, batch_id: entry.batchId }),
        }).then(r => r.json()).then(data => {
          if (data.success && data.total > 0) {
            // Only restore if there are still pending/dialing calls
            const stillActive = (data.dialing || 0) > 0 || (data.pending || 0) > 0;
            setRedialProgresses(prev => [...prev, {
              agentId: entry.agentId, agentName: entry.agentName, type: entry.type,
              total: data.total, dialed: data.withCallId, failed: data.failed || 0, results: [],
              batchId: entry.batchId,
              pollData: { total: data.total, withCallId: data.withCallId, pending: data.pending, answered: data.answered, noAnswer: data.noAnswer, failed: data.failed || 0, dialing: data.dialing || 0 },
              calls: [],
            }]);
            if (stillActive) {
              startRedialPolling(entry.agentId, entry.batchId);
            }
            // If already finished, keep the bar visible — user dismisses with X
          } else {
            // Batch no longer exists — clean up storage
            removeRedialFromStorage(entry.batchId);
          }
        }).catch(() => { /* ignore */ });
      });
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionToken]);

  // Auto-refresh admin stats when owner is logged in — preserves last good data on failure
  const loadAdminStats = useCallback(async (token: string) => {
    setLoadingAdmin(true);
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_admin_stats', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        const stats = (result.data as Record<string, unknown>).admin_stats || result.data as AdminStats;
        setAdminStats(stats as AdminStats);
        const s = stats as Record<string, unknown>;
        const summary = s.summary as Record<string, unknown> | undefined;
        if (summary?.provider_call_limit) setCallLimit(summary.provider_call_limit as number);
        if (summary?.daily_minute_cap !== undefined) setMinuteCap(summary.daily_minute_cap as number);
        setDataHealth({ status: 'healthy', lastSuccess: Date.now(), failedAction: null, failedMessage: null });
      } else {
        const msg = result.error || `HTTP ${result.status}`;
        if (!result.loggedOut) {
          setDataHealth(h => ({ status: 'degraded', lastSuccess: h.lastSuccess, failedAction: 'get_admin_stats', failedMessage: msg }));
        }
      }
    } catch {
      setDataHealth(h => ({ status: 'degraded', lastSuccess: h.lastSuccess, failedAction: 'get_admin_stats', failedMessage: 'Unexpected error' }));
    }
    finally { setLoadingAdmin(false); }
  }, []);

  const loadQueues = useCallback(async (token: string) => {
    setLoadingQueues(true);
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_agent_queues', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        const raw = result.data as Record<string, unknown>;
        const q = (raw.queues || raw) as Record<string, unknown>;
        setQueues({
          human_drop: ((q.human_drops as QueueRecord[]) || (q.human_drop as QueueRecord[]) || []) as QueueRecord[],
          fire_transfers: ((q.fire_transfers as QueueRecord[]) || []) as QueueRecord[],
        });
        if (raw.stats && typeof raw.stats === 'object') {
          setAgentTodayStats(raw.stats as AgentTodayStats);
        }
        if (Array.isArray(raw.today_activity)) {
          setTodayActivity(raw.today_activity as QueueRecord[]);
        }
      }
    } catch { /* authFetch handles 401 internally */ }
    finally { setLoadingQueues(false); }
  }, []);

  const loadSecretaryCalls = useCallback(async (token: string) => {
    setLoadingSecretary(true);
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_secretary_calls', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        setSecretaryCalls(((result.data as Record<string, unknown>).secretary_calls || []) as SecretaryCall[]);
      }
    } catch { /* authFetch handles 401 internally */ }
    finally { setLoadingSecretary(false); }
  }, []);

  const placeQuickSecretaryCall = async (name: string, phone: string) => {
    setPlacingQuickSecretaryCall(true);
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'secretary_call', session_token: sessionToken,
          client_name: name || 'Contact', client_phone: phone,
          mode: 'transfer',
        }),
      });
      const data = await res.json();
      setPhoneAction(null);
      setNotice(data.success ? `Elizabeth is calling ${name || 'the contact'}...` : (data.error || 'Could not place secretary call'));
      setTimeout(() => setNotice(''), 4000);
      if (data.success) loadSecretaryCalls(sessionToken);
    } catch {
      setNotice('Could not place secretary call');
      setTimeout(() => setNotice(''), 4000);
    } finally {
      setPlacingQuickSecretaryCall(false);
    }
  };

  const loadLeadPool = useCallback(async (token: string) => {
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_lead_pool_stats', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        const pool = (result.data as Record<string, unknown>).lead_pool || result.data;
        setLeadPool(pool as LeadPool);
      }
    } catch { /* authFetch handles 401 internally */ }
  }, []);

  const loadRedialStats = useCallback(async (token: string) => {
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'redial_stats', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        const d = result.data as Record<string, unknown>;
        if (d.success) setRedialStats({ batches: (d.batches || []) as RedialBatchStat[], overall: d.overall as RedialOverall, agents_daily: (d.agents_daily || []) as RedialAgentDaily[], today: d.today as RedialTodaySummary });
      }
    } catch { /* authFetch handles 401 internally */ }
  }, []);

  const loadLiveActivity = useCallback(async (token: string) => {
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_dialer_activity', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        setLiveActivity(((result.data as Record<string, unknown>).activity || null) as typeof liveActivity);
      }
    } catch { /* authFetch handles 401 internally — health tracked by loadAdminStats */ }
  }, []);

  // Dialer health monitoring — warning only, NEVER starts/restarts the dialer loop
  const dialerHealthCheck = useCallback(() => {
    if (!sessionTokenRef.current) return;
    const stats = adminStatsRef.current;
    if (!stats) return;
    const campaignState = stats.summary?.campaign_state;
    if (campaignState !== 'running') return;
    const activity = liveActivityRef.current;
    const recentCalls = activity?.recent_50 || [];
    const hasRecent = recentCalls.some(c => c.seconds_ago < 90);
    const hasPending = (activity?.outcome_breakdown?.pending ?? 0) > 0;
    if (!hasRecent && !hasPending) {
      console.warn('[dialer-health] Campaign is running but no recent calls detected. The dialer loop may need manual restart.');
    }
  }, []);

  // Stable refs for health check — read current state without depending on it
  const adminStatsRef = useRef<AdminStats | null>(null);
  adminStatsRef.current = adminStats;
  const liveActivityRef = useRef(liveActivity);
  liveActivityRef.current = liveActivity;

  useEffect(() => {
    if (!session?.valid || !sessionToken) return;
    const role = session.agent?.role;
    const token = sessionToken;

    if (role === 'owner' || role === 'supervisor') {
      let mounted = true;
      const tick = async () => {
        if (!mounted || ownerPollingRef.current) return;
        ownerPollingRef.current = true;
        try {
          await Promise.allSettled([
            loadAdminStats(token),
            loadLeadPool(token),
            loadLiveActivity(token),
            loadRedialStats(token),
            loadRosterAttendance(token),
          ]);
        } finally {
          if (mounted) {
            ownerPollingRef.current = false;
            dialerHealthCheck();
          }
        }
      };
      tick();
      const interval = setInterval(tick, 8000);
      return () => { mounted = false; clearInterval(interval); };
    } else {
      let mounted = true;
      const tick = async () => {
        if (!mounted || agentPollingRef.current) return;
        agentPollingRef.current = true;
        try {
          await Promise.allSettled([
            loadQueues(token),
            loadSecretaryCalls(token),
            loadSavedTransfers(token),
            loadActiveTransfers(token),
          ]);
        } finally {
          if (mounted) agentPollingRef.current = false;
        }
      };
      tick();
      const interval = setInterval(tick, 8000);
      return () => { mounted = false; clearInterval(interval); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionToken, loadAdminStats, loadQueues, loadLeadPool, loadLiveActivity, loadRedialStats, loadRosterAttendance, dialerHealthCheck]);

  // ── Login ──────────────────────────────────────────────────────────────
  const handleAgentRedial = async () => {
    if (selectedRedialIds.size === 0) return;
    setAgentRedialing(true);
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'agent_redial', session_token: sessionToken, call_ids: Array.from(selectedRedialIds) }),
      });
      const data = await res.json();
      if (data.success) {
        setAgentRedialBatchId(data.batch_id);
        setRedialTranscripts([]);
        setNotice(`Elizabeth is calling ${data.total} contact${data.total !== 1 ? 's' : ''}...`);
        setTimeout(() => setNotice(''), 4000);
        startRedialTranscriptPolling(data.batch_id);
      } else {
        setNotice(data.error || 'Redial failed');
        setTimeout(() => setNotice(''), 4000);
      }
    } catch {
      setNotice('Network error');
      setTimeout(() => setNotice(''), 4000);
    } finally {
      setAgentRedialing(false);
      setSelectedRedialIds(new Set());
    }
  };

  const startRedialTranscriptPolling = (batchId: string) => {
    if (redialPollTimer) clearInterval(redialPollTimer);
    const poll = async () => {
      try {
        const res = await providerFetch(PROVIDER_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_redial_transcripts', session_token: sessionToken, batch_id: batchId }),
        });
        const data = await res.json();
        if (data.success) {
          setRedialTranscripts(data.calls || []);
          const allDone = (data.calls || []).every((c: { is_completed: boolean; status: string }) => c.is_completed || c.status === 'no_answer' || c.status === 'fire_transfer' || c.status === 'human_drop' || c.status === 'voice_message');
          if (allDone && (data.calls || []).length > 0) {
            if (redialPollTimer) { clearInterval(redialPollTimer); setRedialPollTimer(null); }
            loadQueues(sessionToken);
          }
        }
      } catch { /* ignore */ }
    };
    poll();
    const timer = setInterval(poll, 3000);
    setRedialPollTimer(timer);
  };

  useEffect(() => {
    return () => { if (redialPollTimer) clearInterval(redialPollTimer); };
  }, [redialPollTimer]);

  const toggleRedialSelect = (id: string) => {
    setSelectedRedialIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  };

  const handleSaveTransfer = async (callId: string) => {
    setSavingTransferIds(prev => new Set(prev).add(callId));
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_transfer', session_token: sessionToken, call_id: callId }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice('Transfer saved to your Saved list');
        setTimeout(() => setNotice(''), 3000);
        loadSavedTransfers(sessionToken);
      } else {
        setNotice(data.error || 'Could not save transfer');
        setTimeout(() => setNotice(''), 3000);
      }
    } catch {
      setNotice('Network error');
      setTimeout(() => setNotice(''), 3000);
    } finally {
      setSavingTransferIds(prev => { const n = new Set(prev); n.delete(callId); return n; });
    }
  };

  const loadActiveTransfers = useCallback(async (token: string) => {
    setActiveTransfersLoading(true);
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_active_transfers', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        setActiveTransfers(((result.data as Record<string, unknown>).transfers || []) as ActiveTransfer[]);
        setActiveTransfersError(null);
      } else if (!result.loggedOut) {
        setActiveTransfersError(result.error || 'Could not load transfers');
      }
    } catch {
      setActiveTransfersError('Could not load transfers');
    } finally { setActiveTransfersLoading(false); }
  }, []);

  const loadSavedTransfers = useCallback(async (token: string) => {
    setLoadingSaved(true);
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_saved_transfers', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        setSavedTransfers(((result.data as Record<string, unknown>).saved_transfers || []) as SavedTransfer[]);
      }
    } catch { /* authFetch handles 401 internally */ }
    finally { setLoadingSaved(false); }
  }, []);

  const [deletingSavedId, setDeletingSavedId] = useState<string | null>(null);
  const handleDeleteSavedTransfer = async (savedId: string) => {
    if (deletingSavedId) return;
    setDeletingSavedId(savedId);
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_saved_transfer', session_token: sessionToken, saved_transfer_id: savedId }),
      });
      const data = await res.json();
      if (data.success) {
        loadSavedTransfers(sessionToken);
        setNotice('Removed from saved');
        setTimeout(() => setNotice(''), 3000);
      } else {
        setNotice(data.error || 'Failed to remove');
        setTimeout(() => setNotice(''), 3000);
      }
    } catch {
      setNotice('Network error');
      setTimeout(() => setNotice(''), 3000);
    } finally { setDeletingSavedId(null); }
  };

  const [allSavedTransfersError, setAllSavedTransfersError] = useState<string | null>(null);
  const loadAllSavedTransfers = useCallback(async (token: string) => {
    setLoadingAllSaved(true);
    setAllSavedTransfersError(null);
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_all_saved_transfers', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        setAllSavedTransfers(((result.data as Record<string, unknown>).saved_transfers || []) as SavedTransfer[]);
      } else {
        if (!result.loggedOut) setAllSavedTransfersError(result.error || `HTTP ${result.status}`);
      }
    } catch {
      setAllSavedTransfersError('Unexpected error');
    }
    finally { setLoadingAllSaved(false); }
  }, []);

  const handleLogin = async () => {
    if (!pin || !/^\d{4}$/.test(pin)) { setLoginError('PIN must be 4 digits'); return; }
    setLoggingIn(true); setLoginError('');
    try {
      const res = await fetchWithRetry(AUTH_URL, { action: 'login', pin });
      const data = await res.json();
      if (data.success && data.session_token) {
        localStorage.setItem('sterling_session_token', data.session_token);
        setSessionToken(data.session_token);
        setSession({ valid: true, agent: data.agent });
        setAgentAvailable(!!data.agent.available_for_transfer);
        setActiveNav('dashboard');
        if (data.agent.role !== 'owner' && data.agent.role !== 'supervisor' && !data.agent.available_for_transfer) setShowOfflineModal(true);
        setPin('');
      } else {
        const kind: LoginErrorKind = res.status === 401 ? 'unauthorized' : res.status >= 500 ? 'server_error' : 'unknown';
        setLoginError(data.error || loginErrorMessage(kind));
      }
    } catch (err) {
      const kind = classifyFetchError(err);
      setLoginError(loginErrorMessage(kind));
    }
    finally { setLoggingIn(false); }
  };

  const handleLogout = async () => {
    try {
      await fetch(AUTH_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout', session_token: sessionToken }),
      });
    } catch { /* ignore */ }
    atomicLogout();
  };

  const handleToggleAvailability = async () => {
    setTogglingAvail(true);
    const newAvail = !agentAvailable;
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_availability', session_token: sessionToken, available: newAvail }),
      });
      const data = await res.json();
      if (data.success) {
        setAgentAvailable(newAvail);
        if (newAvail) {
          setShowOfflineModal(false);
        } else {
          setAvailToast("You're now offline — no calls will come to you until you go available again.");
          setTimeout(() => setAvailToast(''), 5000);
        }
      }
    } catch {
      setNotice('Network error — could not toggle availability');
      setTimeout(() => setNotice(''), 3000);
    } finally { setTogglingAvail(false); }
  };

  const handleOwnerSetup = async () => {
    if (setupPin !== setupConfirm) { setSetupError('PINs do not match'); return; }
    if (!/^\d{4}$/.test(setupPin)) { setSetupError('PIN must be 4 digits'); return; }
    setSettingUp(true); setSetupError('');
    try {
      const res = await fetch(AUTH_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'owner_setup', pin: setupPin }),
      });
      const data = await res.json();
      if (data.success) { setOwnerNeedsSetup(false); setSetupPin(''); setSetupConfirm(''); }
      else { setSetupError(data.error || 'Setup failed'); }
    } catch { setSetupError('Network error'); }
    finally { setSettingUp(false); }
  };

  // ── Admin Actions ──────────────────────────────────────────────────────
  const [startingCampaign, setStartingCampaign] = useState(false);
  const [stoppingCampaign, setStoppingCampaign] = useState(false);
  const [togglingAgent, setTogglingAgent] = useState<string | null>(null);
  const [settingConcurrency, setSettingConcurrency] = useState<string | null>(null);

  const runPreflight = useCallback(async (): Promise<PreflightCheck[]> => {
    const stats = adminStatsRef.current;
    if (!stats) return [];
    const s = stats.summary;
    const activeAgents = stats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner'));
    const campaignStopped = s.campaign_state === 'stopped';
    const hasLeads = s.leads_remaining > 0;
    const hasCap = s.daily_minute_cap === null || s.daily_minute_cap === undefined || (s.daily_minutes_used ?? 0) < (s.daily_minute_cap ?? 0);
    const healthOk = dataHealthRef.current.status === 'healthy';

    // Eligibility predicate — same gates as dialer_next_batch/count_available_agents:
    // active_for_dialer, transfer_certified, valid Talkroute (>=10 digits), unique destination
    const talkrouteNumbers = new Set<string>();
    const eligibleAgents = activeAgents.filter(a => {
      const tr = a.talkroute_number || '';
      if (!a.active_for_dialer) return false;
      if (!a.transfer_certified) return false;
      if (!tr || tr.length < 10) return false;
      if (talkrouteNumbers.has(tr)) return false; // duplicate destination
      talkrouteNumbers.add(tr);
      return true;
    });
    const eligibleCount = eligibleAgents.length;
    const excludedAgents = activeAgents.filter(a => {
      const tr = a.talkroute_number || '';
      return !a.active_for_dialer || !a.transfer_certified || !tr || tr.length < 10;
    });
    const validSessions = activeAgents.filter(a => a.currently_receiving || a.active_for_dialer).length;
    const hasDuplicates = activeAgents.length > talkrouteNumbers.size + excludedAgents.length;
    const dashboardEligibleCount = activeAgents.filter(a => a.active_for_dialer && a.transfer_certified && a.talkroute_number && a.talkroute_number.length >= 10).length;
    const countsAgree = eligibleCount === dashboardEligibleCount;

    return [
      { key: 'campaign_stopped', label: 'Campaign Status', value: campaignStopped ? 'Stopped — ready to start' : `Active (${s.campaign_state})`, passed: campaignStopped, detail: campaignStopped ? undefined : 'Campaign must be stopped before starting' },
      { key: 'eligible_agents', label: 'Eligible Agents', value: `${eligibleCount} eligible`, passed: eligibleCount > 0, detail: eligibleCount === 0 ? 'No eligible agents (must be active, certified, valid Talkroute)' : `Matches dashboard readiness: ${countsAgree ? 'yes' : 'NO — mismatch'}` },
      { key: 'valid_sessions', label: 'Valid Current Sessions', value: `${validSessions} active sessions`, passed: validSessions > 0, detail: validSessions === 0 ? 'No agents with valid sessions' : undefined },
      { key: 'talkroute_destinations', label: 'Talkroute Destinations', value: `${talkrouteNumbers.size} unique valid`, passed: talkrouteNumbers.size > 0 && !hasDuplicates, detail: hasDuplicates ? 'Duplicate destinations detected' : talkrouteNumbers.size === 0 ? 'No valid Talkroute numbers' : undefined },
      { key: 'concurrency', label: 'Concurrency Limit', value: `${activeAgents.reduce((sum, a) => sum + (a.dialer_concurrency ?? 2), 0)} max parallel`, passed: activeAgents.length > 0, detail: activeAgents.length === 0 ? 'No agents configured' : undefined },
      { key: 'lead_pool', label: 'Eligible Leads', value: `${s.leads_remaining} leads`, passed: hasLeads, detail: hasLeads ? undefined : 'No leads remaining to dial' },
      { key: 'call_limit', label: 'Call Limit', value: `${s.provider_call_limit} calls`, passed: s.provider_call_limit > 0, detail: s.provider_call_limit > 0 ? undefined : 'Call limit must be > 0' },
      { key: 'minute_cap', label: 'Daily Minute Cap', value: hasCap ? 'Within cap' : 'Cap exceeded', passed: hasCap, detail: hasCap ? `${s.daily_minutes_used ?? 0} / ${s.daily_minute_cap ?? '∞'} min used` : 'Cap reached — reset tomorrow' },
      { key: 'data_health', label: 'Data Health', value: healthOk ? 'Healthy' : dataHealthRef.current.status, passed: healthOk, detail: !healthOk ? dataHealthRef.current.failedMessage ?? undefined : undefined },
      { key: 'excluded_agents', label: 'Excluded Agents', value: `${excludedAgents.length} excluded`, passed: true, detail: excludedAgents.length === 0 ? 'None excluded' : excludedAgents.map(a => `${a.full_name}: ${!a.active_for_dialer ? 'not active' : !a.transfer_certified ? 'not certified' : 'missing Talkroute'}`).join('; ') },
    ];
  }, []);

  const openPreflight = async () => {
    setShowPreflight(true);
    setPreflightError(null);
    setPreflightLoading(true);
    setPreflightChecks([]);
    try {
      await loadAdminStats(sessionToken);
      const checks = await runPreflight();
      setPreflightChecks(checks);
    } catch {
      setPreflightError('Failed to run preflight checks — please try again');
    } finally {
      setPreflightLoading(false);
    }
  };

  const startCampaign = async () => {
    if (startingCampaign) return;
    setStartingCampaign(true);
    setPreflightError(null);
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start_campaign', session_token: sessionToken, call_limit: callLimit }),
      });
      const data = await res.json();
      if (data.success) {
        await loadAdminStats(sessionToken);
        const confirmedState = adminStatsRef.current?.summary?.campaign_state;
        if (confirmedState === 'running') {
          setNotice('Dialer started');
          setTimeout(() => setNotice(''), 3000);
          setShowPreflight(false);
        } else {
          setPreflightError(`Start returned success but state is "${confirmedState || 'unknown'}" — refreshing`);
        }
      } else {
        setPreflightError(data.error || data.blocking_reason || 'Failed to start');
      }
    } catch { setPreflightError('Network error — please try again'); }
    finally { setStartingCampaign(false); }
  };

  const stopCampaign = async () => {
    if (stoppingCampaign) return;
    setStoppingCampaign(true);
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop_campaign', session_token: sessionToken }),
      });
      const data = await res.json();
      if (data.success || res.ok) {
        // Confirm via follow-up read — require confirmed state=stopped
        await loadAdminStats(sessionToken);
        const confirmedState = adminStatsRef.current?.summary?.campaign_state;
        if (confirmedState === 'stopped') {
          setNotice('Dialer stopped');
          setTimeout(() => setNotice(''), 3000);
        } else {
          setNotice(`Stop returned success but state is "${confirmedState || 'unknown'}" — please verify`);
          setTimeout(() => setNotice(''), 5000);
        }
      } else {
        setNotice(data.error || 'Failed to stop dialer');
        setTimeout(() => setNotice(''), 4000);
      }
    } catch { setNotice('Network error — please try again'); setTimeout(() => setNotice(''), 4000); }
    finally { setStoppingCampaign(false); }
  };

  const toggleAgent = async (agentId: string, current: boolean) => {
    if (togglingAgent) return;
    setTogglingAgent(agentId);
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_agent_dialer_selection', session_token: sessionToken, agent_id: agentId, selected: !current }),
      });
      const data = await res.json();
      if (!data.success) { setNotice(data.error || 'Failed to toggle agent'); setTimeout(() => setNotice(''), 3000); }
      else loadAdminStats(sessionToken);
    } catch {
      setNotice('Network error — could not toggle agent');
      setTimeout(() => setNotice(''), 3000);
    } finally { setTogglingAgent(null); }
  };

  const setConcurrency = async (agentId: string, concurrency: number) => {
    if (settingConcurrency) return;
    setSettingConcurrency(agentId);
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_agent_concurrency', session_token: sessionToken, agent_id: agentId, concurrency }),
      });
      const data = await res.json();
      if (!data.success) { setNotice(data.error || 'Failed to set concurrency'); setTimeout(() => setNotice(''), 3000); }
      else loadAdminStats(sessionToken);
    } catch {
      setNotice('Network error — could not set concurrency');
      setTimeout(() => setNotice(''), 3000);
    } finally { setSettingConcurrency(null); }
  };

  const saveMinuteCap = async () => {
    setSavingCap(true);
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_daily_minute_cap', session_token: sessionToken, minute_cap: minuteCap }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice('Daily minute cap saved');
        setTimeout(() => setNotice(''), 3000);
        loadAdminStats(sessionToken);
      } else {
        setNotice(data.error || 'Failed to save cap');
        setTimeout(() => setNotice(''), 4000);
      }
    } catch { setNotice('Network error'); setTimeout(() => setNotice(''), 3000); }
    finally { setSavingCap(false); }
  };

  const openRedialModal = async (type: 'transfers' | 'humans', agentId: string, agentName: string, sourceAgentId?: string) => {
    const campaignActive = adminStatsRef.current?.summary?.campaign_state === 'running';
    const healthOk = dataHealthRef.current.status === 'healthy';
    if (campaignActive) {
      setNotice('Re-dial disabled — campaign is active');
      setTimeout(() => setNotice(''), 4000);
      return;
    }
    if (!healthOk) {
      setNotice('Re-dial disabled — data health is degraded');
      setTimeout(() => setNotice(''), 4000);
      return;
    }
    setPendingRedialAction({ type, agentId, agentName, sourceAgentId });
    setShowRedialModal(true);
    setRedialModalError(null);
    setRedialModalLoading(true);
    setRedialPreview(null);
    try {
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'redial_preview',
          session_token: sessionToken,
          target_agent_id: agentId,
          source_agent_id: sourceAgentId || agentId,
          redial_type: type,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRedialPreview({
          sourceCohort: `${data.source_agent_name || 'Unknown'} → ${data.target_agent_name || 'Unknown'}`,
          dateWindow: type === 'transfers' ? 'Live Transfers (all-time)' : 'Live Humans (all-time)',
          eligibleCount: data.eligible_count ?? 0,
          excludedCount: data.excluded_count ?? 0,
          excludedReasons: (data.excluded_reasons || []).map((r: { reason: string; count: number }) => `${r.reason} (${r.count})`),
          cappedCount: data.capped_count ?? 0,
        });
      } else {
        setRedialModalError(data.error || 'Failed to build preview');
      }
    } catch {
      setRedialModalError('Network error — could not reach preview service');
    } finally {
      setRedialModalLoading(false);
    }
  };

  const confirmRedial = async () => {
    if (!pendingRedialAction) return;
    const { type, agentId, agentName, sourceAgentId } = pendingRedialAction;
    if (type === 'transfers') setRedialingAgent(agentId);
    else setRedialingHumans(agentId);
    setRedialModalError(null);
    try {
      const action = type === 'transfers' ? 'redial_live_transfers' : 'redial_live_humans';
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, session_token: sessionToken, target_agent_id: agentId, source_agent_id: sourceAgentId }),
      });
      const data = await res.json();
      if (data.success) {
        const sourceName = sourceAgentId && sourceAgentId !== agentId
          ? adminStats?.agents?.find(a => a.id === sourceAgentId)?.full_name
          : undefined;
        setRedialProgresses(prev => [...prev, { agentId, agentName, type, total: data.total, dialed: 0, failed: 0, results: [], batchId: data.batch_id, pollData: null, calls: [] }]);
        saveRedialToStorage({ batchId: data.batch_id, agentId, agentName, type });
        setNotice(`Re-dial started for ${data.total} ${type === 'transfers' ? 'live transfers' : 'live humans'}${sourceName ? ` from ${sourceName}` : ''} — tracking progress...`);
        setTimeout(() => setNotice(''), 5000);
        loadAdminStats(sessionToken);
        startRedialPolling(agentId, data.batch_id);
        setShowRedialModal(false);
        setPendingRedialAction(null);
      } else {
        setRedialModalError(data.error || 'Re-dial failed');
      }
    } catch { setRedialModalError('Network error — the re-dial may still be running'); }
    finally {
      if (type === 'transfers') setRedialingAgent(null);
      else setRedialingHumans(null);
    }
  };

  const startRedialPolling = (agentId: string, batchId: string) => {
    let pollCount = 0;
    const maxPolls = 240; // poll for 20 minutes max — redial batches can take a while
    const poll = async () => {
      if (pollCount >= maxPolls) {
        // Stop polling but keep the progress entry visible — user can dismiss with X
        setRedialProgresses(prev => prev.map(p => p.batchId === batchId
          ? { ...p, pollData: p.pollData ? { ...p.pollData, dialing: 0, pending: 0 } : null }
          : p));
        return;
      }
      pollCount++;
      try {
        const res = await providerFetch(PROVIDER_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'redial_progress', session_token: sessionToken, target_agent_id: agentId, batch_id: batchId }),
        });
        const data = await res.json();
        if (data.success) {
          const callsData = (data.calls || []).map((c: { id: string; consumer_name: string; consumer_phone: string; queue: string; is_completed: boolean; duration_seconds: number; transfer_status: string; is_live_human: boolean }) => ({
            id: c.id, name: c.consumer_name || 'Unknown', phone: c.consumer_phone || '', queue: c.queue,
            is_completed: c.is_completed, duration_seconds: c.duration_seconds || 0,
            transfer_status: c.transfer_status || 'none', is_live_human: c.is_live_human || false,
          }));
          const voicemails = callsData.filter((c: { queue: string }) => c.queue === 'voice_message').length;
          const transfers = callsData.filter((c: { queue: string }) => c.queue === 'fire_transfer').length;
          const liveHumans = callsData.filter((c: { queue: string }) => c.queue === 'human_drop').length;
          setRedialProgresses(prev => prev.map(p => p.batchId === batchId
            ? { ...p, dialed: data.withCallId, failed: data.failed || 0,
                pollData: { total: data.total, withCallId: data.withCallId, pending: data.pending, answered: data.answered, noAnswer: data.noAnswer, failed: data.failed || 0, dialing: data.dialing || 0, voicemails, transfers, liveHumans },
                calls: callsData }
            : p));
          // Stop polling when all calls have a final state (no more dialing/pending)
          if (data.dialing === 0 && data.pending === 0 && pollCount > 2) {
            loadAdminStats(sessionToken);
            loadRedialStats(sessionToken);
            // Keep the progress bar visible — user dismisses with X button
            return;
          }
        }
      } catch { /* ignore poll errors */ }
      if (pollCount < maxPolls) {
        setTimeout(poll, 5000);
      }
    };
    setTimeout(poll, 2000);
  };

  const handleUploadLeads = async (file: File) => {
    if (importing) return;
    setImporting(true); setNotice('');
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { setNotice('CSV is empty or has no data rows'); return; }
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const leads: Record<string, string>[] = [];
      const headerMap: Record<string, string> = {
        'name': 'name', 'client_name': 'name', 'full_name': 'name',
        'phone': 'telephone_original', 'telephone': 'telephone_original', 'telephone_original': 'telephone_original', 'client_phone': 'telephone_original', 'phone_number': 'telephone_original',
        'address': 'address', 'street_address': 'address',
        'income range': 'income_range', 'income_range': 'income_range', 'income': 'income_range',
        'home value': 'home_value', 'home_value': 'home_value', 'home valuation': 'home_value',
        'property information': 'property_information', 'property_information': 'property_information', 'property info': 'property_information',
        'notes': 'notes', 'note': 'notes',
      };
      for (let i = 1; i < lines.length; i++) {
        // Simple CSV parse — handles quoted fields
        const vals: string[] = [];
        let cur = ''; let inQ = false;
        for (const ch of lines[i]) {
          if (ch === '"') { inQ = !inQ; continue; }
          if (ch === ',' && !inQ) { vals.push(cur); cur = ''; continue; }
          cur += ch;
        }
        vals.push(cur);
        const row: Record<string, string> = {};
        headers.forEach((h, j) => {
          const mappedKey = headerMap[h.toLowerCase()] || h.toLowerCase().replace(/\s+/g, '_');
          row[mappedKey] = (vals[j] || '').trim();
        });
        leads.push(row);
      }
      const res = await providerFetch(PROVIDER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_leads', session_token: sessionToken, leads, filename: file.name }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice(`Imported ${data.imported || leads.length} leads`);
        setTimeout(() => setNotice(''), 4000);
        loadLeadPool(sessionToken);
      } else {
        setNotice(data.error || 'Import failed');
      }
    } catch { setNotice('Failed to read file'); }
    finally { setImporting(false); }
  };

  // ── Login Screen ───────────────────────────────────────────────────────
  if (ownerNeedsSetup) {
    return (
      <div className="login-page">
        <div className="login-hero-fullbleed" aria-hidden="true">
          <img src="/wolf-login-team.webp" alt="" />
          <div className="login-hero-scrim" />
        </div>
        <div className="login-aurora" />
        <div className="login-grid" />
        <div className="login-shell">
          <div className="login-brand">
            <div className="brand-mark">S</div>
            <strong>STERLING <span>COLLECTIONS</span></strong>
            <small>PRIVATE SALES FLOOR</small>
          </div>
          <div className="login-card glass-card">
            <div className="login-card-visual" aria-hidden="true">
              <img src="/wolf-agent-momentum.webp" alt="" />
              <div className="login-card-visual-overlay" />
              <div className="login-card-visual-caption"><span>STERLING COLLECTIONS</span><strong>PRIVATE SALES FLOOR</strong><small>Owner initialization</small></div>
            </div>
            <div className="login-card-copy">
              <div className="eyebrow"><CircleHelp size={12} /> FIRST-TIME SETUP</div>
              <h1>Set Your <em>Admin PIN</em></h1>
              <p>Choose a 4-digit PIN to secure your admin dashboard. You'll use this every time you log in.</p>
            </div>
            <div className="login-form">
              <label>ENTER 4-DIGIT PIN</label>
              <input className="pin-input-single" type="password" inputMode="numeric" maxLength={4}
                value={setupPin} onChange={e => setSetupPin(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && handleOwnerSetup()} autoFocus />
              <label style={{ marginTop: '20px' }}>CONFIRM PIN</label>
              <input className="pin-input-single" type="password" inputMode="numeric" maxLength={4}
                value={setupConfirm} onChange={e => setSetupConfirm(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && handleOwnerSetup()} />
              {setupError && <div className="notice"><span>{setupError}</span></div>}
              <GlowButton fullWidth onClick={handleOwnerSetup} disabled={settingUp}>
                {settingUp ? 'Setting up...' : 'Create Admin PIN'}
              </GlowButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!session?.valid) {
    return (
      <div className="login-page">
        <div className="login-hero-fullbleed" aria-hidden="true">
          <img src="/wolf-login-team.webp" alt="" />
          <div className="login-hero-scrim" />
        </div>
        <div className="login-aurora" />
        <div className="login-grid" />
        <div className="login-shell">
          <div className="login-brand">
            <div className="brand-mark">S</div>
            <strong>STERLING <span>COLLECTIONS</span></strong>
            <small>PRIVATE SALES FLOOR</small>
          </div>
          <div className="login-card glass-card">
            <div className="login-card-visual" aria-hidden="true">
              <img src="/wolf-agent-momentum.webp" alt="" />
              <div className="login-card-visual-overlay" />
              <div className="login-card-visual-caption"><span>STERLING COLLECTIONS</span><strong>BUILT FROM PRESSURE</strong><small>Trained to perform</small></div>
            </div>
            <div className="login-card-copy">
              <div className="eyebrow"><Zap size={12} /> STERLING COLLECTIONS · PRIVATE SALES FLOOR</div>
              <h1>
                <span className="headline-word" style={{ animationDelay: '0.1s' }}>Built From</span>
                <span className="headline-word em" style={{ animationDelay: '0.3s' }}> Pressure.</span>
                <span className="headline-word" style={{ animationDelay: '0.5s' }}> Trained</span>
                <span className="headline-word" style={{ animationDelay: '0.7s' }}> To</span>
                <span className="headline-word em" style={{ animationDelay: '0.9s' }}> Perform.</span>
              </h1>
              <p>Discipline over excuses. Consistency over hype. Every conversation is an opportunity.</p>
              <div className="login-chips">
                <span className="login-chip">HUSTLE SMART</span>
                <span className="login-chip">STAY SHARP</span>
                <span className="login-chip">FINISH STRONG</span>
              </div>
            </div>
            <div className="login-form">
              <label>ENTER PIN TO LOG IN</label>
              <PinInput length={4} value={pin} onChange={setPin} onComplete={handleLogin} hasError={!!loginError} />
              {loginError && <div className="notice"><span>{loginError}</span></div>}
              <GlowButton fullWidth onClick={handleLogin} disabled={loggingIn}>
                {loggingIn ? 'Connecting — please wait...' : 'Enter Dashboard'}
              </GlowButton>
              <div className="login-foot"><CircleHelp size={12} /> <span>4-digit PIN access only</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main Layout ────────────────────────────────────────────────────────
  const isOwner = session.agent?.role === 'owner' || session.agent?.role === 'supervisor';
  const canControl = session.agent?.role === 'owner';
  const navItems = isOwner
    ? [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'opportunities', label: 'Opportunities', icon: Users },
        { id: 'contacts', label: 'Contacts', icon: Search },
        { id: 'leads', label: 'Leads', icon: Upload },
        { id: 'calls', label: 'Call Log', icon: Phone },
        { id: 'saved', label: 'Saved Transfers', icon: Bookmark },
      ]
    : [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'opportunities', label: 'Opportunities', icon: Users },
        { id: 'calls', label: 'Call Now', icon: Flame },
        { id: 'saved', label: 'Saved', icon: Bookmark },
        { id: 'secretary', label: 'Secretary', icon: Send },
        { id: 'contacts', label: 'Contacts', icon: Search },
      ];

  return (
    <div className="app-shell">
      <AnimatedBackground />
      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand" onClick={handleLogout} title="Click to log out" style={{ cursor: 'pointer' }}>
          <div className="brand-mark small">S</div>
          <strong>STERLING <span>DIALER</span></strong>
          <small>{isOwner ? 'ADMIN' : 'AGENT'}</small>
        </div>
        <div className="sidebar-hero">
          <img src={HERO_IMAGES[2]} alt="" loading="lazy" />
        </div>
        <div className="floor-status">
          <span className="live-dot"></span> LIVE FLOOR
          <span className="status-time">{etClock} ET</span>
        </div>
        <nav>
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id}
                className={`nav-item ${activeNav === item.id ? 'active' : ''}`}
                onClick={() => { setActiveNav(item.id); setMobileMenuOpen(false); }}>
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-mini">
            <div className={`avatar ${isOwner ? 'gold' : 'green'}`}>{initials(session.agent?.full_name || '')}</div>
            <strong>{session.agent?.full_name}</strong>
            <span>{isOwner ? 'Administrator' : 'Agent'}</span>
            {!isOwner && myAttendance && (
              <div className={`login-status-badge ${myAttendance.presence === 'online' ? 'online' : myAttendance.presence === 'disconnected' ? 'warn' : 'offline'}`}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: presenceColor(myAttendance.presence), marginRight: 6 }} />
                {presenceLabel(myAttendance.presence)}
                {myAttendance.isLegacyEstimate && <span className="legacy-badge" title="Legacy estimate — pre-heartbeat data"> est</span>}
              </div>
            )}
            {!isOwner && attendanceError && (
              <div className="login-status-badge warn" style={{ fontSize: 10, color: '#f59e0b' }}>
                <WifiOff size={10} /> Attendance sync error
              </div>
            )}
            {!isOwner && (
              <button
                className={`availability-toggle-large ${agentAvailable ? 'available' : 'offline'}`}
                onClick={handleToggleAvailability}
                disabled={togglingAvail}
              >
                {togglingAvail ? '...' : agentAvailable ? <><Phone size={16} /> AVAILABLE</> : <><PhoneOff size={16} /> GO AVAILABLE</>}
              </button>
            )}
            {!isOwner && myAttendance && (
              <div className="login-weekly-mini">
                <Clock size={11} /> Today: {fmtAttendanceDuration(myAttendance.todayTotalSeconds)} · Week: {fmtAttendanceDuration(myAttendance.weekTotalSeconds)}
              </div>
            )}
            <button className="logout-btn" onClick={handleLogout}>
              <LogOut size={14} /> Log Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="content-area">
        <div className="topbar">
          <button className="mobile-menu" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <strong>{isOwner ? 'Admin Dashboard' : 'Agent Dashboard'}</strong>
            <span>/</span>
            <span>{navItems.find(n => n.id === activeNav)?.label}</span>
          </div>
          <div className="top-actions">
            {adminStats && (
              <div className={`dialer-indicator ${adminStats.summary.campaign_state === 'running' ? (adminStats.summary.dialer_status === 'waiting_for_agents' ? 'waiting' : 'running') : 'stopped'}`}>
                <div className={`dialer-spinner ${adminStats.summary.campaign_state === 'running' ? (adminStats.summary.dialer_status === 'waiting_for_agents' ? 'waiting' : 'running') : 'stopped'}`}></div>
                <b>{adminStats.summary.campaign_state === 'running' ? (adminStats.summary.dialer_status === 'waiting_for_agents' ? 'WAITING FOR AGENTS' : 'DIALER ACTIVE') : 'DIALER STOPPED'}</b>
              </div>
            )}
            <div className="market-indicator">
              <span>{etClock}</span> ET
            </div>
          </div>
        </div>

        <div className="content-wrap">
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

          {/* ── AGENT: Momentum Banner ─────────────────────────────────── */}
          {!isOwner && (
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

          {/* ── AGENT: Big Connection Status Banner ──────────────────────── */}
          {!isOwner && (
            <div className={`conn-banner ${!isOnline ? 'conn-disconnected' : agentAvailable ? 'conn-active' : 'conn-offline'}`}>
              {!isOnline ? (
                <>
                  <WifiOff size={28} className="conn-banner-icon" />
                  <div className="conn-banner-text">
                    <strong>DISCONNECTED</strong>
                    <span>Check your internet. You are NOT receiving calls.</span>
                  </div>
                </>
              ) : agentAvailable ? (
                <>
                  <span className="conn-pulse-dot" />
                  <div className="conn-banner-text">
                    <strong>ACTIVE</strong>
                    <span>You're connected and waiting for calls.</span>
                  </div>
                </>
              ) : (
                <>
                  <PhoneOff size={28} className="conn-banner-icon" />
                  <div className="conn-banner-text">
                    <strong>OFFLINE</strong>
                    <span>Set yourself Available to receive calls.</span>
                  </div>
                  <button className="conn-go-available" onClick={handleToggleAvailability} disabled={togglingAvail}>
                    {togglingAvail ? '...' : 'GO AVAILABLE'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── ADMIN: Dialer Gated Banner ──────────────────────────────── */}
          {isOwner && adminStats && adminStats.summary.dialer_status === 'waiting_for_agents' && (
            <div className="dialer-gated-banner">
              <Pause size={16} /> <strong>Dialing paused</strong> — 0 agents available. It will resume automatically when an agent goes available.
            </div>
          )}

          {/* ── ADMIN: Dashboard ─────────────────────────────────────────── */}
          {isOwner && activeNav === 'dashboard' && !adminStats && (
            <div className="stats-grid">
              <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
          )}
          {isOwner && activeNav === 'dashboard' && (
            <DataHealthBanner health={dataHealth} />
          )}
          {isOwner && activeNav === 'dashboard' && adminStats && (
            <>
              {/* Compact campaign status card */}
              <div className="campaign-status-card">
                <div className="campaign-status-left">
                  <div className={`campaign-status-badge ${adminStats.summary.campaign_state === 'running' ? 'running' : adminStats.summary.campaign_state === 'stopped' ? 'stopped' : 'unknown'}`}>
                    {adminStats.summary.campaign_state === 'running' ? <><span className="live-dot" /> RUNNING</> : adminStats.summary.campaign_state === 'stopped' ? 'STOPPED' : adminStats.summary.campaign_state.toUpperCase()}
                  </div>
                  <div className="campaign-status-info">
                    <strong>Dialer {adminStats.summary.campaign_state === 'running' ? 'Active' : 'Stopped'}</strong>
                    <span>{adminStats.summary.leads_remaining} leads remaining · {adminStats.summary.calls_attempted_today} calls today</span>
                  </div>
                </div>
                <div className="campaign-status-actions">
                  {canControl && (adminStats.summary.campaign_state === 'running' ? (
                    <GlowButton variant="rust" onClick={stopCampaign} disabled={stoppingCampaign}>
                      {stoppingCampaign ? <RefreshCw size={14} className="search-spinner" /> : <Pause size={14} />} {stoppingCampaign ? 'Stopping...' : 'Stop Dialer'}
                    </GlowButton>
                  ) : (
                    <GlowButton variant="sage" onClick={openPreflight} disabled={startingCampaign}>
                      {startingCampaign ? <RefreshCw size={14} className="search-spinner" /> : <Play size={14} />} Start Dialer
                    </GlowButton>
                  ))}
                  <GlowButton variant="ghost" onClick={() => window.open(`${SUPABASE_URL}/functions/v1/wolf-dialer-report`, '_blank')}>
                    <FileText size={14} /> Report
                  </GlowButton>
                </div>
              </div>

              {adminStats.summary.blocking_reason?.includes('minute cap') && (
                <div className="toast minute-cap-banner">
                  <Clock size={16} /> <strong>Daily minute cap reached</strong> — the dialer was stopped automatically to protect your balance. It will resume tomorrow.
                </div>
              )}

              {/* Dashboard sub-tabs */}
              <div className="dash-tabs" role="tablist" aria-label="Dashboard sections">
                <button className={`dash-tab ${dashTab === 'overview' ? 'active' : ''}`} onClick={() => setDashTab('overview')} role="tab" aria-selected={dashTab === 'overview'}>
                  <LayoutDashboard size={14} /> Overview
                </button>
                <button className={`dash-tab ${dashTab === 'agents' ? 'active' : ''}`} onClick={() => setDashTab('agents')} role="tab" aria-selected={dashTab === 'agents'}>
                  <Users size={14} /> Agents
                </button>
                <button className={`dash-tab ${dashTab === 'redial' ? 'active' : ''}`} onClick={() => setDashTab('redial')} role="tab" aria-selected={dashTab === 'redial'}>
                  <Flame size={14} /> Re-Dial
                </button>
                {isOwner && <button className={`dash-tab ${dashTab === 'transfers' ? 'active' : ''}`} onClick={async () => { setDashTab('transfers'); if (!transferProof) { setTransferProofLoading(true); try { const tk = localStorage.getItem('sterling_session_token'); const r = await authFetch<{since:string;agents:Record<string,unknown>[];totals:Record<string,number>}>(PROVIDER_URL, { onUnauthorized: handleLogout, body: { action: 'get_transfer_proof', session_token: tk } }); if (r.ok && r.data) setTransferProof(r.data); } catch { /* transfer proof load */ } finally { setTransferProofLoading(false); } } }} role="tab" aria-selected={dashTab === 'transfers'}>
                  <ShieldCheck size={14} /> Transfer Proof
                </button>}
                {canControl && <button className={`dash-tab ${dashTab === 'settings' ? 'active' : ''}`} onClick={() => setDashTab('settings')} role="tab" aria-selected={dashTab === 'settings'}>
                  <Settings size={14} /> Settings
                </button>}
              </div>

              {/* ── OVERVIEW TAB: KPI strip, corrected funnel, recent failures, agent readiness ── */}
              {dashTab === 'overview' && (
                <>
                  {/* Command Center Hero */}
                  <div className="command-center-hero">
                    <img src={CINEMATIC_HERO.commandCenter} alt="" className="command-center-hero-img" loading="eager" />
                    <div className="command-center-hero-overlay" />
                    <div className="command-center-hero-content">
                      <div className="command-center-hero-eyebrow">STERLING COLLECTIONS COMMAND CENTER</div>
                      <h1 className="command-center-hero-title">Discipline. Clarity. Results.</h1>
                      <p className="command-center-hero-subtitle">Every call measured. Every transfer verified. Every minute accountable. This is the high-performance collections sales floor — built for professionals who deliver results with integrity.</p>
                    </div>
                  </div>

                  {/* Live Operations Health Map */}
                  <LiveHealthMap
                    campaignState={adminStats.summary.campaign_state}
                    dialerActivated={adminStats.summary.dialer_activated}
                    callsToday={adminStats.summary.calls_attempted_today}
                    callsWeek={adminStats.summary.calls_attempted_week}
                    callsAll={adminStats.summary.funnel_all?.calls_attempted ?? 0}
                    liveHumansToday={adminStats.summary.live_humans_today}
                    liveHumansWeek={adminStats.summary.live_humans_week}
                    liveHumansAll={adminStats.summary.live_humans_all ?? 0}
                    transfersRequestedToday={adminStats.summary.transfers_requested_today ?? 0}
                    transfersRequestedWeek={adminStats.summary.transfers_requested_week ?? 0}
                    talkrouteDialedToday={adminStats.summary.talkroute_dialed_today ?? 0}
                    talkrouteDialedWeek={adminStats.summary.talkroute_dialed_week ?? 0}
                    agentAnsweredToday={adminStats.summary.agent_answered_today ?? 0}
                    agentAnsweredWeek={adminStats.summary.agent_answered_week ?? 0}
                    bridgeConfirmedToday={(adminStats.summary as Record<string, unknown>).bridge_confirmed_today as number ?? 0}
                    bridgeConfirmedWeek={(adminStats.summary as Record<string, unknown>).bridge_confirmed_week as number ?? 0}
                    bridgeConfirmedAll={adminStats.agents.reduce((sum, a) => sum + (a.bridge_confirmed_all ?? 0), 0)}
                    leadsRemaining={adminStats.summary.leads_remaining}
                    errorsRecent={adminStats.summary.errors_recent ?? []}
                    agentsReachable={adminStats.summary.agents_reachable ?? 0}
                    inboundConfiguredCount={adminStats.agents.filter(a => a.inbound_configured).length}
                    totalAgentCount={adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).length}
                    blockingReason={adminStats.summary.blocking_reason ?? ''}
                    lastRefreshed={dataHealth.lastSuccess}
                    failedToday={adminStats.summary.transfer_failed_unverified_today ?? 0}
                    failedWeek={adminStats.summary.transfer_failed_unverified_week ?? 0}
                    failedAll={(adminStats.summary.funnel_all as Record<string, unknown>)?.transfer_failed_unverified as number ?? 0}
                    agents={adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).map(a => ({
                      id: a.id,
                      full_name: a.full_name,
                      attempts_today: a.outbound_attempts_today,
                      attempts_week: a.outbound_attempts_week ?? 0,
                      attempts_all: a.outbound_attempts_all ?? 0,
                      live_humans_today: a.live_humans,
                      live_humans_week: a.live_humans_week ?? 0,
                      live_humans_all: a.live_humans_all ?? 0,
                      transfers_requested_today: a.transfers_requested_today ?? 0,
                      transfers_requested_week: a.transfers_requested_week ?? 0,
                      transfers_requested_all: a.transfers_requested_all ?? 0,
                      talkroute_dialed_today: a.talkroute_leg_created_today ?? 0,
                      talkroute_dialed_week: a.talkroute_leg_created_week ?? 0,
                      talkroute_dialed_all: a.talkroute_leg_created_all ?? 0,
                      agent_answered_today: a.talkroute_answered_today ?? 0,
                      agent_answered_week: a.talkroute_answered_week ?? 0,
                      agent_answered_all: a.talkroute_answered_all ?? 0,
                      bridge_confirmed_today: a.bridge_confirmed_today ?? 0,
                      bridge_confirmed_week: a.bridge_confirmed_week ?? 0,
                      bridge_confirmed_all: a.bridge_confirmed_all ?? 0,
                      failed_today: Math.max(0, (a.transfers_requested_today ?? 0) - (a.bridge_confirmed_today ?? 0)),
                      failed_week: Math.max(0, (a.transfers_requested_week ?? 0) - (a.bridge_confirmed_week ?? 0)),
                      failed_all: Math.max(0, (a.transfers_requested_all ?? 0) - (a.bridge_confirmed_all ?? 0)),
                    }))}
                  />

                  {/* KPI Strip — all values derived from the same monotonic funnel result */}
                  {(() => {
                    const f = adminStats.summary.funnel_today;
                    const s = adminStats.summary;
                    const funnelData: FunnelData | null = f ? {
                      calls_attempted: f.calls_attempted,
                      live_humans_reached: f.live_humans_reached,
                      transfers_requested: s.transfers_requested_today ?? 0,
                      talkroute_dialed: s.talkroute_dialed_today ?? 0,
                      agent_answered: s.agent_answered_today ?? 0,
                      bridge_confirmed: (s as Record<string, unknown>).bridge_confirmed_today as number ?? 0,
                      likely_real_conversation: f.likely_real_conversation,
                      transfer_failed_unverified: s.transfer_failed_unverified_today ?? 0,
                      data_quality_exceptions: 0,
                      total_minutes: f.total_minutes,
                      productive_minutes: f.productive_minutes,
                      wasted_minutes: f.wasted_minutes,
                      machine_minutes: f.machine_minutes,
                      avg_ai_leg_seconds: f.avg_ai_leg_seconds,
                      machines_detected: f.machines_detected,
                      avg_machine_seconds: f.avg_machine_seconds,
                    } : null;
                    const mono = funnelData ? buildMonotonicFunnel(funnelData) : null;
                    const kpiCalls = mono?.stages[0]?.value ?? adminStats.summary.calls_attempted_today ?? 0;
                    const kpiLive = mono?.stages[1]?.value ?? adminStats.summary.live_humans_today ?? 0;
                    const kpiTransfer = mono?.stages[2]?.value ?? 0;
                    const kpiBridged = mono?.stages[5]?.value ?? 0;
                    const rawTransfer = adminStats.summary.transfers_requested_today ?? 0;
                    const transferDQ = Math.max(0, rawTransfer - kpiTransfer);
                    const eligibleAgentCount = adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner') && a.active_for_dialer && a.transfer_certified && a.talkroute_number && a.talkroute_number.length >= 10).length;
                    return (
                  <div className="kpi-strip">
                    <div className="kpi-item accent-steel">
                      <span className="kpi-label">CALLS TODAY</span>
                      <span className="kpi-value">{kpiCalls}</span>
                      <span className="kpi-hint">Precision dialing, every call counted</span>
                    </div>
                    <div className="kpi-item accent-gold">
                      <span className="kpi-label">LIVE HUMANS</span>
                      <span className="kpi-value">{kpiLive}</span>
                      <span className="kpi-hint">Real conversations, real opportunities</span>
                    </div>
                    <div className="kpi-item accent-rust">
                      <span className="kpi-label">TRANSFER REQUESTED</span>
                      <span className="kpi-value">{kpiTransfer}</span>
                      {transferDQ > 0 && <span className="kpi-hint">{kpiTransfer} validated + {transferDQ} exception rows</span>}
                    </div>
                    <div className="kpi-item accent-sage">
                      <span className="kpi-label">VERIFIED BRIDGES</span>
                      <span className="kpi-value">{kpiBridged}</span>
                      <span className="kpi-hint">Bridge confirmed = strict predicate</span>
                    </div>
                    <div className="kpi-item accent-steel">
                      <span className="kpi-label">ELIGIBLE AGENTS</span>
                      <span className="kpi-value">{eligibleAgentCount}</span>
                      <span className="kpi-hint">Active, certified, valid Talkroute</span>
                    </div>
                  </div>
                    );
                  })()}

                  {/* Talkroute Delivery Verification Timeline */}
                  <Reveal delay={200}>
                    <TalkrouteDeliveryTimeline
                      transferRequested={adminStats.summary.transfers_requested_today ?? 0}
                      destinationDialed={adminStats.summary.talkroute_dialed_today ?? 0}
                      agentAnswered={adminStats.summary.agent_answered_today ?? 0}
                      bridgeConfirmed={(adminStats.summary as Record<string, unknown>).bridge_confirmed_today as number ?? 0}
                      failedCount={adminStats.summary.transfer_failed_unverified_today ?? 0}
                      failedReasons={(adminStats.summary.errors_recent ?? []).map(e => e.reason)}
                      unverifiedCount={Math.max(0, (adminStats.summary.transfers_requested_today ?? 0) - ((adminStats.summary as Record<string, unknown>).bridge_confirmed_today as number ?? 0) - (adminStats.summary.transfer_failed_unverified_today ?? 0))}
                    />
                  </Reveal>

                  {/* Inbound Verification Panel */}
                  <Reveal delay={225}>
                    <InboundVerificationPanel
                      agents={adminStats.agents.filter(a => a.status === 'active').map(a => ({
                        full_name: a.full_name,
                        bland_number: a.bland_number || '',
                        talkroute_number: a.talkroute_number || '',
                        inbound_configured: a.inbound_configured ?? false,
                        transfer_certified: a.transfer_certified ?? false,
                      }))}
                      webhookEventsSubscribed={['call', 'tool', 'post_transfer_transcript']}
                    />
                  </Reveal>

                  {/* Corrected Transfer Funnel */}

                  {adminStats.summary.funnel_today && (
                    <Reveal delay={250}>
                    <GlassCard hoverLift className="panel observability-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><Activity size={12} /> TRANSFER FUNNEL</div>
                          <h3>Monotonic Cohort — One Window, One Population</h3>
                        </div>
                        <div className="funnel-time-toggle">
                          {(['today','week','all'] as const).map(t => (
                            <button key={t} className={`perf-tab ${perfView === t ? 'active' : ''}`} onClick={() => setPerfView(t)}>
                              {t === 'today' ? 'TODAY' : t === 'week' ? 'THIS WEEK' : 'ALL TIME'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {(() => {
                        const f = perfView === 'today' ? adminStats.summary.funnel_today : perfView === 'week' ? adminStats.summary.funnel_week : adminStats.summary.funnel_all;
                        if (!f) return null;
                        const s = adminStats.summary;
                        const funnelData: FunnelData = {
                          calls_attempted: f.calls_attempted,
                          live_humans_reached: f.live_humans_reached,
                          transfers_requested: (perfView === 'today' ? s.transfers_requested_today : perfView === 'week' ? s.transfers_requested_week : f.transfers_requested) ?? 0,
                          talkroute_dialed: (perfView === 'today' ? s.talkroute_dialed_today : perfView === 'week' ? s.talkroute_dialed_week : f.talkroute_answered) ?? 0,
                          agent_answered: (perfView === 'today' ? s.agent_answered_today : perfView === 'week' ? s.agent_answered_week : f.talkroute_answered) ?? 0,
                          bridge_confirmed: (perfView === 'today' ? (s as Record<string, unknown>).bridge_confirmed_today : perfView === 'week' ? (s as Record<string, unknown>).bridge_confirmed_week : f.bridge_confirmed) as number ?? 0,
                          likely_real_conversation: f.likely_real_conversation,
                          transfer_failed_unverified: (perfView === 'today' ? s.transfer_failed_unverified_today : perfView === 'week' ? s.transfer_failed_unverified_week : 0) ?? 0,
                          data_quality_exceptions: 0,
                          total_minutes: f.total_minutes,
                          productive_minutes: f.productive_minutes,
                          wasted_minutes: f.wasted_minutes,
                          machine_minutes: f.machine_minutes,
                          avg_ai_leg_seconds: f.avg_ai_leg_seconds,
                          machines_detected: f.machines_detected,
                          avg_machine_seconds: f.avg_machine_seconds,
                        };
                        const { stages, exceptions, sideOutcome } = buildMonotonicFunnel(funnelData);
                        return <TransferFunnel stages={stages} exceptions={exceptions} sideOutcome={sideOutcome} />;
                      })()}
                    </GlassCard>
                    </Reveal>
                  )}

                  {/* Recent Transfer Failures (side outcome) */}
                  {adminStats.summary.errors_recent && adminStats.summary.errors_recent.length > 0 && (
                    <Reveal delay={300}>
                    <GlassCard hoverLift className="panel recent-failures-card">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><CircleHelp size={12} /> RECENT FAILURES</div>
                          <h3>Transfer Failures — Last 20</h3>
                        </div>
                      </div>
                      <div className="recent-failures-list">
                        {adminStats.summary.errors_recent.slice(0, 10).map((e, i) => {
                          const phoneDisplay = displayPhone(`err-${i}`, e.consumer_phone);
                          return (
                            <div key={i} className="recent-failure-row">
                              <span className="privacy-masked">{phoneDisplay.text}</span>
                              {phoneDisplay.masked && (
                                <button className="privacy-reveal-btn" onClick={() => togglePhoneReveal(`err-${i}`)} aria-label="Reveal phone number">
                                  Reveal
                                </button>
                              )}
                              <span className="recent-failure-reason">{e.reason}</span>
                              <span className="recent-failure-time">{fmtTime(e.created_at)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </GlassCard>
                    </Reveal>
                  )}

                  {/* Agent Readiness Summary */}
                  <Reveal delay={350}>
                  <GlassCard hoverLift className="panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow"><ShieldCheck size={12} /> AGENT READINESS</div>
                        <h3>Transfer-Certified Agent Status</h3>
                      </div>
                    </div>
                    <div className="agent-readiness-strip">
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).map(agent => {
                        const ra = rosterAttendance.find(r => r.agent_id === agent.id);
                        const presence = ra?.presence || 'unknown';
                        const statusClass = presence === 'online' ? 'online' : presence === 'disconnected' ? 'warn' : 'offline';
                        return (
                          <div key={agent.id} className="agent-readiness-card">
                            <div className={`avatar ${presence === 'online' ? 'green' : presence === 'disconnected' ? 'amber' : 'gray'}`}>{initials(agent.full_name)}</div>
                            <div className="agent-readiness-info">
                              <strong>{agent.full_name}</strong>
                              <span>{agent.transfer_certified ? 'Certified' : 'Not certified'} · {agent.active_for_dialer ? 'Active' : 'Off'}</span>
                            </div>
                            <span className={`agent-readiness-status ${statusClass}`}>{presenceLabel(presence).toUpperCase()}</span>
                          </div>
                        );
                      })}
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).length === 0 && (
                        <div className="empty-state">No active agents. Ready when you are — activate an agent to begin.</div>
                      )}
                    </div>
                  </GlassCard>
                  </Reveal>
                </>
              )}

              {/* ── AGENTS TAB: agent activation, performance, login hours, live monitor ── */}
              {dashTab === 'agents' && (
                <>
                  {rosterAttendance.length > 0 && (() => {
                    const onlineCount = rosterAttendance.filter(r => r.presence === 'online').length;
                    const totalCount = rosterAttendance.length;
                    return (
                      <div className={`agents-live-panel ${onlineCount === 0 ? 'none-connected' : ''}`}>
                        <div className="agents-live-header">
                          <div className="agents-live-count">
                            <span className={`al-count-dot ${onlineCount > 0 ? 'live' : 'none'}`} />
                            <strong>{onlineCount} of {totalCount}</strong> agents online
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--steel-400)' }}>Timezone: {rosterTimezone.replace('_', ' ')}</span>
                        </div>
                        <div className="agents-live-roster">
                          {rosterAttendance.map(ra => {
                            const agentRow = adminStats.agents.find(a => a.id === ra.agent_id);
                            const statusClass = ra.presence === 'online' ? 'connected' : ra.presence === 'disconnected' ? 'idle' : 'offline';
                            return (
                              <div key={ra.agent_id} className={`al-agent ${statusClass}`}>
                                <div className={`al-avatar ${statusClass}`}>{initials(ra.full_name)}</div>
                                <div className="al-info">
                                  <strong>{ra.full_name}</strong>
                                  <span className={`al-status ${statusClass}`}>
                                    <span className="al-mini-dot" style={{ background: presenceColor(ra.presence) }} />
                                    {presenceLabel(ra.presence).toUpperCase()}
                                    {ra.presence !== 'signed-out' && <> · Today: {fmtAttendanceDuration(ra.today_total_seconds)}</>}
                                    {ra.is_legacy_estimate && <span className="legacy-badge" title="Legacy estimate"> est</span>}
                                  </span>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--steel-400)', minWidth: 60 }}>
                                  {agentRow?.active_for_dialer ? 'Dialer ON' : 'Dialer OFF'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <Reveal delay={500}>
                  <GlassCard hoverLift className="panel agents-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow"><Users size={12} /> AGENTS</div>
                        <h3>Agent Activation</h3>
                      </div>
                    </div>
                    <div className="agent-list">
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).map(agent => (
                        <div key={agent.id} className="agent-control-row">
                          <div className="agent-control-left">
                            <div className={`avatar ${agent.active_for_dialer ? 'green' : 'gray'}`}>
                              {initials(agent.full_name)}
                            </div>
                            <div className="agent-name">
                              <strong>{agent.full_name}</strong>
                              <span>•••• {agent.bland_number?.slice(-4)} → •••• {agent.talkroute_number?.slice(-4)}</span>
                              <button className="privacy-reveal-btn" onClick={() => togglePhoneReveal(`agent-${agent.id}`)} aria-label={`Reveal phone numbers for ${agent.full_name}`}>
                                {revealedPhones.has(`agent-${agent.id}`) ? 'Hide' : 'Reveal'}
                              </button>
                              {revealedPhones.has(`agent-${agent.id}`) && (
                                <span className="agent-revealed-phones" style={{ display: 'block', fontSize: '10px', color: 'var(--steel-300)', marginTop: '2px' }}>
                                  {agent.bland_number} → {agent.talkroute_number}
                                </span>
                              )}
                            </div>
                          </div>
                          {canControl && (
                          <div className="agent-control-right">
                            <div className="direct-number-row direct-number-disabled">
                              <span className="direct-number-locked">
                                <PhoneOff size={12} /> Direct routing disabled — all transfers go through Talkroute
                              </span>
                            </div>
                            <div className="concurrency-selector">
                              <span className="concurrency-label">LINES:</span>
                              {[2, 3, 5, 7].map(n => (
                                <button key={n}
                                  className={`conc-btn ${agent.dialer_concurrency === n ? 'active' : ''}`}
                                  onClick={() => setConcurrency(agent.id, n)}
                                  disabled={settingConcurrency === agent.id}>
                                  {settingConcurrency === agent.id && agent.dialer_concurrency !== n ? '…' : n}
                                </button>
                              ))}
                            </div>
                            <button
                              className={`toggle-btn ${agent.active_for_dialer ? 'active' : ''}`}
                              onClick={() => toggleAgent(agent.id, agent.active_for_dialer)}
                              disabled={togglingAgent === agent.id}>
                              {togglingAgent === agent.id ? '...' : agent.active_for_dialer ? 'ACTIVE' : 'OFF'}
                            </button>
                          </div>
                          )}
                        </div>
                      ))}
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).length === 0 && (
                        <div className="empty-state">No active agents. Activate John or James to start dialing.</div>
                      )}

                      {/* Archived / Inactive agents */}
                      {adminStats.agents.filter(a => a.status !== 'active' && !a.role?.includes('owner')).length > 0 && (
                        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(148,163,184,0.1)' }}>
                          <div style={{ fontSize: '10px', color: '#64748b', letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>Archived / Inactive</div>
                          {adminStats.agents.filter(a => a.status !== 'active' && !a.role?.includes('owner')).map(agent => (
                            <div key={agent.id} className="agent-control-row" style={{ opacity: 0.55 }}>
                              <div className="agent-control-left">
                                <div className="avatar gray">{initials(agent.full_name)}</div>
                                <div className="agent-name">
                                  <strong>{agent.full_name}</strong>
                                  <span style={{ fontSize: '10px', color: '#ef4444' }}>
                                    {agent.status === 'archived' ? 'ARCHIVED' : 'INACTIVE'} — {agent.outbound_attempts_all ?? 0} total calls, {agent.bridge_confirmed_all ?? 0} bridges
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </GlassCard>
                  </Reveal>

                  {/* Agent Performance */}
                  <div className="panel perf-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow"><Users size={12} /> COMMAND CENTER</div>
                        <h3>Agent Performance</h3>
                      </div>
                      <div className="perf-toggle">
                        <button className={`perf-tab ${perfView === 'today' ? 'active' : ''}`} onClick={() => setPerfView('today')}>TODAY</button>
                        <button className={`perf-tab ${perfView === 'week' ? 'active' : ''}`} onClick={() => setPerfView('week')}>THIS WEEK</button>
                      </div>
                    </div>
                    <div className="perf-table-wrap">
                      <table className="perf-table">
                        <thead>
                          <tr>
                            <th>AGENT</th>
                            <th className="num-col">CALLS</th>
                            <th className="num-col">LIVE</th>
                            <th className="num-col">DROPS</th>
                            <th className="num-col">TRANSFERS</th>
                            <th className="num-col handed-off-col">BRIDGED</th>
                            <th className="num-col">NO ANS.</th>
                            <th className="num-col">VOICEMAIL</th>
                            <th className="num-col">CONNECT %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).map(agent => {
                            const d = perfView === 'today';
                            const rawCalls = d ? agent.outbound_attempts_today : agent.outbound_attempts_week;
                            const rawLive = d ? agent.live_humans : agent.live_humans_week;
                            const rawTransfers = d ? agent.fire_transfers : agent.fire_transfers_week;
                            const rawBridged = d ? (agent.bridge_confirmed_today ?? 0) : (agent.bridge_confirmed_week ?? 0);
                            const capped = capAgentMonotonic({ calls_attempted: rawCalls, live_humans: rawLive, transfers_requested: rawTransfers, bridge_confirmed: rawBridged });
                            const drops = d ? agent.human_drops : agent.human_drops_week;
                            const noAns = d ? agent.no_answers : agent.no_answers_week;
                            const vm = d ? agent.voice_messages : agent.voice_messages_week;
                            const connectRate = capped.attempted > 0 ? Math.round((capped.live / capped.attempted) * 100) : 0;
                            return (
                              <tr key={agent.id}>
                                <td className="agent-cell">
                                  <div className={`avatar green perf-avatar`}>{initials(agent.full_name)}</div>
                                  <strong>{agent.full_name}</strong>
                                  {capped.exceptions > 0 && <span className="agent-dq-badge" title={`${capped.exceptions} data-quality exception rows — downstream counts exceeded prerequisites`}>DQ:{capped.exceptions}</span>}
                                </td>
                                <td className="num-col">{capped.attempted}</td>
                                <td className="num-col">{capped.live}</td>
                                <td className="num-col">{drops}</td>
                                <td className="num-col transfers-cell">{capped.transfers}</td>
                                <td className="num-col handed-off-cell"><strong>{capped.bridged}</strong></td>
                                <td className="num-col">{noAns}</td>
                                <td className="num-col">{vm}</td>
                                <td className="num-col">
                                  <div className="connect-bar-wrap">
                                    <div className="connect-bar" style={{ width: `${connectRate}%` }} />
                                    <span>{connectRate}%</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).length === 0 && (
                            <tr><td colSpan={9} className="empty-state">No active agents.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="perf-note">
                      {perfView === 'today' ? 'Daily counts reset automatically at midnight ET.' : 'Weekly totals cover Monday through Sunday of the current week.'}
                    </div>
                  </div>

                  {/* Attendance (heartbeat-based) */}
                  {rosterAttendance.length > 0 && (
                    <Reveal delay={550}>
                    <GlassCard hoverLift className="panel login-hours-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><Clock size={12} /> AGENT ATTENDANCE</div>
                          <h3>Connected App Time — Resets Every Monday ({rosterTimezone.replace('_', ' ')})</h3>
                        </div>
                        <span className="perf-tab active">THIS WEEK</span>
                      </div>
                      <div className="login-hours-table-wrap">
                        <table className="live-monitor-table login-hours-table">
                          <thead>
                            <tr>
                              <th>AGENT</th>
                              <th>STATUS</th>
                              <th className="num-col">TODAY</th>
                              <th className="num-col">THIS WEEK</th>
                              <th>DIALER</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rosterAttendance.map(ra => (
                              <tr key={ra.agent_id} className={`lh-row ${ra.presence === 'online' ? 'lh-logged-in' : 'lh-logged-off'}`}>
                                <td className="lh-agent">
                                  <div className={`avatar ${ra.presence === 'online' ? 'green' : ra.presence === 'disconnected' ? 'amber' : 'gray'}`}>
                                    {initials(ra.full_name)}
                                  </div>
                                  <strong>{ra.full_name}</strong>
                                </td>
                                <td>
                                  <span className={`lh-status-badge ${ra.presence === 'online' ? 'online' : ra.presence === 'disconnected' ? 'warn' : 'offline'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: presenceColor(ra.presence) }} />
                                    {presenceLabel(ra.presence).toUpperCase()}
                                    {ra.is_legacy_estimate && <span className="legacy-badge" title="Legacy estimate — pre-heartbeat session data"> est</span>}
                                  </span>
                                </td>
                                <td className="num-col lh-today">{fmtAttendanceDuration(ra.today_total_seconds)}</td>
                                <td className="num-col lh-week"><strong>{fmtAttendanceDuration(ra.week_total_seconds)}</strong></td>
                                <td>{ra.active_for_dialer ? 'Active' : 'Off'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="perf-note">
                        Connected app time, NOT proof of productive work. Historical sessions before heartbeat are labeled "est" (legacy estimate).
                      </div>
                    </GlassCard>
                    </Reveal>
                  )}

                  {/* Live Call Monitor */}
                  {liveActivity && liveActivity.recent_50 && (
                    <Reveal delay={450}>
                    <GlassCard hoverLift className="panel live-monitor-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><Activity size={12} /> LIVE CALL MONITOR</div>
                          <h3>Last 50 Calls — Rolling Feed</h3>
                        </div>
                        <div className="live-monitor-summary">
                          <span className="lms-pill"><Flame size={11} className="fire-icon" /> {liveActivity.outcome_breakdown?.fire_transfer ?? 0} transfers</span>
                          <span className="lms-pill"><Users size={11} /> {liveActivity.outcome_breakdown?.human_drop ?? 0} drops</span>
                          <span className="lms-pill">{liveActivity.outcome_breakdown?.no_answer ?? 0} no-answer</span>
                          <span className="lms-pill">{liveActivity.outcome_breakdown?.voice_message ?? 0} voicemail</span>
                          <span className="lms-pill lms-connect">Connect: {liveActivity.connect_rate ?? 0}%</span>
                          <span className="lms-pill">Avg talk: {fmtDuration(liveActivity.avg_duration_seconds)}</span>
                        </div>
                      </div>
                      <div className="live-monitor-table-wrap">
                        <table className="live-monitor-table">
                          <thead>
                            <tr>
                              <th>TIME</th>
                              <th>NAME</th>
                              <th>PHONE</th>
                              <th>AGENT</th>
                              <th>OUTCOME</th>
                              <th className="num-col">DURATION</th>
                              <th>TRANSFER</th>
                              <th>AI STOP</th>
                            </tr>
                          </thead>
                          <tbody>
                            {liveActivity.recent_50.slice(0, 50).map((c) => {
                              const phoneDisplay = displayPhone(`lm-${c.id}`, c.consumer_phone);
                              return (
                                <tr key={c.id} className={`lm-row lm-${c.queue}`}>
                                  <td className="lm-time">
                                    <span className="lm-seconds">{c.seconds_ago < 60 ? `${c.seconds_ago}s ago` : `${Math.floor(c.seconds_ago / 60)}m ago`}</span>
                                    <span className="lm-clock">{fmtTime(c.created_at)}</span>
                                  </td>
                                  <td className="lm-name">{c.consumer_name || 'Unknown'}</td>
                                  <td className="lm-phone">
                                    <span className="privacy-masked">{phoneDisplay.text}</span>
                                    {phoneDisplay.masked && c.consumer_phone && (
                                      <button className="privacy-reveal-btn" onClick={() => togglePhoneReveal(`lm-${c.id}`)} aria-label="Reveal phone">Reveal</button>
                                    )}
                                  </td>
                                  <td className="lm-agent">{c.agent_name || '—'}</td>
                                  <td><StatusPill variant={queueToPillVariant(c.queue)} /></td>
                                  <td className="num-col lm-dur">{fmtDuration(c.duration_seconds)}</td>
                                  <td className="lm-transfer">
                                    {c.transfer_status && c.transfer_status !== 'none' ? (
                                      <span className={`lm-tag ${c.transfer_status === 'completed' ? 'lm-tag-ok' : 'lm-tag-pending'}`}>{c.transfer_status}</span>
                                    ) : <span className="lm-dash">—</span>}
                                  </td>
                                  <td className="lm-ai-stop">
                                    {c.ai_terminated ? <Check size={14} className="lm-check" /> : <span className="lm-dash">—</span>}
                                  </td>
                                </tr>
                              );
                            })}
                            {liveActivity.recent_50.length === 0 && (
                              <tr><td colSpan={8} className="empty-state">No calls yet. The dialer will populate this feed as calls complete.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </GlassCard>
                    </Reveal>
                  )}

                  <AdminCharts sessionToken={sessionToken} onUnauthorized={() => atomicLogoutRef.current?.()} />
                </>
              )}

              {/* ── REDIAL TAB: redial panel with safety gates ── */}
              {dashTab === 'redial' && (
                <>
                  <div className="panel redial-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow flame-eyebrow"><Flame size={12} /> RE-DIAL CONTROL</div>
                        <h3>Re-Dial Live Transfers &amp; Live Humans</h3>
                      </div>
                      <div className="perf-toggle">
                        <span className="perf-tab active">THIS WEEK</span>
                      </div>
                    </div>
                    <p className="redial-subtitle">Max {REDIAL_CAP} records per batch. Two-step confirmation required. Disabled when campaign is active.</p>
                    {redialProgresses.map(rp => (
                      <div key={rp.batchId} className={`redial-progress-bar ${rp.type === 'humans' ? 'humans-progress' : ''}`}>
                        <div className="redial-progress-header">
                          <div className="redial-progress-title">
                            <RefreshCw size={14} className="search-spinner" />
                            <strong>Re-dialing {rp.type === 'humans' ? 'Live Humans' : 'Live Transfers'} for {rp.agentName}</strong>
                            {rp.pollData && rp.pollData.dialing === 0 && rp.pollData.pending === 0 && (
                              <span className="rp-done-badge">COMPLETE</span>
                            )}
                          </div>
                          <button className="redial-progress-close" onClick={() => { setRedialProgresses(prev => prev.filter(p => p.batchId !== rp.batchId)); removeRedialFromStorage(rp.batchId); }}>
                            <X size={14} />
                          </button>
                        </div>
                        <div className="redial-progress-stats">
                          <div className="rp-stat"><span className="rp-stat-label">DIALING</span><span className="rp-stat-value">{rp.pollData?.dialing ?? '—'}</span></div>
                          <div className="rp-stat"><span className="rp-stat-label">PLACED</span><span className="rp-stat-value">{rp.pollData?.withCallId ?? rp.dialed}</span></div>
                          <div className="rp-stat rp-stat-transfer"><span className="rp-stat-label">TRANSFERS</span><span className="rp-stat-value">{rp.pollData?.transfers ?? 0}</span></div>
                          <div className="rp-stat rp-stat-human"><span className="rp-stat-label">LIVE HUMANS</span><span className="rp-stat-value">{rp.pollData?.liveHumans ?? 0}</span></div>
                          <div className="rp-stat"><span className="rp-stat-label">VOICEMAILS</span><span className="rp-stat-value">{rp.pollData?.voicemails ?? 0}</span></div>
                          <div className="rp-stat rp-stat-fail"><span className="rp-stat-label">FAILED</span><span className="rp-stat-value">{rp.pollData?.failed ?? rp.failed}</span></div>
                          <div className="rp-stat"><span className="rp-stat-label">TOTAL</span><span className="rp-stat-value">{rp.total}</span></div>
                        </div>
                        <div className="redial-progress-track">
                          <div className={`redial-progress-fill ${rp.type === 'humans' ? 'humans-fill' : ''}`} style={{ width: `${rp.total > 0 ? Math.round(((rp.pollData?.withCallId ?? rp.dialed) / rp.total) * 100) : 0}%` }} />
                        </div>
                        {rp.calls.length > 0 && (
                          <div className="rp-calls-list">
                            {rp.calls.map(c => {
                              const statusLabel = c.queue === 'fire_transfer' ? 'TRANSFERRED' : c.queue === 'human_drop' ? 'LIVE HUMAN' : c.queue === 'no_answer' ? 'NO ANSWER' : c.queue === 'voice_message' ? 'VOICEMAIL' : c.queue === 'pending' ? (c.duration_seconds > 0 ? 'RINGING' : 'DIALING') : c.queue.toUpperCase();
                              const statusClass = c.queue === 'fire_transfer' ? 'rpc-transfer' : c.queue === 'human_drop' ? 'rpc-human' : c.queue === 'no_answer' ? 'rpc-noans' : c.queue === 'voice_message' ? 'rpc-vm' : c.queue === 'pending' ? 'rpc-dialing' : 'rpc-other';
                              return (
                                <div key={c.id} className={`rp-call-row ${statusClass}`}>
                                  <span className="rpc-name">{c.name || 'Unknown'}</span>
                                  <span className="rpc-phone">{formatPhone(c.phone)}</span>
                                  <span className="rpc-status">{statusLabel}</span>
                                  <span className="rpc-duration">{c.duration_seconds > 0 ? `${Math.round(c.duration_seconds)}s` : '—'}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Redial Analytics */}
                    {redialStats && redialStats.overall.total_batches > 0 && (
                      <div className="redial-analytics">
                        <div className="redial-analytics-header">
                          <div className="eyebrow"><Activity size={12} /> REDIAL ANALYTICS</div>
                          <div className="redial-filter-tabs">
                            <button className={`redial-filter-tab ${redialStatsFilter === 'all' ? 'active' : ''}`} onClick={() => setRedialStatsFilter('all')}>ALL ({redialStats.overall.total_batches})</button>
                            <button className={`redial-filter-tab ${redialStatsFilter === 'active' ? 'active' : ''}`} onClick={() => setRedialStatsFilter('active')}>ACTIVE ({redialStats.overall.active_batches})</button>
                            <button className={`redial-filter-tab ${redialStatsFilter === 'completed' ? 'active' : ''}`} onClick={() => setRedialStatsFilter('completed')}>COMPLETED ({redialStats.overall.total_batches - redialStats.overall.active_batches})</button>
                          </div>
                        </div>
                        <div className="redial-overall-grid">
                          <div className="redial-stat-card"><span className="rs-label">TOTAL CALLS</span><span className="rs-value">{redialStats.overall.total_calls}</span></div>
                          <div className="redial-stat-card"><span className="rs-label">PLACED</span><span className="rs-value">{redialStats.overall.total_placed}</span></div>
                          <div className="redial-stat-card"><span className="rs-label">ANSWERED</span><span className="rs-value">{redialStats.overall.total_answered}</span></div>
                          <div className="redial-stat-card"><span className="rs-label">NO ANSWER</span><span className="rs-value">{redialStats.overall.total_no_answer}</span></div>
                          <div className="redial-stat-card rs-transfer"><Flame size={14} className="fire-icon" /><span className="rs-label">TRANSFER REQUESTED</span><span className="rs-value">{redialStats.overall.total_transfer_requested}</span></div>
                          <div className="redial-stat-card rs-success"><Check size={14} /><span className="rs-label">SUCCESSFUL TRANSFERS</span><span className="rs-value">{redialStats.overall.total_transfer_successful}</span></div>
                          <div className="redial-stat-card rs-fail"><X size={14} /><span className="rs-label">FAILED TRANSFERS</span><span className="rs-value">{redialStats.overall.total_transfer_failed}</span></div>
                          <div className="redial-stat-card"><Users size={14} /><span className="rs-label">LIVE HUMANS</span><span className="rs-value">{redialStats.overall.total_live_humans}</span></div>
                          <div className="redial-stat-card"><span className="rs-label">FAILURES</span><span className="rs-value">{redialStats.overall.total_failed}</span></div>
                          <div className="redial-stat-card"><span className="rs-label">MINUTES USED</span><span className="rs-value">{redialStats.overall.total_minutes}</span></div>
                        </div>
                        <div className="redial-batch-table-wrap">
                          <table className="redial-batch-table">
                            <thead>
                              <tr>
                                <th>BATCH</th>
                                <th>AGENT</th>
                                <th>TYPE</th>
                                <th className="num-col">TOTAL</th>
                                <th className="num-col">PLACED</th>
                                <th className="num-col">TRANSFER REQ</th>
                                <th className="num-col">SUCCESSFUL</th>
                                <th className="num-col">FAILED</th>
                                <th>STATUS</th>
                              </tr>
                            </thead>
                            <tbody>
                              {redialStats.batches.filter(b => redialStatsFilter === 'all' || (redialStatsFilter === 'active' && b.is_active) || (redialStatsFilter === 'completed' && !b.is_active)).map(batch => (
                                <tr key={batch.batch_id} className={`rb-row ${batch.is_active ? 'rb-active' : ''}`}>
                                  <td className="rb-batch-id">{batch.batch_id.slice(0, 8)}...</td>
                                  <td className="rb-agent">{batch.agent_name}</td>
                                  <td className="rb-type">{batch.type === 'transfers' ? 'Transfer' : batch.type === 'humans' ? 'Human' : 'Agent'}</td>
                                  <td className="num-col">{batch.total}</td>
                                  <td className="num-col">{batch.placed}</td>
                                  <td className="num-col rb-transfer-req">{batch.transfer_requested}</td>
                                  <td className="num-col rb-success">{batch.transfer_successful}</td>
                                  <td className="num-col rb-fail">{batch.transfer_failed}</td>
                                  <td><span className={`rb-status ${batch.is_active ? 'rb-status-active' : 'rb-status-done'}`}>{batch.is_active ? 'ACTIVE' : 'DONE'}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="redial-timeframe-bar">
                      <span className="redial-timeframe-label">Timeframe:</span>
                      <button className={`redial-timeframe-btn ${redialTimeframe === 'today' ? 'active' : ''}`} onClick={() => setRedialTimeframe('today')}>Today</button>
                      <button className={`redial-timeframe-btn ${redialTimeframe === 'week' ? 'active' : ''}`} onClick={() => setRedialTimeframe('week')}>This Week</button>
                      <button className={`redial-timeframe-btn ${redialTimeframe === 'all' ? 'active' : ''}`} onClick={() => setRedialTimeframe('all')}>All Time</button>
                    </div>

                    <div className="redial-agent-list">
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).map(agent => {
                        const tf = redialTimeframe;
                        const attempts = tf === 'today' ? agent.outbound_attempts_today : tf === 'week' ? agent.outbound_attempts_week : (agent.outbound_attempts_all ?? 0);
                        const liveHumans = tf === 'today' ? agent.live_humans : tf === 'week' ? agent.live_humans_week : (agent.live_humans_all ?? 0);
                        const transfersReq = tf === 'today' ? agent.transfers_requested_today : tf === 'week' ? (agent.transfers_requested_week ?? 0) : (agent.transfers_requested_all ?? 0);
                        const talkrouteLeg = tf === 'today' ? (agent.talkroute_leg_created_today ?? 0) : tf === 'week' ? (agent.talkroute_leg_created_week ?? 0) : (agent.talkroute_leg_created_all ?? 0);
                        const talkrouteAns = tf === 'today' ? agent.talkroute_answered_today : tf === 'week' ? (agent.talkroute_answered_week ?? 0) : (agent.talkroute_answered_all ?? 0);
                        const bridgeConf = tf === 'today' ? agent.bridge_confirmed_today : tf === 'week' ? (agent.bridge_confirmed_week ?? 0) : (agent.bridge_confirmed_all ?? 0);
                        const fireTransfers = tf === 'today' ? agent.fire_transfers : tf === 'week' ? agent.fire_transfers_week : (agent.fire_transfers_all ?? 0);
                        const isDialingTransfers = redialingAgent === agent.id;
                        const isDialingHumans = redialingHumans === agent.id;
                        const sourceId = redialSourceAgent[agent.id] || agent.id;
                        const sourceAgent = adminStats.agents.find(a => a.id === sourceId);
                        const sourceTransfers = tf === 'today' ? (sourceAgent?.fire_transfers ?? 0) : tf === 'week' ? (sourceAgent?.fire_transfers_week ?? 0) : (sourceAgent?.fire_transfers_all ?? 0);
                        const sourceLiveHumans = tf === 'today' ? (sourceAgent?.live_humans ?? 0) : tf === 'week' ? (sourceAgent?.live_humans_week ?? 0) : (sourceAgent?.live_humans_all ?? 0);
                        const otherAgents = adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner') && a.id !== agent.id);
                        const campaignActive = adminStats.summary.campaign_state === 'running';
                        const tfLabel = tf === 'today' ? 'today' : tf === 'week' ? 'this week' : 'all-time';
                        return (
                          <div key={agent.id} className={`redial-agent-card ${(fireTransfers > 0 || liveHumans > 0) ? 'has-transfers' : ''} ${(isDialingTransfers || isDialingHumans) ? 'dialing' : ''}`}>
                            <div className="redial-agent-info">
                              <div className={`avatar ${agent.active_for_dialer ? 'green' : 'gray'}`}>{initials(agent.full_name)}</div>
                              <div className="redial-agent-text">
                                <strong>{agent.full_name}</strong>
                                <div className="redial-historical-grid">
                                  <span className="rh-stat"><Activity size={11} /> {attempts} attempts</span>
                                  <span className="rh-stat"><Users size={11} /> {liveHumans} live humans</span>
                                  <span className="rh-stat"><Flame size={11} /> {transfersReq} transfer req.</span>
                                  <span className="rh-stat"><Phone size={11} /> {talkrouteLeg} TR leg</span>
                                  <span className="rh-stat"><Check size={11} /> {talkrouteAns} TR answered</span>
                                  <span className="rh-stat bridge"><ShieldCheck size={11} /> {bridgeConf} bridge confirmed</span>
                                </div>
                                <div className="redial-stats">
                                  <span className="redial-count"><Flame size={13} className="fire-icon" /> {fireTransfers} transfer{fireTransfers !== 1 ? 's' : ''} <span className="redial-period">({tfLabel})</span></span>
                                  <span className="redial-count humans-count"><Users size={13} /> {liveHumans} live human{liveHumans !== 1 ? 's' : ''} <span className="redial-period">({tfLabel})</span></span>
                                </div>
                                {otherAgents.length > 0 && (
                                  <div className="redial-source-row">
                                    <label className="redial-source-label">Dial contacts from:</label>
                                    <select className="redial-source-select" value={sourceId} onChange={e => setRedialSourceAgent(prev => ({ ...prev, [agent.id]: e.target.value }))}>
                                      <option value={agent.id}>{agent.full_name} (own)</option>
                                      {otherAgents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                                    </select>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="redial-actions">
                              <button
                                className={`redial-action-btn ${sourceTransfers > 0 ? 'has-transfers' : ''} ${isDialingTransfers ? 'dialing' : ''}`}
                                disabled={sourceTransfers === 0 || isDialingTransfers || campaignActive || dataHealth.status !== 'healthy'}
                                onClick={() => openRedialModal('transfers', agent.id, agent.full_name, sourceId !== agent.id ? sourceId : undefined)}
                              >
                                {isDialingTransfers ? <><RefreshCw size={16} className="search-spinner" /> DIALING...</> : sourceTransfers > 0 ? <><Flame size={16} /> PREVIEW TRANSFER REDIAL</> : <>NO TRANSFERS</>}
                              </button>
                              <button
                                className={`redial-action-btn humans-btn ${sourceLiveHumans > 0 ? 'has-humans' : ''} ${isDialingHumans ? 'dialing' : ''}`}
                                disabled={sourceLiveHumans === 0 || isDialingHumans || campaignActive || dataHealth.status !== 'healthy'}
                                onClick={() => openRedialModal('humans', agent.id, agent.full_name, sourceId !== agent.id ? sourceId : undefined)}
                              >
                                {isDialingHumans ? <><RefreshCw size={16} className="search-spinner" /> DIALING...</> : sourceLiveHumans > 0 ? <><Phone size={16} /> PREVIEW HUMAN REDIAL</> : <>NO LIVE HUMANS</>}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).length === 0 && (
                        <div className="empty-state">No active agents.</div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* ── SETTINGS TAB: call limit, minute cap, machine waste ── */}
              {dashTab === 'transfers' && (
                <div className="glass-card" style={{ padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <ShieldCheck size={18} /> Transfer Proof Ledger
                    </h3>
                    <button className="btn-ghost" style={{ fontSize: '.8rem' }} onClick={async () => { setTransferProofLoading(true); try { const tk = localStorage.getItem('sterling_session_token'); const r = await authFetch<{since:string;agents:Record<string,unknown>[];totals:Record<string,number>}>(PROVIDER_URL, { onUnauthorized: handleLogout, body: { action: 'get_transfer_proof', session_token: tk } }); if (r.ok && r.data) setTransferProof(r.data); } catch { /* transfer proof refresh */ } finally { setTransferProofLoading(false); } }}>
                      <RefreshCw size={12} className={transferProofLoading ? 'search-spinner' : ''} /> Refresh
                    </button>
                  </div>
                  {transferProofLoading && !transferProof && <p style={{ opacity: .6, textAlign: 'center', padding: '2rem 0' }}>Loading transfer evidence...</p>}
                  {transferProof && (
                    <>
                      <p style={{ fontSize: '.78rem', opacity: .5, marginBottom: '1rem' }}>Since {new Date(transferProof.since).toLocaleString()}</p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '.75rem', marginBottom: '1.5rem' }}>
                        {[
                          { label: 'Total Outbound', val: transferProof.totals?.total_outbound ?? 0 },
                          { label: 'Transfer Req', val: transferProof.totals?.transfer_requested ?? 0 },
                          { label: 'Talkroute Dialed', val: transferProof.totals?.talkroute_dialed ?? 0 },
                          { label: 'Talkroute Answered', val: transferProof.totals?.talkroute_answered ?? 0 },
                          { label: 'Rep Speech', val: transferProof.totals?.rep_speech_detected ?? 0 },
                          { label: 'Bridge Confirmed', val: transferProof.totals?.bridge_confirmed ?? 0 },
                          { label: 'Transfer Failed', val: transferProof.totals?.transfer_failed ?? 0 },
                          { label: 'Drops Classified', val: transferProof.totals?.classified_drops ?? 0 },
                        ].map(k => (
                          <div key={k.label} className="glass-card" style={{ padding: '.75rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{k.val}</div>
                            <div style={{ fontSize: '.7rem', opacity: .6, marginTop: '.15rem' }}>{k.label}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)', textAlign: 'left' }}>
                              <th style={{ padding: '.5rem .4rem', fontWeight: 600 }}>Agent</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Outbound</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Transfer Req</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>TR Dialed</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>TR Answered</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Rep Speech</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Bridge</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Failed</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Live Humans</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>No Answer</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>VM</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>DNC</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(transferProof.agents || []).map((ag: Record<string, unknown>) => (
                              <tr key={String(ag.agent_id)} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                                <td style={{ padding: '.45rem .4rem', fontWeight: 500 }}>{String(ag.agent_name)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.total_outbound)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.transfer_requested)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.talkroute_dialed)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.talkroute_answered)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.rep_speech_detected)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right', color: Number(ag.bridge_confirmed) > 0 ? '#22c55e' : 'inherit' }}>{Number(ag.bridge_confirmed)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right', color: Number(ag.transfer_failed) > 0 ? '#ef4444' : 'inherit' }}>{Number(ag.transfer_failed)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.live_humans)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.no_answer)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.voicemail)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.dnc)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {dashTab === 'settings' && (
                <>
                  {/* Minutes / Cost */}
                  {adminStats.summary.funnel_today && (
                    <Reveal delay={300}>
                    <GlassCard hoverLift className="panel observability-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><Clock size={12} /> MINUTES &amp; COST</div>
                          <h3>Productive vs Wasted Talk Time</h3>
                        </div>
                        <span className="perf-tab active">{perfView === 'today' ? 'TODAY' : perfView === 'week' ? 'THIS WEEK' : 'ALL TIME'}</span>
                      </div>
                      {(() => {
                        const f = perfView === 'today' ? adminStats.summary.funnel_today! : perfView === 'week' ? adminStats.summary.funnel_week! : adminStats.summary.funnel_all!;
                        if (!f) return null;
                        return (
                          <div className="minutes-grid">
                            <div className="minute-card total"><span className="minute-label">TOTAL MINUTES</span><span className="minute-value">{f.total_minutes}</span></div>
                            <div className="minute-card productive"><span className="minute-label">PRODUCTIVE (bridged)</span><span className="minute-value">{f.productive_minutes}</span></div>
                            <div className="minute-card wasted"><span className="minute-label">WASTED (no-answer/machines)</span><span className="minute-value">{f.wasted_minutes}</span></div>
                            <div className="minute-card machine"><span className="minute-label">ON MACHINES</span><span className="minute-value">{f.machine_minutes}</span></div>
                            <div className="minute-card avg-ai"><span className="minute-label">AVG AI-LEG (pre-transfer)</span><span className="minute-value">{f.avg_ai_leg_seconds}s</span></div>
                          </div>
                        );
                      })()}
                    </GlassCard>
                    </Reveal>
                  )}

                  {/* Machine Waste */}
                  {adminStats.summary.funnel_today && (
                    <Reveal delay={350}>
                    <GlassCard hoverLift className="panel observability-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><Square size={12} /> MACHINE-WASTE VISIBILITY</div>
                          <h3>Answering Machine Detection</h3>
                        </div>
                      </div>
                      {(() => {
                        const f = adminStats.summary.funnel_today!;
                        if (!f) return null;
                        const slow = f.avg_machine_seconds > 8;
                        return (
                          <div className="machine-waste-row">
                            <div className="mw-stat"><span className="mw-label">MACHINES DETECTED</span><span className="mw-value">{f.machines_detected}</span></div>
                            <div className="mw-stat"><span className="mw-label">AVG MACHINE SECONDS</span><span className={`mw-value ${slow ? 'mw-slow' : ''}`}>{f.avg_machine_seconds}s</span></div>
                            {slow && <div className="mw-warning"><Zap size={14} /> Avg machine call is {f.avg_machine_seconds}s — machine-drop rule may be too slow (should be ~8s or less).</div>}
                          </div>
                        );
                      })()}
                    </GlassCard>
                    </Reveal>
                  )}

                  {/* Call Limit */}
                  <div className="panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow"><Zap size={12} /> CAMPAIGN SETTINGS</div>
                        <h3>Call Limit</h3>
                      </div>
                    </div>
                    <div className="call-limit-row">
                      <label>Maximum calls for this campaign:</label>
                      <input type="number" className="call-limit-input" value={callLimit} onChange={e => setCallLimit(parseInt(e.target.value) || 100)} min={1} />
                      <span className="call-limit-hint">The dialer stops automatically when this limit is reached.</span>
                    </div>
                  </div>

                  {/* Daily Minute Cap */}
                  <div className="panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow"><Clock size={12} /> BALANCE PROTECTION</div>
                        <h3>Daily Minute Cap</h3>
                      </div>
                    </div>
                    <div className="call-limit-row">
                      <label>Max connected minutes per day:</label>
                      <input type="number" className="call-limit-input" value={minuteCap ?? ''} onChange={e => setMinuteCap(e.target.value ? parseInt(e.target.value) : null)} min={0} placeholder="Off" />
                      <span className="call-limit-hint">
                        {adminStats?.summary?.daily_minutes_used != null && <>Today: <strong style={{ color: 'var(--gold-300)' }}>{adminStats.summary.daily_minutes_used} min</strong> used</>}
                        {minuteCap && adminStats?.summary?.daily_minutes_used != null && <> · <strong style={{ color: minuteCap > 0 && adminStats.summary.daily_minutes_used >= minuteCap ? 'var(--rust-400)' : 'var(--sage-400)' }}>{minuteCap > 0 && adminStats.summary.daily_minutes_used >= minuteCap ? 'CAP REACHED' : `${Math.round((adminStats.summary.daily_minutes_used / minuteCap) * 100)}%`}</strong></>}
                      </span>
                    </div>
                    <div style={{ marginTop: '12px' }}>
                      <GlowButton onClick={saveMinuteCap} disabled={savingCap}>{savingCap ? 'Saving...' : 'Save Cap'}</GlowButton>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── CONTACTS: Universal Search (admin) ─────────────────────────── */}
          {isOwner && activeNav === 'contacts' && (
            <ContactsView searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              searchResults={searchResults} setSearchResults={setSearchResults}
              searching={searching} setSearching={setSearching}
              expandedContact={expandedContact} setExpandedContact={setExpandedContact}
              searchTimerRef={searchTimerRef} sessionToken={sessionToken}
              onPhoneClick={(name, phone) => setPhoneAction({ name, phone })}
              onUnauthorized={() => atomicLogoutRef.current?.()}
            />
          )}

          {/* ── CONTACTS: Universal Search (agent) ─────────────────────────── */}
          {!isOwner && activeNav === 'contacts' && (
            <ContactsView searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              searchResults={searchResults} setSearchResults={setSearchResults}
              searching={searching} setSearching={setSearching}
              expandedContact={expandedContact} setExpandedContact={setExpandedContact}
              searchTimerRef={searchTimerRef} sessionToken={sessionToken}
              onPhoneClick={(name, phone) => setPhoneAction({ name, phone })}
              onUnauthorized={() => atomicLogoutRef.current?.()}
            />
          )}

          {/* ── ADMIN: Leads Upload ──────────────────────────────────────── */}
          {isOwner && activeNav === 'leads' && (
            <>
              <SectionHero image={CINEMATIC_HERO.commandCenter} eyebrow="LEAD MANAGEMENT" title="Upload Leads" subtitle="Upload a CSV file with NAME and PHONE columns. Each number will be dialed exactly once." />
              <div className="hero-row">
                <div>
                  <div className="eyebrow"><Upload size={12} /> LEAD MANAGEMENT</div>
                  <h2>Upload Leads</h2>
                  <p>Upload a CSV file with NAME and PHONE columns. Each number will be dialed exactly once.</p>
                </div>
              </div>

              {leadPool && (() => {
                const fresh = leadPool.fresh ?? leadPool.new ?? 0;
                const called = leadPool.called ?? 0;
                const suppressed = leadPool.suppressed ?? 0;
                const invalid = leadPool.invalid ?? 0;
                const excludedOther = leadPool.excluded_other ?? 0;
                const dataQuality = leadPool.data_quality ?? 0;
                const bucketSum = fresh + called + suppressed + invalid + excludedOther + dataQuality;
                const reconciled = bucketSum === leadPool.total;
                return (
                <div className="lead-pool-breakdown">
                  <div className="lead-pool-total-row">
                    <div className="stat-card lead-pool-total">
                      <FileUp className="stat-icon" size={20} />
                      <span className="stat-label">TOTAL LEADS</span>
                      <span className="stat-value">{leadPool.total}</span>
                    </div>
                    <div className={`lead-pool-reconciliation-badge ${reconciled ? 'reconciled' : 'mismatch'}`}>
                      {reconciled ? `Buckets sum to ${leadPool.total}` : `Buckets sum to ${bucketSum} \u2260 ${leadPool.total}`}
                    </div>
                  </div>
                  <div className="lead-pool-buckets">
                    <div className="lead-bucket fresh">
                      <span className="bucket-label">FRESH</span>
                      <span className="bucket-value">{fresh}</span>
                      <span className="bucket-hint">Not yet dialed</span>
                    </div>
                    <div className="lead-bucket called">
                      <span className="bucket-label">CALLED</span>
                      <span className="bucket-value">{called}</span>
                      <span className="bucket-hint">Dialed, no suppression</span>
                    </div>
                    <div className="lead-bucket suppressed">
                      <span className="bucket-label">SUPPRESSED</span>
                      <span className="bucket-value">{suppressed}</span>
                      <span className="bucket-hint">DNC flagged</span>
                    </div>
                    <div className="lead-bucket invalid">
                      <span className="bucket-label">INVALID</span>
                      <span className="bucket-value">{invalid}</span>
                      <span className="bucket-hint">Wrong number</span>
                    </div>
                    <div className="lead-bucket excluded">
                      <span className="bucket-label">EXCLUDED / OTHER</span>
                      <span className="bucket-value">{excludedOther}</span>
                      <span className="bucket-hint">Closed, agent-assigned, no call</span>
                    </div>
                    <div className="lead-bucket unclassified">
                      <span className="bucket-label">DATA QUALITY</span>
                      <span className="bucket-value">{dataQuality}</span>
                      <span className="bucket-hint">Closed, no call record, unassigned</span>
                    </div>
                  </div>
                </div>
                );
              })()}

              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow"><FileUp size={12} /> CSV UPLOAD</div>
                    <h3>Drop your lead list</h3>
                  </div>
                  <button className="primary-button" onClick={async () => {
                    try {
                      const tk = localStorage.getItem('sterling_session_token');
                      if (!tk) { alert('You must be logged in'); return; }
                      const ak = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? '';
                      const res = await fetch(`${SUPABASE_URL}/functions/v1/wolf-export-humans?token=${encodeURIComponent(tk)}`, {
                        headers: { Authorization: `Bearer ${ak}`, apikey: ak },
                      });
                      if (!res.ok) throw new Error('Download failed');
                      const blob = await res.blob();
                      const u = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = u; a.download = 'human-contacts-all-time.csv'; a.click();
                      URL.revokeObjectURL(u);
                    } catch { alert('Download failed — try again'); }
                  }}>
                    <Download size={14} /> Download Live Humans CSV
                  </button>
                </div>
                <div className="upload-zone"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                  onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                  onDrop={(e) => {
                    e.preventDefault(); e.currentTarget.classList.remove('drag-over');
                    const file = e.dataTransfer.files[0];
                    if (file) handleUploadLeads(file);
                  }}
                  onClick={() => fileInputRef.current?.click()}>
                  <Upload size={36} />
                  <strong>Drop CSV here or click to browse</strong>
                  <span>Columns: NAME, PHONE, ADDRESS, INCOME RANGE, HOME VALUE</span>
                  <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadLeads(f); }} />
                </div>
                {importing && <div className="upload-progress">Importing leads...</div>}
              </div>
            </>
          )}

          {/* ── ADMIN: Call Log ───────────────────────────────────────────── */}
          {isOwner && activeNav === 'calls' && (
            <CallLogView expandedCall={expandedCall} setExpandedCall={setExpandedCall}
              sessionToken={sessionToken} onUnauthorized={() => atomicLogoutRef.current?.()} />
          )}

          {/* ── AGENT: Secretary ──────────────────────────────────────────── */}
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

          {/* ── AGENT: Incoming Transfer Panel ──────────────────────── */}
          {!isOwner && (
            <IncomingTransferPanel
              transfers={activeTransfers}
              loading={activeTransfersLoading}
              error={activeTransfersError}
              onDismiss={(id) => setDismissedTransferIds(prev => new Set(prev).add(id))}
            />
          )}

          {/* ── AGENT: Dashboard Cockpit ────────────────────────────────── */}
          {!isOwner && activeNav === 'dashboard' && (
            <AgentCockpit
              agentName={session?.agent?.full_name ?? 'Agent'}
              available={agentAvailable}
              togglingAvail={togglingAvail}
              onToggleAvail={handleToggleAvailability}
              fireTransfers={(queues?.fire_transfers ?? []) as QueueRecord[]}
              humanDrops={(queues?.human_drop ?? []) as QueueRecord[]}
              todayStats={agentTodayStats}
              onNavTo={setActiveNav}
              activeNav={activeNav}
            />
          )}

          {/* ── AGENT/OWNER: Opportunities Feed ──────────────────────── */}
          {activeNav === 'opportunities' && (
            <OpportunitiesFeed
              sessionToken={sessionToken}
              onUnauthorized={handleLogout}
              isOwner={isOwner}
              onCallback={(name, phone) => {
                setSecClientName(name);
                setSecClientPhone(phone);
                setActiveNav('secretary');
              }}
            />
          )}

          {/* ── AGENT: Workspace (replaces old Call Now) ──────────────── */}
          {!isOwner && activeNav === 'calls' && (
            <AgentWorkspaceView
              providerUrl={PROVIDER_URL}
              sessionToken={sessionToken}
              onUnauthorized={() => atomicLogoutRef.current?.()}
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

          {/* ── AGENT: Saved Transfers ────────────────────────────────────── */}
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

          {/* ── ADMIN: Saved Transfers History ────────────────────────────── */}
          {isOwner && activeNav === 'saved' && (
            <AdminSavedTransfersView
              savedTransfers={allSavedTransfers}
              loading={loadingAllSaved}
              onLoad={() => loadAllSavedTransfers(sessionToken)}
              expandedCall={expandedCall}
              setExpandedCall={setExpandedCall}
              error={allSavedTransfersError}
            />
          )}
        </div>
      </div>
      {phoneAction && !isOwner && (
        <PhoneActionModal
          name={phoneAction.name} phone={phoneAction.phone}
          onClose={() => setPhoneAction(null)}
          onSecretaryCall={() => placeQuickSecretaryCall(phoneAction.name, phoneAction.phone)}
          placingSecretaryCall={placingQuickSecretaryCall}
        />
      )}
      {isOwner && (
        <StartPreflightModal
          open={showPreflight}
          onClose={() => setShowPreflight(false)}
          checks={preflightLoading ? [] : preflightChecks}
          onConfirm={startCampaign}
          starting={startingCampaign}
          error={preflightError}
        />
      )}
      {isOwner && (
        <RedialConfirmModal
          open={showRedialModal}
          onClose={() => { setShowRedialModal(false); setPendingRedialAction(null); setRedialModalError(null); }}
          preview={redialPreview}
          onConfirm={confirmRedial}
          dialing={redialingAgent !== null || redialingHumans !== null}
          error={redialModalError}
        />
      )}
      {showOfflineModal && !isOwner && (
        <div className="modal-overlay" onClick={() => setShowOfflineModal(false)}>
          <div className="offline-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowOfflineModal(false)}><X size={18} /></button>
            <PhoneOff size={32} className="offline-modal-icon" />
            <h2>You are OFFLINE</h2>
            <p>You will NOT receive any calls until you tap <strong>Go Available</strong>.</p>
            <button className="primary-button go-available-btn" onClick={() => { handleToggleAvailability(); }} disabled={togglingAvail}>
              {togglingAvail ? 'Switching...' : <><Phone size={14} /> Go Available</>}
            </button>
            <button className="secondary-button stay-offline-btn" onClick={() => setShowOfflineModal(false)}>
              Stay Offline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Data Health Banner ───────────────────────────────────────────────────
function DataHealthBanner({ health }: { health: DataHealth }) {
  if (health.status === 'healthy' && health.lastSuccess) {
    const ago = Math.round((Date.now() - health.lastSuccess) / 1000);
    return (
      <div className="data-health-banner healthy">
        <Check size={14} /> Live data healthy · last refreshed {ago}s ago
      </div>
    );
  }
  if (health.status === 'loading') {
    return (
      <div className="data-health-banner loading">
        <RefreshCw size={14} className="search-spinner" /> Loading dashboard data...
      </div>
    );
  }
  if (health.status === 'degraded') {
    return (
      <div className="data-health-banner degraded">
        <WifiOff size={14} /> Data degraded — {health.failedAction} failed: {health.failedMessage || 'unknown error'}.
        Showing last known good data.
      </div>
    );
  }
  return null;
}

// ── Call List Component ──────────────────────────────────────────────────
function CallList({ records, loading, expandedCall, setExpandedCall, onPhoneClick, emptyText, selectable, selectedIds, onToggleSelect, onSaveTransfer, savingTransferIds, sessionToken, onUnauthorized }: {
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
                <Flame size={12} /> {isFireTransfer ? 'HOT TRANSFER' : 'LIVE HUMAN'}
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
              {call.is_dnc && <div className="detail-row"><span>Do Not Call:</span><strong>Yes</strong></div>}
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

// ── Saved Transfers View (Agent) ──────────────────────────────────────────
function SavedTransfersView({ savedTransfers, loading, onDelete, onPhoneClick, expandedCall, setExpandedCall }: {
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

// ── Admin Saved Transfers History View ────────────────────────────────────
function AdminSavedTransfersView({ savedTransfers, loading, onLoad, expandedCall, setExpandedCall, error }: {
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

// ── Redial Transcript Panel ──────────────────────────────────────────────
// ── Admin Call Log View ──────────────────────────────────────────────────
function CallLogView({ expandedCall, setExpandedCall, sessionToken, onUnauthorized }: {
  expandedCall: string | null; setExpandedCall: (id: string | null) => void;
  sessionToken: string;
  onUnauthorized: () => void;
}) {
  const [allCalls, setAllCalls] = useState<QueueRecord[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [callLogError, setCallLogError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [agentFilter] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    let mounted = true;
    setOffset(0);
    const loadCalls = async () => {
      setLoadingAll(true);
      setCallLogError(null);
      try {
        const result = await authFetch(PROVIDER_URL, {
          body: {
            action: 'get_call_log', session_token: sessionToken,
            outcome: filter, agent_id: agentFilter !== 'all' ? agentFilter : undefined,
            limit: PAGE_SIZE, offset: 0,
          },
          onUnauthorized,
        });
        if (!mounted) return;
        if (result.ok && result.data) {
          const d = result.data as Record<string, unknown>;
          setAllCalls((d.records || []) as QueueRecord[]);
          setHasMore(!!d.has_more);
          setTotal((d.total as number) || ((d.records as unknown[]) || []).length);
        } else {
          if (!result.loggedOut) setCallLogError(result.error || `HTTP ${result.status}`);
          setAllCalls([]);
        }
      } catch {
        if (!mounted) return;
        setCallLogError('Unexpected error');
        setAllCalls([]);
      } finally {
        if (mounted) setLoadingAll(false);
      }
    };
    loadCalls();
    return () => { mounted = false; };
  }, [sessionToken, filter, agentFilter, onUnauthorized]);

  const loadMore = async () => {
    const nextOffset = offset + PAGE_SIZE;
    setLoadingAll(true);
    setCallLogError(null);
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: {
          action: 'get_call_log', session_token: sessionToken,
          outcome: filter, agent_id: agentFilter !== 'all' ? agentFilter : undefined,
          limit: PAGE_SIZE, offset: nextOffset,
        },
        onUnauthorized,
      });
      if (result.ok && result.data) {
        const d = result.data as Record<string, unknown>;
        setAllCalls(prev => [...prev, ...((d.records || []) as QueueRecord[])]);
        setHasMore(!!d.has_more);
        setTotal((d.total as number) || 0);
        setOffset(nextOffset);
      } else {
        if (!result.loggedOut) setCallLogError(result.error || `HTTP ${result.status}`);
      }
    } catch {
      setCallLogError('Unexpected error');
    } finally {
      setLoadingAll(false);
    }
  };

  return (
    <>
      <SectionHero image={CINEMATIC_HERO.commandCenter} eyebrow="CALL HISTORY" title="Call History — Every Connection" subtitle="Every call the dialer has placed, with full transcripts, recordings, and transfer status." />
      <div className="hero-row">
        <div>
          <div className="eyebrow"><Phone size={12} /> CALL HISTORY</div>
          <h2>Call History</h2>
          <p>Every call across all outcomes — transfers, drops, no-answers, and voicemails. Newest first.</p>
        </div>
        <div className="hero-actions">
          <select className="filter-select" value={filter} onChange={e => { setFilter(e.target.value); }}>
            <option value="all">All Calls</option>
            <option value="fire_transfer">Transferred</option>
            <option value="human_drop">Dropped</option>
            <option value="no_answer">No Answer</option>
            <option value="voice_message">Voicemail</option>
            <option value="pending">Dialing</option>
          </select>
        </div>
      </div>
      {callLogError && (
        <div className="data-health-banner degraded" style={{ marginBottom: 12 }}>
          <WifiOff size={14} /> Failed to load call history: {callLogError}
        </div>
      )}
      <CallList records={allCalls} loading={loadingAll}
        sessionToken={sessionToken} onUnauthorized={onUnauthorized}
        expandedCall={expandedCall} setExpandedCall={setExpandedCall} onPhoneClick={() => {}}
        emptyText={callLogError ? 'Could not load calls — see error above.' : 'No calls match this filter.'} />
      {hasMore && (
        <div style={{ textAlign: 'center', margin: '16px 0' }}>
          <button className="secondary-button" onClick={loadMore} disabled={loadingAll}>
            {loadingAll ? <RefreshCw size={14} className="search-spinner" /> : <Download size={14} />} Load More
          </button>
        </div>
      )}
      {!loadingAll && allCalls.length > 0 && (
        <div style={{ textAlign: 'center', color: 'var(--steel-400)', fontSize: 12, marginBottom: 16 }}>
          Showing {allCalls.length} of {total} calls
        </div>
      )}
    </>
  );
}

// ── Contacts Search View ─────────────────────────────────────────────────
function ContactsView({ searchQuery, setSearchQuery, searchResults, setSearchResults,
  searching, setSearching, expandedContact, setExpandedContact, searchTimerRef, sessionToken, onPhoneClick, onUnauthorized,
}: {
  searchQuery: string; setSearchQuery: (v: string) => void;
  searchResults: ContactResult[]; setSearchResults: (v: ContactResult[]) => void;
  searching: boolean; setSearching: (v: boolean) => void;
  expandedContact: string | null; setExpandedContact: (v: string | null) => void;
  searchTimerRef: ReturnType<typeof useRef<ReturnType<typeof setTimeout> | null>>;
  sessionToken: string; onPhoneClick: (name: string, phone: string) => void;
  onUnauthorized: () => void;
}) {
  const searchInFlightRef = useRef(false);
  const [searchError, setSearchError] = useState(false);
  const searchOffsetRef = useRef(0);
  const [hasMore, setHasMore] = useState(false);
  const currentQueryRef = useRef('');
  const requestTokenRef = useRef(0);

  const doSearch = async (query: string, offset: number = 0) => {
    if (!query.trim()) { setSearchResults([]); setHasMore(false); setSearchError(false); return; }
    // Stale guard: each request gets a token; only the latest token's response is applied
    const token = ++requestTokenRef.current;
    currentQueryRef.current = query;
    searchOffsetRef.current = offset;
    // Reset results immediately on a new query (offset 0) so old results don't linger
    if (offset === 0) { setSearchResults([]); setHasMore(false); }
    setSearchError(false);
    setSearching(true);
    searchInFlightRef.current = true;
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'search_contacts', session_token: sessionToken, search_text: query, offset },
        onUnauthorized,
      });
      // Drop stale responses — a newer query or Load More superseded this one
      if (token !== requestTokenRef.current) return;
      if (result.ok && result.data) {
        const newResults = ((result.data as Record<string, unknown>).results || []) as ContactResult[];
        if (offset === 0) {
          setSearchResults(newResults);
        } else {
          const existingIds = new Set(searchResults.map(r => r.id));
          setSearchResults([...searchResults, ...newResults.filter(r => !existingIds.has(r.id))]);
        }
        setHasMore(newResults.length >= 50);
      } else {
        if (offset === 0) setSearchResults([]);
        setSearchError(true);
      }
    } catch {
      if (token !== requestTokenRef.current) return;
      if (offset === 0) setSearchResults([]);
      setSearchError(true);
    } finally {
      if (token === requestTokenRef.current) { setSearching(false); searchInFlightRef.current = false; }
    }
  };

  const loadMore = () => {
    if (searchInFlightRef.current || !hasMore) return;
    doSearch(currentQueryRef.current, searchOffsetRef.current + 50);
  };

  const onSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => doSearch(val), 350);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      doSearch(searchQuery);
    }
  };

  return (
    <>
      <SectionHero image={CINEMATIC_HERO.commandCenter} eyebrow="CONTACT DIRECTORY" title="Search Contacts" subtitle="Search every contact by name, phone number, or address. Covers both leads and call records across all campaigns." />
      <div className="hero-row">
        <div>
          <div className="eyebrow"><Search size={12} /> CONTACT DIRECTORY</div>
          <h2>Search Contacts</h2>
          <p>Search every contact we've ever had — by name, phone number, or address. Covers both leads and call records across all campaigns.</p>
        </div>
      </div>

      <div className="panel search-panel">
        <div className="search-bar-wrap">
          <Search size={20} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search by name, phone, address, or email..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            autoFocus
          />
          {searching && <RefreshCw size={18} className="search-spinner" />}
          {searchQuery && !searching && (
            <button className="search-clear" onClick={() => { setSearchQuery(''); setSearchResults([]); }}>
              <X size={16} />
            </button>
          )}
        </div>
        {searchQuery && (
          <div className="search-meta">
            {searching ? 'Searching...' : searchError ? 'Search failed — try again' : `${searchResults.length} contact${searchResults.length !== 1 ? 's' : ''} found`}
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
                    <strong>{contact.consumer_name || 'Unknown'}</strong>
                    <button className="phone-link" onClick={(event) => { event.stopPropagation(); onPhoneClick(contact.consumer_name || 'Contact', contact.phone_normalized || contact.phone); }}>
                      <Phone size={11} /> {formatPhone(contact.phone)}
                    </button>
                    {contact.custom_fields && typeof contact.custom_fields === 'object' && 'email' in contact.custom_fields && Boolean(contact.custom_fields.email) && (
                      <span className="card-address" style={{ color: '#6db8d4' }}> · {String(contact.custom_fields.email)}</span>
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
                  {contact.is_dnc && (
                    <span className="queue-badge" style={{ color: '#e8623a', borderColor: '#e8623a' }}>
                      DNC
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
                    <div className="detail-row"><span>Phone:</span><strong>{formatPhone(contact.phone)}</strong></div>
                    <div className="detail-row"><span>Address:</span><strong>{contact.address || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Income Range:</span><strong>{contact.income_range || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Home Value:</span><strong>{contact.home_value || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Property Info:</span><strong>{contact.property_information || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Lead Source:</span><strong>{contact.lead_source || 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Lead Status:</span><strong>{contact.lead_status ? contact.lead_status.toUpperCase() : 'Not on file'}</strong></div>
                    <div className="detail-row"><span>Priority Lead:</span><strong>{contact.is_priority ? 'Yes' : 'No'}</strong></div>
                    {contact.original_agent_information && <div className="detail-row"><span>Original Agent Info:</span><strong>{contact.original_agent_information}</strong></div>}
                    {contact.custom_fields && typeof contact.custom_fields === 'object' && 'email' in contact.custom_fields && Boolean(contact.custom_fields.email) && (
                      <div className="detail-row"><span>Email:</span><strong>{String(contact.custom_fields.email)}</strong></div>
                    )}
                  </div>
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
                    {contact.is_dnc && <div className="detail-row"><span>Do Not Call:</span><strong>Yes</strong></div>}
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
          <div className="empty-state">No contacts found matching "{searchQuery}". Try a different name, phone number, or address.</div>
        </div>
      )}

      {searchError && !searching && (
        <div className="panel">
          <div className="empty-state error-banner">Search failed. Check your connection and try again. If the problem persists, your session may have expired.</div>
        </div>
      )}

      {!searchQuery && (
        <div className="panel">
          <div className="empty-state">Start typing a name, phone number, or address to search all contacts.</div>
        </div>
      )}
    </>
  );
}

// ── Secretary View ───────────────────────────────────────────────────────
function SecretaryView({ secretaryCalls, setSecretaryCalls, loadingSecretary, setLoadingSecretary,
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
        setNotice(`Elizabeth is calling ${secClientName}...`);
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
      failed: 'Failed', dnc_blocked: 'DNC Blocked',
    };
    return map[status] || status;
  };

  return (
    <>
      <SectionHero image={CINEMATIC_HERO.agentMomentum} eyebrow="YOUR SECRETARY" title="Elizabeth Sterling" subtitle="Send Elizabeth to call a contact and transfer the live human to your line — or leave a reminder message." />
      <div className="hero-row">
        <div>
          <div className="eyebrow"><Send size={12} /> SECRETARY</div>
          <h2>Elizabeth Will Call for You</h2>
          <p>Give Elizabeth a name and number. She'll call on your behalf, introduce you, and transfer the prospect straight to your Talkroute line.</p>
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
                    <RecordingPlayer url={call.recording_url} />
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

// ── Phone Action Modal ───────────────────────────────────────────────────
function PhoneActionModal({ name, phone, onClose, onSecretaryCall, placingSecretaryCall }: {
  name: string; phone: string; onClose: () => void;
  onSecretaryCall: () => void; placingSecretaryCall: boolean;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="phone-action-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="phone-action-header">
          <div className="phone-action-avatar">{initials(name || '?')}</div>
          <div>
            <strong>{name || 'Unknown'}</strong>
            <span>{phone}</span>
          </div>
        </div>
        <div className="phone-action-options">
          <button className="phone-action-option" onClick={onSecretaryCall} disabled={placingSecretaryCall}>
            <div className="phone-action-icon secretary-icon"><Send size={22} /></div>
            <div className="phone-action-text">
              <strong>Send Elizabeth</strong>
              <span>Secretary calls &amp; transfers to you</span>
            </div>
            {placingSecretaryCall && <RefreshCw size={16} className="search-spinner" />}
          </button>
          <a className="phone-action-option" href={`tel:${phone}`}>
            <div className="phone-action-icon talkroute-icon"><Phone size={22} /></div>
            <div className="phone-action-text">
              <strong>Call via Talkroute</strong>
              <span>Dial from your Talkroute line</span>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
