import { canMonitor } from '@/modules/monitoring/api';
import { AdminStats,ContactResult,DataHealth,DIALER_CONTROLS_URL,FEDERAL_ONE_V2_URL,getETTime,LeadPool,PROVIDER_URL,providerFetch,QueueRecord,RosterAttendanceRow,SavedTransfer,SecretaryCall,TeamHealth } from "@/app/shared";
import { type ActiveTransfer,type RedialPreview,type TransferAlert } from '@/components';
import type { AgentTodayStats } from '@/components/AgentCockpit';
import { useLoginLifecycle,useLoginState } from "@/modules/login/useLoginSession";
import { authFetch } from '@/utils/auth-fetch';
import { maskPhone } from '@/utils/privacy';
import { useContactSearch } from '@/utils/useContactSearch';
import { useHeartbeat,type AttendanceInfo as HeartbeatAttendance } from '@/utils/useHeartbeat';
import {
Bookmark,
FileText,
Flame,Inbox,LayoutDashboard,
Phone,
Search,Send,
Settings,
Upload,Users
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState } from 'react';
export function useApplicationModel() {
const login = useLoginState();
const { session,setSession,pin,setPin,loginError,setLoginError,loggingIn,setLoggingIn,loginInFlight,sessionToken,setSessionToken,ownerNeedsSetup,setOwnerNeedsSetup,setupPin,setSetupPin,setupConfirm,setSetupConfirm,setupError,setSetupError,settingUp,setSettingUp } = login;
const [activeNav, setActiveNav] = useState('dashboard');

const [notice, setNotice] = useState('');

const [etClock, setEtClock] = useState(getETTime());

const [adminStats, setAdminStats] = useState<AdminStats | null>(null);

const [teamHealth, setTeamHealth] = useState<TeamHealth | null>(null);

const [, setLoadingAdmin] = useState(false);

const [callLimit, setCallLimit] = useState(500);

const [dialerLines, setDialerLines] = useState(3);

const dialerControlsBusy = useRef(false);

const [savingSpeed, setSavingSpeed] = useState(false);

const [speedNotice, setSpeedNotice] = useState<string | null>(null);

const [minuteCap, setMinuteCap] = useState<number | null>(null);

const [savingCap, setSavingCap] = useState(false);

const [myAttendance, setMyAttendance] = useState<HeartbeatAttendance | null>(null);

const [attendanceError, setAttendanceError] = useState<string | null>(null);

const [rosterAttendance, setRosterAttendance] = useState<RosterAttendanceRow[]>([]);

const [rosterTimezone, setRosterTimezone] = useState<string>('America/New_York');

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

const [queues, setQueues] = useState<{ human_drop: QueueRecord[]; fire_transfers: QueueRecord[] } | null>(null);

const [, setLoadingQueues] = useState(false);

const [expandedCall, setExpandedCall] = useState<string | null>(null);

const [leadPool, setLeadPool] = useState<LeadPool | null>(null);

const [importing, setImporting] = useState(false);

const fileInputRef = useRef<HTMLInputElement>(null);

const [perfView, setPerfView] = useState<'today' | 'week' | 'all'>('today');

const [secretaryCalls, setSecretaryCalls] = useState<SecretaryCall[]>([]);

const [loadingSecretary, setLoadingSecretary] = useState(false);

const [secClientName, setSecClientName] = useState('');

const [secClientPhone, setSecClientPhone] = useState('');

const [secMode, setSecMode] = useState<'reminder' | 'transfer'>('transfer');

const [secCustomMsg, setSecCustomMsg] = useState('');

const [placingSecCall, setPlacingSecCall] = useState(false);

const [expandedSecCall, setExpandedSecCall] = useState<string | null>(null);

const [phoneAction, setPhoneAction] = useState<{ name: string; phone: string; email?: string; address?: string } | null>(null);

const [placingQuickSecretaryCall, setPlacingQuickSecretaryCall] = useState(false);

const [dashTab, setDashTab] = useState<'overview' | 'agents' | 'redial' | 'transfers' | 'settings'>('overview');

const [transferProof, setTransferProof] = useState<{ since: string; agents: Record<string,unknown>[]; totals: Record<string,number> } | null>(null);

const [transferProofLoading, setTransferProofLoading] = useState(false);

const [dialerError, setDialerError] = useState('');

const [showRedialModal, setShowRedialModal] = useState(false);

const [redialPreview, setRedialPreview] = useState<RedialPreview | null>(null);

const [, setRedialModalLoading] = useState(false);

const [redialModalError, setRedialModalError] = useState<string | null>(null);

const [pendingRedialAction, setPendingRedialAction] = useState<{ type: 'transfers' | 'humans'; agentId: string; agentName: string; sourceAgentId?: string } | null>(null);

const [redialTimeframe, setRedialTimeframe] = useState<'today' | 'week' | 'all'>('all');

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

const [redialingAgent, setRedialingAgent] = useState<string | null>(null);

const [redialingHumans, setRedialingHumans] = useState<string | null>(null);

const [redialSourceAgent, setRedialSourceAgent] = useState<Record<string, string>>({});

type RedialProgressEntry = { agentId: string; agentName: string; type: 'transfers' | 'humans'; total: number; dialed: number; failed: number; results: Array<{ phone: string; success: boolean; error?: string }>; batchId: string; pollData: { total: number; withCallId: number; pending: number; answered: number; noAnswer: number; failed: number; dialing: number; voicemails?: number; transfers?: number; liveHumans?: number } | null; calls: Array<{ id: string; name: string; phone: string; queue: string; is_completed: boolean; duration_seconds: number; transfer_status: string; is_live_human: boolean }> };

const [redialProgresses, setRedialProgresses] = useState<RedialProgressEntry[]>([]);

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

const [selectedRedialIds, setSelectedRedialIds] = useState<Set<string>>(new Set());

const [agentRedialing, setAgentRedialing] = useState(false);

const [agentRedialBatchId, setAgentRedialBatchId] = useState<string | null>(null);

const [redialTranscripts, setRedialTranscripts] = useState<Array<{ id: string; name: string; phone: string; status: string; duration: number; transcript: string; ai_summary: string; is_completed: boolean; transfer_status: string; is_live_human: boolean; voicemail_status: string }>>([]);

const [redialPollTimer, setRedialPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);

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

const contactSearch = useContactSearch<ContactResult>(PROVIDER_URL, sessionToken, () => atomicLogoutRef.current?.());

const [expandedContact, setExpandedContact] = useState<string | null>(null);

const [extraInfoPrefill, setExtraInfoPrefill] = useState<{ name?: string; phone?: string; address?: string; email?: string } | null>(null);

const [activeTransfers, setActiveTransfers] = useState<ActiveTransfer[]>([]);

const [activeTransfersLoading, setActiveTransfersLoading] = useState(false);

const [activeTransfersError, setActiveTransfersError] = useState<string | null>(null);

const [, setDismissedTransferIds] = useState<Set<string>>(new Set());

const [transferAlerts, setTransferAlerts] = useState<TransferAlert[]>([]);

const [savedTransfers, setSavedTransfers] = useState<SavedTransfer[]>([]);

const [loadingSaved, setLoadingSaved] = useState(false);

const [allSavedTransfers, setAllSavedTransfers] = useState<SavedTransfer[]>([]);

const [loadingAllSaved, setLoadingAllSaved] = useState(false);

const [savingTransferIds, setSavingTransferIds] = useState<Set<string>>(new Set());

const [liveActivity, setLiveActivity] = useState<{
    recent_50: Array<{
      id: string; consumer_name: string; consumer_phone: string; queue: string;
      is_live_human: boolean; is_completed: boolean; transfer_status: string;
      ai_terminated: boolean; talkroute_answered: boolean; agent_name: string | null;
      duration_seconds: number; created_at: string; seconds_ago: number;
    }>;
    outcome_breakdown: { bridged?: number; fire_transfer: number; human_drop: number; no_answer: number; voice_message: number; pending: number };
    avg_duration_seconds: number; connect_rate: number;
    campaign_state: string; agents_activated: number;
  } | null>(null);

const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

const ownerPollingRef = useRef(false);

const agentPollingRef = useRef(false);

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

const [dataHealth, setDataHealth] = useState<DataHealth>({
    status: 'loading', lastSuccess: null, failedAction: null, failedMessage: null,
  });

const dataHealthRef = useRef(dataHealth);

dataHealthRef.current = dataHealth;

const sessionTokenRef = useRef(sessionToken);

sessionTokenRef.current = sessionToken;

const sessionRef = useRef(session);

sessionRef.current = session;

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
    contactSearch.onSearchChange('');
    setSecretaryCalls([]);
    setAgentAvailable(false);
    setShowOfflineModal(false);
    setDialerError('');
    setShowRedialModal(false);
    setPhoneAction(null);
    setExpandedCall(null);
    setExpandedContact(null);
    ownerPollingRef.current = false;
    agentPollingRef.current = false;
    // activeNav preserved as safe return destination
  }, []);

