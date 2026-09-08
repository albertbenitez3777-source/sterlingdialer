import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  flattenTranscript, blandDurationToSeconds, isBridgeConfirmed,
  detectLiveHuman, isOriginalVoicemail, classifyQueue,
  evaluateTransferState, getBlandCallCompletion,
} from "../_shared/call-evidence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const blandApiKey = Deno.env.get("BLAND_API_KEY") ?? "";

function isTransferRequested(d: Record<string, unknown>): boolean {
  if (d.transferred_to && String(d.transferred_to).trim()) return true;
  if (d.transferred_at) return true;
  if (d.transfer_requested === true) return true;
  const ts = String(d.transfer_status || "").toLowerCase();
  return ["requested", "accepted", "transferring", "ringing"].includes(ts);
}

function isTransferFailed(d: Record<string, unknown>): boolean {
  const ts = String(d.transfer_status || "").toLowerCase();
  if (["unsuccessful", "failed"].includes(ts)) return true;
  const callStatus = String(d.status || "").toLowerCase();
  if (["no_answer", "no-answer", "timed_out", "timed-out", "failed", "cancelled", "canceled"].includes(callStatus)) return true;
  return false;
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

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const body = await req.json();
    const action = body.action;

    if (action !== "backfill_transcripts") {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!blandApiKey) {
      return new Response(JSON.stringify({ error: "BLAND_API_KEY not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [recRes, durRes] = await Promise.all([
      supabase.from("calls")
        .select("id, provider_call_id, queue, agent_id, is_completed, recording_url, duration_seconds, agent_notes")
        .not("provider_call_id", "is", null)
        .neq("provider_call_id", "")
        .eq("recording_url", "")
        .in("queue", ["fire_transfer", "human_drop", "voice_message", "no_answer"])
        .limit(50),
      supabase.from("calls")
        .select("id, provider_call_id, queue, agent_id, is_completed, recording_url, duration_seconds, agent_notes")
        .not("provider_call_id", "is", null)
        .neq("provider_call_id", "")
        .eq("duration_seconds", 0)
        .in("queue", ["fire_transfer", "human_drop", "voice_message", "no_answer", "pending"])
        .limit(50),
    ]);

    const seen = new Set<string>();
    const calls: Array<{ id: string; provider_call_id: string; queue: string; agent_id: string; is_completed: boolean; recording_url: string | null; duration_seconds: number; agent_notes: string | null }> = [];
    for (const c of [...(recRes.data || []), ...(durRes.data || [])]) {
      if (!seen.has(c.id)) { seen.add(c.id); calls.push(c); }
    }
    const fetchErr = recRes.error || durRes.error;

    if (fetchErr || !calls) {
      return new Response(JSON.stringify({ error: "Failed to fetch calls" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    let failed = 0;
    let skipped = 0;
    let humansFound = 0;
    let transfersFound = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const call of calls) {
      try {
        const blandRes = await fetch(`https://api.bland.ai/v1/calls/${call.provider_call_id}`, {
          headers: { "authorization": blandApiKey },
        });

        if (!blandRes.ok) {
          failed++;
          results.push({ call_id: call.id, error: `Bland API returned ${blandRes.status}` });
          continue;
        }

        const d = await blandRes.json() as Record<string, unknown>;

        // A successful GET can describe a queued or live call. Only finalize a
        // record when Bland supplies completion evidence; leave unknown results
        // for a later pass, without reclassifying the call or notifying an agent.
        if (getBlandCallCompletion(d) !== true) {
          skipped++;
          results.push({ call_id: call.id, skipped: "provider_call_not_completed" });
          continue;
        }

        const transcript = flattenTranscript(d.transcripts, d.concatenated_transcript);
        const summary = String(d.summary || "");
        const recordingUrl = String(d.recording_url || "");
        const rawDuration = d.call_length ?? d.duration ?? 0;
        const durationSeconds = blandDurationToSeconds(rawDuration);
        const isLiveHuman = detectLiveHuman(d, transcript);
        const bridgeConfirmed = isBridgeConfirmed(d);
        const transferRequested = isTransferRequested(d);
        const transferFailed = isTransferFailed(d);

        if (isLiveHuman) humansFound++;
        if (bridgeConfirmed) transfersFound++;

        const voicemail = isOriginalVoicemail(d, transcript);
        const transcriptLower = transcript.toLowerCase();
        const VOICEMAIL_MARKERS = ["leave a message", "after the tone", "press pound", "mailbox", "does not accept solicitations", "to send your message", "to mark the message"];
        const hasVoicemailMarker = VOICEMAIL_MARKERS.some(m => transcriptLower.includes(m));

        const transferState = evaluateTransferState(d);
        const newQueue = classifyQueue(transferState, isLiveHuman, voicemail, hasVoicemailMarker);

        const DECLINE_MARKERS = ["not interested", "stop calling", "remove me", "take me off", "do not call", "not interested in", "remove my number", "take my number off", "add this number to your do not call list"];
        const hasDeclineMarker = DECLINE_MARKERS.some(m => transcriptLower.includes(m));
        const hasNoSolicitations = transcriptLower.includes("does not accept solicitations");
        const shouldSuppress = hasDeclineMarker || hasNoSolicitations;

        const updateData: Record<string, unknown> = {
          is_live_human: isLiveHuman,
          is_completed: true,
        };
        if (transcript) updateData.transcript = transcript;
        if (summary && summary !== "Not enough information to generate summary.") updateData.ai_summary = summary;
        if (recordingUrl) updateData.recording_url = recordingUrl;
        const wasAutoKilled = String(call.agent_notes || "").includes("Auto-killed");
        if (durationSeconds > 0 && !wasAutoKilled) updateData.duration_seconds = durationSeconds;
        if (newQueue !== call.queue) updateData.queue = newQueue;
        if (shouldSuppress) updateData.is_dnc = true;

        // Preserve agent notes — only clear auto-clean notes, not manual ones
        if (call.is_completed && newQueue !== "pending") {
          const notes = String(call.agent_notes || "");
          if (notes.startsWith("Auto-") || notes === "") {
            updateData.agent_notes = "";
          }
        }

        if (bridgeConfirmed) {
          updateData.transfer_status = "successful";
          updateData.bridge_confirmed = true;
          updateData.bridge_confirmed_at = new Date().toISOString();
          updateData.talkroute_answered = true;
          updateData.talkroute_answered_at = d.transferred_at || new Date().toISOString();
          // Do NOT set ai_terminated on bridge — bridge is not AI termination
          updateData.transfer_requested_at = d.transferred_at || new Date().toISOString();
        }
        if (transferRequested && !bridgeConfirmed) {
          updateData.transfer_status = "requested";
          updateData.transfer_requested_at = d.transferred_at || new Date().toISOString();
          updateData.talkroute_leg_created = true;
        }
        if (transferFailed) {
          updateData.transfer_status = "unsuccessful";
        }

        const { error: updateErr } = await supabase
          .from("calls")
          .update(updateData)
          .eq("id", call.id);

        if (updateErr) {
          failed++;
          results.push({ call_id: call.id, error: updateErr.message });
        } else {
          updated++;

          if (shouldSuppress) {
            const { data: leadInfo } = await supabase
              .from("calls")
              .select("lead_id")
              .eq("id", call.id)
              .maybeSingle();
            if (leadInfo?.lead_id) {
              await supabase.from("leads").update({ status: "closed" }).eq("id", leadInfo.lead_id);
            }
          }

          if (newQueue === "human_drop" || newQueue === "fire_transfer" || newQueue === "voice_message") {
            const { data: existing } = await supabase
              .from("agent_inbox")
              .select("id")
              .eq("call_id", call.id)
              .maybeSingle();

            if (!existing) {
              const { data: details } = await supabase
                .from("calls")
                .select("consumer_name, consumer_phone, lead_id, recording_url")
                .eq("id", call.id)
                .maybeSingle();

              if (details) {
                let inboxType = "callback";
                let title = `Callback needed: ${details.consumer_name || "Unknown"}`;
                let msgBody = `A live human answered but the call dropped before transfer. Prospect: ${details.consumer_name || "Unknown"}, Phone: ${details.consumer_phone || "N/A"}. Call them back as soon as possible.`;

                if (newQueue === "fire_transfer") {
                  inboxType = "fire_transfer";
                  title = `FIRE TRANSFER: ${details.consumer_name || "Unknown"}`;
                  msgBody = `Live transfer completed to your Talkroute. Prospect: ${details.consumer_name || "Unknown"}, Phone: ${details.consumer_phone || "N/A"}.`;
                } else if (newQueue === "voice_message") {
                  inboxType = "voicemail";
                  title = `Voicemail reached: ${details.consumer_name || "Unknown"}`;
                  msgBody = `Elizabeth reached voicemail for ${details.consumer_name || "Unknown"} at ${details.consumer_phone || "N/A"}. Consider calling back at a different time.`;
                }

                await supabase.from("agent_inbox").insert({
                  agent_id: call.agent_id,
                  call_id: call.id,
                  lead_id: details.lead_id,
                  type: inboxType,
                  title,
                  body: msgBody,
                  consumer_name: details.consumer_name || "",
                  consumer_phone: details.consumer_phone || "",
                  recording_url: details.recording_url || recordingUrl || "",
                  transcript,
                });
              }
            }
          }
        }
      } catch {
        failed++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total: calls.length,
      updated,
      failed,
      skipped,
      humans_found: humansFound,
      transfers_found: transfersFound,
      results: results.slice(0, 20),
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Backfill failed", detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
