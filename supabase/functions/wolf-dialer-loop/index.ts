import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.4";
import { getBlandCallCompletion, detectLiveHuman, flattenTranscript, blandDurationToSeconds } from "../_shared/call-evidence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const blandApiKey = Deno.env.get("BLAND_API_KEY") ?? "";
const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
const DIALER_FUNCTION_URL = `${supabaseUrl}/functions/v1/wolf-dialer-loop`;

type Sql = ReturnType<typeof postgres>;

function getPool(): Sql {
  return postgres(dbUrl, {
    max: 1,
    idle_timeout: 3,
    connect_timeout: 10,
    ssl: { rejectUnauthorized: false },
  });
}

function normalizeToE164(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length === 10) return "+1" + digits;
  return "+" + digits;
}

const BANNED_NAME_WORDS = [
  "ransom", "kidnap", "hostage", "extort", "bomb", "terror", "drug", "cartel",
  "kill", "murder", "assassin", "weapon", "gun", "explosive",
];

function sanitizeName(rawName: string): string {
  if (!rawName || !rawName.trim()) return "the client";
  const lower = rawName.toLowerCase();
  const hasBanned = BANNED_NAME_WORDS.some(w => lower.includes(w));
  if (!hasBanned) return rawName.trim();
  const parts = rawName.trim().split(/\s+/);
  const safeParts = parts.filter(p => !BANNED_NAME_WORDS.some(w => p.toLowerCase().includes(w)));
  if (safeParts.length > 0) return safeParts.join(" ");
  return "the client";
}

function isTollFree(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  const areaCode = digits.length === 11 ? digits.slice(1, 4) : digits.slice(0, 3);
  return ["800", "855", "866", "877", "888", "844", "833"].includes(areaCode);
}

async function checkBlandBalance(): Promise<{ ok: boolean; balance: number }> {
  try {
    const res = await fetch("https://api.bland.ai/v1/billing", {
      headers: { "authorization": blandApiKey },
    });
    if (!res.ok) return { ok: false, balance: 0 };
    const data = await res.json();
    const balance = typeof data.balance === "number" ? data.balance : parseFloat(String(data.balance || 0));
    return { ok: true, balance };
  } catch {
    return { ok: false, balance: 0 };
  }
}

// Watchdog timeout. MUST stay above the Bland max_duration used when placing
// calls (8 minutes) minus a small margin, otherwise we hang up on our own
// live calls. Previously 150s, which killed calls mid-transfer while Talkroute
// was still ringing the agent — the DB-side "transfer aware" exclusions below
// only help if a real-time transfer webhook already landed, and Bland's native
// transfer_phone_number path does not reliably send one before the call ends.
const STALE_CALL_TIMEOUT_SECONDS = 210;

async function killStaleCalls(sql: Sql) {
  try {
    const cutoff = new Date(Date.now() - STALE_CALL_TIMEOUT_SECONDS * 1000).toISOString();
    const staleCalls = await sql`
      SELECT id, provider_call_id, created_at, duration_seconds FROM calls
      WHERE queue = 'pending' AND is_completed = false
        AND call_direction = 'outbound' AND provider_call_id IS NOT NULL
        AND provider_call_id != '' AND created_at < ${cutoff}
        AND transfer_requested_at IS NULL
        AND talkroute_leg_created = false
        AND ai_terminated = false
      LIMIT 20
    `;
    if (!staleCalls || staleCalls.length === 0) return;

    for (const call of staleCalls) {
      try {
        const statusRes = await fetch(`https://api.bland.ai/v1/calls/${call.provider_call_id}`, {
          headers: { "authorization": blandApiKey },
        });
        if (!statusRes.ok) continue;
        const info = await statusRes.json() as Record<string, unknown>;
        if (getBlandCallCompletion(info) !== true) continue;

        const terminalStatus = String(info.status || "").toLowerCase().replace(/[\s-]+/g, "_");
        const transcript = flattenTranscript(info.transcripts, info.concatenated_transcript);
        const transferring = Boolean(info.transferred_to || info.transfer_phone_number || info.warm_transfer_call);
        const durationSeconds = blandDurationToSeconds(info.call_length ?? info.duration);
        const hasHuman = detectLiveHuman(info, transcript);
        const hasEvidence = transferring || !!transcript || hasHuman || !!info.recording_url ||
            durationSeconds > 0 || (call.duration_seconds ?? 0) > 0;

        const failedWithoutAnswer = ["no_answer", "busy", "failed", "error", "cancelled", "canceled", "timeout", "timed_out"].includes(terminalStatus);

        // Human/transfer evidence belongs to the evidence-preserving backfill
        // path. The watchdog only closes calls that clearly ended without one.
        if (hasHuman || transferring) continue;

        if (failedWithoutAnswer && !hasEvidence) {
          await sql`UPDATE calls SET queue = 'no_answer', is_completed = true WHERE id = ${call.id} AND queue = 'pending' AND is_completed = false`;
        } else if (hasEvidence) {
          const queue = hasHuman || transferring ? 'human_drop' : durationSeconds > 5 ? 'voice_message' : 'no_answer';
          await sql`UPDATE calls SET queue = ${queue}, is_completed = true, duration_seconds = GREATEST(duration_seconds, ${durationSeconds || 0}), recording_url = COALESCE(NULLIF(recording_url,''), ${String(info.recording_url || '')}), transcript = COALESCE(NULLIF(transcript,''), ${transcript || ''}) WHERE id = ${call.id} AND queue = 'pending' AND is_completed = false`;
        } else {
          await sql`UPDATE calls SET queue = 'no_answer', is_completed = true WHERE id = ${call.id} AND queue = 'pending' AND is_completed = false`;
        }
      } catch { continue; }
    }
  } catch { /* ignore */ }
}

