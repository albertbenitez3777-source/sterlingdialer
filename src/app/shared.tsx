import { type TransferMetricSummary } from '@/utils/transfer-metrics';
export type AgentRole = 'owner' | 'administrator' | 'agent' | 'supervisor';

export type SessionAgent = { id: string; full_name: string; role: AgentRole; status: string; is_owner?: boolean; available_for_transfer?: boolean; logged_in?: boolean };

export type SessionData = { valid: boolean; agent?: SessionAgent };

export type QueueRecord = {
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

export type AdminAgentRow = {
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
  outbound_attempts_all?: number; no_answers_all?: number; voice_messages_all?: number;
  transfers_requested_all?: number; transfers_requested_week?: number;
  talkroute_leg_created_today?: number; talkroute_leg_created_week?: number; talkroute_leg_created_all?: number;
  talkroute_answered_all?: number;
  bridge_confirmed_today?: number; talkroute_answered_today?: number;
  bridge_confirmed_week?: number; talkroute_answered_week?: number;
  bridge_confirmed_all?: number;
  inbound_configured?: boolean;
  phone_ready?: boolean; dialer_eligible?: boolean;
  transfers_requested_today?: number; likely_real_conversation_today?: number;
  productive_minutes_today?: number; wasted_minutes_today?: number; total_minutes_today?: number;
};

export type FunnelStats = {
  calls_attempted: number; live_humans_reached: number; transfers_requested: number;
  talkroute_answered: number; bridge_confirmed: number; likely_real_conversation: number;
  total_minutes: number; productive_minutes: number; wasted_minutes: number; machine_minutes: number;
  avg_ai_leg_seconds: number; machines_detected: number; avg_machine_seconds: number;
  no_answer_count: number; human_drop_count: number; voice_message_count: number;
  fire_transfer_count: number; pending_count: number;
};

export type ErrorEntry = {
  created_at: string; consumer_phone: string; consumer_name: string;
  agent_name: string | null; error_type: string; reason: string;
  queue: string; duration_seconds: number; talkroute_leg_created: boolean;
  talkroute_answered: boolean; bridge_confirmed: boolean;
};

export type CampaignSummary = TransferMetricSummary & {
  campaign_state: string; dialer_activated: boolean; concurrency: number;
  as_of?: string; active_call_count?: number; reserved_call_count?: number; provider_call_limit: number; leads_remaining: number; calls_attempted_today: number;
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

export type AdminStats = { summary: CampaignSummary; agents: AdminAgentRow[] };

export type TeamHealth = {
  services: { database: string; bland_api_key: boolean; webhook_signature: boolean; federal_one_v2: string };
  agents: Array<{ id: string; full_name: string; inbound_configured: boolean; mapping_verified: boolean; provider_sync_status: string; settings?: { camera_state?: string; personal_dialer_state?: string } | null; device?: { last_seen_at?: string; device_kind?: string } | null; route?: { status?: string } | null }>;
  checked_at: string;
};

export type DataHealth = {
  status: 'loading' | 'healthy' | 'degraded';
  lastSuccess: number | null;
  failedAction: string | null;
  failedMessage: string | null;
};

export type RosterAttendanceRow = {
  agent_id: string; full_name: string; role: string;
  presence: 'online' | 'disconnected' | 'signed-out' | 'unknown';
  last_confirmed_at: string | null;
  today_total_seconds: number; week_total_seconds: number;
  is_legacy_estimate: boolean;
  available_for_transfer: boolean; active_for_dialer: boolean;
};

export type LeadPool = {
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

export type SecretaryCall = {
  id: string; client_name: string; client_phone: string; mode: string;
  custom_message: string | null; status: string; provider_call_id: string | null;
  transfer_status: string | null; transcript: string | null;
  recording_url: string | null; ai_summary: string | null;
  error_message: string | null; duration_seconds: number;
  created_at: string; updated_at: string;
};

export type ContactResult = {
  email?: string; emails?: string[]; contact_key?: string;
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

export type SourceFinding = {
  id: string; source_name: string; source_url: string; finding_type: string;
  finding_value: string; match_status: string; confidence: number; created_at: string;
};

export type SavedTransfer = {
  id: string; call_id: string | null; consumer_name: string; consumer_phone: string;
  consumer_address: string | null; consumer_income_range: string | null;
  consumer_home_value: string | null; consumer_property_info: string | null;
  original_queue: string; notes: string | null; created_at: string;
  is_active: boolean; deleted_at: string | null;
  agent?: { id: string; full_name: string } | null;
};

export function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 1) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? '';

export const FUNCTIONS_BASE = import.meta.env.DEV ? '' : SUPABASE_URL;

export const AUTH_URL = `${FUNCTIONS_BASE}/functions/v1/wolf-auth`;

export const PROVIDER_URL = `${FUNCTIONS_BASE}/functions/v1/wolf-provider`;

export const DIALER_CONTROLS_URL = `${FUNCTIONS_BASE}/functions/v1/dialer-controls`;

export const FEDERAL_ONE_V2_URL = `${FUNCTIONS_BASE}/functions/v1/federal-one-v2`;

export const TZ = 'America/Costa_Rica';

export const CINEMATIC_HERO = {
  skyline: 'https://images.pexels.com/photos/33803478/pexels-photo-33803478.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&dpr=2',
  callCenter: 'https://images.pexels.com/photos/8867208/pexels-photo-8867208.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&dpr=2',
  agentHero: 'https://images.pexels.com/photos/7709268/pexels-photo-7709268.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&dpr=2',
  commandCenter: '/collections-command-center-hero.webp',
  loginTeam: '/wolf-login-team.webp',
  agentMomentum: '/wolf-agent-momentum.webp',
};

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

export function getETTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export function queueLabel(queue: string): string {
  const map: Record<string, string> = {
    pending: 'Dialing', no_answer: 'No Answer', human_drop: 'Dropped', fire_transfer: 'Transferred',
    voice_message: 'Voicemail', completed: 'Completed',
  };
  return map[queue] || queue;
}

export type LoginErrorKind = 'network' | 'timeout' | 'unauthorized' | 'server_error' | 'unknown';

export function classifyFetchError(err: unknown): LoginErrorKind {
  if (err instanceof DOMException && err.name === 'AbortError') return 'timeout';
  if (err instanceof TypeError) return 'network';
  return 'unknown';
}

export function loginErrorMessage(kind: LoginErrorKind): string {
  switch (kind) {
    case 'network': return 'Cannot reach the server. Please check your connection and try again.';
    case 'timeout': return 'Request timed out — the server may be waking up. Please try again.';
    case 'unauthorized': return 'Invalid PIN or credentials.';
    case 'server_error': return 'Server error. Please try again in a moment.';
    default: return 'Connection failed. Please try again.';
  }
}

export async function fetchWithRetry(url: string, body: Record<string, unknown>, maxAttempts = 1, timeoutMs = 25000): Promise<Response> {
  // This argument is total attempts, not additional retries. Zero must not
  // silently prevent the PIN request from ever reaching the server.
  const attempts = Number.isFinite(maxAttempts) ? Math.max(1, Math.floor(maxAttempts)) : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // Keep the deadline active until the body is fully received. Headers alone
      // do not mean a login response is complete.
      const payload = await res.arrayBuffer();
      if (controller.signal.aborted) throw new DOMException('Request timed out', 'AbortError');
      clearTimeout(timeout);
      if ([502, 503, 504].includes(res.status) && attempt < attempts - 1) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return new Response([204, 205, 304].includes(res.status) ? null : payload, {
        status: res.status, statusText: res.statusText, headers: res.headers,
      });
    } catch (err) {
      clearTimeout(timeout);
      const isLast = attempt === attempts - 1;
      if (isLast) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error('Unreachable');
}

export async function providerFetch(url: string, options: RequestInit, retries = 1, timeoutMs = 15000): Promise<Response> {
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
