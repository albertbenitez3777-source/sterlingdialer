import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createDbClient } from "../_shared/db-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
const blandApiKey = Deno.env.get("BLAND_API_KEY") ?? "";
class SessionVerificationUnavailable extends Error {}

// Inbound configuration is handled by the canonical wolf-configure-inbound edge function.
// This helper calls it via HTTP so there is exactly one implementation of the inbound config.
async function autoConfigureInbound(agentId?: string): Promise<{ configured: number; attempted: number; results: Array<Record<string, unknown>> }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/wolf-configure-inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    return {
      configured: (data as Record<string, unknown>).configured as number || 0,
      attempted: (data as Record<string, unknown>).total as number || 0,
      results: ((data as Record<string, unknown>).results as Array<Record<string, unknown>>) || [],
    };
  } catch {
    return { configured: 0, attempted: 0, results: [] };
  }
}

async function placeBlandCall(
  callId: string,
  phoneNumber: string,
  blandNumber: string,
  voiceId: string,
  consumerName: string,
  agentName: string,
  talkrouteNumber: string,
): Promise<{ success: boolean; provider_call_id?: string; error?: string; transfer_route?: string }> {
  const transferNumber = normalizeToE164(talkrouteNumber);
  const transferRoute = "hub";
  const webhookUrl = `${supabaseUrl}/functions/v1/wolf-webhook`;

  // CRITICAL: The first_sentence must NOT contain the transfer_word phrase.
  // If it does, Bland triggers the transfer immediately when the AI speaks,
  // before the prospect has even responded. The transfer_word "connecting you now"
  // must only appear in the SECOND thing the AI says, after the prospect speaks.
  const elizabethFirstSentence = `Hi, may I speak with ${consumerName}? This is Elizabeth with Sterling Collections calling on behalf of ${agentName}.`;

  const elizabethTask = `You are Elizabeth, a professional assistant at Sterling Collections calling ${consumerName} on behalf of ${agentName}.

RULES — follow exactly, no exceptions:
1. VOICEMAIL / MACHINE: If you hear any answering machine, voicemail greeting, or automated system — "leave a message", "after the tone", "press pound", "mailbox", "not available", "does not accept solicitations", or any voice that keeps talking without reacting to you — HANG UP immediately. Say nothing. Never transfer to a machine.
2. WRONG PERSON: If the person says they are not ${consumerName}, or ${consumerName} is not available, or "doesn't live here" — say "I apologize for the inconvenience" and HANG UP.
3. LIVE PERSON — TRANSFER FAST: After your first_sentence, WAIT up to 5 seconds for any reply. The INSTANT you hear ANY engagement — "Hello?", "Yes?", "Yeah", "Speaking", "This is him/her", "That's me", "Who is this?", "Who is calling?", "What is this about?", "What do you want?", "What account?", "Okay", or any live human voice — proceed immediately to the transfer line.
4. TRANSFER LINE: Say EXACTLY: "Thank you. A representative is available regarding a private account matter. Please hold for a moment while I connect you. Connecting you now." Then say NOTHING else. Do not wait for consent. Do not ask additional questions.
5. IF ASKED "what is this about?" or "who are you?": Say "A representative needs to speak with you regarding a private account matter. Please hold while I connect you. Connecting you now." Then say NOTHING.
6. DECLINE / DNC: ONLY an explicit refusal counts — "no", "not interested", "stop calling", "remove me", "take me off", "do not call". Say "I understand, thank you for your time" and HANG UP. Questions like "who is this?" are NOT a decline.
7. SILENCE: If there is no reply within 5 seconds, HANG UP.
8. IF ASKED "Are you a robot/AI?": Say "I'm an automated assistant for ${agentName} at Sterling Collections. A representative is available now. Connecting you now." Then say NOTHING.
9. NEVER claim an urgent legal matter, lawsuit, deadline, or case-agent status. NEVER say ${agentName} is already on the line. NEVER impersonate a government agency. NEVER disclose debt amounts or account details.
10. NEVER repeat your first_sentence. NEVER argue. NEVER say anything after "Connecting you now." After the transfer trigger phrase, remain completely silent.`;

  try {
    const blandResponse = await fetch("https://api.bland.ai/v1/calls", {
      method: "POST",
      headers: {
        "authorization": blandApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone_number: phoneNumber,
        from: blandNumber,
        voice: voiceId || undefined,
        task: elizabethTask,
        first_sentence: elizabethFirstSentence,
        wait_for_greeting: true,
        record: true,
        voicemail: { action: "hangup", timeout: 0, sensitive: false },
        webhook: webhookUrl,
        webhook_events: ["call", "tool", "post_transfer_transcript"],
        max_duration: 8,
        block_interruptions: false,
        interruption_threshold: 100,
        temperature: 0.05,
        noise_cancellation: true,
        transfer_phone_number: transferNumber,
        block_dtmf: false,
        sensitive_voicemail_detection: false,
        summary_prompt: `Summarize this call in 2-3 sentences. Did the prospect agree to the transfer? Was the transfer successful? What was the prospect's reaction? Did they provide their name?`,
      }),
    });

    const blandData = await blandResponse.json();

    if (blandResponse.ok && blandData.status === "success") {
      return { success: true, provider_call_id: blandData.call_id, transfer_route: transferRoute };
    } else {
      return { success: false, error: blandData.message || blandData.error || "Bland API rejected call" };
    }
  } catch {
    return { success: false, error: "Network error" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    // cors preflight v5
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    void new URL(req.url);
    const supabase = createDbClient(dbUrl, supabaseUrl, serviceRoleKey);

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = body.action;

    // Infrastructure failures must not masquerade as expired credentials.
    // Verify the caller's session and check admin role
    const verifySession = async (token: string) => {
      if (!token) return null;
      const { data, error } = await supabase.rpc("verify_session", { p_session_token: token });
      if (error) {
        console.error("[verifySession] RPC error:", error.message);
        throw new SessionVerificationUnavailable();
      }
      if (!data?.valid) return null;
      return data.agent;
    };

    const isReadAdmin = (role: string) => role === "owner" || role === "administrator" || role === "supervisor";

    // Read-only provider diagnostics, protected by the existing owner session.
    // Return counts and account status without caller details or API keys.
    if (action === "provider_queue_health") {
      const agent = await verifySession(body.session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!["owner", "administrator"].includes(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!blandApiKey) return new Response(JSON.stringify({ error: "Provider API key is not configured" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const readProvider = async (path: string) => {
        try {
          const response = await fetch(`https://api.bland.ai/v1/${path}`, {
            method: "GET", headers: { authorization: blandApiKey }, signal: AbortSignal.timeout(12000),
          });
          return { status: response.status, data: await response.json() };
        } catch { return { status: 0, data: null }; }
      };
      const [account, active] = await Promise.all([readProvider("me"), readProvider("calls/active")]);
      const calls = active.status === 200 && Array.isArray(active.data?.data) ? active.data.data as Array<Record<string, unknown>> : null;
      const queued = calls?.filter(c => String(c.status).toUpperCase() === "QUEUED");
      const times = (queued || []).map(c => Number(c.timestamp)).filter(n => Number.isFinite(n) && n > 0 && n < 8.64e15);
      return new Response(JSON.stringify({
        checked_at: new Date().toISOString(), account_http_status: account.status,
        account_status: account.status === 200 ? account.data?.status ?? null : null,
        balance: account.status === 200 ? account.data?.billing?.current_balance ?? null : null,
        total_calls: account.status === 200 ? account.data?.total_calls ?? null : null,
        queue_http_status: active.status, queued: queued?.length ?? null,
        in_progress: calls?.filter(c => String(c.status).toUpperCase() === "IN_PROGRESS").length ?? null,
        oldest_queued_at: times.length ? new Date(Math.min(...times)).toISOString() : null,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_AGENT_READINESS_TABLE: admin-only — returns all four agents with readiness details
    if (action === "get_readiness_table") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isReadAdmin(agent.role)) {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase.rpc("get_agent_readiness_table");
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load readiness table" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ agents: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SYNC_FROM_BLAND: administrator-only, read-only sync
    // Authenticates with secure server credential, retrieves Bland.ai resources,
    // matches to agent's confirmed number, saves provider IDs — NEVER places a call
    if (action === "sync_from_bland") {
      const { session_token, agent_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (agent.role !== "owner" && agent.role !== "administrator") {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!blandApiKey) {
        return new Response(JSON.stringify({
          error: "Bland.ai API key is not configured in the server environment. Contact your platform administrator to add the BLAND_API_KEY secret."
        }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get the agent's confirmed Bland.ai number
      const { data: agentRow, error: agentErr } = await supabase
        .from("agents")
        .select("full_name, bland_number")
        .eq("id", agent_id)
        .maybeSingle();

      if (agentErr || !agentRow) {
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!agentRow.bland_number) {
        return new Response(JSON.stringify({ error: "This agent has no confirmed Bland.ai number to match against." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Normalize the agent's number to E.164
      const normalizedAgentNumber = normalizeToE164(agentRow.bland_number);

      // Mark as syncing
      await supabase.from("agents").update({ provider_sync_status: "syncing" }).eq("id", agent_id);

      // Retrieve Bland.ai telephone numbers (read-only GET — never places a call)
      const phoneResponse = await fetch("https://api.bland.ai/v1/inbound", {
        method: "GET",
        headers: {
          "authorization": blandApiKey,
        },
      });

      if (!phoneResponse.ok) {
        const errBody = await phoneResponse.text();
        await supabase.from("agents").update({ provider_sync_status: "failed" }).eq("id", agent_id);
        await supabase.from("provider_sync_logs").insert({
          agent_id,
          sync_type: "bland_ai",
          status: "failed",
          details: { reason: "phone_list_fetch_failed", status: phoneResponse.status, body: errBody.slice(0, 500) },
        });
        return new Response(JSON.stringify({ error: "Failed to retrieve Bland.ai telephone numbers. Check that the API key is valid." }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const phoneData = await phoneResponse.json();
      // Bland /v1/inbound returns { inbound_numbers: [...] }
      const phoneNumbers: Array<Record<string, unknown>> =
        Array.isArray(phoneData) ? phoneData : (phoneData.inbound_numbers || phoneData.numbers || phoneData.data || []);

      // Match the agent's confirmed Bland.ai number to a Bland resource
      const matchedPhone = phoneNumbers.find((p) => {
        const num = String(p.phone_number || p.number || p.inbound_number || "");
        return normalizeToE164(num) === normalizedAgentNumber;
      });

      if (!matchedPhone) {
        await supabase.from("agents").update({ provider_sync_status: "failed" }).eq("id", agent_id);
        await supabase.from("provider_sync_logs").insert({
          agent_id,
          sync_type: "bland_ai",
          status: "failed",
          details: { reason: "no_matching_number", agent_number: normalizedAgentNumber },
        });
        return new Response(JSON.stringify({
          error: `No Bland.ai telephone number resource matched ${agentRow.bland_number}. Verify the number is provisioned in your Bland.ai account.`,
        }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // The inbound number's phone_number is used as the ID in Bland.ai
      const matchedNumberStr = String(matchedPhone.phone_number || matchedPhone.number || agentRow.bland_number);
      const phoneId = matchedNumberStr; // Bland uses the number itself as the identifier

      // Check if a voice is already assigned to this inbound number
      const assignedVoiceId = String(matchedPhone.voice || "");

      // Retrieve authorized voice resources (read-only GET)
      const voiceResponse = await fetch("https://api.bland.ai/v1/voices", {
        method: "GET",
        headers: {
          "authorization": blandApiKey,
        },
      });

      let voices: Array<{ voice_id: string; name: string }> = [];
      if (voiceResponse.ok) {
        const voiceData = await voiceResponse.json();
        voices = Array.isArray(voiceData) ? voiceData : (voiceData.voices || voiceData.data || []);
      }

      // Look up the voice name for the assigned voice ID
      let assignedVoiceName = "";
      if (assignedVoiceId) {
        const found = voices.find((v) => v.voice_id === assignedVoiceId || (v as Record<string, unknown>).id === assignedVoiceId);
        if (found) {
          assignedVoiceName = found.name;
        }
      }

      // If a voice is already assigned to the inbound number, save it automatically
      // Otherwise, return the available voices for admin selection
      const saveVoiceId = assignedVoiceId || "";
      const saveVoiceName = assignedVoiceName || "";

      const { error: syncErr } = await supabase.rpc("sync_bland_agent", {
        p_agent_id: agent_id,
        p_phone_id: phoneId,
        p_voice_id: saveVoiceId,
        p_voice_name: saveVoiceName,
        p_number_owned_active: true,
      });

      if (syncErr) {
        return new Response(JSON.stringify({ error: "Failed to save sync results" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Record the sync result in the audit log
      await supabase.from("provider_sync_logs").insert({
        agent_id,
        sync_type: "bland_ai",
        status: "success",
        details: {
          matched_number: matchedNumberStr,
          phone_id: phoneId,
          voice_id: saveVoiceId,
          voice_name: saveVoiceName,
          voice_already_assigned: !!assignedVoiceId,
        },
      });

      await supabase.from("agents").update({ provider_sync_status: "synced" }).eq("id", agent_id);

      // Auto-configure inbound for this agent — Elizabeth Sterling's script + Talkroute transfer
      const inboundResult = await autoConfigureInbound(agent_id);

      const needsVoiceSelection = !assignedVoiceId && voices.length > 0;
      return new Response(JSON.stringify({
        success: true,
        matched_phone_id: phoneId,
        matched_number: matchedNumberStr,
        assigned_voice_id: saveVoiceId || null,
        assigned_voice_name: saveVoiceName || null,
        available_voices: needsVoiceSelection ? voices : [],
        inbound_configured: inboundResult.configured > 0,
        message: assignedVoiceId
          ? `Sync complete. Phone ID and voice "${saveVoiceName}" saved. Inbound configured automatically.`
          : needsVoiceSelection
          ? "Phone number matched. Select an authorized voice to complete the sync."
          : "Sync complete. Phone ID saved. Inbound configured automatically.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SELECT_VOICE: administrator selects the authorized voice for an agent
    if (action === "select_voice") {
      const { session_token, agent_id, voice_id: _voice_id, voice_name: _voice_name } = body;
      void _voice_id; void _voice_name;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (agent.role !== "owner" && agent.role !== "administrator") {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get existing phone_id to preserve it
      const { data: agentRow } = await supabase.from("agents").select("bland_phone_id").eq("id", agent_id).maybeSingle();
      if (!agentRow?.bland_phone_id) {
        return new Response(JSON.stringify({ error: "Sync phone numbers first before selecting a voice." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: syncErr } = await supabase.rpc("sync_bland_agent", {
        p_agent_id: agent_id,
        p_phone_id: agentRow.bland_phone_id,
        p_voice_id: _voice_id,
        p_voice_name: _voice_name,
        p_number_owned_active: true,
      });

      if (syncErr) {
        return new Response(JSON.stringify({ error: "Failed to save voice selection" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Auto-configure inbound with the newly selected voice
      await autoConfigureInbound(agent_id);

      return new Response(JSON.stringify({ success: true, message: "Voice selected and inbound configured automatically." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET_AGENT_OPPORTUNITIES: returns qualifying calls via server-side SQL RPC
    // Scoped to authenticated agent only; owner may pass agent_id filter to see any agent
    if (action === "get_agent_opportunities") {
      const { session_token, tab, filter_agent_id, since_ts } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const isAdmin = agent.role === "owner" || agent.role === "administrator" || agent.role === "supervisor";
      const targetAgentId = isAdmin && filter_agent_id ? filter_agent_id : agent.id;
      const selectedTab = tab === "week" ? "week" : tab === "all" ? "all" : "today";

      try {
        const { data: rpcResult, error: rpcError } = await supabase.rpc("get_agent_opportunities", {
          p_agent_id: targetAgentId,
          p_tab: selectedTab,
        });

        if (rpcError) {
          return new Response(JSON.stringify({
            error: "Failed to load opportunities",
            detail: rpcError.message || String(rpcError),
            code: rpcError.code || "UNKNOWN",
          }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const result = rpcResult as { rows: Record<string, unknown>[]; counts: { today: number; week: number; all: number }; server_today_start: string; server_week_start: string };
        const allRows = result.rows || [];
        const todayStartISO = result.server_today_start;

        // Server-side status precedence
        const computeStatus = (r: Record<string, unknown>): { primary_status: string; status_rank: number } => {
          if (r.bridge_confirmed || r.bridge_confirmed_at || (r.has_post_transfer_ai_speech && r.talkroute_answered))
            return { primary_status: "bridge_confirmed", status_rank: 9 };
          if (r.talkroute_answered)
            return { primary_status: "talkroute_answered", status_rank: 8 };
          if (r.talkroute_leg_created)
            return { primary_status: "talkroute_dialed", status_rank: 7 };
          if (r.transfer_requested_at)
            return { primary_status: "transfer_requested", status_rank: 6 };
          if (r.is_live_human || r.queue === "human_drop" || r.queue === "fire_transfer")
            return { primary_status: "live_human", status_rank: 5 };
          if (r.queue === "voice_message")
            return { primary_status: "voicemail", status_rank: 4 };
          if (r.callback_requested)
            return { primary_status: "callback", status_rank: 4 };
          if (r.queue === "no_answer")
            return { primary_status: "no_answer", status_rank: 3 };
          if (r.queue === "pending")
            return { primary_status: "pending", status_rank: 2 };
          return { primary_status: "failed", status_rank: 1 };
        };

        const enrichedRows = allRows.map(r => ({ ...r, transcript: r.transcript_preview || r.transcript || "", ...computeStatus(r) }));

        // Dedupe by lead_id
        const leadGroups = new Map<string, Array<typeof enrichedRows[0]>>();
        for (const row of enrichedRows) {
          const key = (row.lead_id || row.id) as string;
          if (!leadGroups.has(key)) leadGroups.set(key, []);
          leadGroups.get(key)!.push(row);
        }

        const deduped: Array<typeof enrichedRows[0] & { call_history?: Array<{ id: string; created_at: string; primary_status: string; queue: string; duration_seconds: number }> }> = [];
        for (const [, calls] of leadGroups) {
          calls.sort((a, b) => (b.status_rank as number) - (a.status_rank as number) || String(b.created_at).localeCompare(String(a.created_at)));
          const best = calls[0];
          const history = calls.length > 1
            ? calls.map(c => ({ id: String(c.id), created_at: String(c.created_at), primary_status: c.primary_status, queue: String(c.queue), duration_seconds: Number(c.duration_seconds) }))
            : undefined;
          deduped.push({ ...best, call_history: history });
        }

        // Sort: today records first (by status_rank DESC), then by created_at DESC
        deduped.sort((a, b) => {
          const aTs = String(a.created_at);
          const bTs = String(b.created_at);
          const aToday = aTs >= todayStartISO ? 1 : 0;
          const bToday = bTs >= todayStartISO ? 1 : 0;
          if (aToday !== bToday) return bToday - aToday;
          if (aToday && bToday) {
            if ((a.status_rank as number) !== (b.status_rank as number)) return (b.status_rank as number) - (a.status_rank as number);
          }
          return bTs.localeCompare(aTs);
        });

        // Count new records since last poll
        let newSinceCount = 0;
        if (since_ts) {
          newSinceCount = deduped.filter(r => String(r.created_at) > since_ts).length;
        }

        // Get agent list for owner/supervisor filter dropdown
        let agents: Array<{ id: string; full_name: string }> = [];
        if (isAdmin) {
          const { data: agentRows } = await supabase
            .from("agents")
            .select("id, full_name")
            .in("status", ["active", "on_leave"])
            .order("full_name");
          agents = agentRows || [];
        }

        return new Response(JSON.stringify({
          opportunities: deduped,
          counts: result.counts,
          agents,
          server_today_start: result.server_today_start,
          server_week_start: result.server_week_start,
          new_since_count: newSinceCount,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (processingErr: unknown) {
        const msg = processingErr instanceof Error ? processingErr.message : String(processingErr);
        return new Response(JSON.stringify({ error: "Opportunities processing failed", detail: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // GET_AGENT_QUEUES: returns only the requesting agent's three queues
    if (action === "get_agent_queues") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const [queueRes, statsRes, activityRes] = await Promise.all([
        supabase.rpc("get_agent_queues", { p_agent_id: agent.id }),
        supabase.rpc("get_agent_stats", { p_agent_id: agent.id }),
        supabase.rpc("get_agent_today_activity", { p_agent_id: agent.id }),
      ]);
      if (queueRes.error) {
        return new Response(JSON.stringify({ error: "Failed to load queues" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ queues: queueRes.data, stats: statsRes.data, today_activity: activityRes.data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET_AGENT_WORKSPACE: time-bucketed workspace for agent Call Now view
    if (action === "get_agent_workspace") {
      const { session_token, archive_offset } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("get_agent_workspace", { p_agent_id: agent.id, p_archive_offset: archive_offset ?? 0 });
      if (error) return new Response(JSON.stringify({ error: "Failed to load workspace", detail: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_ADMIN_CHART_DATA_V2: enhanced admin charts with hourly/daily/per-agent/quality alerts
    if (action === "get_admin_chart_data_v2") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent || agent.role !== "owner") return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("get_admin_chart_data_v2");
      if (error) return new Response(JSON.stringify({ error: "Failed to load chart data", detail: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_AGENT_STATS: returns the requesting agent's dashboard statistics
    if (action === "get_agent_stats") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("get_agent_stats", { p_agent_id: agent.id });
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load stats" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ stats: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET_ADMIN_STATS: admin command center
    if (action === "get_admin_stats") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isReadAdmin(agent.role)) {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("get_admin_stats");
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load admin stats" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ admin_stats: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET_DIALER_ACTIVITY: admin command center — live per-minute dialer activity
    if (action === "get_transfer_proof") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isReadAdmin(agent.role)) {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("get_transfer_proof_stats");
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load transfer proof" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(data), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET_DIALER_ACTIVITY: admin command center — live per-minute dialer activity
    if (action === "get_dialer_activity") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isReadAdmin(agent.role)) {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("get_dialer_activity");
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load dialer activity" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ activity: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_chart_data") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isReadAdmin(agent.role)) {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("get_chart_data");
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load chart data" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ chart_data: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // UPDATE_DISPOSITION: agent updates disposition and notes on their own call
    if (action === "update_disposition") {
      const { session_token, call_id, disposition, notes } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("update_call_disposition", {
        p_call_id: call_id, p_agent_id: agent.id, p_disposition: disposition, p_notes: notes,
      });
      if (error || data?.success === false) {
        return new Response(JSON.stringify({ error: data?.error || "Failed to update" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SCHEDULE_CALLBACK: agent schedules a callback on their own call
    if (action === "schedule_callback") {
      const { session_token, call_id, callback_at } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("schedule_callback", {
        p_call_id: call_id, p_agent_id: agent.id, p_callback_at: callback_at,
      });
      if (error || data?.success === false) {
        return new Response(JSON.stringify({ error: data?.error || "Failed to schedule" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // MARK_COMPLETED: agent marks a call completed
    if (action === "mark_completed") {
      const { session_token, call_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("mark_call_completed", {
        p_call_id: call_id, p_agent_id: agent.id,
      });
      if (error || data?.success === false) {
        return new Response(JSON.stringify({ error: data?.error || "Failed" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // MARK_DNC_WRONG_NUMBER: agent submits DNC or wrong number
    if (action === "mark_dnc_wrong_number") {
      const { session_token, call_id, is_dnc, is_wrong_number } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("mark_dnc_wrong_number", {
        p_call_id: call_id, p_agent_id: agent.id, p_is_dnc: is_dnc, p_is_wrong_number: is_wrong_number,
      });
      if (error || data?.success === false) {
        return new Response(JSON.stringify({ error: data?.error || "Failed" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // MARK_VOICEMAIL_HEARD: agent marks a voicemail as heard
    if (action === "mark_voicemail_heard") {
      const { session_token, call_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("mark_voicemail_heard", {
        p_call_id: call_id, p_agent_id: agent.id,
      });
      if (error || data?.success === false) {
        return new Response(JSON.stringify({ error: data?.error || "Failed" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ADMIN_RECLASSIFY: admin-only audited reclassification
    if (action === "admin_reclassify") {
      const { session_token, call_id, new_queue, reason } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (agent.role !== "owner" && agent.role !== "administrator") {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("admin_reclassify_call", {
        p_call_id: call_id, p_new_queue: new_queue, p_reason: reason, p_admin_id: agent.id,
      });
      if (error || data?.success === false) {
        return new Response(JSON.stringify({ error: data?.error || "Failed" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, ...data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET_DIALER_READY_AGENTS: admin-only — returns fully-ready agents for lead distribution
    if (action === "get_dialer_ready_agents") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isReadAdmin(agent.role)) {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase.rpc("get_dialer_ready_agents");
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to retrieve ready agents" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ agents: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // HEARTBEAT: agent stamps presence, receives attendance summary
    if (action === "heartbeat") {
      const { session_token } = body;
      if (!session_token) {
        return new Response(JSON.stringify({ error: "Missing session_token" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("heartbeat_session", {
        p_session_token: session_token,
      });
      if (error) {
        console.error("[heartbeat] RPC error:", error.message);
        return new Response(JSON.stringify({ error: "Heartbeat failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!data?.valid) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ attendance: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET_ROSTER_ATTENDANCE: admin-only — returns all agents' attendance
    if (action === "get_roster_attendance") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isReadAdmin(agent.role)) {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("get_roster_attendance");
      if (error) {
        console.error("[roster_attendance] RPC error:", error.message);
        return new Response(JSON.stringify({ error: "Failed to load attendance" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ roster_attendance: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET_LOGIN_HOURS: admin-only — returns each agent's weekly login hours
    if (action === "get_login_hours") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isReadAdmin(agent.role)) {
        return new Response(JSON.stringify({ error: "Administrator access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("get_agent_login_hours");
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load login hours" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ login_hours: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET_MY_LOGIN_HOURS: agent sees their own weekly login hours
    if (action === "get_my_login_hours") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("get_agent_login_hours");
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load login hours" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const myData = (data || []).find((r: { agent_id: string }) => r.agent_id === agent.id) || null;
      return new Response(JSON.stringify({ my_login_hours: myData }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // TOGGLE_AVAILABILITY: agent sets their own transfer availability
    if (action === "toggle_availability") {
      const { session_token, available } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.rpc("toggle_agent_availability", {
        p_agent_id: agent.id, p_available: available,
      });
      if (error || data?.success === false) {
        return new Response(JSON.stringify({ error: data?.error || "Failed" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, available_for_transfer: available }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SEARCH_LEADS: any authenticated user can search leads by phone or name
    if (action === "search_leads") {
      const { session_token, search_text } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("search_leads_by_phone", { p_search: search_text || "", p_limit: 20 });
      if (error) return new Response(JSON.stringify({ error: "Search failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ results: data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // SEARCH_CONTACTS: universal search across leads AND calls tables — all active agents see full directory
    if (action === "search_contacts") {
      const { session_token, search_text, offset } = body;
      const safeOffset = Math.max(0, Math.min(Math.floor(Number(offset) || 0), 1_000_000));
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      // The database uses literal substring matching, so pass the original text
      // without LIKE escaping (which corrupted emails containing underscores).
      const searchText = typeof search_text === "string" ? search_text.trim().slice(0, 250) : "";
      const { data, error } = await supabase.rpc("search_contacts", { p_search: searchText, p_limit: 50, p_offset: safeOffset });
      if (error) return new Response(JSON.stringify({ error: "Search failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const results = data && Array.isArray(data.results) ? data.results : [];
      const total = data?.total ?? results.length;
      return new Response(JSON.stringify({ results, count: total }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // SECRETARY — Elizabeth calls a contact on behalf of an agent
    // ============================================================

    // SECRETARY_CALL: agent asks Elizabeth to call a contact
    if (action === "secretary_call") {
      const { session_token, client_name, client_phone, mode, custom_message } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Eligibility: agent must be logged in and available for transfer
      if (agent.role === "owner" || agent.role === "administrator") {
        return new Response(JSON.stringify({ error: "Secretary is available to agents only." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (mode !== undefined && mode !== "transfer" && mode !== "reminder") {
        return new Response(JSON.stringify({ error: "Choose transfer or reminder mode." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!blandApiKey) {
        return new Response(JSON.stringify({ error: "Bland.ai API key is not configured." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const phoneNumber = normalizeToE164(String(client_phone || ""));
      if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
        return new Response(JSON.stringify({ error: "Invalid phone number" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Idempotency: reject duplicate secretary call within 60 seconds for same agent + phone
      const { data: recentCall } = await supabase
        .from("secretary_calls")
        .select("id, created_at")
        .eq("agent_id", agent.id)
        .eq("client_phone", phoneNumber)
        .gte("created_at", new Date(Date.now() - 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentCall) {
        return new Response(JSON.stringify({ error: "A secretary call to this number was just placed. Please wait a moment before trying again." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Get agent's Bland number, voice, and Talkroute transfer number
      const { data: agentRow } = await supabase
        .from("agents")
        .select("bland_number, bland_voice_id, talkroute_number, agent_direct_number, full_name, custom_message_privilege, status, available_for_transfer")
        .eq("id", agent.id)
        .maybeSingle();

      if (!agentRow || !agentRow.bland_number) {
        return new Response(JSON.stringify({ error: "Your Bland number is not configured." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (agentRow.status !== "active" || (mode === "transfer" && !agentRow.available_for_transfer)) {
        return new Response(JSON.stringify({ error: "Go available before asking Elizabeth to transfer a call to you." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Transfer mode requires a valid, unique Talkroute number on this agent
      if (mode === "transfer") {
        const transferNum = agentRow.talkroute_number ? normalizeToE164(agentRow.talkroute_number) : "";
        if (!transferNum) {
          return new Response(JSON.stringify({ error: "Your Talkroute transfer number is not configured. Contact your administrator." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Verify this Talkroute number is unique to this agent (not shared, not owner fallback)
        const { data: otherAgent } = await supabase
          .from("agents")
          .select("id")
          .neq("id", agent.id)
          .eq("talkroute_number", agentRow.talkroute_number)
          .limit(1)
          .maybeSingle();
        if (otherAgent) {
          return new Response(JSON.stringify({ error: "Transfer number is shared with another agent. Contact your administrator." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // Check DNC
      const { data: dncCheck } = await supabase
        .from("calls")
        .select("id")
        .eq("consumer_phone", phoneNumber)
        .eq("is_dnc", true)
        .limit(1)
        .maybeSingle();

      if (dncCheck) {
        // Record the blocked attempt
        await supabase.from("secretary_calls").insert({
          agent_id: agent.id,
          client_name: String(client_name || "Unknown"),
          client_phone: phoneNumber,
          mode: mode || "reminder",
          custom_message: agentRow.custom_message_privilege ? (custom_message || null) : null,
          status: "dnc_blocked",
        });
        return new Response(JSON.stringify({ error: "This number is on the Do Not Call list." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Create secretary_calls record
      const { data: secCall, error: secErr } = await supabase
        .from("secretary_calls")
        .insert({
          agent_id: agent.id,
          client_name: String(client_name || "Unknown"),
          client_phone: phoneNumber,
          mode: mode || "reminder",
          custom_message: agentRow.custom_message_privilege ? (custom_message || null) : null,
          status: "dialing",
        })
        .select("id")
        .single();

      if (secErr || !secCall) {
        return new Response(JSON.stringify({ error: "Failed to create secretary call record" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Build Elizabeth's task
      const transferNumber = (agentRow.talkroute_number ? normalizeToE164(agentRow.talkroute_number) : "");
      const agentName = agentRow.full_name;
      const useTransfer = mode === "transfer" && transferNumber;
      const customMsg = agentRow.custom_message_privilege && custom_message ? custom_message.trim() : "";

      const elizabethFirstSentence = useTransfer && customMsg
        ? `Hi, this is Elizabeth calling on behalf of ${agentName} at Sterling Collections. ${customMsg}`
        : `Hi, may I speak with ${client_name}? This is Elizabeth calling on behalf of ${agentName} at Sterling Collections.`;

      const elizabethTask = useTransfer ? `You are Elizabeth, a professional assistant at Sterling Collections calling ${client_name} on behalf of ${agentName}.

RULES — follow exactly, no exceptions:
1. VOICEMAIL / MACHINE: If you hear any answering machine, voicemail greeting, or automated system — HANG UP immediately. Say nothing.
2. WRONG PERSON: If the person says they are not ${client_name}, or ${client_name} is not available — say "I apologize for the inconvenience" and HANG UP.
3. LIVE PERSON — TRANSFER FAST: After your first_sentence, WAIT up to 5 seconds for any reply. The INSTANT you hear ANY engagement — "Hello?", "Yes?", "Speaking", "Who is this?", "What is this about?", "Okay", or any live human voice — proceed immediately to the transfer line.
4. TRANSFER LINE: Say EXACTLY: "Thank you. A representative is available regarding a private account matter. Please hold for a moment while I connect you. Connecting you now." Immediately use the transfer tool to connect the call to the configured transfer number. Remain silent after invoking the transfer.
5. IF ASKED "what is this about?" or "who are you?": Say "A representative needs to speak with you regarding a private account matter. Please hold while I connect you. Connecting you now." Then say NOTHING.
6. DECLINE / DNC: ONLY explicit refusal — "no", "not interested", "stop calling", "remove me", "do not call". Say "I understand, thank you for your time" and HANG UP.
7. SILENCE: If there is no reply within 5 seconds, HANG UP.
8. IF ASKED "Are you a robot/AI?": Say "I'm an automated assistant for ${agentName} at Sterling Collections. A representative is available now. Connecting you now." Then say NOTHING.
9. NEVER claim an urgent legal matter, lawsuit, deadline, or case-agent status. NEVER say ${agentName} is already on the line. NEVER disclose debt amounts or account details.
10. NEVER repeat your first_sentence. NEVER argue. NEVER say anything after "Connecting you now." After the transfer trigger, remain completely silent.
` : `You are Elizabeth, an automated assistant at Sterling Collections calling ${client_name} on behalf of ${agentName} with a reminder.
1. If you hear voicemail or an automated system, hang up without leaving a message.
2. Confirm you are speaking with ${client_name}. If this is the wrong person or they are unavailable, apologize and hang up without sharing the message.
3. ${customMsg ? `After confirming the intended person, deliver this message once: "${customMsg}".` : `After confirming the intended person, ask them to return ${agentName}'s call at the number you are calling from.`}
4. This call is a reminder. Do not announce a transfer or say "Connecting you now." No transfer tool is configured. If they ask to speak with ${agentName}, ask them to call back on this number.
5. If they refuse or request no more calls, acknowledge the request and end the call.
6. If asked whether you are AI, truthfully identify yourself as an automated assistant. Never claim legal urgency or disclose account details. End politely after the reminder.`;

      try {
        const blandResponse = await fetch("https://api.bland.ai/v1/calls", {
          method: "POST",
          headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            phone_number: phoneNumber,
            from: normalizeToE164(agentRow.bland_number),
            voice: agentRow.bland_voice_id || undefined,
            task: elizabethTask,
            first_sentence: elizabethFirstSentence,
            wait_for_greeting: true,
            record: true,
            voicemail: { action: "hangup", timeout: 0, sensitive: false },
            webhook: `${supabaseUrl}/functions/v1/wolf-webhook`,
            webhook_events: ["call", "tool", "post_transfer_transcript"],
            max_duration: 8,
            interruptibility: 0,
            temperature: 0.1,
            noise_cancellation: true,
            ...(useTransfer ? {
              transfer_phone_number: transferNumber,
              block_dtmf: false,
            } : {}),
            summary_prompt: useTransfer
              ? `Summarize this secretary call in 2-3 sentences. Did ${client_name} agree to speak with ${agentName}? Was the transfer successful?`
              : `Summarize this reminder call in 2-3 sentences. Was the intended person reached and the reminder delivered? Did they request a callback or no more calls?`,
          }),
        });

        const blandData = await blandResponse.json();

        if (blandResponse.ok && blandData.status === "success") {
          await supabase.from("secretary_calls").update({
            provider_call_id: blandData.call_id,
            status: "pending",
          }).eq("id", secCall.id);

          return new Response(JSON.stringify({ success: true, secretary_call_id: secCall.id, provider_call_id: blandData.call_id }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          await supabase.from("secretary_calls").update({
            status: "failed",
            error_message: blandData.message || blandData.error || "Bland API rejected call",
          }).eq("id", secCall.id);
          return new Response(JSON.stringify({ error: blandData.message || blandData.error || "Failed to place call" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {
        await supabase.from("secretary_calls").update({ status: "failed", error_message: "Network error" }).eq("id", secCall.id);
        return new Response(JSON.stringify({ error: "Network error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // GET_SECRETARY_CALLS: agent retrieves their secretary call history
    if (action === "get_secretary_calls") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data, error } = await supabase
        .from("secretary_calls")
        .select("*")
        .eq("agent_id", agent.id)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) return new Response(JSON.stringify({ error: "Failed to load secretary calls" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ secretary_calls: data || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // CAMPAIGN CONTROLS (owner/admin only)
    // ============================================================

    // CAMPAIGN_START
    if (action === "campaign_start") {
      const { session_token, concurrency, call_limit } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("campaign_start", { p_concurrency: concurrency || 3, p_call_limit: call_limit || 0 });
      if (error || data?.success === false) return new Response(JSON.stringify({ error: data?.error || "Failed", blocking_reason: data?.blocking_reason || "" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Kick off the server-side dialer loop — runs continuously, no admin login required
      if (blandApiKey) {
        fetch(`${supabaseUrl}/functions/v1/wolf-dialer-loop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: true }),
        }).catch(() => {});
      }

      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // CAMPAIGN_PAUSE
    if (action === "campaign_pause") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("campaign_pause");
      if (error) return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // CAMPAIGN_RESUME
    if (action === "campaign_resume") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("campaign_resume");
      if (error) return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Restart the server-side dialer loop
      if (blandApiKey) {
        fetch(`${supabaseUrl}/functions/v1/wolf-dialer-loop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: true }),
        }).catch(() => {});
      }

      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // CAMPAIGN_STOP
    if (action === "campaign_stop") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("campaign_stop");
      if (error) return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // DIALER — place outbound calls via Bland.ai
    // ============================================================

    // DIAL_CALLS: picks eligible leads, sends them to Bland.ai, records results
    if (action === "dial_calls") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      if (!blandApiKey) {
        return new Response(JSON.stringify({ error: "Bland.ai API key is not configured in the server environment." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Agent availability gate — refuse to dial if no agent is reachable
      const { data: availCount } = await supabase.rpc("count_available_agents");
      if ((availCount as number) === 0) {
        return new Response(JSON.stringify({ success: false, gated: true, error: "No agents available to receive calls. Agents must be logged in and set to Available." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Get the next batch of leads to dial
      const { data: batchData, error: batchErr } = await supabase.rpc("dialer_next_batch");
      if (batchErr || !batchData?.success) {
        return new Response(JSON.stringify({ error: batchData?.error || "Failed to get dial batch" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const callsToDial: Array<Record<string, unknown>> = batchData.calls || [];
      if (callsToDial.length === 0) {
        // If the batch returned "Call limit reached", auto-stop the campaign server-side
        if (batchData.message === "Call limit reached") {
          await supabase.rpc("campaign_stop");
        }
        return new Response(JSON.stringify({ success: true, dialed: 0, message: batchData.message || "No calls to dial" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const results: Array<Record<string, unknown>> = [];
      const dialPromises = callsToDial.map(async (call) => {
        const callId = call.call_id as string;
        try {
          const result = await placeBlandCall(
            callId, call.phone as string, call.bland_number as string,
            call.bland_voice_id as string, call.name as string, call.agent_name as string,
            call.talkroute_number as string,
          );

          if (result.success) {
            const dest = normalizeToE164(call.talkroute_number as string);
            await supabase.from("calls").update({
              provider_call_id: result.provider_call_id,
              queue: "pending",
              originating_bland_number: call.bland_number,
              talkroute_destination: dest,
              transfer_route_used: "hub",
            }).eq("id", callId);
            return { call_id: callId, success: true, provider_call_id: result.provider_call_id };
          } else {
            await supabase.from("calls").update({
              queue: "pending",
              is_completed: true,
              agent_notes: `Bland API error: ${result.error}`,
              originating_bland_number: call.bland_number,
            }).eq("id", callId);
            return { call_id: callId, success: false, error: result.error };
          }
        } catch (err) {
          await supabase.from("calls").update({
            queue: "pending",
            is_completed: true,
            agent_notes: `Dialer exception: ${String(err)}`,
            originating_bland_number: call.bland_number,
          }).eq("id", callId);
          return { call_id: callId, success: false, error: String(err) };
        }
      });
      const settled = await Promise.all(dialPromises);
      results.push(...settled);

      const successCount = results.filter((r) => r.success).length;
      return new Response(JSON.stringify({
        success: true,
        dialed: successCount,
        attempted: results.length,
        results,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // INBOUND CONFIG — automatically set on sync, kept for manual re-run
    // ============================================================

    // CONFIGURE_INBOUND: re-configures all agents' Bland.ai numbers with Elizabeth's
    // inbound script. This is also done automatically during sync_from_bland and select_voice.
    if (action === "configure_inbound") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      if (!blandApiKey) {
        return new Response(JSON.stringify({ error: "Bland.ai API key is not configured." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const inboundResult = await autoConfigureInbound();
      return new Response(JSON.stringify({
        success: true,
        configured: inboundResult.configured,
        attempted: inboundResult.attempted,
        results: inboundResult.results,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // LEAD MANAGEMENT (owner/admin only)
    // ============================================================

    // IMPORT_LEADS
    if (action === "import_leads") {
      const { session_token, leads, filename } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("import_leads", { p_leads: leads, p_filename: filename || "upload.csv" });
      if (error || data?.success === false) return new Response(JSON.stringify({ error: data?.error || "Import failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_LEAD_POOL_STATS
    if (action === "get_lead_pool_stats") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isReadAdmin(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("get_lead_pool_stats");
      if (error) return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ lead_pool: data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_RECENT_LEADS
    if (action === "get_recent_leads") {
      const { session_token, limit } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isReadAdmin(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("get_recent_leads", { p_limit: limit || 50 });
      if (error) return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ leads: data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // AGENT MANAGEMENT (owner/admin only)
    // ============================================================

    // SET_AGENT_DIALER_SELECTION (multi-select — no longer deselects others)
    if (action === "set_agent_dialer_selection") {
      const { session_token, agent_id, selected } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("set_agent_dialer_selection", { p_agent_id: agent_id, p_selected: selected });
      if (error || data?.success === false) return new Response(JSON.stringify({ error: data?.error || "Failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // SET_AGENT_CONCURRENCY — set per-agent dial speed (3, 5, or 10)
    if (action === "set_agent_concurrency") {
      const { session_token, agent_id, concurrency: c } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const validConcurrency = [1, 2, 3, 4, 5, 6, 7].includes(c) ? c : 3;
      const { error } = await supabase.from("agents").update({ dialer_concurrency: validConcurrency }).eq("id", agent_id);
      if (error) return new Response(JSON.stringify({ error: "Failed to update concurrency" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // SET_AGENT_STATUS
    if (action === "set_agent_status") {
      const { session_token, agent_id, status: newStatus } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("set_agent_status", { p_agent_id: agent_id, p_status: newStatus });
      if (error || data?.success === false) return new Response(JSON.stringify({ error: data?.error || "Failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // SET_AGENT_DIRECT_NUMBER — disabled until route selector implemented
    if (action === "set_agent_direct_number") {
      return new Response(JSON.stringify({ error: "Direct number routing is disabled. All transfers go through Talkroute. A route selector will be available in a future update." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "set_daily_minute_cap") {
      const { session_token, minute_cap } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const capVal = minute_cap == null ? null : Math.max(0, parseInt(minute_cap) || 0);
      const { error } = await supabase.from("campaigns").update({ daily_minute_cap: capVal, updated_at: new Date().toISOString() }).order("created_at", { ascending: false }).limit(1);
      if (error) return new Response(JSON.stringify({ error: "Failed to update minute cap" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      return new Response(JSON.stringify({ success: true, daily_minute_cap: capVal }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // REDIAL_PREVIEW: admin-only — dry-run that returns exact eligible count and exclusion breakdown
    // without creating any call rows or contacting the provider
    if (action === "redial_preview") {
      const { session_token, target_agent_id, source_agent_id, redial_type } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isReadAdmin(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const sourceAgentId = source_agent_id || target_agent_id;
      const cohortType = redial_type === "humans" ? "humans" : "transfers";

      // Check campaign state
      const { data: campaignRow } = await supabase
        .from("campaigns")
        .select("state")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const campaignActive = campaignRow?.state === "running";

      // Check target agent has active redial batch
      const { count: activeRedialCount } = await supabase
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", target_agent_id)
        .eq("queue", "pending")
        .like("agent_notes", "redial_batch:%");
      const hasActiveBatch = (activeRedialCount || 0) > 0;

      // Fetch all source-agent calls in the cohort (paginated — no truncation)
      const queues = cohortType === "transfers" ? ["fire_transfer"] : ["fire_transfer", "human_drop"];
      let allSourceCalls: Array<{ id: string; consumer_phone: string }> = [];
      let pageOffset = 0;
      const pageSize = 1000;
      while (true) {
        const { data: page, error: pageErr } = await supabase
          .from("calls")
          .select("id, consumer_phone")
          .eq("agent_id", sourceAgentId)
          .in("queue", queues)
          .order("created_at", { ascending: false })
          .range(pageOffset, pageOffset + pageSize - 1);
        if (pageErr || !page || page.length === 0) break;
        allSourceCalls = allSourceCalls.concat(page);
        if (page.length < pageSize) break;
        pageOffset += pageSize;
      }

      // Deduplicate by normalized phone
      const seenPhones = new Set<string>();
      const uniqueContacts: Array<{ id: string; phone: string }> = [];
      let dupPhoneCount = 0;
      for (const c of allSourceCalls) {
        const phone = normalizeToE164(c.consumer_phone);
        if (!phone) { dupPhoneCount++; continue; }
        if (seenPhones.has(phone)) { dupPhoneCount++; continue; }
        seenPhones.add(phone);
        uniqueContacts.push({ id: c.id, phone });
      }

      const excludedReasons: Array<{ reason: string; count: number }> = [];
      let eligiblePhones = uniqueContacts.map(c => c.phone);

      // Exclusion: DNC on any historical call
      if (eligiblePhones.length > 0) {
        const { data: dncRows } = await supabase
          .from("calls")
          .select("consumer_phone")
          .in("consumer_phone", eligiblePhones)
          .eq("is_dnc", true);
        const dncSet = new Set((dncRows || []).map(r => normalizeToE164(r.consumer_phone)));
        const before = eligiblePhones.length;
        eligiblePhones = eligiblePhones.filter(p => !dncSet.has(p));
        if (dncSet.size > 0) excludedReasons.push({ reason: "DNC flagged on historical call", count: before - eligiblePhones.length });
      }

      // Exclusion: wrong number
      if (eligiblePhones.length > 0) {
        const { data: wnRows } = await supabase
          .from("calls")
          .select("consumer_phone")
          .in("consumer_phone", eligiblePhones)
          .eq("is_wrong_number", true);
        const wnSet = new Set((wnRows || []).map(r => normalizeToE164(r.consumer_phone)));
        const before = eligiblePhones.length;
        eligiblePhones = eligiblePhones.filter(p => !wnSet.has(p));
        if (wnSet.size > 0) excludedReasons.push({ reason: "Wrong number flagged", count: before - eligiblePhones.length });
      }

      // Exclusion: DNC on current lead
      if (eligiblePhones.length > 0) {
        const { data: leadDncRows } = await supabase
          .from("leads")
          .select("telephone_original")
          .in("telephone_original", eligiblePhones)
          .eq("status", "suppressed");
        const leadDncSet = new Set((leadDncRows || []).map(r => normalizeToE164(r.telephone_original)));
        const before = eligiblePhones.length;
        eligiblePhones = eligiblePhones.filter(p => !leadDncSet.has(p));
        if (leadDncSet.size > 0) excludedReasons.push({ reason: "DNC/suppressed on lead table", count: before - eligiblePhones.length });
      }

      // Exclusion: currently pending/active dialer call
      if (eligiblePhones.length > 0) {
        const { data: pendingRows } = await supabase
          .from("calls")
          .select("consumer_phone")
          .in("consumer_phone", eligiblePhones)
          .eq("queue", "pending")
          .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
        const pendingSet = new Set((pendingRows || []).map(r => normalizeToE164(r.consumer_phone)));
        const before = eligiblePhones.length;
        eligiblePhones = eligiblePhones.filter(p => !pendingSet.has(p));
        if (pendingSet.size > 0) excludedReasons.push({ reason: "Currently pending/active dialer call", count: before - eligiblePhones.length });
      }

      // Exclusion: cross-batch dedup (target already dialed in previous redial)
      if (eligiblePhones.length > 0) {
        const { data: alreadyDialed } = await supabase
          .from("calls")
          .select("consumer_phone")
          .eq("agent_id", target_agent_id)
          .eq("call_direction", "outbound")
          .like("agent_notes", "redial_batch:%")
          .in("consumer_phone", eligiblePhones);
        const dialedSet = new Set((alreadyDialed || []).map(r => normalizeToE164(r.consumer_phone)));
        const before = eligiblePhones.length;
        eligiblePhones = eligiblePhones.filter(p => !dialedSet.has(p));
        if (dialedSet.size > 0) excludedReasons.push({ reason: "Already re-dialed by target agent in prior batch", count: before - eligiblePhones.length });
      }

      // Exclusion: redial cap (already re-dialed 2+ times)
      if (eligiblePhones.length > 0) {
        const { data: redialCountRows } = await supabase
          .from("calls")
          .select("consumer_phone, redial_count")
          .in("consumer_phone", eligiblePhones)
          .gte("redial_count", 2);
        const cappedSet = new Set((redialCountRows || []).map(r => normalizeToE164(r.consumer_phone)));
        const before = eligiblePhones.length;
        eligiblePhones = eligiblePhones.filter(p => !cappedSet.has(p));
        if (cappedSet.size > 0) excludedReasons.push({ reason: "Redial cap reached (2+ prior redials)", count: before - eligiblePhones.length });
      }

      if (dupPhoneCount > 0) excludedReasons.push({ reason: "Duplicate phone number in source cohort", count: dupPhoneCount });

      const cappedCount = Math.min(eligiblePhones.length, 25);
      const cappedExclusion = Math.max(0, eligiblePhones.length - cappedCount);
      if (cappedExclusion > 0) excludedReasons.push({ reason: `Exceeds ${25}-record batch cap`, count: cappedExclusion });

      const excludedCount = allSourceCalls.length - eligiblePhones.length + cappedExclusion;

      // Get agent names
      const { data: sourceAgentRow } = await supabase.from("agents").select("full_name").eq("id", sourceAgentId).maybeSingle();
      const { data: targetAgentRow } = await supabase.from("agents").select("full_name").eq("id", target_agent_id).maybeSingle();

      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        source_agent_id: sourceAgentId,
        source_agent_name: sourceAgentRow?.full_name || "Unknown",
        target_agent_id: target_agent_id,
        target_agent_name: targetAgentRow?.full_name || "Unknown",
        cohort_type: cohortType,
        total_source_records: allSourceCalls.length,
        unique_phones: uniqueContacts.length,
        eligible_count: eligiblePhones.length,
        capped_count: cappedCount,
        excluded_count: excludedCount,
        excluded_reasons: excludedReasons,
        campaign_active: campaignActive,
        has_active_batch: hasActiveBatch,
        can_proceed: !campaignActive && !hasActiveBatch && eligiblePhones.length > 0,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_ALL_FIRE_TRANSFERS: admin-only — returns all fire transfer calls with recording + transcript
    if (action === "redial_live_transfers") {
      const { session_token, target_agent_id, source_agent_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      if (!blandApiKey) {
        return new Response(JSON.stringify({ error: "Bland.ai API key is not configured." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // source_agent_id: whose contacts to redial (defaults to target_agent_id for backward compat)
      const sourceAgentId = source_agent_id || target_agent_id;

      // Get the target agent's config (the agent who will receive transfers)
      const { data: agentRow } = await supabase
        .from("agents")
        .select("id, full_name, bland_number, bland_voice_id, talkroute_number, agent_direct_number")
        .eq("id", target_agent_id)
        .maybeSingle();

      if (!agentRow || !agentRow.bland_number) {
        return new Response(JSON.stringify({ error: "Agent has no Bland number configured." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Never interrupt an active redial for this agent.
      const { count: activeRedialCount } = await supabase
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", target_agent_id)
        .eq("queue", "pending")
        .like("agent_notes", "redial_batch:%");
      if ((activeRedialCount || 0) > 0) {
        return new Response(JSON.stringify({ error: "This agent already has a redial in progress. Wait for the current calls to finish." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const redialBatchId = crypto.randomUUID();
      const _targetAgentId = target_agent_id;
      const _sourceAgentId = sourceAgentId;
      const _agentRow = agentRow;

      EdgeRuntime.waitUntil((async () => {
        // Clear only genuinely old redial rows. Calls newer than 10 minutes may still be active.
        await supabase.from("calls")
          .update({ queue: "no_answer", is_completed: true, agent_notes: " [Auto-cleaned: stale redial]" })
          .eq("agent_id", _targetAgentId)
          .eq("queue", "pending")
          .like("agent_notes", "redial_batch:%")
          .lt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

        // Get ALL-TIME live human transfers for the SOURCE agent (fire_transfer queue)
        // Paginated fetch — no 1000-row truncation
        let liveTransfers: Array<{ id: string; consumer_name: string; consumer_phone: string; consumer_address: string; consumer_income_range: string; consumer_home_value: string; consumer_property_info: string }> = [];
        let pageOffset = 0;
        const pageSize = 1000;
        while (true) {
          const { data: page, error: ltErr } = await supabase
            .from("calls")
            .select("id, consumer_name, consumer_phone, consumer_address, consumer_income_range, consumer_home_value, consumer_property_info")
            .eq("agent_id", _sourceAgentId)
            .eq("queue", "fire_transfer")
            .order("created_at", { ascending: false })
            .range(pageOffset, pageOffset + pageSize - 1);
          if (ltErr || !page || page.length === 0) break;
          liveTransfers = liveTransfers.concat(page);
          if (page.length < pageSize) break;
          pageOffset += pageSize;
        }

        if (liveTransfers.length === 0) return;

        // Deduplicate by phone number
        const seenTransferPhones = new Set<string>();
        let uniqueTransfers = liveTransfers.filter(c => {
          const phone = normalizeToE164(c.consumer_phone);
          if (!phone || seenTransferPhones.has(phone)) return false;
          seenTransferPhones.add(phone);
          return true;
        });

        // Cross-batch dedup: skip phones the target agent already dialed in ANY previous redial
        const transferPhones = uniqueTransfers.map(c => normalizeToE164(c.consumer_phone)).filter(Boolean);
        if (transferPhones.length > 0) {
          const { data: alreadyDialed } = await supabase
            .from("calls")
            .select("consumer_phone")
            .eq("agent_id", _targetAgentId)
            .eq("call_direction", "outbound")
            .like("agent_notes", "redial_batch:%")
            .in("consumer_phone", transferPhones);
          if (alreadyDialed && alreadyDialed.length > 0) {
            const dialedSet = new Set(alreadyDialed.map(c => normalizeToE164(c.consumer_phone)));
            uniqueTransfers = uniqueTransfers.filter(c => !dialedSet.has(normalizeToE164(c.consumer_phone)));
          }
        }

        // Redial cap: skip contacts already re-dialed 2+ times
        const transferRedialPhones = uniqueTransfers.map(c => normalizeToE164(c.consumer_phone)).filter(Boolean);
        if (transferRedialPhones.length > 0) {
          const { data: redialCountRows } = await supabase
            .from("calls")
            .select("consumer_phone, redial_count")
            .in("consumer_phone", transferRedialPhones)
            .gte("redial_count", 2);
          if (redialCountRows && redialCountRows.length > 0) {
            const cappedSet = new Set(redialCountRows.map(r => normalizeToE164(r.consumer_phone)));
            uniqueTransfers = uniqueTransfers.filter(c => !cappedSet.has(normalizeToE164(c.consumer_phone)));
          }
        }

        const transferNumber = normalizeToE164(_agentRow.talkroute_number);
        const transferRoute = "hub";
        const agentName = _agentRow.full_name;
        const webhookUrl = `${supabaseUrl}/functions/v1/wolf-webhook`;

        await Promise.all(uniqueTransfers.map(async (contact): Promise<{ phone: string; success: boolean; error?: string }> => {
        const phone = normalizeToE164(contact.consumer_phone);
        if (!phone) return { phone: contact.consumer_phone, success: false, error: "Invalid number" };

        // Skip DNC
        const { data: dnc } = await supabase.from("calls").select("id").eq("consumer_phone", phone).eq("is_dnc", true).limit(1).maybeSingle();
        if (dnc) return { phone, success: false, error: "DNC" };

        // Get current redial_count for this phone
        const { data: existingRedial } = await supabase.from("calls")
          .select("redial_count")
          .eq("consumer_phone", phone)
          .order("created_at", { ascending: false })
          .limit(1).maybeSingle();
        const currentRedialCount = existingRedial?.redial_count ?? 0;

        const urgentFirstSentence = `Hi, may I speak with ${contact.consumer_name || "the account holder"}? This is Elizabeth calling on behalf of ${agentName} at Sterling Collections.`;

        const urgentTask = `You are Elizabeth, a professional assistant at Sterling Collections calling ${contact.consumer_name || "the prospect"} on behalf of ${agentName}. This is a follow-up call.

RULES — follow exactly, no exceptions:
1. VOICEMAIL / MACHINE: If you hear any answering machine, voicemail, or automated system — HANG UP immediately. Say nothing.
2. WRONG PERSON: If the person says they are not ${contact.consumer_name || "the account holder"} — say "I apologize for the inconvenience" and HANG UP.
3. LIVE PERSON — TRANSFER FAST: After your first_sentence, WAIT up to 5 seconds for any reply. The INSTANT you hear ANY engagement — "Hello?", "Yes?", "Speaking", "Who is this?", "What is this about?", "Okay", or any live human voice — proceed immediately to the transfer line.
4. TRANSFER LINE: Say EXACTLY: "Thank you. A representative is available regarding a private account matter. Please hold for a moment while I connect you. Connecting you now." Then say NOTHING else.
5. IF ASKED "what is this about?": Say "A representative needs to speak with you regarding a private account matter. Please hold while I connect you. Connecting you now." Then say NOTHING.
6. DECLINE / DNC: ONLY explicit refusal — "no", "not interested", "stop calling", "remove me", "do not call". Say "I understand, thank you for your time" and HANG UP.
7. SILENCE: If there is no reply within 5 seconds, HANG UP.
8. IF ASKED "Are you a robot/AI?": Say "I'm an automated assistant for ${agentName} at Sterling Collections. A representative is available now. Connecting you now." Then say NOTHING.
9. NEVER claim an urgent legal matter, lawsuit, deadline, or case-agent status. NEVER say ${agentName} is already on the line. NEVER disclose debt amounts or account details.
10. NEVER repeat your first_sentence. NEVER argue. NEVER say anything after "Connecting you now." After the transfer trigger, remain completely silent.`;

        try {
          const { data: attempt } = await supabase.from("calls").insert({
            agent_id: target_agent_id,
            original_agent_id: _sourceAgentId,
            redial_of: contact.id,
            redial_source_type: "live_transfers",
            redial_batch_id: redialBatchId,
            consumer_name: contact.consumer_name,
            consumer_phone: phone,
            consumer_address: contact.consumer_address,
            consumer_income_range: contact.consumer_income_range,
            consumer_home_value: contact.consumer_home_value,
            consumer_property_info: contact.consumer_property_info,
            queue: "pending",
            call_direction: "outbound",
            originating_bland_number: agentRow.bland_number,
            talkroute_destination: transferNumber,
            transfer_route_used: transferRoute,
            agent_notes: `redial_batch:${redialBatchId}:transfers:dialing`,
            redial_count: currentRedialCount + 1,
          }).select("id").maybeSingle();

          const blandResponse = await fetch("https://api.bland.ai/v1/calls", {
            method: "POST",
            headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              phone_number: phone,
              from: normalizeToE164(agentRow.bland_number),
              voice: agentRow.bland_voice_id || undefined,
              task: urgentTask,
              first_sentence: urgentFirstSentence,
              wait_for_greeting: true,
              record: true,
              voicemail: { action: "hangup", timeout: 0, sensitive: false },
              webhook: webhookUrl,
              webhook_events: ["call", "tool", "post_transfer_transcript"],
              max_duration: 8,
              block_interruptions: true,
              temperature: 0.1,
              noise_cancellation: true,
              transfer_phone_number: transferNumber,
              block_dtmf: false,
              summary_prompt: `Summarize this re-dial call in 2-3 sentences. Did ${contact.consumer_name || "the prospect"} agree to the transfer? Was the transfer successful?`,
              metadata: { redial_batch_id: redialBatchId, redial_type: "live_transfers" },
            }),
          });
          const blandData = await blandResponse.json();

          if (blandResponse.ok && blandData.status === "success") {
            if (attempt?.id) {
              await supabase.from("calls").update({
                provider_call_id: blandData.call_id,
                agent_notes: `redial_batch:${redialBatchId}:transfers:placed`,
              }).eq("id", attempt.id);
            }
            return { phone, success: true };
          } else {
            if (attempt?.id) {
              await supabase.from("calls").update({ queue: "no_answer", is_completed: true, agent_notes: `redial_batch:${redialBatchId}:transfers:failed` }).eq("id", attempt.id);
            }
            return { phone, success: false, error: blandData.message || blandData.error || `Bland rejected: ${blandResponse.status}` };
          }
        } catch {
          if (attempt?.id) {
            await supabase.from("calls").update({ queue: "no_answer", is_completed: true, agent_notes: `redial_batch:${redialBatchId}:transfers:failed` }).eq("id", attempt.id);
          }
          return { phone, success: false, error: "Network error" };
        }
      }));
      })());

      return new Response(JSON.stringify({
        success: true,
        dialed: 0,
        failed: 0,
        total: 0,
        batch_id: redialBatchId,
        message: "Re-dial started",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // REDIAL_LIVE_HUMANS: admin-only — re-dials every live human (including drops) for an agent
    if (action === "redial_live_humans") {
      const { session_token, target_agent_id, source_agent_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      if (!blandApiKey) {
        return new Response(JSON.stringify({ error: "Bland.ai API key is not configured." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // source_agent_id: whose contacts to redial (defaults to target_agent_id for backward compat)
      const sourceAgentId = source_agent_id || target_agent_id;

      const { data: agentRow } = await supabase
        .from("agents")
        .select("id, full_name, bland_number, bland_voice_id, talkroute_number, agent_direct_number")
        .eq("id", target_agent_id)
        .maybeSingle();

      if (!agentRow || !agentRow.bland_number) {
        return new Response(JSON.stringify({ error: "Agent has no Bland number configured." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Never interrupt an active redial for this agent.
      const { count: activeRedialCount } = await supabase
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", target_agent_id)
        .eq("queue", "pending")
        .like("agent_notes", "redial_batch:%");
      if ((activeRedialCount || 0) > 0) {
        return new Response(JSON.stringify({ error: "This agent already has a redial in progress. Wait for the current calls to finish." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const redialBatchId = crypto.randomUUID();
      const _targetAgentId = target_agent_id;
      const _sourceAgentId = sourceAgentId;
      const _agentRow = agentRow;

      EdgeRuntime.waitUntil((async () => {
        // Clear only genuinely old redial rows. Calls newer than 10 minutes may still be active.
        await supabase.from("calls")
          .update({ queue: "no_answer", is_completed: true, agent_notes: " [Auto-cleaned: stale redial]" })
          .eq("agent_id", _targetAgentId)
          .eq("queue", "pending")
          .like("agent_notes", "redial_batch:%")
          .lt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

        // Get ALL-TIME live human calls for the SOURCE agent — both fire_transfer AND human_drop queues
        // Paginated fetch — no 1000-row truncation
        let liveHumans: Array<{ id: string; consumer_name: string; consumer_phone: string; consumer_address: string; consumer_income_range: string; consumer_home_value: string; consumer_property_info: string; queue: string }> = [];
        let pageOffset = 0;
        const pageSize = 1000;
        while (true) {
          const { data: page, error: lhErr } = await supabase
            .from("calls")
            .select("id, consumer_name, consumer_phone, consumer_address, consumer_income_range, consumer_home_value, consumer_property_info, queue")
            .eq("agent_id", _sourceAgentId)
            .in("queue", ["fire_transfer", "human_drop"])
            .order("created_at", { ascending: false })
            .range(pageOffset, pageOffset + pageSize - 1);
          if (lhErr || !page || page.length === 0) break;
          liveHumans = liveHumans.concat(page);
          if (page.length < pageSize) break;
          pageOffset += pageSize;
        }

        if (liveHumans.length === 0) return;

        // Deduplicate by phone number
        const seenPhones = new Set<string>();
        let uniqueContacts = liveHumans.filter(c => {
          const phone = normalizeToE164(c.consumer_phone);
          if (!phone || seenPhones.has(phone)) return false;
          seenPhones.add(phone);
          return true;
        });

        // Cross-batch dedup: skip phones the target agent already dialed in ANY previous redial
        const humanPhones = uniqueContacts.map(c => normalizeToE164(c.consumer_phone)).filter(Boolean);
        if (humanPhones.length > 0) {
          const { data: alreadyDialed } = await supabase
            .from("calls")
            .select("consumer_phone")
            .eq("agent_id", _targetAgentId)
            .eq("call_direction", "outbound")
            .like("agent_notes", "redial_batch:%")
            .in("consumer_phone", humanPhones);
          if (alreadyDialed && alreadyDialed.length > 0) {
            const dialedSet = new Set(alreadyDialed.map(c => normalizeToE164(c.consumer_phone)));
            uniqueContacts = uniqueContacts.filter(c => !dialedSet.has(normalizeToE164(c.consumer_phone)));
          }
        }

        // Redial cap: skip contacts already re-dialed 2+ times
        const humanRedialPhones = uniqueContacts.map(c => normalizeToE164(c.consumer_phone)).filter(Boolean);
        if (humanRedialPhones.length > 0) {
          const { data: redialCountRows } = await supabase
            .from("calls")
            .select("consumer_phone, redial_count")
            .in("consumer_phone", humanRedialPhones)
            .gte("redial_count", 2);
          if (redialCountRows && redialCountRows.length > 0) {
            const cappedSet = new Set(redialCountRows.map(r => normalizeToE164(r.consumer_phone)));
            uniqueContacts = uniqueContacts.filter(c => !cappedSet.has(normalizeToE164(c.consumer_phone)));
          }
        }

        const transferNumber = normalizeToE164(_agentRow.talkroute_number);
        const transferRoute = "hub";
        const agentName = _agentRow.full_name;
        const webhookUrl = `${supabaseUrl}/functions/v1/wolf-webhook`;

        await Promise.all(uniqueContacts.map(async (contact): Promise<{ phone: string; success: boolean; error?: string }> => {
        const phone = normalizeToE164(contact.consumer_phone);
        if (!phone) return { phone: contact.consumer_phone, success: false, error: "Invalid number" };

        const { data: dnc } = await supabase.from("calls").select("id").eq("consumer_phone", phone).eq("is_dnc", true).limit(1).maybeSingle();
        if (dnc) return { phone, success: false, error: "DNC" };

        // Get current redial_count for this phone
        const { data: existingRedial } = await supabase.from("calls")
          .select("redial_count")
          .eq("consumer_phone", phone)
          .order("created_at", { ascending: false })
          .limit(1).maybeSingle();
        const currentRedialCount = existingRedial?.redial_count ?? 0;

        const pressureFirstSentence = `Hi, may I speak with ${contact.consumer_name || "the account holder"}? This is Elizabeth calling on behalf of ${agentName} at Sterling Collections.`;

        const pressureTask = `You are Elizabeth, a professional assistant at Sterling Collections calling ${contact.consumer_name || "the prospect"} on behalf of ${agentName}. This is a follow-up call.

RULES — follow exactly, no exceptions:
1. VOICEMAIL / MACHINE: If you hear any answering machine, voicemail, or automated system — HANG UP immediately. Say nothing.
2. WRONG PERSON: If the person says they are not ${contact.consumer_name || "the account holder"} — say "I apologize for the inconvenience" and HANG UP.
3. LIVE PERSON — TRANSFER FAST: After your first_sentence, WAIT up to 5 seconds for any reply. The INSTANT you hear ANY engagement — "Hello?", "Yes?", "Speaking", "Who is this?", "What is this about?", "Okay", or any live human voice — proceed immediately to the transfer line.
4. TRANSFER LINE: Say EXACTLY: "Thank you. A representative is available regarding a private account matter. Please hold for a moment while I connect you. Connecting you now." Then say NOTHING else.
5. IF ASKED "what is this about?": Say "A representative needs to speak with you regarding a private account matter. Please hold while I connect you. Connecting you now." Then say NOTHING.
6. DECLINE / DNC: ONLY explicit refusal — "no", "not interested", "stop calling", "remove me", "do not call". Say "I understand, thank you for your time" and HANG UP.
7. SILENCE: If there is no reply within 5 seconds, HANG UP.
8. IF ASKED "Are you a robot/AI?": Say "I'm an automated assistant for ${agentName} at Sterling Collections. A representative is available now. Connecting you now." Then say NOTHING.
9. NEVER claim an urgent legal matter, lawsuit, deadline, or case-agent status. NEVER say ${agentName} is already on the line. NEVER disclose debt amounts or account details.
10. NEVER repeat your first_sentence. NEVER argue. NEVER say anything after "Connecting you now." After the transfer trigger, remain completely silent.`;

        try {
          const { data: attempt } = await supabase.from("calls").insert({
            agent_id: target_agent_id,
            original_agent_id: _sourceAgentId,
            redial_of: contact.id,
            redial_source_type: "live_humans",
            redial_batch_id: redialBatchId,
            consumer_name: contact.consumer_name,
            consumer_phone: phone,
            consumer_address: contact.consumer_address,
            consumer_income_range: contact.consumer_income_range,
            consumer_home_value: contact.consumer_home_value,
            consumer_property_info: contact.consumer_property_info,
            queue: "pending",
            call_direction: "outbound",
            originating_bland_number: agentRow.bland_number,
            talkroute_destination: transferNumber,
            transfer_route_used: transferRoute,
            agent_notes: `redial_batch:${redialBatchId}:humans:dialing`,
            redial_count: currentRedialCount + 1,
          }).select("id").maybeSingle();

          const blandResponse = await fetch("https://api.bland.ai/v1/calls", {
            method: "POST",
            headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              phone_number: phone,
              from: normalizeToE164(agentRow.bland_number),
              voice: agentRow.bland_voice_id || undefined,
              task: pressureTask,
              first_sentence: pressureFirstSentence,
              wait_for_greeting: true,
              record: true,
              voicemail: { action: "hangup", timeout: 0, sensitive: false },
              webhook: webhookUrl,
              webhook_events: ["call", "tool", "post_transfer_transcript"],
              max_duration: 8,
              block_interruptions: true,
              temperature: 0.1,
              noise_cancellation: true,
              transfer_phone_number: transferNumber,
              block_dtmf: false,
              summary_prompt: `Summarize this second-call re-dial in 2-3 sentences. Did ${contact.consumer_name || "the prospect"} agree to the transfer? Was the transfer successful? How did they react to the second call?`,
              metadata: { redial_batch_id: redialBatchId, redial_type: "live_humans" },
            }),
          });
          const blandData = await blandResponse.json();

          if (blandResponse.ok && blandData.status === "success") {
            if (attempt?.id) {
              await supabase.from("calls").update({
                provider_call_id: blandData.call_id,
                agent_notes: `redial_batch:${redialBatchId}:humans:placed`,
              }).eq("id", attempt.id);
            }
            return { phone, success: true };
          } else {
            if (attempt?.id) {
              await supabase.from("calls").update({ queue: "no_answer", is_completed: true, agent_notes: `redial_batch:${redialBatchId}:humans:failed` }).eq("id", attempt.id);
            }
            return { phone, success: false, error: blandData.message || blandData.error || `Bland rejected: ${blandResponse.status}` };
          }
        } catch {
          if (attempt?.id) {
            await supabase.from("calls").update({ queue: "no_answer", is_completed: true, agent_notes: `redial_batch:${redialBatchId}:humans:failed` }).eq("id", attempt.id);
          }
          return { phone, success: false, error: "Network error" };
        }
      }));
      })());

      return new Response(JSON.stringify({
        success: true,
        dialed: 0,
        failed: 0,
        total: 0,
        batch_id: redialBatchId,
        message: "Re-dial started",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // REDIAL_PROGRESS: poll for how many re-dial calls exist for an agent
    if (action === "redial_progress") {
      const { session_token, batch_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isReadAdmin(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Query by batch_id only (not agent_id) so cross-agent redials work correctly
      // Paginated fetch — no truncation
      let recentRedials: Array<{ id: string; queue: string; provider_call_id: string; consumer_name: string; consumer_phone: string; agent_notes: string; is_completed: boolean; duration_seconds: number; transfer_status: string; is_live_human: boolean }> = [];
      let pageOffset = 0;
      const pageSize = 1000;
      while (true) {
        const { data: page, error } = await supabase
          .from("calls")
          .select("id, queue, provider_call_id, consumer_name, consumer_phone, agent_notes, is_completed, duration_seconds, transfer_status, is_live_human")
          .eq("call_direction", "outbound")
          .like("agent_notes", `redial_batch:${batch_id}:%`)
          .order("created_at", { ascending: false })
          .range(pageOffset, pageOffset + pageSize - 1);
        if (error) return new Response(JSON.stringify({ error: "DB error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!page || page.length === 0) break;
        recentRedials = recentRedials.concat(page);
        if (page.length < pageSize) break;
        pageOffset += pageSize;
      }

      const total = recentRedials?.length || 0;
      const withCallId = recentRedials?.filter(c => c.provider_call_id).length || 0;
      const pending = recentRedials?.filter(c => c.queue === "pending").length || 0;
      const answered = recentRedials?.filter(c => c.queue === "fire_transfer" || c.queue === "human_drop").length || 0;
      const noAnswer = recentRedials?.filter(c => c.queue === "no_answer").length || 0;
      const failed = recentRedials?.filter(c => c.agent_notes?.endsWith(":failed")).length || 0;
      const dialing = recentRedials?.filter(c => c.agent_notes?.endsWith(":dialing")).length || 0;

      return new Response(JSON.stringify({
        success: true,
        total, withCallId, pending, answered, noAnswer, failed, dialing,
        calls: recentRedials || [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // REDIAL_STATS: aggregate analytics for all redial batches, with daily per-agent breakdown
    if (action === "redial_stats") {
      const { session_token, agent_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isReadAdmin(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Fetch all redial calls — both owner redial_batch:* (new format includes type) and agent_redial:*
      let query = supabase
        .from("calls")
        .select("id, agent_id, queue, consumer_name, consumer_phone, provider_call_id, agent_notes, transfer_status, is_live_human, is_completed, duration_seconds, created_at, agents!inner(full_name)")
        .or("agent_notes.like.redial_batch:%,agent_notes.like.agent_redial:%")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (agent_id) query = query.eq("agent_id", agent_id);

      const { data: redialCalls, error } = await query;
      if (error) return new Response(JSON.stringify({ error: "DB error: " + error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Parse notes to extract batch_id and redial type (transfers vs humans vs agent_selected)
      type ParsedRedial = { batchId: string; redialType: string; cleanNotes: string };
      const parseNotes = (notes: string): ParsedRedial | null => {
        // Strip auto-clean suffix that the stale-call cleaner appends — it contaminates the batch ID and status
        const cleanNotes = notes.replace(/\s*\[Auto-cleaned:.*\]\s*$/, "").trim();
        if (cleanNotes.startsWith("redial_batch:")) {
          // New format: redial_batch:<uuid>:transfers:placed  OR  redial_batch:<uuid>:humans:failed
          // Old format: redial_batch:<uuid>:placed  (no type — treat as unknown)
          const parts = cleanNotes.split(":");
          const batchId = parts[1] || "unknown";
          const typePart = parts[2] || "unknown";
          if (typePart === "transfers" || typePart === "humans") return { batchId, redialType: typePart, cleanNotes };
          // Old format without type — infer from queue later
          return { batchId, redialType: "unknown", cleanNotes };
        } else if (cleanNotes.startsWith("agent_redial:")) {
          const parts = cleanNotes.split(":");
          return { batchId: parts[1] || "unknown", redialType: "agent_selected", cleanNotes };
        }
        return null;
      };

      // Today's date in ET (server runs UTC, dashboard shows ET)
      const now = new Date();
      const etOffset = -4 * 60; // EDT = UTC-4
      const etNow = new Date(now.getTime() + etOffset * 60 * 1000);
      const todayET = etNow.toISOString().slice(0, 10); // YYYY-MM-DD

      type BatchStat = {
        batch_id: string; agent_id: string; agent_name: string; type: string;
        total: number; placed: number; pending: number; answered: number;
        transfer_requested: number; transfer_successful: number; transfer_failed: number;
        no_answer: number; failed: number; live_humans: number; voicemails: number;
        total_minutes: number; created_at: string; is_active: boolean; is_today: boolean;
      };
      type AgentDailyStat = {
        agent_id: string; agent_name: string;
        transfer_redials_today: number; human_redials_today: number; agent_redials_today: number;
        transfer_redial_batches_today: number; human_redial_batches_today: number; agent_redial_batches_today: number;
        transfers_from_redial_today: number; live_humans_from_redial_today: number;
        answered_today: number; no_answer_today: number; failed_today: number; total_calls_today: number;
        voicemails_today: number; total_minutes_today: number;
        connect_rate_today: number; transfer_conversion_rate_today: number;
      };

      const batchMap = new Map<string, BatchStat>();
      const agentDailyMap = new Map<string, AgentDailyStat>();
      const dailyBatchTracker = new Map<string, Set<string>>(); // agent_id -> set of batch_ids today

      const ensureAgentDaily = (agentId: string, agentName: string): AgentDailyStat => {
        if (!agentDailyMap.has(agentId)) {
          agentDailyMap.set(agentId, {
            agent_id: agentId, agent_name: agentName,
            transfer_redials_today: 0, human_redials_today: 0, agent_redials_today: 0,
            transfer_redial_batches_today: 0, human_redial_batches_today: 0, agent_redial_batches_today: 0,
            transfers_from_redial_today: 0, live_humans_from_redial_today: 0,
            answered_today: 0, no_answer_today: 0, failed_today: 0, total_calls_today: 0,
            voicemails_today: 0, total_minutes_today: 0,
            connect_rate_today: 0, transfer_conversion_rate_today: 0,
          });
          dailyBatchTracker.set(agentId, new Set());
        }
        return agentDailyMap.get(agentId)!;
      };

      for (const call of (redialCalls || [])) {
        const notes = call.agent_notes || "";
        const parsed = parseNotes(notes);
        if (!parsed) continue;
        const { batchId, redialType, cleanNotes } = parsed;

        const agentName = (call.agents as { full_name: string } | null)?.full_name || "Unknown";
        const callDateET = (() => {
          const d = new Date(call.created_at);
          const et = new Date(d.getTime() + etOffset * 60 * 1000);
          return et.toISOString().slice(0, 10);
        })();
        const isToday = callDateET === todayET;

        // Batch-level stats
        const key = batchId;
        if (!batchMap.has(key)) {
          batchMap.set(key, {
            batch_id: batchId, agent_id: call.agent_id, agent_name: agentName, type: redialType,
            total: 0, placed: 0, pending: 0, answered: 0,
            transfer_requested: 0, transfer_successful: 0, transfer_failed: 0,
            no_answer: 0, failed: 0, live_humans: 0, voicemails: 0,
            total_minutes: 0, created_at: call.created_at, is_active: false, is_today: isToday,
          });
        }
        const b = batchMap.get(key)!;
        b.total++;
        if (call.provider_call_id) b.placed++;
        if (call.queue === "pending") { b.pending++; b.is_active = true; }
        if (call.queue === "fire_transfer") { b.answered++; b.transfer_requested++; b.transfer_successful++; }
        if (call.queue === "human_drop") { b.answered++; b.live_humans++; if (call.transfer_status && call.transfer_status !== "none" && call.transfer_status !== "successful") b.transfer_failed++; }
        if (call.queue === "no_answer") b.no_answer++;
        if (call.queue === "voice_message") b.voicemails++;
        if (cleanNotes.endsWith(":failed")) b.failed++;
        if (call.transfer_status === "requested" || call.transfer_status === "transfer_api_accepted") b.transfer_requested++;
        if (call.transfer_status === "successful") b.transfer_successful++;
        if (call.transfer_status === "unsuccessful") b.transfer_failed++;
        b.total_minutes += Math.round((call.duration_seconds || 0) / 60 * 100) / 100;

        // Per-agent daily stats
        if (isToday) {
          const ad = ensureAgentDaily(call.agent_id, agentName);
          ad.total_calls_today++;
          if (call.queue === "fire_transfer") ad.transfers_from_redial_today++;
          if (call.queue === "human_drop") ad.live_humans_from_redial_today++;
          if (call.queue === "fire_transfer" || call.queue === "human_drop") ad.answered_today++;
          if (call.queue === "no_answer") ad.no_answer_today++;
          if (call.queue === "voice_message") ad.voicemails_today++;
          if (cleanNotes.endsWith(":failed")) ad.failed_today++;
          ad.total_minutes_today += Math.round((call.duration_seconds || 0) / 60 * 100) / 100;

          // Count unique batches per type per agent today
          if (redialType === "transfers") ad.transfer_redials_today++;
          else if (redialType === "humans") ad.human_redials_today++;
          else if (redialType === "agent_selected") ad.agent_redials_today++;

          const tracker = dailyBatchTracker.get(call.agent_id)!;
          const batchKey = `${redialType}:${batchId}`;
          if (!tracker.has(batchKey)) {
            tracker.add(batchKey);
            if (redialType === "transfers") ad.transfer_redial_batches_today++;
            else if (redialType === "humans") ad.human_redial_batches_today++;
            else if (redialType === "agent_selected") ad.agent_redial_batches_today++;
          }
        }
      }

      const batches = Array.from(batchMap.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
      const agents_daily = Array.from(agentDailyMap.values()).sort((a, b) => a.agent_name.localeCompare(b.agent_name));

      // Compute connect rate and transfer conversion rate per agent
      for (const ad of agents_daily) {
        ad.connect_rate_today = ad.total_calls_today > 0 ? Math.round((ad.answered_today / ad.total_calls_today) * 1000) / 10 : 0;
        ad.transfer_conversion_rate_today = ad.answered_today > 0 ? Math.round((ad.transfers_from_redial_today / ad.answered_today) * 1000) / 10 : 0;
      }

      // Overall totals (all-time) — includes computed rates
      const totalCallsAll = batches.reduce((s, b) => s + b.total, 0);
      const totalAnsweredAll = batches.reduce((s, b) => s + b.answered, 0);
      const totalTransfersAll = batches.reduce((s, b) => s + b.transfer_successful, 0);
      const overall = {
        total_batches: batches.length,
        total_calls: totalCallsAll,
        total_placed: batches.reduce((s, b) => s + b.placed, 0),
        total_transfer_requested: batches.reduce((s, b) => s + b.transfer_requested, 0),
        total_transfer_successful: totalTransfersAll,
        total_transfer_failed: batches.reduce((s, b) => s + b.transfer_failed, 0),
        total_answered: totalAnsweredAll,
        total_no_answer: batches.reduce((s, b) => s + b.no_answer, 0),
        total_live_humans: batches.reduce((s, b) => s + b.live_humans, 0),
        total_voicemails: batches.reduce((s, b) => s + b.voicemails, 0),
        total_failed: batches.reduce((s, b) => s + b.failed, 0),
        total_minutes: Math.round(batches.reduce((s, b) => s + b.total_minutes, 0) * 100) / 100,
        active_batches: batches.filter(b => b.is_active).length,
        connect_rate: totalCallsAll > 0 ? Math.round((totalAnsweredAll / totalCallsAll) * 1000) / 10 : 0,
        transfer_conversion_rate: totalAnsweredAll > 0 ? Math.round((totalTransfersAll / totalAnsweredAll) * 1000) / 10 : 0,
        cost_per_transfer: totalTransfersAll > 0 ? Math.round((batches.reduce((s, b) => s + b.total_minutes, 0) / totalTransfersAll) * 100) / 100 : 0,
      };

      // Today's totals (derived from agents_daily) — includes computed rates
      const todayTotalCalls = agents_daily.reduce((s, a) => s + a.total_calls_today, 0);
      const todayAnswered = agents_daily.reduce((s, a) => s + a.answered_today, 0);
      const todayTransfers = agents_daily.reduce((s, a) => s + a.transfers_from_redial_today, 0);
      const todayMinutes = Math.round(agents_daily.reduce((s, a) => s + a.total_minutes_today, 0) * 100) / 100;
      const today = {
        date: todayET,
        total_calls: todayTotalCalls,
        transfer_redials: agents_daily.reduce((s, a) => s + a.transfer_redials_today, 0),
        human_redials: agents_daily.reduce((s, a) => s + a.human_redials_today, 0),
        agent_redials: agents_daily.reduce((s, a) => s + a.agent_redials_today, 0),
        transfer_batches: agents_daily.reduce((s, a) => s + a.transfer_redial_batches_today, 0),
        human_batches: agents_daily.reduce((s, a) => s + a.human_redial_batches_today, 0),
        agent_batches: agents_daily.reduce((s, a) => s + a.agent_redial_batches_today, 0),
        transfers_from_redial: todayTransfers,
        live_humans_from_redial: agents_daily.reduce((s, a) => s + a.live_humans_from_redial_today, 0),
        answered: todayAnswered,
        no_answer: agents_daily.reduce((s, a) => s + a.no_answer_today, 0),
        failed: agents_daily.reduce((s, a) => s + a.failed_today, 0),
        voicemails: agents_daily.reduce((s, a) => s + a.voicemails_today, 0),
        total_minutes: todayMinutes,
        connect_rate: todayTotalCalls > 0 ? Math.round((todayAnswered / todayTotalCalls) * 1000) / 10 : 0,
        transfer_conversion_rate: todayAnswered > 0 ? Math.round((todayTransfers / todayAnswered) * 1000) / 10 : 0,
        cost_per_transfer: todayTransfers > 0 ? Math.round((todayMinutes / todayTransfers) * 100) / 100 : 0,
      };

      return new Response(JSON.stringify({ success: true, batches, overall, agents_daily, today }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // AGENT_REDIAL: any logged-in agent selects up to 3 contacts to re-dial
    if (action === "agent_redial") {
      const { session_token, call_ids } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      if (!blandApiKey) {
        return new Response(JSON.stringify({ error: "Bland.ai API key is not configured." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── Strict input validation (all-or-nothing: every check runs before any Bland call) ──

      // 1. call_ids must be a non-empty array
      if (!Array.isArray(call_ids) || call_ids.length === 0) {
        return new Response(JSON.stringify({ error: "Select at least one contact to redial." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 2. Hard cap: reject more than 3
      if (call_ids.length > 3) {
        return new Response(JSON.stringify({ error: "Maximum 3 contacts per redial batch. You sent " + call_ids.length + "." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 3. Every ID must be a valid UUID string
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const ids: string[] = call_ids;
      for (const id of ids) {
        if (typeof id !== "string" || !uuidRe.test(id)) {
          return new Response(JSON.stringify({ error: "Malformed contact ID: " + String(id).slice(0, 40) }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // 4. No duplicates
      if (new Set(ids).size !== ids.length) {
        return new Response(JSON.stringify({ error: "Duplicate contact IDs are not allowed." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 5. Agent config
      const { data: agentRow } = await supabase
        .from("agents")
        .select("id, full_name, bland_number, bland_voice_id, talkroute_number, agent_direct_number")
        .eq("id", agent.id)
        .maybeSingle();

      if (!agentRow || !agentRow.bland_number) {
        return new Response(JSON.stringify({ error: "Your Bland number is not configured." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 6. All IDs must exist AND be assigned to this agent
      const { data: originalCalls } = await supabase
        .from("calls")
        .select("id, consumer_name, consumer_phone, consumer_address, consumer_income_range, consumer_home_value, consumer_property_info, queue")
        .in("id", ids)
        .eq("agent_id", agent.id);

      if (!originalCalls || originalCalls.length !== ids.length) {
        const foundIds = new Set((originalCalls || []).map((c: { id: string }) => c.id));
        const missing = ids.filter(id => !foundIds.has(id));
        return new Response(JSON.stringify({ error: "Contacts not found or not assigned to you: " + missing.join(", ") }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 7. Validate every phone number and check DNC — before any Bland call
      const validatedContacts: Array<{ contact: typeof originalCalls[0]; phone: string }> = [];
      for (const contact of originalCalls) {
        const phone = normalizeToE164(contact.consumer_phone);
        if (!phone) {
          return new Response(JSON.stringify({ error: "Invalid phone number for " + (contact.consumer_name || contact.id) + "." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { data: dnc } = await supabase.from("calls").select("id").eq("consumer_phone", phone).eq("is_dnc", true).limit(1).maybeSingle();
        if (dnc) {
          return new Response(JSON.stringify({ error: (contact.consumer_name || "Contact") + " is on the Do-Not-Call list." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        validatedContacts.push({ contact, phone });
      }

      // ── All validation passed — now create calls and fire Bland requests ──

      const transferNumber = normalizeToE164(agentRow.talkroute_number);
      const transferRoute = "hub";
      const agentName = agentRow.full_name;
      const webhookUrl = `${supabaseUrl}/functions/v1/wolf-webhook`;
      const redialBatchId = crypto.randomUUID();
      const results: Array<Record<string, unknown>> = [];

      for (const { contact, phone } of validatedContacts) {

        const firstSentence = `Hi, may I speak with ${contact.consumer_name || "the account holder"}? This is Elizabeth calling on behalf of ${agentName} at Sterling Collections.`;

        const task = `You are Elizabeth, a professional assistant at Sterling Collections calling ${contact.consumer_name || "the prospect"} on behalf of ${agentName}. This is a follow-up call.

RULES — follow exactly, no exceptions:
1. VOICEMAIL / MACHINE: If you hear any answering machine, voicemail, or automated system — HANG UP immediately. Say nothing.
2. WRONG PERSON: If the person says they are not ${contact.consumer_name || "the account holder"} — say "I apologize for the inconvenience" and HANG UP.
3. LIVE PERSON — TRANSFER FAST: After your first_sentence, WAIT up to 5 seconds for any reply. The INSTANT you hear ANY engagement — "Hello?", "Yes?", "Speaking", "Who is this?", "What is this about?", "Okay", or any live human voice — proceed immediately to the transfer line.
4. TRANSFER LINE: Say EXACTLY: "Thank you. A representative is available regarding a private account matter. Please hold for a moment while I connect you. Connecting you now." Then say NOTHING else.
5. IF ASKED "what is this about?": Say "A representative needs to speak with you regarding a private account matter. Please hold while I connect you. Connecting you now." Then say NOTHING.
6. DECLINE / DNC: ONLY explicit refusal — "no", "not interested", "stop calling", "remove me", "do not call". Say "I understand, thank you for your time" and HANG UP.
7. SILENCE: If there is no reply within 5 seconds, HANG UP.
8. IF ASKED "Are you a robot/AI?": Say "I'm an automated assistant for ${agentName} at Sterling Collections. A representative is available now. Connecting you now." Then say NOTHING.
9. NEVER claim an urgent legal matter, lawsuit, deadline, or case-agent status. NEVER say ${agentName} is already on the line. NEVER disclose debt amounts or account details.
10. NEVER repeat your first_sentence. NEVER argue. NEVER say anything after "Connecting you now." After the transfer trigger, remain completely silent.`;

        try {
          const { data: attempt } = await supabase.from("calls").insert({
            agent_id: agent.id,
            consumer_name: contact.consumer_name,
            consumer_phone: phone,
            consumer_address: contact.consumer_address,
            consumer_income_range: contact.consumer_income_range,
            consumer_home_value: contact.consumer_home_value,
            consumer_property_info: contact.consumer_property_info,
            queue: "pending",
            call_direction: "outbound",
            originating_bland_number: agentRow.bland_number,
            talkroute_destination: transferNumber,
            transfer_route_used: transferRoute,
            agent_notes: `agent_redial:${redialBatchId}`,
          }).select("id").maybeSingle();

          const blandResponse = await fetch("https://api.bland.ai/v1/calls", {
            method: "POST",
            headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              phone_number: phone,
              from: normalizeToE164(agentRow.bland_number),
              voice: agentRow.bland_voice_id || undefined,
              task,
              first_sentence: firstSentence,
              wait_for_greeting: true,
              record: true,
              voicemail: { action: "hangup", timeout: 0, sensitive: false },
              webhook: webhookUrl,
              webhook_events: ["call", "tool", "post_transfer_transcript"],
              max_duration: 8,
              interruptibility: 0,
              temperature: 0.1,
              noise_cancellation: true,
              transfer_phone_number: transferNumber,
              block_dtmf: false,
              summary_prompt: `Summarize this call in 2-3 sentences. Did ${contact.consumer_name || "the prospect"} agree to the transfer? Was the transfer successful? Was a voicemail left?`,
              metadata: { redial_batch_id: redialBatchId, redial_type: "agent_selected" },
            }),
          });
          const blandData = await blandResponse.json();

          if (blandResponse.ok && blandData.status === "success") {
            if (attempt?.id) {
              await supabase.from("calls").update({ provider_call_id: blandData.call_id }).eq("id", attempt.id);
            }
            results.push({ id: attempt?.id, name: contact.consumer_name, phone, success: true, provider_call_id: blandData.call_id });
          } else {
            if (attempt?.id) {
              await supabase.from("calls").update({ queue: "no_answer", is_completed: true }).eq("id", attempt.id);
            }
            results.push({ name: contact.consumer_name, phone, success: false, error: blandData.message || blandData.error || "Bland rejected call" });
          }
        } catch {
          results.push({ name: contact.consumer_name, phone, success: false, error: "Network error" });
        }
      }

      return new Response(JSON.stringify({ success: true, batch_id: redialBatchId, total: results.length, results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_REDIAL_TRANSCRIPTS: poll for live transcript data on agent's redial calls
    if (action === "get_redial_transcripts") {
      const { session_token, batch_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data: batchCalls, error } = await supabase
        .from("calls")
        .select("id, consumer_name, consumer_phone, queue, provider_call_id, duration_seconds, ai_summary, transcript, is_completed, transfer_status, is_live_human, voicemail_status, created_at")
        .eq("agent_id", agent.id)
        .like("agent_notes", `agent_redial:${batch_id}`)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) return new Response(JSON.stringify({ error: "DB error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const liveData: Array<Record<string, unknown>> = [];
      for (const call of (batchCalls || [])) {
        let liveTranscript = call.transcript || "";
        let liveStatus = call.queue || "pending";
        let liveDuration = call.duration_seconds || 0;

        if (call.provider_call_id && !call.is_completed) {
          try {
            const blandRes = await fetch(`https://api.bland.ai/v1/calls/${call.provider_call_id}`, {
              headers: { "authorization": blandApiKey },
            });
            if (blandRes.ok) {
              const blandCall = await blandRes.json();
              if (blandCall.transcript && blandCall.transcript.length > (liveTranscript?.length || 0)) {
                liveTranscript = blandCall.transcript;
              }
              if (blandCall.status === "live" || blandCall.status === "ringing" || blandCall.status === "in_progress") {
                liveStatus = blandCall.status === "ringing" ? "ringing" : "in_progress";
              }
              if (blandCall.call_length && blandCall.call_length > liveDuration) {
                liveDuration = blandCall.call_length;
              }
            }
          } catch { /* use DB data */ }
        }

        liveData.push({
          id: call.id, name: call.consumer_name, phone: call.consumer_phone,
          status: liveStatus, duration: liveDuration, transcript: liveTranscript,
          ai_summary: call.ai_summary, is_completed: call.is_completed,
          transfer_status: call.transfer_status, is_live_human: call.is_live_human,
          voicemail_status: call.voicemail_status, provider_call_id: call.provider_call_id,
        });
      }

      return new Response(JSON.stringify({ success: true, calls: liveData }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_all_fire_transfers") {
      const { session_token, agent_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isReadAdmin(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      let query = supabase
        .from("calls")
        .select(`
          id, consumer_name, consumer_phone, consumer_address, consumer_home_value,
          consumer_income_range, consumer_property_info, consumer_custom_fields,
          call_direction, duration_seconds, ai_summary, transcript, recording_url,
          transfer_status, transfer_requested_at, talkroute_answered_at,
          bridge_confirmed_at, ai_terminated_at, talkroute_answered, bridge_confirmed,
          ai_terminated, is_completed, created_at, queue, agent_id,
          callback_requested, is_dnc, is_wrong_number, agent_disposition, agent_notes
        `)
        .order("created_at", { ascending: false })
        .limit(200);

      if (agent_id) {
        query = query.eq("agent_id", agent_id);
      }

      const { data: fireCalls, error: fireErr } = await query;
      if (fireErr) return new Response(JSON.stringify({ error: "Failed to load call log" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const agentMap = new Map<string, string>();
      if (fireCalls && fireCalls.length > 0) {
        const agentIds = [...new Set(fireCalls.map((c: Record<string, unknown>) => c.agent_id).filter(Boolean))] as string[];
        if (agentIds.length > 0) {
          const { data: agentsData } = await supabase.from("agents").select("id, full_name").in("id", agentIds);
          if (agentsData) for (const a of agentsData as Array<Record<string, unknown>>) agentMap.set(a.id as string, a.full_name as string);
        }
      }
      const enriched = (fireCalls || []).map((c: Record<string, unknown>) => ({
        ...c,
        agent: c.agent_id ? { id: c.agent_id, full_name: agentMap.get(c.agent_id as string) || "Unknown" } : null,
      }));

      return new Response(JSON.stringify({ fire_transfers: enriched }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET_CALL_LOG — paginated call history with filters (owner/admin only)
    if (action === "get_call_log") {
      const { session_token, outcome, agent_id, date_from, date_to, limit, offset } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isReadAdmin(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const pageLimit = Math.min(Math.max(parseInt(String(limit || "50"), 10) || 50, 1), 200);
      const pageOffset = Math.max(parseInt(String(offset || "0"), 10) || 0, 0);

      let query = supabase
        .from("calls")
        .select(`
          id, consumer_name, consumer_phone, consumer_address, consumer_home_value,
          consumer_income_range, consumer_property_info, consumer_custom_fields,
          call_direction, duration_seconds, ai_summary, transcript, recording_url,
          transfer_status, transfer_requested_at, talkroute_answered_at,
          bridge_confirmed_at, ai_terminated_at, talkroute_answered, bridge_confirmed,
          ai_terminated, is_completed, created_at, queue, agent_id,
          callback_requested, is_dnc, is_wrong_number, agent_disposition, agent_notes
        `)
        .order("created_at", { ascending: false })
        .limit(pageLimit + 1);

      if (outcome && outcome !== "all") {
        const validQueues = ["fire_transfer", "human_drop", "no_answer", "voice_message", "pending", "completed"];
        if (validQueues.includes(outcome)) {
          query = query.eq("queue", outcome);
        }
      }
      if (agent_id) query = query.eq("agent_id", agent_id);
      if (date_from) query = query.gte("created_at", date_from);
      if (date_to) query = query.lte("created_at", date_to);

      const { data: callsData, error: callsErr } = await query;
      if (callsErr) return new Response(JSON.stringify({ error: "Failed to load call log" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const allRows = (callsData || []) as Array<Record<string, unknown>>;
      const hasMore = allRows.length > pageLimit;
      const records = hasMore ? allRows.slice(0, pageLimit) : allRows;

      const agentMap = new Map<string, string>();
      if (records.length > 0) {
        const agentIds = [...new Set(records.map((c) => c.agent_id).filter(Boolean))] as string[];
        if (agentIds.length > 0) {
          const { data: agentsData } = await supabase.from("agents").select("id, full_name").in("id", agentIds);
          if (agentsData) for (const a of agentsData as Array<Record<string, unknown>>) agentMap.set(a.id as string, a.full_name as string);
        }
      }
      const enriched = records.map((c) => ({
        ...c,
        agent: c.agent_id ? { id: c.agent_id, full_name: agentMap.get(c.agent_id as string) || "Unknown" } : null,
      }));

      return new Response(JSON.stringify({ records: enriched, total: pageOffset + enriched.length + (hasMore ? 1 : 0), has_more: hasMore }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // AUDIT & EVENTS (owner/admin only)
    // ============================================================

    // GET_AUDIT_LOGS
    if (action === "get_audit_logs") {
      const { session_token, limit } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isReadAdmin(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("get_audit_logs", { p_limit: limit || 50 });
      if (error) return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ audit_logs: data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_CAMPAIGN_EVENTS
    if (action === "get_campaign_events") {
      const { session_token, limit } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isReadAdmin(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc("get_campaign_events", { p_limit: limit || 20 });
      if (error) return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ events: data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // CAMPAIGN CONTROL (owner/admin only)
    // ============================================================

    if (action === "start_campaign") {
      const { session_token, call_limit } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data, error } = await supabase.rpc("campaign_start", { p_concurrency: 5, p_call_limit: call_limit || 500 });
      if (error) return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "stop_campaign") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data, error } = await supabase.rpc("campaign_stop");
      if (error) return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // SAVED TRANSFERS
    // ============================================================

    // SAVE_TRANSFER — agent bookmarks a transfer for later follow-up
    if (action === "save_transfer") {
      const { session_token, call_id, notes } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data: call } = await supabase
        .from("calls")
        .select("id, agent_id, consumer_name, consumer_phone, consumer_address, consumer_income_range, consumer_home_value, consumer_property_info, queue")
        .eq("id", call_id)
        .eq("agent_id", agent.id)
        .maybeSingle();

      if (!call) return new Response(JSON.stringify({ error: "Call not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Check if already saved (active)
      const { data: existing } = await supabase
        .from("saved_transfers")
        .select("id")
        .eq("agent_id", agent.id)
        .eq("call_id", call_id)
        .eq("is_active", true)
        .maybeSingle();

      if (existing) return new Response(JSON.stringify({ success: true, message: "Already saved" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { error: insertErr } = await supabase.from("saved_transfers").insert({
        agent_id: agent.id,
        call_id: call.id,
        consumer_name: call.consumer_name,
        consumer_phone: call.consumer_phone,
        consumer_address: call.consumer_address,
        consumer_income_range: call.consumer_income_range,
        consumer_home_value: call.consumer_home_value,
        consumer_property_info: call.consumer_property_info,
        original_queue: call.queue || "fire_transfer",
        notes: notes || null,
      });

      if (insertErr) return new Response(JSON.stringify({ error: "Failed to save transfer" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_ACTIVE_TRANSFERS — agent sees incoming transfer_context rows for their calls
    if (action === "get_active_transfers") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data, error } = await supabase.rpc("get_active_transfers", { p_agent_id: agent.id });
      if (error) return new Response(JSON.stringify({ error: "Failed to load active transfers" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ transfers: data || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_SAVED_TRANSFERS — agent sees their active saved transfers
    if (action === "get_saved_transfers") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data, error } = await supabase
        .from("saved_transfers")
        .select("id, call_id, consumer_name, consumer_phone, consumer_address, consumer_income_range, consumer_home_value, consumer_property_info, original_queue, notes, created_at")
        .eq("agent_id", agent.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) return new Response(JSON.stringify({ error: "Failed to load saved transfers" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ saved_transfers: data || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // DELETE_SAVED_TRANSFER — agent soft-deletes (admin can still see history)
    if (action === "delete_saved_transfer") {
      const { session_token, saved_transfer_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { error } = await supabase
        .from("saved_transfers")
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .eq("id", saved_transfer_id)
        .eq("agent_id", agent.id)
        .eq("is_active", true);

      if (error) return new Response(JSON.stringify({ error: "Failed to remove" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET_ALL_SAVED_TRANSFERS — admin sees all agents' saved transfers (including deleted, for history)
    if (action === "get_all_saved_transfers") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!isReadAdmin(agent.role)) return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data, error } = await supabase
        .from("saved_transfers")
        .select("id, call_id, agent_id, consumer_name, consumer_phone, consumer_address, consumer_income_range, consumer_home_value, consumer_property_info, original_queue, notes, is_active, deleted_at, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) return new Response(JSON.stringify({ error: "Failed to load saved transfers" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const rows = (data || []) as Array<Record<string, unknown>>;
      const agentMap = new Map<string, string>();
      if (rows.length > 0) {
        const agentIds = [...new Set(rows.map((r) => r.agent_id).filter(Boolean))] as string[];
        if (agentIds.length > 0) {
          const { data: agentsData } = await supabase.from("agents").select("id, full_name").in("id", agentIds);
          if (agentsData) for (const a of agentsData as Array<Record<string, unknown>>) agentMap.set(a.id as string, a.full_name as string);
        }
      }
      const enriched = rows.map((r) => ({
        ...r,
        agent: r.agent_id ? { id: r.agent_id, full_name: agentMap.get(r.agent_id as string) || "Unknown" } : null,
      }));

      return new Response(JSON.stringify({ saved_transfers: enriched }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // RECOVER_RECORDING: fetch Bland recording server-side, store in bucket, return playable URL
    // ============================================================
    if (action === "recover_recording") {
      const { session_token, call_id } = body;
      const agent = await verifySession(session_token);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!call_id || typeof call_id !== "string") {
        return new Response(JSON.stringify({ error: "call_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch the call row — verify ownership or owner role
      const { data: callRow, error: callErr } = await supabase
        .from("calls")
        .select("id, agent_id, provider_call_id, recording_url")
        .eq("id", call_id)
        .maybeSingle();

      if (callErr || !callRow) {
        return new Response(JSON.stringify({ error: "Call not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Role isolation: owner/admin can recover any call; agents only their own
      const isOwnerOrAdmin = agent.role === "owner" || agent.role === "administrator";
      if (!isOwnerOrAdmin && callRow.agent_id !== agent.id) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!blandApiKey) {
        return new Response(JSON.stringify({ error: "Recording service unavailable" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const blandCallId = callRow.provider_call_id;
      if (!blandCallId) {
        return new Response(JSON.stringify({ error: "No provider call ID — cannot recover recording" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Try fetching recording from Bland (2 strategies: /recording endpoint, then detail fallback)
      let audioBlob: Blob | null = null;
      let contentType = "audio/mpeg";

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const recRes = await fetch(`https://api.bland.ai/v1/calls/${blandCallId}/recording`, {
            headers: { "authorization": blandApiKey },
          });
          if (recRes.ok) {
            const ct = recRes.headers.get("content-type") || "";
            if (ct.includes("audio") || ct.includes("octet")) {
              audioBlob = await recRes.blob();
              contentType = ct;
              break;
            }
          }

          // Fallback: get recording_url from call detail
          const detailRes = await fetch(`https://api.bland.ai/v1/calls/${blandCallId}`, {
            headers: { "authorization": blandApiKey },
          });
          if (detailRes.ok) {
            const detail = await detailRes.json() as Record<string, unknown>;
            const recUrl = String(detail.recording_url || "");
            if (recUrl && recUrl.startsWith("http")) {
              const s3Res = await fetch(recUrl);
              if (s3Res.ok) {
                audioBlob = await s3Res.blob();
                contentType = s3Res.headers.get("content-type") || "audio/mpeg";
                break;
              }
            }
          }
        } catch {
          // retry
        }
        if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
      }

      if (!audioBlob || audioBlob.size === 0) {
        return new Response(JSON.stringify({ error: "Recording not available from provider" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store in Supabase storage
      const ext = contentType.includes("ogg") ? "ogg" : contentType.includes("wav") ? "wav" : "mp3";
      const filePath = `${call_id}.${ext}`;
      const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/call-recordings/${filePath}`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${serviceRoleKey}`,
          "Content-Type": contentType,
          "x-upsert": "true",
        },
        body: audioBlob,
      });

      if (!uploadRes.ok) {
        return new Response(JSON.stringify({ error: "Failed to store recording" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const publicUrl = `${supabaseUrl}/storage/v1/object/public/call-recordings/${filePath}`;

      // Update calls.recording_url
      await supabase.from("calls").update({ recording_url: publicUrl }).eq("id", call_id);

      return new Response(JSON.stringify({ success: true, recording_url: publicUrl }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_retry_stats") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner" && agent.role !== "administrator") return new Response(JSON.stringify({ error: "Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error: rpcErr } = await supabase.rpc("get_retry_campaign_stats");
      if (rpcErr) return new Response(JSON.stringify({ error: rpcErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ success: true, stats: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "start_retry_campaign") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner") return new Response(JSON.stringify({ error: "Owner access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { error: upErr } = await supabase.from("campaigns").update({ state: "running", dialer_status: "running", dialer_activated: true, updated_at: new Date().toISOString() }).eq("campaign_type", "retry");
      if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ success: true, message: "Retry campaign started" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "stop_retry_campaign") {
      const { session_token } = body;
      const agent = await verifySession(session_token);
      if (!agent) return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (agent.role !== "owner") return new Response(JSON.stringify({ error: "Owner access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { error: upErr } = await supabase.from("campaigns").update({ state: "stopped", dialer_status: "idle", dialer_activated: false, updated_at: new Date().toISOString() }).eq("campaign_type", "retry");
      if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ success: true, message: "Retry campaign stopped" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof SessionVerificationUnavailable) {
      return new Response(JSON.stringify({ error: "Session verification temporarily unavailable. Please try again." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function normalizeToE164(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    return "+1" + digits;
  }
  return "+" + digits;
}
// edge-runtime pragma: no-cache
// deploy-1787853263
// deploy2-1787853326
// deploy3-1787853510
// deploy4-1787853815
// deploy-retry-v264
