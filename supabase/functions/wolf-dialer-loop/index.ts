import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.4";

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
const STALE_CALL_TIMEOUT_SECONDS = 540;

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
      // Ask the provider whether this call is genuinely dead before ending it.
      // Never hang up on a call that is still connected or mid-transfer —
      // that is what produced 135 "Auto-killed" transfers with 0 answers.
      try {
        const statusRes = await fetch(`https://api.bland.ai/v1/calls/${call.provider_call_id}`, {
          headers: { "authorization": blandApiKey },
        });
        if (statusRes.ok) {
          const info = await statusRes.json() as Record<string, unknown>;
          const status = String(info.status || info.call_status || "").toLowerCase();
          const stillLive = ["in-progress", "in_progress", "active", "ringing", "queued", "transferring"].includes(status);
          const transferring = Boolean(info.transferred_to || info.transfer_phone_number || info.warm_transfer_call);
          if (stillLive || transferring) continue; // leave it alone
        }
      } catch { continue; } // provider unreachable — do not kill blind

      let stopSucceeded = false;
      try {
        const stopRes = await fetch(`https://api.bland.ai/v1/calls/${call.provider_call_id}/stop`, {
          method: "POST",
          headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
        });
        stopSucceeded = stopRes.ok;
      } catch { /* network error — don't mark completed */ }
      if (!stopSucceeded) continue;
      const elapsedSeconds = call.duration_seconds && call.duration_seconds > 0
        ? call.duration_seconds
        : Math.round((Date.now() - new Date(call.created_at).getTime()) / 1000);
      await sql`UPDATE calls SET queue = 'no_answer', is_completed = true, agent_notes = ${` [Auto-killed: exceeded ${STALE_CALL_TIMEOUT_SECONDS} seconds]`}, duration_seconds = ${elapsedSeconds} WHERE id = ${call.id}`;
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

  const firstSentence = `Hi, may I speak with ${consumerName}? This is Elizabeth with Sterling Collections calling on behalf of ${agentName}.`;

  const task = `You are Elizabeth, a professional assistant at Sterling Collections calling ${consumerName} on behalf of ${agentName}.

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
      headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        phone_number: phoneNumber,
        from: normalizeToE164(blandNumber),
        voice: voiceId || undefined,
        task,
        first_sentence: firstSentence,
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  let sql: Sql | null = null;
  try {
    sql = getPool();

    await killStaleCalls(sql);

    const campaignRows = await sql`SELECT state, provider_call_limit, started_at FROM campaigns ORDER BY created_at DESC LIMIT 1`;
    const campaign = campaignRows[0] as Record<string, unknown> | undefined;

    if (!campaign || campaign.state !== "running") {
      return new Response(JSON.stringify({ stopped: true, reason: "Campaign not running" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!blandApiKey) {
      return new Response(JSON.stringify({ stopped: true, reason: "No BLAND_API_KEY" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── AGENT AVAILABILITY GATE ──────────────────────────────────────
    // Never place outbound calls unless at least one agent is reachable:
    // status = active, logged in with valid session, available_for_transfer = true.
    // Do NOT stop the campaign — keep the self-chaining loop alive so dialing
    // auto-resumes the instant an agent becomes available.
    const availRows = await sql`SELECT count_available_agents() AS cnt`;
    const availableCount = availRows[0]?.cnt ?? 0;

    if (availableCount === 0) {
      await sql`UPDATE campaigns SET dialer_status = 'waiting_for_agents', updated_at = now() WHERE id = (SELECT id FROM campaigns ORDER BY created_at DESC LIMIT 1)`;
      console.log("[dialer] GATE: 0 agents available — skipping calls this cycle, keeping loop alive");
      // Close DB before chaining
      if (sql) { await sql.end(); sql = null; }
      const gateTimer = setTimeout(() => {
        fetch(DIALER_FUNCTION_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ continue: true }),
        }).catch(() => {
          setTimeout(() => {
            fetch(DIALER_FUNCTION_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ continue: true }),
            }).catch(() => {
              console.error("[dialer] Self-chain retry failed — loop will need manual restart");
            });
          }, 10000);
        });
      }, 20000);
      try { (EdgeRuntime as never as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(gateTimer); } catch { /* not available */ }
      return new Response(JSON.stringify({ success: true, gated: true, reason: "waiting_for_agents", continued: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // At least one agent is reachable — clear the waiting status and proceed
    await sql`UPDATE campaigns SET dialer_status = 'dialing', updated_at = now() WHERE id = (SELECT id FROM campaigns ORDER BY created_at DESC LIMIT 1)`;
    console.log(`[dialer] GATE: ${availableCount} agent(s) available — proceeding with calls`);

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
              const dest = normalizeToE164(call.talkroute_number as string);
              await sql`UPDATE calls SET provider_call_id = ${result.provider_call_id}, queue = 'pending', originating_bland_number = ${call.bland_number as string}, talkroute_destination = ${dest}, transfer_route_used = 'hub' WHERE id = ${callId}`;
            } else {
              await sql`UPDATE calls SET queue = 'no_answer', is_completed = true, agent_notes = ${'Bland API error: ' + result.error}, originating_bland_number = ${call.bland_number as string} WHERE id = ${callId}`;
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

    // Close DB connection BEFORE chaining — prevents connection pool exhaustion
    if (sql) { await sql.end(); sql = null; }

    const chainTimer = setTimeout(() => {
      fetch(DIALER_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ continue: true }),
      }).catch(() => {
        setTimeout(() => {
          fetch(DIALER_FUNCTION_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ continue: true }),
          }).catch(() => {
            console.error("[dialer] Self-chain retry failed — loop will need manual restart");
          });
        }, 10000);
      });
    }, 20000);

    try { (EdgeRuntime as never as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(chainTimer); } catch { /* not available */ }

    return new Response(JSON.stringify({ success: true, continued: true }), {
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
// deploy-fix-v6: max_duration=8, stale=540s, 20s loop
