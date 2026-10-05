import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildCallScript } from "../_shared/appointment-script.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const blandApiKey = Deno.env.get("BLAND_API_KEY") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // PLACE_APPOINTMENT_TEST: place a real Bland call with the appointment script
    // and booking tool to a staff-only number. Does NOT use the customer campaign.
    if (body.action === "place_appointment_test" && blandApiKey) {
      const phone = String(body.phone || "+18669991670");
      const agentName = String(body.agent_name || "James Spencer");
      const consumerName = String(body.consumer_name || "Staff Test");
      const fromNumber = String(body.from_number || "+17712026103");
      const voiceId = String(body.voice_id || "29158307-9893-4149-8a75-bc9ce313d64e");

      // Fetch the booking token from system_config
      let bookingToken = "";
      try {
        const tokenRes = await fetch(`${supabaseUrl}/rest/v1/system_config?select=value&key=eq.callback_booking_token`, {
          headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}` },
        });
        const tokenData = await tokenRes.json() as Array<Record<string, unknown>>;
        bookingToken = String(tokenData[0]?.value || "");
      } catch { /* will fail gracefully */ }

      const bookingToolUrl = `${supabaseUrl}/functions/v1/wolf-callback-booking`;
      const webhookUrl = `${supabaseUrl}/functions/v1/wolf-webhook`;

      const script = buildCallScript({
        agentName,
        consumerName,
        mode: "appointment",
        bookingToolUrl,
        bookingToolToken: bookingToken || undefined,
      });

      const callPayload: Record<string, unknown> = {
        phone_number: phone,
        from: fromNumber,
        voice: voiceId,
        task: script.task,
        first_sentence: script.first_sentence,
        wait_for_greeting: true,
        answered_by_enabled: true,
        record: true,
        voicemail: { action: "hangup", sensitive: true },
        webhook: webhookUrl,
        webhook_events: ["call", "tool", "post_transfer_transcript"],
        max_duration: 3,
        temperature: 0.05,
        noise_cancellation: true,
        block_dtmf: false,
        sensitive_voicemail_detection: true,
        summary_prompt: "Summarize the conversation. Did the caller confirm identity? Was a callback booked or request saved? Did the caller consent?",
      };

      if (script.tools) {
        callPayload.tools = script.tools;
      }

      const blandRes = await fetch("https://api.bland.ai/v1/calls", {
        method: "POST",
        headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
        body: JSON.stringify(callPayload),
      });
      const blandData = await blandRes.json();

      return new Response(JSON.stringify({
        success: blandRes.ok && blandData.status === "success",
        bland_status: blandRes.status,
        call_id: blandData.call_id || null,
        error: blandData.message || blandData.error || null,
        tools_sent: !!script.tools,
        tool_definition: script.tools?.[0] || null,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Existing probe functionality
    const { call_id, check_voice, check_number } = body;

    if (check_voice && blandApiKey) {
      const testPayload = {
        phone_number: "+12025551234",
        task: "Say hello and hang up immediately.",
        max_duration: 1,
        record: false,
      };
      const testRes = await fetch("https://api.bland.ai/v1/calls", {
        method: "POST",
        headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
        body: JSON.stringify(testPayload),
      });
      const testBody = await testRes.json();
      return new Response(JSON.stringify({
        minimal_test: { status: testRes.status, body: testBody },
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (check_number && blandApiKey) {
      const nRes = await fetch(`https://api.bland.ai/v1/inbound`, {
        headers: { "authorization": blandApiKey },
      });
      const nBody = await nRes.json();
      return new Response(JSON.stringify({
        status: nRes.status,
        body: nBody,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!call_id || !blandApiKey) {
      return new Response(JSON.stringify({ error: "Missing call_id or BLAND_API_KEY" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(`https://api.bland.ai/v1/calls/${call_id}`, {
      headers: { "authorization": blandApiKey },
    });

    const status = res.status;
    const callBody = await res.json();

    return new Response(JSON.stringify({
      bland_status: status,
      call_status: callBody.status,
      call_length: callBody.call_length,
      duration: callBody.duration,
      has_transcripts: !!callBody.transcripts && Array.isArray(callBody.transcripts) && callBody.transcripts.length > 0,
      transcript_count: Array.isArray(callBody.transcripts) ? callBody.transcripts.length : 0,
      has_recording: !!callBody.recording_url,
      recording_url: callBody.recording_url || null,
      has_summary: !!callBody.summary,
      summary: callBody.summary || null,
      concatenated_transcript: callBody.concatenated_transcript ? String(callBody.concatenated_transcript).substring(0, 500) : null,
      error_message: callBody.error_message || callBody.message || null,
      completed: callBody.completed,
      queue_status: callBody.queue_status,
      answered_by: callBody.answered_by,
      from: callBody.from || null,
      to: callBody.to || callBody.phone_number || null,
      corrected_duration: callBody.corrected_duration || null,
      price: callBody.price || null,
      end_at: callBody.end_at || null,
      start_at: callBody.start_at || null,
      created_at: callBody.created_at || null,
      batch_id: callBody.batch_id || null,
      error: callBody.error || null,
      variables: callBody.variables || null,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
