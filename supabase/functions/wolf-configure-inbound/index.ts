import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const blandApiKey = Deno.env.get("BLAND_API_KEY") ?? "";

function digitsOnly(input: string): string {
  return input.replace(/\D/g, "");
}

function normalizeToE164(input: string): string {
  let d = digitsOnly(input);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) return "+1" + d;
  return "+" + d;
}

const inboundTaskTemplate = (agentName: string) => `You are Elizabeth, answering ${agentName}'s line. This is a callback — the caller is expecting to speak with ${agentName}.

TRANSFER DECISION — follow exactly:
1. The instant you hear an answering machine, voicemail, or automated system — HANG UP immediately and say nothing.
2. If a live person speaks, say your first_sentence ONCE, then WAIT up to 3 seconds for their reply.
3. If they respond like a live human ("yes", "okay", "hello?", "speaking", etc.), say EXACTLY: "Thank you. Please stay on the line for one moment while I connect you with ${agentName}. Connecting you now." Then say NOTHING.
4. Do NOT transfer if they decline in ANY way, or if there is no reply within 3 seconds, or if the line is silent.
5. Never say you are an AI. Never repeat your first_sentence. Never argue, ask questions, or say anything after "Connecting you now."
6. Never claim an urgent legal matter, lawsuit, deadline, or case-agent status.
7. Never disclose debt amounts, account details, or financial information.`;

const firstSentenceTemplate = (agentName: string) => `Hi, this is Elizabeth. Thank you for calling back regarding ${agentName}. Are you available for a brief conversation?`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const targetAgentId = body.agent_id || undefined;

    if (!blandApiKey) {
      return new Response(JSON.stringify({
        error: "Bland.ai API key is not configured. Add the BLAND_API_KEY secret.",
        configured: 0,
        total: 0,
        results: [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    let agentQuery = supabase
      .from("agents")
      .select("id, full_name, bland_number, bland_phone_id, bland_voice_id, talkroute_number, agent_direct_number, inbound_configured")
      .neq("bland_number", "")
      .neq("is_owner", true)
      .eq("status", "active")
      .eq("transfer_certified", true);

    if (targetAgentId) {
      agentQuery = agentQuery.eq("id", targetAgentId);
    }

    const { data: agents, error: agentErr } = await agentQuery;

    if (agentErr || !agents || agents.length === 0) {
      return new Response(JSON.stringify({
        error: "No eligible agents found.",
        configured: 0,
        total: 0,
        results: [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const webhookUrl = `${supabaseUrl}/functions/v1/wolf-webhook`;
    let configured = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const agent of agents) {
      const blandNumber = normalizeToE164(agent.bland_number);
      const talkrouteNumber = normalizeToE164(agent.talkroute_number);
      const transferNumber = talkrouteNumber;
      const task = inboundTaskTemplate(agent.full_name);
      const firstSentence = firstSentenceTemplate(agent.full_name);

      try {
        const updateBody: Record<string, unknown> = {
          voice: agent.bland_voice_id,
          task: task,
          first_sentence: firstSentence,
          wait_for_greeting: true,
          record: true,
          voicemail: { action: "hangup", timeout: 0, sensitive: false },
          webhook: webhookUrl,
          webhook_events: ["call", "tool", "post_transfer_transcript"],
          max_duration: 8,
          block_interruptions: false,
          temperature: 0.1,
          noise_cancellation: true,
          transfer_phone_number: transferNumber,
          sensitive_voicemail_detection: false,
          summary_prompt: "Summarize this call in 2-3 sentences. Did the prospect agree to the transfer? Was the transfer successful?",
        };

        // Bland's endpoint is POST /v1/inbound/{phone_number} — the phone number
        // goes in the URL path, not the body.
        const inboundRes = await fetch(`https://api.bland.ai/v1/inbound/${encodeURIComponent(blandNumber)}`, {
          method: "POST",
          headers: {
            "authorization": blandApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updateBody),
        });

        const inboundData = await inboundRes.json().catch(() => ({ status: "error", message: "Non-JSON response" }));

        if (inboundRes.ok && (inboundData.status === "success" || inboundData.success === true)) {
          configured++;
          await supabase.from("agents").update({ inbound_configured: true }).eq("id", agent.id);
          results.push({
            agent_id: agent.id,
            agent_name: agent.full_name,
            bland_number: blandNumber,
            talkroute_number: talkrouteNumber,
            transfer_number: transferNumber,
            transfer_route: "hub",
            status: "configured",
          });
        } else {
          results.push({
            agent_id: agent.id,
            agent_name: agent.full_name,
            status: "failed",
            error: inboundData.message || inboundData.error || JSON.stringify(inboundData),
            http_status: inboundRes.status,
          });
        }
      } catch (e) {
        results.push({
          agent_id: agent.id,
          agent_name: agent.full_name,
          status: "failed",
          error: `Network error: ${String(e)}`,
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      configured,
      total: agents.length,
      results,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: "Inbound configuration failed",
      detail: String(err),
      configured: 0,
      total: 0,
      results: [],
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
