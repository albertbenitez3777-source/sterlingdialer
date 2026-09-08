import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.4";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  flattenTranscript, blandDurationToSeconds, hasRepresentativeSpeech,
  extractRepFirstSpeechAt, hasMergedState, isBridgeConfirmed, detectLiveHuman,
  isOriginalVoicemail, evaluateTransferState, classifyQueue, classifyDropReason,
  verifyWebhookHmac, type TransferState,
} from "../_shared/call-evidence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const blandApiKey = Deno.env.get("BLAND_API_KEY") ?? "";
const blandWebhookSecret = Deno.env.get("BLAND_WEBHOOK_SECRET") ?? "";
const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";

type Sql = ReturnType<typeof postgres>;

function getPool(): Sql {
  return postgres(dbUrl, {
    max: 1,
    idle_timeout: 3,
    connect_timeout: 10,
    ssl: { rejectUnauthorized: false },
  });
}

function digitsOnly(input: string): string {
  return input.replace(/\D/g, "");
}


// stopAiLeg REMOVED: Bland POST /calls/{id}/stop ends the entire call,
// not just the AI leg. Must not terminate a live caller-agent conversation.

async function uploadRecordingToStorage(callId: string, audioBlob: Blob, contentType: string): Promise<string | null> {
  try {
    const ext = contentType.includes("ogg") ? "ogg" : contentType.includes("wav") ? "wav" : "mp3";
    const filePath = `${callId}.${ext}`;
    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/call-recordings/${filePath}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: audioBlob,
    });
    if (uploadRes.ok) {
      return `${supabaseUrl}/storage/v1/object/public/call-recordings/${filePath}`;
    }
    return null;
  } catch {
    return null;
  }
}

