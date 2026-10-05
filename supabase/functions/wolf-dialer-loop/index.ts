import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.4";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getBlandCallCompletion, detectLiveHuman, flattenTranscript, blandDurationToSeconds } from "../_shared/call-evidence.ts";
import { buildCallScript, type CallMode } from "../_shared/appointment-script.ts";

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
    const rawBalance = data.balance;
    if ((typeof rawBalance !== "number" && typeof rawBalance !== "string") || String(rawBalance).trim() === "") return { ok: false, balance: 0 };
    const balance = Number(rawBalance);
    return { ok: Number.isFinite(balance), balance: Number.isFinite(balance) ? balance : 0 };
  } catch {
    return { ok: false, balance: 0 };
  }
}

async function recordCampaignStop(sql: Sql, campaignId: string, reason: string) {
  await sql`SELECT campaign_stop()`;
  await sql`UPDATE campaigns SET blocking_reason=${reason},updated_at=now() WHERE id=${campaignId}`;
  await sql`INSERT INTO campaign_events(campaign_id,event_type,event_data) VALUES(${campaignId},'dialer_stop_reason',${JSON.stringify({reason})}::jsonb)`;
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
  callMode: CallMode = "appointment",
): Promise<{ success: boolean; provider_call_id?: string; error?: string; transfer_route?: string }> {
  const transferNumber = normalizeToE164(talkrouteNumber);
  const transferRoute = callMode === "appointment" ? "booking" : "hub";
  const webhookUrl = `${supabaseUrl}/functions/v1/wolf-webhook`;
  const bookingToolUrl = `${supabaseUrl}/functions/v1/wolf-callback-booking`;

  // Fetch the booking token for the Bland tool's Authorization header
  let bookingToken = "";
  if (callMode === "appointment") {
    try {
      const dbSql = getPool();
      const [tokenRow] = await dbSql`SELECT value FROM system_config WHERE key = 'callback_booking_token'`;
      bookingToken = String(tokenRow?.value || "");
      await dbSql.end();
    } catch { /* will fail gracefully — no token means no booking tool */ }
  }

  const script = buildCallScript({
    agentName,
    consumerName,
    mode: callMode,
    bookingToolUrl: callMode === "appointment" ? bookingToolUrl : undefined,
    bookingToolToken: bookingToken || undefined,
  });

  const requestBody: Record<string, unknown> = {
    phone_number: phoneNumber,
    from: normalizeToE164(blandNumber),
    voice: voiceId || undefined,
    task: script.task,
    first_sentence: script.first_sentence,
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
    block_dtmf: false,
    sensitive_voicemail_detection: true,
    summary_prompt: `Summarize the actual conversation. Distinguish customer machine or screening, confirmed intended person, wrong person, refusal, callback booking, callback request (no slot), and verified agent speech. Do not claim a successful booking merely because the AI announced one. State unknown when evidence is missing.`,
  };

  // Appointment mode: attach booking tool, NO transfer_phone_number
  if (callMode === "appointment" && script.tools) {
    requestBody.tools = script.tools;
  } else {
    // Transfer mode: use native transfer
    requestBody.transfer_phone_number = transferNumber;
  }

  try {
    const blandResponse = await fetch("https://api.bland.ai/v1/calls", {
      method: "POST",
      headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
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

  if (req.method !== "POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{"Content-Type":"application/json"}});
  const timestamp=req.headers.get("x-dialer-timestamp") || "";
  const signature=req.headers.get("x-dialer-signature") || "";
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp))>120 || !/^[a-f0-9]{64}$/.test(signature)) {
    return new Response(JSON.stringify({error:"Signed scheduler request required"}),{status:401,headers:{"Content-Type":"application/json"}});
  }
  const reader=req.body?.getReader();
  let requestBody="";
  if(reader) while(true){const {done,value}=await reader.read();if(done)break;if(requestBody.length+value.length>2){await reader.cancel();return new Response(JSON.stringify({error:"Invalid scheduler payload"}),{status:400});}requestBody+=new TextDecoder().decode(value);}
  if (requestBody!=="{}") return new Response(JSON.stringify({error:"Invalid scheduler payload"}),{status:400,headers:{"Content-Type":"application/json"}});

  let sql: Sql | null = null;
  try {
    sql = getPool();
    const [authConfig]=await sql`SELECT value FROM system_config WHERE key='dialer_scheduler_secret'`;
    const signingSecret=String(authConfig?.value || "");
    if (signingSecret.length<32) return new Response(JSON.stringify({error:"Scheduler authentication unavailable"}),{status:503,headers:{"Content-Type":"application/json"}});
    const expected=createHmac("sha256",signingSecret).update(`${timestamp}.${requestBody}`).digest("hex");
    if (!timingSafeEqual(new TextEncoder().encode(signature),new TextEncoder().encode(expected))) return new Response(JSON.stringify({error:"Invalid scheduler signature"}),{status:401,headers:{"Content-Type":"application/json"}});

    // Cron may fire before the previous provider cycle finishes. Serialize runs
    // so dialing cannot exhaust database capacity and break application login.
    const lockRows = await sql`SELECT pg_try_advisory_lock(hashtext('wolf-dialer-loop')) AS acquired`;
    if (lockRows[0]?.acquired !== true) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "Previous dialer cycle still running" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const campaignRows = await sql`SELECT id, state, dispatch_epoch, provider_call_limit, started_at::text AS started_at, offline_voicemail_test_until, campaign_type FROM campaigns ORDER BY created_at DESC LIMIT 1`;
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
        body: JSON.stringify({agent_id: route.id, mode: String(campaign.campaign_type) === "appointment" ? "appointment" : "transfer"}), signal: AbortSignal.timeout(45000),
      });
      const configResult = await configured.json().catch(() => ({})) as Record<string, unknown>;
      if (!configured.ok || configResult.success !== true) {
        await sql`SELECT campaign_stop()`;
        await sql`UPDATE campaigns SET blocking_reason=${"Callback setup failed for "+String(route.full_name)+". Check the route verification result."} WHERE id=${campaign.id as string}`;
        return new Response(JSON.stringify({stopped:true,reason:"Callback route verification failed",agent_id:route.id,results:configResult.results||[],error:configResult.error||null}),{status:502,headers:{...corsHeaders,"Content-Type":"application/json"}});
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

          // Timezone gate: skip calls to addresses where it's before 8am local
          if (call.lead_id) {
            const [tzCheck] = await sql`SELECT public.is_within_calling_hours(l.address) AS ok FROM leads l WHERE l.id = ${call.lead_id as string} LIMIT 1`;
            if (tzCheck && !tzCheck.ok) {
              await releaseUndispatchedCall(sql, call);
              cancelledCount++;
              cancellationDetail = { reason: "timezone_gate", lead_id: call.lead_id };
              continue;
            }
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
            const callMode: CallMode = String(campaign.campaign_type) === "appointment" ? "appointment" : "transfer";
            const result = await placeBlandCall(
              phone,
              call.bland_number as string,
              call.bland_voice_id as string,
              safeName,
              call.agent_name as string,
              call.talkroute_number as string,
              callMode,
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
                await recordCampaignStop(sql, campaign.id as string, "Insufficient Bland balance");
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
        // No auto-stop on call limit — only stop when the user manually stops the campaign
        console.log("[dialer] Call limit reached but auto-stop disabled — continuing");
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
// deploy-fix-v8: verify_jwt=false for scheduler access