async function placeBlandCall(
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

  const firstSentence = `Hello, this is Elizabeth Sterling. I'm the assistant for ${agentName}. May I speak with ${consumerName}?`;

  const task = `You are Elizabeth Sterling, the assistant for ${agentName}.

RULES — follow exactly, no exceptions:
1. VOICEMAIL / MACHINE: Before speaking to the intended person, if you hear an answering machine, voicemail greeting, or automated system — "leave a message", "after the tone", "press pound", "mailbox", "not available", "does not accept solicitations", or any voice that keeps talking without reacting to you — HANG UP immediately. Say nothing. Never transfer a customer answering machine. Once the intended person agrees and you transfer to the agent, allow the agent\'s voicemail greeting and recording to complete if the agent does not answer.
2. WRONG PERSON: If the person says they are not ${consumerName}, or ${consumerName} is not available, or "doesn't live here" — say "I apologize for the inconvenience" and HANG UP.
3. RIGHT PERSON: If the person confirms they are ${consumerName}, say: "Thank you. ${agentName} would like to speak with you. May I connect you now?" If they agree, say "Certainly. Please hold while I connect you to ${agentName}." Then invoke the transfer tool immediately and remain completely silent while it connects.
4. IDENTITY NOT CONFIRMED: If asked who is calling before identity is confirmed, say only: "I help connect callers with ${agentName}. Is ${consumerName} available?" Never reveal an account, balance, debt, collection purpose, or private matter to an unverified person.
5. WHY ARE YOU CALLING / WHAT IS THIS ABOUT: Say: "I don't have the details to discuss, but ${agentName} can explain. Would you like me to transfer you?" If they agree, invoke the transfer tool.
6. I DON'T KNOW THAT AGENT: Say: "That's okay—you don't need to know ${agentName} personally. They can help clarify why you were contacted. May I connect you?" Never require callers to know the agent's name before transferring.
7. QUESTIONS ABOUT A CASE: Say: "I cannot confirm case details. ${agentName} can help with your question. May I connect you?" Never invent legal authority, deadlines, urgency, or private details.
8. DECLINE / DNC: ONLY an explicit refusal counts — "no", "not interested", "stop calling", "remove me", "take me off", "do not call". Say "I understand, thank you for your time" and HANG UP. Questions like "who is this?" are NOT a decline.
9. SILENCE: If there is no reply within 5 seconds, HANG UP.
10. IF ASKED "Are you a robot/AI?": Answer truthfully: "Yes, I'm an AI assistant for ${agentName}." Then return to the conversation.
11. NEVER claim an urgent legal matter, lawsuit, deadline, or case-agent status. NEVER say ${agentName} is already on the line. NEVER impersonate a government agency. NEVER disclose debt amounts or account details.
12. NEVER repeat your first_sentence. NEVER argue. NEVER say anything after the transfer trigger. After saying "Please hold while I connect you to ${agentName}", remain completely silent.`;

  try {
    const blandResponse = await fetch("https://api.bland.ai/v1/calls", {
      method: "POST",
      headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        phone_number: phoneNumber,
        from: normalizeToE164(blandNumber),
        voice: voiceId || undefined,
        task,
        first_sentence: firstSentence,
        wait_for_greeting: true,
        answered_by_enabled: true,
        record: true,
        voicemail: { action: "hangup", sensitive: true },
        webhook: webhookUrl,
        webhook_events: ["call", "tool", "post_transfer_transcript"],
        max_duration: 3,
        block_interruptions: false,
        interruption_threshold: 100,
        temperature: 0.05,
        noise_cancellation: true,
        transfer_phone_number: transferNumber,
        block_dtmf: false,
        sensitive_voicemail_detection: true,
        summary_prompt: `Did the prospect answer? Was the transfer successful?`,
      }),
    });

    const blandData = await blandResponse.json();

    if (blandResponse.ok && blandData.status === "success" && blandData.call_id) {
      return { success: true, provider_call_id: blandData.call_id, transfer_route: transferRoute };
    } else {
      return { success: false, error: blandData.message || blandData.error || "Bland API rejected call" };
    }
  } catch {
    return { success: false, error: "Network error" };
  }
}