atomicLogoutRef.current = atomicLogout;
const { handleLogin, handleLogout, handleOwnerSetup } = useLoginLifecycle({ ...login, setAgentAvailable,setActiveNav,setShowOfflineModal,atomicLogout });

useEffect(() => {
    const interval = setInterval(() => setEtClock(getETTime()), 1000);
    return () => clearInterval(interval);
  }, []);

useEffect(() => {
    if (!session?.valid || !sessionToken) return;
    if (session.agent?.role !== 'owner' && session.agent?.role !== 'administrator') return;
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

const loadAdminStats = useCallback(async (token: string) => {
    setLoadingAdmin(true);
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_admin_stats', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        const raw = ((result.data as Record<string, unknown>).admin_stats || result.data) as Record<string, unknown>;
        const summary = { ...(raw.summary as Record<string, unknown>) };
        for (const windowName of ['today', 'week', 'all']) {
          const funnel = (raw[`funnel_${windowName}`] || summary[`funnel_${windowName}`]) as Record<string, number> | undefined;
          if (!funnel) continue;
          summary[`funnel_${windowName}`] = funnel;
          for (const [field, source] of Object.entries({transfers_requested:'transfers_requested',talkroute_dialed:'talkroute_dialed',agent_answered:'agent_answered',bridge_confirmed:'bridge_confirmed',transfer_failed_unverified:'transfer_failed_unverified'})) {
            if (summary[`${field}_${windowName}`] == null && funnel[source] != null) summary[`${field}_${windowName}`] = funnel[source];
          }
        }
        const stats = { ...raw, summary };

        adminStatsRef.current = stats as AdminStats;
        setAdminStats(stats as AdminStats);
        const s = stats as Record<string, unknown>;
        const loadedSummary = s.summary as Record<string, unknown> | undefined;
        if (loadedSummary?.provider_call_limit) setCallLimit(loadedSummary.provider_call_limit as number);
        if (loadedSummary?.daily_minute_cap !== undefined) setMinuteCap(loadedSummary.daily_minute_cap as number);
        const conc = loadedSummary?.concurrency as number | undefined;
        if (conc && conc > 0) setDialerLines(conc);
        setDataHealth({ status: 'healthy', lastSuccess: Date.now(), failedAction: null, failedMessage: null });
        const healthResult = await authFetch<TeamHealth>(FEDERAL_ONE_V2_URL, {
          body: { action: 'get_team_status', session_token: token },
          onUnauthorized: () => atomicLogoutRef.current?.(),
        });
        if (healthResult.ok && healthResult.data) setTeamHealth(healthResult.data);
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
        setDataHealth({ status: 'healthy', lastSuccess: Date.now(), failedAction: null, failedMessage: null });
      } else if (!result.loggedOut) {
        setDataHealth(h => ({ status: 'degraded', lastSuccess: h.lastSuccess, failedAction: 'get_agent_queues', failedMessage: result.error || 'Agent statistics could not refresh.' }));
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
      setNotice(data.success ? `Elizabeth's call to ${name || 'the contact'} is queued.` : (data.error || 'Could not place secretary call'));
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

const adminStatsRef = useRef<AdminStats | null>(null);

adminStatsRef.current = adminStats;

const liveActivityRef = useRef(liveActivity);

liveActivityRef.current = liveActivity;

useEffect(() => {
    if (!session?.valid || !sessionToken) return;
    const role = session.agent?.role;
    const token = sessionToken;

    if (role === 'owner' || role === 'administrator') {
      let mounted = true;
      const tick = async () => {
        if (!mounted || ownerPollingRef.current) return;
        ownerPollingRef.current = true;
        try {
          // Load the screen's essential data first so the dashboard becomes usable
          // before slower secondary reports finish.
          await loadAdminStats(token);
          if (!mounted) return;
          await Promise.allSettled([
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
      const interval = setInterval(tick, 30000);
      return () => { mounted = false; clearInterval(interval); };
    } else {
      let mounted = true;
      const tick = async () => {
        if (!mounted || agentPollingRef.current) return;
        agentPollingRef.current = true;
        try {
          // Show the agent's call workspace first; refresh secondary panels after it.
          await loadQueues(token);
          if (!mounted) return;
          await Promise.allSettled([
            loadSecretaryCalls(token),
            loadSavedTransfers(token),
            loadActiveTransfers(token),
            loadTransferAlerts(token),
          ]);
        } finally {
          if (mounted) agentPollingRef.current = false;
        }
      };
      tick();
      const interval = setInterval(tick, 30000);
      return () => { mounted = false; clearInterval(interval); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionToken, loadAdminStats, loadQueues, loadLeadPool, loadLiveActivity, loadRedialStats, loadRosterAttendance, dialerHealthCheck]);

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

const loadTransferAlerts = useCallback(async (token: string) => {
    try {
      const result = await authFetch(PROVIDER_URL, {
        body: { action: 'get_agent_alerts', session_token: token },
        onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      if (result.ok && result.data) {
        const d = result.data as Record<string, unknown>;
        setTransferAlerts(((d.alerts || []) as TransferAlert[]));
      }
    } catch { /* handled */ }
  }, []);

const handleAlertAcknowledge = useCallback(async (alertId: string, outcome: string, notes: string): Promise<boolean> => {
    const result = await authFetch(PROVIDER_URL, {
      body: { action: 'acknowledge_alert', session_token: sessionToken, alert_id: alertId, outcome, notes },
      onUnauthorized: () => atomicLogoutRef.current?.(),
    });
    if (result.ok) { loadTransferAlerts(sessionToken); return true; }
    return false;
  }, [sessionToken, loadTransferAlerts]);

const handleAlertSchedule = useCallback(async (alertId: string, callbackAt: string, notes: string): Promise<boolean> => {
    const result = await authFetch(PROVIDER_URL, {
      body: { action: 'schedule_alert_callback', session_token: sessionToken, alert_id: alertId, callback_at: callbackAt, notes },
      onUnauthorized: () => atomicLogoutRef.current?.(),
    });
    if (result.ok) { loadTransferAlerts(sessionToken); return true; }
    return false;
  }, [sessionToken, loadTransferAlerts]);

const handleAlertDismiss = useCallback((alertId: string) => {
    setTransferAlerts(prev => prev.filter(a => a.id !== alertId));
  }, []);

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

const [startingCampaign, setStartingCampaign] = useState(false);

const startCampaignInFlight = useRef(false);

const [stoppingCampaign, setStoppingCampaign] = useState(false);

const [togglingAgent, setTogglingAgent] = useState<string | null>(null);

const [settingConcurrency, setSettingConcurrency] = useState<string | null>(null);

const startCampaign = async () => {
    if (startCampaignInFlight.current || dialerControlsBusy.current) return;
    startCampaignInFlight.current = true;
    setStartingCampaign(true);
    setDialerError('');
    try {
      const result = await authFetch<{ success?: boolean; error?: string; blocking_reason?: string }>(DIALER_CONTROLS_URL, {
        body: { action: 'start_campaign', session_token: sessionToken, call_limit: callLimit, concurrency: dialerLines },
        timeoutMs: 45000, onUnauthorized: () => atomicLogoutRef.current?.(),
      });
      // The server performs current readiness checks and protects the call limit.
      // Read the resulting state even after a timeout: do not retry a live action.
      await loadAdminStats(sessionToken);
      if (adminStatsRef.current?.summary.campaign_state === 'running') {
        setNotice('Dialer started');
        setTimeout(() => setNotice(''), 4000);
      } else {
        setDialerError(result.error || result.data?.blocking_reason || result.data?.error ||
          (result.data?.success ? 'Startup is not yet confirmed. Refresh the dialer status.' : 'Could not start the dialer.'));
      }
    } finally {
      startCampaignInFlight.current = false;
      setStartingCampaign(false);
    }
  };

const stopCampaign = async () => {
    if (stoppingCampaign) return;
    setStoppingCampaign(true);
    try {
      const res = await providerFetch(DIALER_CONTROLS_URL, {
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
    if (dialerControlsBusy.current || startCampaignInFlight.current) return;
    dialerControlsBusy.current = true;
    setTogglingAgent(agentId);
    try {
      const res = await providerFetch(DIALER_CONTROLS_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_agent_dialer_selection', session_token: sessionToken, agent_id: agentId, selected: !current }),
      });
      const data = await res.json();
      if (!data.success) { setNotice(data.error || 'Failed to toggle agent'); setTimeout(() => setNotice(''), 3000); }
      else {
        await loadAdminStats(sessionToken);
        const saved = adminStatsRef.current?.agents.find(a => a.id === agentId);
        setSpeedNotice(saved?.active_for_dialer === !current ? `${saved.full_name}: ${!current ? 'dialer calls on' : 'dialer calls off'}` : 'Agent setting could not be confirmed. Refresh and check.');
      }
    } catch {
      setNotice('Network error — could not toggle agent');
      setTimeout(() => setNotice(''), 3000);
    } finally { dialerControlsBusy.current = false; setTogglingAgent(null); }
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

const handleDialerLines = async (lines: number) => {
    if (dialerControlsBusy.current || startCampaignInFlight.current || !Number.isInteger(lines) || lines < 1 || lines > 12) return;
    dialerControlsBusy.current = true;
    setSavingSpeed(true);
    setSpeedNotice(null);
    try {
      const res = await providerFetch(DIALER_CONTROLS_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_dialer_lines', session_token: sessionToken, concurrency: lines }),
      });
      const data = await res.json();
      if (data.success) {
        setDialerLines(data.concurrency);
        await loadAdminStats(sessionToken);
        setSpeedNotice(adminStatsRef.current?.summary.concurrency === data.concurrency ? `Saved: up to ${data.concurrency} lines at a time. Existing calls finish normally.` : 'Line setting could not be confirmed. Refresh and check.');
      } else {
        setSpeedNotice(data.error || 'Failed to save the line limit');
      }
    } catch {
      await loadAdminStats(sessionToken);
      setSpeedNotice('Connection interrupted. Check the saved line count before trying again.');
    } finally {
      dialerControlsBusy.current = false;
      setSavingSpeed(false);
      setTimeout(() => setSpeedNotice(null), 4000);
    }
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
          const voicemails = data.voicemails ?? 0;
          const transfers = data.transfers ?? 0;
          const liveHumans = data.liveHumans ?? 0;
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
        const parts = [`Imported ${data.imported || 0} new leads`];
        if (data.updated) parts.push(`${data.updated} existing leads updated`);
        if (data.blocked) parts.push(`${data.blocked} do-not-call or wrong-number records skipped`);
        if (data.invalid) parts.push(`${data.invalid} invalid rows skipped`);
        if (data.reopened) parts.push(`${data.reopened} reopened for redial`);
        setNotice(parts.join(', '));
        setTimeout(() => setNotice(''), 4000);
        loadLeadPool(sessionToken);
      } else {
        setNotice(data.error || 'Import failed');
      }
    } catch { setNotice('Failed to read file'); }
    finally { setImporting(false); }
  };
const isOwner = session?.agent?.role === 'owner' || session?.agent?.role === 'administrator';
const isStrictOwner = isOwner;
const canControl = isOwner;
const navItems = isOwner
    ? [
        { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
        { id: 'extra', label: 'Extra Info', icon: FileText },
        { id: 'contacts', label: 'Find a Client', icon: Search },
        { id: 'calls', label: 'All Calls', icon: Phone },
        { id: 'opportunities', label: 'Call Backs', icon: Users },
        { id: 'saved', label: 'Saved Calls', icon: Bookmark },
        { id: 'leads', label: 'Add Leads', icon: Upload },
        { id: 'system', label: 'System', icon: Settings },
        { id: 'test', label: 'Test Calls', icon: Phone },
      ]
    : [
        { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
        { id: 'extra', label: 'Extra Info', icon: FileText },
        { id: 'inbox', label: 'New Calls', icon: Inbox },
        { id: 'opportunities', label: 'People to Call', icon: Users },
        { id: 'calls', label: 'My Calls', icon: Flame },
        { id: 'saved', label: 'Saved Calls', icon: Bookmark },
        { id: 'secretary', label: 'Ask Elizabeth', icon: Send },
        { id: 'contacts', label: 'Find a Client', icon: Search },
      ];
if (canMonitor(isOwner, session?.agent)) navItems.push({id:'monitoring',label:'Monitoring',icon:Users});
return { session,ownerNeedsSetup,isOwner,isStrictOwner,sessionToken,atomicLogout,adminStats,dialerLines,savingSpeed,togglingAgent,startingCampaign,stoppingCampaign,notice,speedNotice,handleDialerLines,toggleAgent,startCampaign,stopCampaign,activeNav,setActiveNav,setExtraInfoPrefill,canControl,teamHealth,dashTab,setDashTab,transferProof,setTransferProofLoading,handleLogout,setTransferProof,perfView,setPerfView,displayPhone,togglePhoneReveal,rosterAttendance,rosterTimezone,revealedPhones,setConcurrency,settingConcurrency,liveActivity,redialProgresses,setRedialProgresses,removeRedialFromStorage,redialStats,redialStatsFilter,setRedialStatsFilter,redialTimeframe,setRedialTimeframe,redialingAgent,redialingHumans,redialSourceAgent,setRedialSourceAgent,dataHealth,openRedialModal,transferProofLoading,callLimit,setCallLimit,minuteCap,setMinuteCap,saveMinuteCap,savingCap,contactSearch,expandedContact,setExpandedContact,setPhoneAction,leadPool,handleUploadLeads,fileInputRef,importing,expandedCall,setExpandedCall,savedTransfers,allSavedTransfers,loadingAllSaved,loadAllSavedTransfers,allSavedTransfersError,isOnline,agentAvailable,handleToggleAvailability,togglingAvail,secretaryCalls,setSecretaryCalls,loadingSecretary,setLoadingSecretary,secClientName,setSecClientName,secClientPhone,setSecClientPhone,secMode,setSecMode,secCustomMsg,setSecCustomMsg,placingSecCall,setPlacingSecCall,expandedSecCall,setExpandedSecCall,setNotice,transferAlerts,handleAlertAcknowledge,handleAlertSchedule,handleAlertDismiss,activeTransfers,activeTransfersLoading,activeTransfersError,setDismissedTransferIds,queues,agentTodayStats,handleSaveTransfer,savingTransferIds,selectedRedialIds,toggleRedialSelect,handleAgentRedial,agentRedialing,agentRedialBatchId,redialTranscripts,redialPollTimer,setRedialPollTimer,setAgentRedialBatchId,setRedialTranscripts,loadingSaved,handleDeleteSavedTransfer,dialerError,setDialerError,availToast,setAvailToast,extraInfoPrefill,setupPin,setSetupPin,handleOwnerSetup,setupConfirm,setSetupConfirm,setupError,settingUp,loginError,pin,setPin,setLoginError,handleLogin,loggingIn,etClock,setMobileMenuOpen,mobileMenuOpen,navItems,myAttendance,attendanceError,phoneAction,placeQuickSecretaryCall,placingQuickSecretaryCall,showRedialModal,setShowRedialModal,setPendingRedialAction,setRedialModalError,redialPreview,confirmRedial,redialModalError,showOfflineModal,setShowOfflineModal };
}
export type ApplicationModel = ReturnType<typeof useApplicationModel>;
