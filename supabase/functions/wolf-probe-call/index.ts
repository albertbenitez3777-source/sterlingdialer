import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const blandApiKey = Deno.env.get("BLAND_API_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { call_id, check_voice, check_number } = await req.json();
    
    if (check_voice && blandApiKey) {
      // Test: place a minimal call that should ring briefly then hang up
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
      
      // Also try with the exact same params as our dialer
      const dialerPayload = {
        phone_number: "+12025551234",
        from: "+19177460418",
        voice: "29158307-9893-4149-8a75-bc9ce313d64e",
        task: "Say hello and hang up.",
        first_sentence: "Hello, this is a test.",
        wait_for_greeting: true,
        record: true,
        voicemail: { action: "hangup", timeout: 0, sensitive: false },
        webhook: `${Deno.env.get("SUPABASE_URL")}/functions/v1/wolf-webhook`,
        webhook_events: ["call", "tool", "post_transfer_transcript"],
        max_duration: 3,
        block_interruptions: false,
        interruption_threshold: 100,
        temperature: 0.05,
        noise_cancellation: true,
        transfer_phone_number: "+18663502227",
        block_dtmf: false,
        sensitive_voicemail_detection: false,
        summary_prompt: "Test call.",
      };
      const dialerRes = await fetch("https://api.bland.ai/v1/calls", {
        method: "POST",
        headers: { "authorization": blandApiKey, "Content-Type": "application/json" },
        body: JSON.stringify(dialerPayload),
      });
      const dialerBody = await dialerRes.json();
      
      return new Response(JSON.stringify({
        minimal_test: { status: testRes.status, body: testBody },
        dialer_test: { status: dialerRes.status, body: dialerBody },
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
    const body = await res.json();

    return new Response(JSON.stringify({
      bland_status: status,
      call_status: body.status,
      call_length: body.call_length,
      duration: body.duration,
      has_transcripts: !!body.transcripts && Array.isArray(body.transcripts) && body.transcripts.length > 0,
      transcript_count: Array.isArray(body.transcripts) ? body.transcripts.length : 0,
      has_recording: !!body.recording_url,
      recording_url: body.recording_url || null,
      has_summary: !!body.summary,
      summary: body.summary || null,
      concatenated_transcript: body.concatenated_transcript ? String(body.concatenated_transcript).substring(0, 500) : null,
      error_message: body.error_message || body.message || null,
      completed: body.completed,
      queue_status: body.queue_status,
      answered_by: body.answered_by,
      from: body.from || null,
      to: body.to || body.phone_number || null,
      corrected_duration: body.corrected_duration || null,
      price: body.price || null,
      end_at: body.end_at || null,
      start_at: body.start_at || null,
      created_at: body.created_at || null,
      batch_id: body.batch_id || null,
      error: body.error || null,
      variables: body.variables || null,
      request_data: body.request_data ? { phone_number: (body.request_data as Record<string,unknown>).phone_number, from: (body.request_data as Record<string,unknown>).from } : null,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