// The database cron is the sole scheduler. Do not self-chain this worker.

async function releaseUndispatchedCall(sql: Sql, call: Record<string, unknown>) {
  const removed = await sql`DELETE FROM calls WHERE id = ${call.call_id as string}
    AND queue = 'pending' AND (provider_call_id IS NULL OR provider_call_id = '') RETURNING lead_id`;
  if (removed.length === 0) return;
  if (call.lead_id) {
    await sql`UPDATE leads SET status = 'new', force_redial = force_redial OR ${call.force_redial === true}
      WHERE id = ${call.lead_id as string} AND status = 'in_progress'
      AND NOT EXISTS (SELECT 1 FROM calls WHERE lead_id = ${call.lead_id as string} AND queue = 'pending' AND NOT is_completed)`;
  }
  if (call.retry_lead_id) {
    await sql`UPDATE retry_leads SET status = 'new', dialed_at = NULL
      WHERE id = ${call.retry_lead_id as string} AND status = 'in_progress'`;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  let sql: Sql | null = null;
  try {
    sql = getPool();

    // Cron may fire before the previous provider cycle finishes. Serialize runs
    // so dialing cannot exhaust database capacity and break application login.
    const lockRows = await sql`SELECT pg_try_advisory_lock(hashtext('wolf-dialer-loop')) AS acquired`;
    if (lockRows[0]?.acquired !== true) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "Previous dialer cycle still running" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const campaignRows = await sql`SELECT id, state, dispatch_epoch, provider_call_limit, started_at::text AS started_at, offline_voicemail_test_until FROM campaigns ORDER BY created_at DESC LIMIT 1`;
    const campaign = campaignRows[0] as Record<string, unknown> | undefined;

    if (!campaign || campaign.state !== "running") {
      return new Response(JSON.stringify({ stopped: true, reason: "Campaign not running" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const offlineTest = campaign.offline_voicemail_test_until != null;
    if (offlineTest && (Number(campaign.provider_call_limit) > 20 ||
        Number(campaign.provider_call_limit) < 1 ||
        new Date(campaign.offline_voicemail_test_until as string).getTime() <= Date.now())) {
      await sql`SELECT campaign_stop()`;
      await sql`UPDATE campaigns SET blocking_reason='Offline voicemail test expired or exceeded its 20-call limit' WHERE id=${campaign.id as string}`;
      return new Response(JSON.stringify({stopped:true,reason:"Voicemail test ended"}),{headers:{...corsHeaders,"Content-Type":"application/json"}});
    }

    // Provider reconciliation is call-work and must never run while stopped.
    await killStaleCalls(sql);

    if (!blandApiKey) {
      await sql`SELECT campaign_stop()`;
      await sql`UPDATE campaigns SET blocking_reason='Bland API key is not configured' WHERE id=${campaign.id as string}`;
      return new Response(JSON.stringify({ stopped: true, reason: "No BLAND_API_KEY" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── AGENT AVAILABILITY GATE ──────────────────────────────────────
    // Never place outbound calls unless at least one agent is reachable:
    // status = active, logged in with valid session, available_for_transfer = true.
    // Keep the campaign armed; the next scheduled cycle can resume when a desktop phone is ready.
    const availRows = await sql`SELECT count_dialer_dispatch_agents() AS cnt`;
    const availableCount = availRows[0]?.cnt ?? 0;

    if (availableCount === 0) {
      await sql`UPDATE campaigns SET dialer_status = 'waiting_for_agents', updated_at = now() WHERE id = (SELECT id FROM campaigns ORDER BY created_at DESC LIMIT 1)`;
      console.log("[dialer] GATE: 0 agents available — skipping calls this cycle, keeping loop alive");
      return new Response(JSON.stringify({ success: true, gated: true, reason: "waiting_for_agents", continued: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // At least one agent is reachable — clear the waiting status and proceed
    await sql`UPDATE campaigns SET dialer_status = 'dialing', updated_at = now() WHERE id = (SELECT id FROM campaigns ORDER BY created_at DESC LIMIT 1)`;
    console.log(`[dialer] GATE: ${availableCount} agent(s) available — proceeding with calls`);

    const pendingInbound = await sql`SELECT id, full_name FROM agents a WHERE public.campaign_agent_can_receive(a.id,${campaign.id as string}::uuid) AND (NOT coalesce(a.inbound_configured,false) OR a.provider_sync_status IS DISTINCT FROM 'synced')`;
    for (const route of pendingInbound) {
      const configured = await fetch(`${supabaseUrl}/functions/v1/wolf-configure-inbound`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}` },
        body: JSON.stringify({agent_id: route.id}), signal: AbortSignal.timeout(45000),
      });
      const configResult = await configured.json().catch(() => ({})) as Record<string, unknown>;
      if (!configured.ok || configResult.success !== true) {
        await sql`SELECT campaign_stop()`;
        await sql`UPDATE campaigns SET blocking_reason=${"Callback setup failed for "+String(route.full_name)+". Check the route verification result."} WHERE id=${campaign.id as string}`;
        return new Response(JSON.stringify({stopped:true,reason:"Callback route verification failed",agent_id:route.id,results:configResult.results||[],error:configResult.error||null}),{status:502,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }
    }

    const twoMinAgo = new Date(Date.now() - 120_000).toISOString();
    const recentCountRows = await sql`SELECT count(*)::int AS cnt FROM calls WHERE call_direction = 'outbound' AND created_at >= ${twoMinAgo}`;
    const recentCallCount = recentCountRows[0]?.cnt ?? 0;

    if (recentCallCount > 60) {
      await sql`SELECT campaign_stop()`;
      console.error(`[dialer] RUNAWAY GUARD: ${recentCallCount} calls in 2 minutes — campaign stopped`);
      return new Response(JSON.stringify({
        stopped: true, reason: `RUNAWAY GUARD: ${recentCallCount} calls in 2 minutes`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── DAILY MINUTE CAP ────────────────────────────────────────────────
    const capRows = await sql`SELECT check_daily_minute_cap() AS cap_reached`;
    const capReached = capRows[0]?.cap_reached ?? false;
    if (capReached) {
      await sql`SELECT campaign_stop()`;
      await sql`UPDATE campaigns SET blocking_reason = 'Daily minute cap reached', updated_at = now() WHERE id = (SELECT id FROM campaigns ORDER BY created_at DESC LIMIT 1)`;
      console.log("[dialer] DAILY MINUTE CAP reached — campaign stopped");
      return new Response(JSON.stringify({ stopped: true, reason: "Daily minute cap reached" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (Math.floor(Date.now() / 15000) % 4 === 0) {
      const balanceCheck = await checkBlandBalance();
      if (balanceCheck.ok && balanceCheck.balance < 20) {
        await sql`SELECT campaign_stop()`;
        return new Response(JSON.stringify({
          stopped: true, reason: `Bland balance below $20 (${balanceCheck.balance.toFixed(2)})`,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const batchRows = await sql`SELECT * FROM dialer_next_batch()`;
    let dispatchedCount = 0;
    let cancelledCount = 0;
    let cancellationDetail: unknown = null;
    const batchRaw = batchRows[0] as Record<string, unknown> | undefined;
    let batchData: Record<string, unknown> | undefined;
    const rawVal = batchRaw?.dialer_next_batch ?? batchRaw;
    if (typeof rawVal === "string") {
      try { batchData = JSON.parse(rawVal); } catch { batchData = undefined; }
    } else {
      batchData = rawVal as Record<string, unknown> | undefined;
    }
    console.log("[dialer] batchData type:", typeof batchData, "success:", batchData?.success, "calls_len:", (batchData?.calls as unknown[])?.length);

    if (!batchData || !batchData.success) {
      const errMsg = String(batchData?.error || "Batch error");
      if (errMsg.includes("RUNAWAY PROTECTION")) {
        console.error(`[dialer] ${errMsg} — halting loop`);
        return new Response(JSON.stringify({ stopped: true, reason: errMsg }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("Dialer batch error:", errMsg);
    } else {
      const callsToDial = (batchData.calls as Array<Record<string, unknown>>) || [];
      if (callsToDial.length > 0) {
        for (const call of callsToDial) {
          const callId = call.call_id as string;
          const phone = call.phone as string;

          if (isTollFree(phone)) {
            await sql`UPDATE calls SET queue = 'no_answer', is_completed = true, agent_notes = 'Skipped: toll-free number (800/855/866/877/888)' WHERE id = ${callId}`;
            continue;
          }

          // Recheck the campaign and this agent immediately before every provider request.
          const [dispatch] = await sql`SELECT public.dialer_dispatch_allowed(
            ${campaign.id as string}::uuid, ${campaign.started_at as string}::text::timestamptz,
            ${call.agent_id as string}::uuid, ${campaign.dispatch_epoch as number}::bigint) AS allowed`;
          if (dispatch?.allowed !== true) {
            await releaseUndispatchedCall(sql, call);
            cancelledCount++;
            cancellationDetail = { started_at: campaign.started_at, epoch: campaign.dispatch_epoch, agent_id: call.agent_id, allowed: dispatch?.allowed };
            continue;
          }

          try {
            const safeName = sanitizeName(call.name as string);
            const result = await placeBlandCall(
              phone,
              call.bland_number as string,
              call.bland_voice_id as string,
              safeName,
              call.agent_name as string,
              call.talkroute_number as string,
            );

            if (result.success) {
              dispatchedCount++;
              const dest = normalizeToE164(call.talkroute_number as string);
              await sql`UPDATE calls SET provider_call_id = ${result.provider_call_id}, queue = 'pending', originating_bland_number = ${call.bland_number as string}, talkroute_destination = ${dest}, transfer_route_used = 'hub' WHERE id = ${callId}`;
            } else {
              await sql`UPDATE calls SET queue = 'no_answer', is_completed = true, agent_notes = ${'Bland API error: ' + result.error}, originating_bland_number = ${call.bland_number as string} WHERE id = ${callId}`;
              if (offlineTest) {
                await sql`SELECT campaign_stop()`;
                await sql`UPDATE campaigns SET blocking_reason=${'Voicemail test stopped after provider rejection: '+String(result.error || 'Unknown provider error').slice(0,300)} WHERE id=${campaign.id as string}`;
                return new Response(JSON.stringify({stopped:true,reason:"Voicemail test provider rejection",error:result.error}),{status:502,headers:{...corsHeaders,"Content-Type":"application/json"}});
              }
              if (result.error && result.error.toLowerCase().includes("banned phrase")) {
                await sql`UPDATE leads SET status = 'closed' WHERE id = ${call.lead_id as string}`;
              }
              if (result.error && result.error.toLowerCase().includes("insufficient balance")) {
                await sql`SELECT campaign_stop()`;
                return new Response(JSON.stringify({ stopped: true, reason: "Insufficient Bland balance" }),
                  { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }
              if (result.error && result.error.toLowerCase().includes("rate limit")) {
                await new Promise((r) => setTimeout(r, 10000));
              }
            }
          } catch (err) {
            await sql`UPDATE calls SET queue = 'no_answer', is_completed = true, agent_notes = ${'Dialer exception: ' + String(err)}, originating_bland_number = ${call.bland_number as string} WHERE id = ${callId}`;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        console.log(`Dialer placed ${callsToDial.length} calls`);
      } else if (batchData.message === "Call limit reached") {
        await sql`SELECT campaign_stop()`;
        return new Response(JSON.stringify({ stopped: true, reason: "Call limit reached" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (Math.floor(Date.now() / 30000) % 5 === 0) {
      try {
        fetch(`${supabaseUrl}/functions/v1/wolf-backfill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill_transcripts" }),
        }).catch(() => {});
      } catch { /* ignore */ }
    }

    return new Response(JSON.stringify({ success: batchData?.success === true, continued: false, worker_version: "one-click-v2", campaign_id: campaign.id, reserved: (batchData?.calls as unknown[])?.length ?? 0, dispatched: dispatchedCount, cancelled: cancelledCount, cancellation: cancellationDetail, reason: batchData?.error || batchData?.message || batchData?.skipped || null }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Dialer loop error:", String(err));
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (sql) await sql.end();
  }
});
// deploy-fix-v7: max_duration=8, stale=540s, 20s loop