async function downloadAndStoreRecording(callId: string, blandCallId: string): Promise<string | null> {
  if (!blandApiKey || !blandCallId) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const recRes = await fetch(`https://api.bland.ai/v1/calls/${blandCallId}/recording`, {
        headers: { "authorization": blandApiKey },
      });
      if (recRes.ok) {
        const audioBlob = await recRes.blob();
        if (audioBlob.size > 0) {
          const contentType = recRes.headers.get("content-type") || "audio/mpeg";
          const stored = await uploadRecordingToStorage(callId, audioBlob, contentType);
          if (stored) return stored;
        }
      }

      const detailRes = await fetch(`https://api.bland.ai/v1/calls/${blandCallId}`, {
        headers: { "authorization": blandApiKey },
      });
      if (detailRes.ok) {
        const detail = await detailRes.json() as Record<string, unknown>;
        const recUrl = String(detail.recording_url || "");
        if (recUrl && recUrl.startsWith("http")) {
          const s3Res = await fetch(recUrl);
          if (s3Res.ok) {
            const s3Blob = await s3Res.blob();
            if (s3Blob.size > 0) {
              const s3ContentType = s3Res.headers.get("content-type") || "audio/mpeg";
              const stored = await uploadRecordingToStorage(callId, s3Blob, s3ContentType);
              if (stored) return stored;
            }
          }
          return recUrl;
        }
      }

      if (attempt < 1) await new Promise(r => setTimeout(r, 2000));
    } catch {
      if (attempt < 1) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sql: Sql | null = null;
  try {
    const url = new URL(req.url);
    const rawBody = await req.text();

    const signatureHeader = req.headers.get("x-webhook-signature") || req.headers.get("X-Webhook-Signature");
    if (blandWebhookSecret) {
      if (!signatureHeader) {
        console.error("[webhook] REJECTED — BLAND_WEBHOOK_SECRET configured but no signature header received");
        return new Response(JSON.stringify({ error: "Missing webhook signature" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const hmacResult = verifyWebhookHmac(rawBody, signatureHeader, blandWebhookSecret, createHmac, (a, b) => timingSafeEqual(a, b));
      if (!hmacResult.valid) {
        console.error(`[webhook] REJECTED — ${hmacResult.reason}`);
        return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (signatureHeader) {
      console.warn("[webhook] UNVERIFIED — signature header present but BLAND_WEBHOOK_SECRET not configured; cannot verify");
    } else {
      console.warn("[webhook] UNVERIFIED — no BLAND_WEBHOOK_SECRET configured and no signature header present");
    }

    const body = JSON.parse(rawBody) as Record<string, unknown>;
    sql = getPool();

    const eventType = String(body.type || body.event || "").toLowerCase();
    const eventStatus = String(body.status || "").toLowerCase();
    const eventCallId = String(body.call_id || body.id || "");

    // ── Real-time transfer event handler ──────────────────────────────
    // A tool or transfer event means transfer was REQUESTED, not that the agent answered.
    // Do NOT set queue='fire_transfer', talkroute_answered, or bridge_confirmed here.
    if (eventType === "tool" || eventType === "transfer" ||
        (eventStatus === "transferring" || eventStatus === "transfer_requested" || eventStatus === "transfer_initiated")) {
      console.log(`[webhook] REAL-TIME transfer event call_id=${eventCallId}`);
      if (eventCallId) {
        const secRows = await sql`SELECT id FROM secretary_calls WHERE provider_call_id = ${eventCallId} LIMIT 1`;
        if (secRows.length > 0) {
          const now = new Date().toISOString();
          await sql`UPDATE secretary_calls SET status = 'transferring', transfer_status = 'requested', updated_at = ${now} WHERE id = ${secRows[0].id}`;
          return new Response(JSON.stringify({ success: true, action: "secretary_transfer_requested" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const callRows = await sql`SELECT id, queue, ai_terminated FROM calls WHERE provider_call_id = ${eventCallId} LIMIT 1`;
        if (callRows.length > 0 && !callRows[0].ai_terminated) {
          const now = new Date().toISOString();
          const transferDest = String(body.transfer_phone_number || body.transferred_to || body.transfer_destination || "");
          const transferId = String(body.transfer_call_id || body.transfer_id || "");
          await sql`UPDATE calls SET transfer_state = 'transfer_api_accepted', transfer_status = 'transfer_api_accepted', talkroute_leg_created = true, transfer_requested_at = ${now}${transferDest ? sql`, transfer_destination = ${transferDest}` : sql``}${transferId ? sql`, provider_transfer_id = ${transferId}` : sql``}, destination_dialed_at = ${now} WHERE id = ${callRows[0].id}`;
          console.log(`[webhook] Marked transfer_requested for call_id=${callRows[0].id} (NOT fire_transfer)`);
        }
      }
      return new Response(JSON.stringify({ success: true, action: "transfer_event_logged" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Real-time call status events ──────────────────────────────────
    if (eventType === "call" && eventStatus === "in_progress" && !body.transcripts && !body.summary) {
      return new Response(JSON.stringify({ success: true, action: "logged" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Legacy transfer_call tool handler ──────────────────────────────
    const transferAction = url.searchParams.get("action");
    const transferTo = url.searchParams.get("transfer_to");
    if (transferAction === "transfer_call") {
      const toolCallId = String(body.call_id || body.id || "");
      if (!toolCallId || !transferTo) {
        return new Response(JSON.stringify({ error: "Missing call_id or transfer_to" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let transferAccepted = false;
      let transferApiResponse: Record<string, unknown> = {};
      try {
        const transferRes = await fetch("https://api.bland.ai/v1/calls/active/transfer", {
          method: "POST",
          headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ call_id: toolCallId }),
        });
        const transferHttpOk = transferRes.status >= 200 && transferRes.status < 300;
        transferApiResponse = await transferRes.json().catch(() => ({}));
        const errors = transferApiResponse.errors;
        const dataMsg = transferApiResponse.data as Record<string, unknown> | undefined;
        transferAccepted = transferHttpOk && errors == null && Boolean(dataMsg?.message);
      } catch (e) {
        console.error(`[transfer] ERROR call_id=${toolCallId}: ${String(e)}`);
      }

      if (!transferAccepted) {
        try {
          await fetch(`https://api.bland.ai/v1/calls/${toolCallId}/stop`, {
            method: "POST",
            headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
          });
        } catch { /* best effort */ }
      }

      const callRows = await sql`SELECT id, queue, agent_id FROM calls WHERE provider_call_id = ${toolCallId} LIMIT 1`;
      if (callRows.length > 0) {
        const now = new Date().toISOString();
        if (transferAccepted) {
          const legacyTransferId = String((transferApiResponse.data as Record<string,unknown>)?.call_id || transferApiResponse.transfer_id || "");
          await sql`UPDATE calls SET transfer_state = 'transfer_api_accepted', transfer_status = 'transfer_api_accepted', talkroute_leg_created = true, ai_terminated = true, ai_terminated_at = ${now}, transfer_requested_at = ${now}, destination_dialed_at = ${now}${legacyTransferId ? sql`, provider_transfer_id = ${legacyTransferId}` : sql``} WHERE id = ${callRows[0].id}`;
        } else {
          await sql`UPDATE calls SET transfer_state = 'transfer_failed', transfer_status = 'unsuccessful', transfer_failure_reason = ${'Bland transfer API rejected: ' + JSON.stringify(transferApiResponse)}, queue = 'human_drop', ai_terminated = true, ai_terminated_at = ${now}, drop_reason = 'transfer_provider_error' WHERE id = ${callRows[0].id}`;
        }
      } else {
        const secRows = await sql`SELECT id FROM secretary_calls WHERE provider_call_id = ${toolCallId} LIMIT 1`;
        if (secRows.length > 0) {
          const now = new Date().toISOString();
          await sql`UPDATE secretary_calls SET status = ${transferAccepted ? "transferring" : "failed"}, transfer_status = ${transferAccepted ? "requested" : "failed"}, updated_at = ${now} WHERE id = ${secRows[0].id}`;
        }
      }

      return new Response(JSON.stringify({ success: true, transferred: transferAccepted }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (url.searchParams.get("action") === "stop_ai" || body.action === "stop_ai") {
      return new Response(JSON.stringify({ success: true, message: "Acknowledged." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Main webhook processing ──────────────────────────────────────────
    const blandCallId = String(body.call_id || body.id || "");
    if (!blandCallId) {
      return new Response(JSON.stringify({ error: "Missing call_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find existing call record
    const callRows = await sql`SELECT id, queue, agent_id FROM calls WHERE provider_call_id = ${blandCallId} LIMIT 1`;
    let callInfo: { id: string; queue: string; agent_id: string | null; created: boolean } | null = null;

    if (callRows.length > 0) {
      callInfo = { id: callRows[0].id, queue: callRows[0].queue, agent_id: callRows[0].agent_id, created: false };
    } else {
      // Check secretary_calls
      const secRows = await sql`SELECT id, agent_id FROM secretary_calls WHERE provider_call_id = ${blandCallId} LIMIT 1`;
      if (secRows.length > 0) {
        // Process as secretary call
        const secTranscript = flattenTranscript(body.transcripts, body.concatenated_transcript);
        const secSummary = String(body.summary || "");
        const secRecordingUrl = String(body.recording_url || body.recording || "");
        const secDurationSeconds = blandDurationToSeconds(body.call_length ?? body.duration);
        const secVoicemail = body.voicemail === true || String(body.answered_by || "").toLowerCase() === "voicemail" || String(body.answered_by || "").toLowerCase() === "machine";
        const secTransferState = evaluateTransferState(body);

        let secNewStatus = "completed";
        if (secVoicemail) secNewStatus = "voicemail_left";
        else if (secTransferState === "human_answered" || secTransferState === "bridge_confirmed") secNewStatus = "transferred";
        else if (secTransferState === "transfer_failed") secNewStatus = "failed";
        else if (String(body.status || "").toLowerCase() === "no-answer" || String(body.status || "").toLowerCase() === "busy") secNewStatus = "no_answer";
        else if (String(body.status || "").toLowerCase() === "failed") secNewStatus = "failed";

        const now = new Date().toISOString();
        const secUpdateParts: string[] = [`status = ${secNewStatus}`, `updated_at = ${now}`];
        if (secTranscript) secUpdateParts.push(sql`transcript = ${secTranscript}`);
        if (secSummary) secUpdateParts.push(sql`ai_summary = ${secSummary}`);
        if (secRecordingUrl) secUpdateParts.push(sql`recording_url = ${secRecordingUrl}`);
        if (secDurationSeconds > 0) secUpdateParts.push(sql`duration_seconds = ${secDurationSeconds}`);
        if (secTransferState === "human_answered" || secTransferState === "bridge_confirmed") secUpdateParts.push(sql`transfer_status = 'bridged'`);

        // Build update dynamically
        await sql`UPDATE secretary_calls SET status = ${secNewStatus}, updated_at = ${now}${secTranscript ? sql`, transcript = ${secTranscript}` : sql``}${secSummary ? sql`, ai_summary = ${secSummary}` : sql``}${secRecordingUrl ? sql`, recording_url = ${secRecordingUrl}` : sql``}${secDurationSeconds > 0 ? sql`, duration_seconds = ${secDurationSeconds}` : sql``}${(secTransferState === "human_answered" || secTransferState === "bridge_confirmed") ? sql`, transfer_status = 'bridged'` : sql``} WHERE id = ${secRows[0].id}`;

        if (blandApiKey) {
          const storedUrl = await downloadAndStoreRecording(`secretary-${secRows[0].id}`, blandCallId);
          if (storedUrl) {
            await sql`UPDATE secretary_calls SET recording_url = ${storedUrl} WHERE id = ${secRows[0].id}`;
          }
        }

        return new Response(JSON.stringify({ success: true, secretary_call_id: secRows[0].id, status: secNewStatus }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create new inbound call record
      const fromNumber = String(body.from || body.caller_number || body.caller || "");
      const toNumber = String(body.to || body.called_number || body.inbound_number || "");
      const startedAt = body.started_at || body.start_time || (body.created_at ? String(body.created_at) : null);

      // Skip transfer-leg calls
      const fromDigits = digitsOnly(fromNumber);
      let isTransferLeg = false;
      if (fromDigits && fromDigits.length >= 10) {
        const agentRows = await sql`SELECT bland_number FROM agents WHERE bland_number != '' AND status = 'active'`;
        for (const ag of agentRows) {
          if (digitsOnly(ag.bland_number) === fromDigits) {
            isTransferLeg = true;
            break;
          }
        }
      }
      if (isTransferLeg) {
        console.log(`[webhook] Skipping transfer-leg call from agent Bland number ${fromNumber}`);
        return new Response(JSON.stringify({ success: true, action: "skipped_transfer_leg" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Look up agent by called Bland number
      let resolvedAgentId: string | null = null;
      if (toNumber) {
        const normalizedTo = digitsOnly(toNumber);
        if (normalizedTo.length >= 10) {
          const agentRows = await sql`SELECT id, bland_number FROM agents WHERE bland_number != '' AND status = 'active'`;
          for (const ag of agentRows) {
            if (digitsOnly(ag.bland_number) === normalizedTo) {
              resolvedAgentId = ag.id;
              break;
            }
          }
        }
      }

      const insertRows = await sql`
        INSERT INTO calls (provider_call_id, call_direction, queue, from_number, to_number, consumer_phone, is_live_human, agent_id${startedAt ? sql`, started_at` : sql``})
        VALUES (${blandCallId}, 'inbound', 'pending', ${fromNumber}, ${toNumber}, ${fromNumber}, true, ${resolvedAgentId}${startedAt ? sql`, ${startedAt}` : sql``})
        RETURNING id, queue, agent_id
      `;
      if (insertRows.length > 0) {
        callInfo = { id: insertRows[0].id, queue: insertRows[0].queue, agent_id: insertRows[0].agent_id, created: true };
        console.log(`[webhook] Created inbound call record ${callInfo.id} for bland_call_id=${blandCallId}`);
      }
    }

    if (!callInfo) {
      return new Response(JSON.stringify({ error: "Could not find or create call record" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse Bland fields ───────────────────────────────────────────
    const transcript = flattenTranscript(body.transcripts, body.concatenated_transcript);
    const summary = String(body.summary || "");
    const recordingUrl = String(body.recording_url || body.recording || "");
    const durationSeconds = blandDurationToSeconds(body.call_length ?? body.duration ?? body.duration_seconds ?? body.length);
    const voicemail = body.voicemail === true || body.is_voicemail === true ||
      String(body.answered_by || "").toLowerCase() === "voicemail" ||
      String(body.answered_by || "").toLowerCase() === "machine";

    const isLiveHuman = detectLiveHuman(body, transcript);
    const transferState = evaluateTransferState(body);
    const callStatus = String(body.status || "").toLowerCase();

    console.log(`[webhook] Processing call_id=${callInfo.id} bland_call_id=${blandCallId} transfer_state=${transferState} status=${callStatus} duration=${durationSeconds}s`);

    // ── Determine queue based on call outcome ─────────────────────────
    const transcriptLower = transcript.toLowerCase();
    const VOICEMAIL_MARKERS = ["leave a message", "after the tone", "press pound", "mailbox", "does not accept solicitations"];
    const DECLINE_MARKERS = ["not interested", "stop calling", "remove me", "take me off", "do not call", "not interested in", "remove my number", "take my number off"];
    const hasVoicemailMarker = VOICEMAIL_MARKERS.some(m => transcriptLower.includes(m));
    const hasDeclineMarker = DECLINE_MARKERS.some(m => transcriptLower.includes(m));

    const newQueue = classifyQueue(transferState, isLiveHuman, voicemail, hasVoicemailMarker);

    // is_live_human must NOT be inferred solely from a transfer attempt.
    const effectiveIsLiveHuman = isLiveHuman && transferState !== "transfer_api_accepted";

    // Fetch existing call details
    const existingRows = await sql`SELECT agent_notes, duration_seconds, ai_terminated FROM calls WHERE id = ${callInfo.id} LIMIT 1`;
    const existingCall = existingRows[0];
    const wasAutoKilled = String(existingCall?.agent_notes || "").includes("Auto-killed");
    const alreadyTerminated = existingCall?.ai_terminated === true;

    // Build update — use a single UPDATE with all fields
    const now = new Date().toISOString();
    const finalDuration = (durationSeconds > 0 && !wasAutoKilled) ? durationSeconds : existingCall?.duration_seconds ?? 0;

    let transferStatusVal = null as string | null;
    let talkrouteLegCreated = false;
    let talkrouteAnswered = false;
    let talkrouteAnsweredAt = null as string | null;
    let bridgeConfirmed = false;
    let bridgeConfirmedAt = null as string | null;
    let aiTerminated = alreadyTerminated;
    let aiTerminatedAt = null as string | null;
    let transferRequestedAt = null as string | null;
    let transferFailureReason = null as string | null;

    if (transferState !== "none") {
      transferRequestedAt = String(body.transferred_at || now);
    }

    if (transferState === "transfer_api_accepted") {
      transferStatusVal = "transfer_api_accepted";
      talkrouteLegCreated = true;
    }

    if (transferState === "destination_ringing") {
      transferStatusVal = "requested";
      talkrouteLegCreated = true;
    }

    // bridge_confirmed and talkroute_answered are set ONLY when we have proof:
    // post_transfer_transcript with non-empty representative speech, or a documented MERGED state.
    // bridge_confirmed: do NOT fabricate ai_terminated or call stopAiLeg.
    // The AI leg ends naturally or via Bland's own bridge logic.
    // Calling /calls/{id}/stop would terminate the live caller-agent conversation.
    if (transferState === "bridge_confirmed") {
      transferStatusVal = "successful";
      talkrouteLegCreated = true;
      talkrouteAnswered = true;
      talkrouteAnsweredAt = String(body.transferred_at || now);
      bridgeConfirmed = true;
      bridgeConfirmedAt = now;
      console.log(`[webhook] bridge_confirmed call_id=${callInfo.id} evidence: rep_speech=${hasRepresentativeSpeech(body.post_transfer_transcript)} merged=${hasMergedState(body)}`);
    }

    if (transferState === "transfer_failed") {
      transferStatusVal = "unsuccessful";
      transferFailureReason = String(body.transfer_failure_reason || "Transfer failed or destination did not answer");
      console.log(`[webhook] transfer_failed call_id=${callInfo.id}`);
    }

    const voicemailStatus = body.voicemail_status ? String(body.voicemail_status) : null;
    const callbackRequested = body.callback_requested === true;
    const requestedCallbackTime = body.requested_callback_time ? String(body.requested_callback_time) : null;

    // v262 evidence fields
    const providerTransferId = String(body.transfer_call_id || body.transfer_id || body.transferred_call_id || "");
    const destinationDialedAt = (transferState !== "none" && transferState !== "transfer_api_accepted")
      ? String(body.transferred_at || body.transfer_started_at || now) : null;
    const repFirstSpeechAt = extractRepFirstSpeechAt(body.post_transfer_transcript);
    const postTransferTranscriptText = flattenTranscript(body.post_transfer_transcript, null);

    let postTransferDuration = 0;
    if (transferState === "bridge_confirmed" && body.post_transfer_duration) {
      postTransferDuration = Math.round(Number(body.post_transfer_duration));
    } else if (transferState === "bridge_confirmed" && bridgeConfirmedAt && durationSeconds > 0) {
      const transferredTime = body.transferred_at ? new Date(String(body.transferred_at)).getTime() : 0;
      const endTime = Date.now();
      if (transferredTime > 0) {
        postTransferDuration = Math.max(0, Math.round((endTime - transferredTime) / 1000));
      }
    }

    const dropReason = classifyDropReason(body, transferState, newQueue, transcript);

    // Talkroute voicemail: destination leg answered but hit voicemail/machine, NOT a live rep
    const talkrouteVoicemail = talkrouteLegCreated && !bridgeConfirmed && (
      transferState === "transfer_failed" &&
      (String(body.transfer_failure_reason || "").toLowerCase().includes("voicemail") ||
       String(body.transfer_failure_reason || "").toLowerCase().includes("machine") ||
       String(body.transfer_failure_reason || "").toLowerCase().includes("no answer"))
    );

    const finalTranscript = transcript || null;
    const finalSummary = (summary && summary !== "Not enough information to generate summary.") ? summary : null;
    const finalRecordingUrl = recordingUrl || null;
    const finalVoicemailStatus = voicemailStatus || null;
    const finalRequestedCallbackTime = requestedCallbackTime || null;
    const finalProviderTransferId = providerTransferId || null;
    const finalPostTransferTranscript = postTransferTranscriptText || null;

    await sql`
      UPDATE calls SET
        is_live_human = ${effectiveIsLiveHuman},
        is_completed = true,
        transfer_state = ${transferState},
        queue = ${newQueue},
        transcript = COALESCE(${finalTranscript}, transcript),
        ai_summary = COALESCE(${finalSummary}, ai_summary),
        recording_url = COALESCE(${finalRecordingUrl}, recording_url),
        duration_seconds = ${finalDuration},
        transfer_status = COALESCE(${transferStatusVal}, transfer_status),
        talkroute_leg_created = CASE WHEN ${talkrouteLegCreated} THEN true ELSE talkroute_leg_created END,
        talkroute_answered = CASE WHEN ${talkrouteAnswered} THEN true ELSE talkroute_answered END,
        talkroute_answered_at = COALESCE(${talkrouteAnsweredAt}::timestamptz, talkroute_answered_at),
        bridge_confirmed = CASE WHEN ${bridgeConfirmed} THEN true ELSE bridge_confirmed END,
        bridge_confirmed_at = COALESCE(${bridgeConfirmedAt}::timestamptz, bridge_confirmed_at),
        ai_terminated = CASE WHEN ${aiTerminated} THEN true ELSE ai_terminated END,
        ai_terminated_at = COALESCE(${aiTerminatedAt}::timestamptz, ai_terminated_at),
        transfer_requested_at = COALESCE(${transferRequestedAt}::timestamptz, transfer_requested_at),
        transfer_failure_reason = COALESCE(${transferFailureReason}, transfer_failure_reason),
        voicemail_status = COALESCE(${finalVoicemailStatus}, voicemail_status),
        callback_requested = CASE WHEN ${callbackRequested} THEN true ELSE callback_requested END,
        requested_callback_time = COALESCE(${finalRequestedCallbackTime}, requested_callback_time),
        provider_transfer_id = COALESCE(${finalProviderTransferId}, provider_transfer_id),
        destination_dialed_at = COALESCE(${destinationDialedAt}::timestamptz, destination_dialed_at),
        rep_first_speech_at = COALESCE(${repFirstSpeechAt}::timestamptz, rep_first_speech_at),
        post_transfer_transcript = COALESCE(${finalPostTransferTranscript}, post_transfer_transcript),
        post_transfer_duration_seconds = ${postTransferDuration},
        drop_reason = ${dropReason},
        talkroute_voicemail = CASE WHEN ${talkrouteVoicemail} THEN true ELSE talkroute_voicemail END,
        is_dnc = false,
        webhook_raw_payload = CASE WHEN ${talkrouteLegCreated} THEN ${JSON.stringify(body)}::jsonb ELSE webhook_raw_payload END
      WHERE id = ${callInfo.id}
    `;

    // ── Audit row ─────────────────────────────────────────────────────
    try {
      const rawTs = String(body.transfer_status || "");
      await sql`SELECT upsert_call_audit(
        ${callInfo.id}, ${callInfo.agent_id || "00000000-0000-0000-0000-000000000000"},
        ${String(body.to || body.phone_number || "")}, ${String(body.from_name || "")},
        ${callInfo.created_at || now}::timestamptz,
        ${talkrouteLegCreated ? (destinationDialedAt || now) : null}::timestamptz,
        ${talkrouteAnswered ? (talkrouteAnsweredAt || now) : null}::timestamptz,
        ${talkrouteVoicemail ? now : null}::timestamptz,
        ${bridgeConfirmed ? (bridgeConfirmedAt || now) : null}::timestamptz,
        ${transferState === "transfer_failed" ? now : null}::timestamptz,
        ${transferFailureReason},
        ${finalDuration}, ${newQueue}, ${transferState}, ${rawTs}
      )`;
    } catch (auditErr) {
      console.error(`[webhook] audit write error: ${String(auditErr)}`);
    }

    console.log(`[webhook] call_ended call_id=${callInfo.id} queue=${newQueue} transfer_state=${transferState} drop_reason=${dropReason}`);

    // ── Download and store recording ─────────────────────────────────
    let publicRecordingUrl = recordingUrl;
    if (blandApiKey && blandCallId && newQueue !== "no_answer") {
      const storedUrl = await downloadAndStoreRecording(callInfo.id, blandCallId);
      if (storedUrl) {
        publicRecordingUrl = storedUrl;
        await sql`UPDATE calls SET recording_url = ${storedUrl} WHERE id = ${callInfo.id}`;
      }
    }

    // ── Auto-suppress: DNC + close lead for declines and no-solicitation voicemails ──
    const shouldSuppress = hasDeclineMarker ||
      (hasVoicemailMarker && transcriptLower.includes("does not accept solicitations"));
    if (shouldSuppress) {
      await sql`UPDATE calls SET is_dnc = true WHERE id = ${callInfo.id}`;
      const leadRow = await sql`SELECT lead_id FROM calls WHERE id = ${callInfo.id} LIMIT 1`;
      if (leadRow[0]?.lead_id) {
        await sql`UPDATE leads SET status = 'closed' WHERE id = ${leadRow[0].lead_id}`;
      }
      console.log(`[webhook] Auto-suppressed call_id=${callInfo.id} (decline or no-solicitations voicemail)`);
    }

    // ── No-answer retry: schedule one retry for eligible leads ──────────
    if (newQueue === "no_answer" && callInfo.lead_id) {
      try {
        await sql`SELECT handle_no_answer_retry(${callInfo.lead_id}, ${callInfo.id})`;
        console.log(`[webhook] no_answer retry checked for call_id=${callInfo.id} lead_id=${callInfo.lead_id}`);
      } catch (retryErr) {
        console.error(`[webhook] no_answer retry error: ${String(retryErr)}`);
      }
    }

    // ── Create inbox entries ─────────────────────────────────────────
    if (callInfo.agent_id) {
      // Check if inbox entry already exists
      const inboxRows = await sql`SELECT id FROM agent_inbox WHERE call_id = ${callInfo.id} LIMIT 1`;
      if (inboxRows.length === 0) {
        const detailRows = await sql`SELECT consumer_name, consumer_phone, lead_id FROM calls WHERE id = ${callInfo.id} LIMIT 1`;
        const details = detailRows[0];

        let inboxType: string | null = null;
        let inboxTitle = "";
        let inboxBody = "";

        if (transferState === "bridge_confirmed") {
          inboxType = "fire_transfer";
          inboxTitle = "FIRE TRANSFER: Inbound callback connected";
          inboxBody = "A customer called your Bland number and was successfully transferred to your Talkroute line.";
        } else if (transferState === "transfer_failed" || (isLiveHuman && newQueue === "human_drop")) {
          inboxType = "callback";
          inboxTitle = "Callback needed: Inbound callback transfer failed";
          inboxBody = "A customer called your Bland number but the transfer to your Talkroute line did not connect. Call them back as soon as possible.";
        } else if (voicemail && newQueue === "voice_message") {
          inboxType = "voicemail";
          inboxTitle = "Voicemail: Inbound callback reached voicemail";
          inboxBody = "A customer called your Bland number and reached voicemail. Consider calling back at a different time.";
        }

        if (inboxType) {
          await sql`
            INSERT INTO agent_inbox (agent_id, call_id, lead_id, type, title, body, consumer_name, consumer_phone, recording_url, transcript)
            VALUES (${callInfo.agent_id}, ${callInfo.id}, ${details?.lead_id || null}, ${inboxType}, ${inboxTitle}, ${inboxBody}, ${details?.consumer_name || ""}, ${details?.consumer_phone || ""}, ${publicRecordingUrl || ""}, ${transcript || ""})
          `;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      call_id: callInfo.id,
      created: callInfo.created,
      detected: { is_live_human: isLiveHuman, transfer_state: transferState, queue: newQueue },
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[webhook] FATAL: ${String(err)}`);
    return new Response(JSON.stringify({ error: "Webhook processing failed", detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (sql) await sql.end();
  }
});
// deploy-v262-evidence-fix
