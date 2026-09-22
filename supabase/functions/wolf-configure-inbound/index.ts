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

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const inboundTaskTemplate = (agentName: string) => `You are Elizabeth Sterling, the AI assistant for ${agentName}. You answer incoming calls to this office.

1. Greet the caller with first_sentence once, then listen. Speak calmly and professionally.
2. MISSED CALL: "Thank you for calling back. You have reached ${agentName}\'s office. ${agentName} can explain the reason for the call. May I connect you now?"
3. WHY THIS NUMBER / WHAT IS THIS ABOUT: "I help connect callers with ${agentName}. I do not have the details to discuss, but ${agentName} can explain. Would you like me to transfer you?"
4. UNKNOWN AGENT: "That is okay. You do not need to know ${agentName} personally. May I connect you so they can clarify why you were contacted?"
5. CASE QUESTIONS: "I cannot confirm case details. ${agentName} can help with your question. May I connect you?" Do not assume a case exists or invent urgency, authority, deadlines, balances, or private information.
6. When the caller agrees or directly asks for the agent, say "Certainly. Please hold while I connect you to ${agentName}." Immediately invoke transfer using the configured destination. Do not ask for permission twice. Remain silent while the transfer connects and allow the agent\'s voicemail greeting and recording to complete if the agent does not answer. Do not disconnect a transfer because you hear the agent\'s voicemail.
7. A question or brief pause is not a refusal. Give the caller time to respond. If silence continues, ask once whether they are still there before politely ending the call.
8. Respect a clear refusal, wrong-number report, or do-not-call request. Acknowledge it and end without transferring. Do not argue.
9. If asked, answer truthfully: "Yes, I am an AI assistant for ${agentName}."`;

const firstSentenceTemplate = (agentName: string) => `Hello, this is Elizabeth Sterling. I'm the assistant for ${agentName}. How may I help you?`;

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

  const authorization = req.headers.get("authorization") || "";
  if (!serviceRoleKey || authorization !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Authorized Federal One service required" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      const expectedFingerprint = await sha256(JSON.stringify({ blandNumber, transferNumber, webhookUrl, prompt: task, firstSentence, pathwayId: "", defaultTransfer: transferNumber }));
      const { data: audit } = await supabase.from("federal_one_route_audits").insert({
        agent_id: agent.id, bland_number: blandNumber, talkroute_number: talkrouteNumber,
        webhook_url: webhookUrl, expected_fingerprint: expectedFingerprint, status: "pending",
      }).select("id").single();

      try {
        const updateBody: Record<string, unknown> = {
          voice: agent.bland_voice_id,
          prompt: task,
          pathway_id: null,
          model: "base",
          first_sentence: firstSentence,
          wait_for_greeting: false,
          record: true,
          webhook: webhookUrl,
          webhook_events: ["call", "tool", "post_transfer_transcript"],
          max_duration: 8,
          block_interruptions: false,
          temperature: 0.1,
          noise_cancellation: true,
          transfer_phone_number: transferNumber,
          transfer_list: { default: transferNumber },
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
          signal: AbortSignal.timeout(20000),
        });

        const inboundData = await inboundRes.json().catch(() => ({ status: "error", message: "Non-JSON response" }));

        if (inboundRes.ok && (inboundData.status === "success" || inboundData.success === true)) {
          const verifyRes = await fetch(`https://api.bland.ai/v1/inbound/${encodeURIComponent(blandNumber)}`, {
            headers: { "authorization": blandApiKey },
            signal: AbortSignal.timeout(20000),
          });
          const verifyData = await verifyRes.json().catch(() => ({})) as Record<string, unknown>;
          const providerConfig = (verifyData.data || verifyData) as Record<string, unknown>;
          const providerTransfer = normalizeToE164(String(providerConfig.transfer_phone_number || ""));
          const providerWebhook = String(providerConfig.webhook || providerConfig.webhook_url || "");
          const providerPrompt = String(providerConfig.prompt || "").replace(/\r\n/g, "\n").trim();
          const providerFirstSentence = String(providerConfig.first_sentence || "").trim();
          const providerPathway = String(providerConfig.pathway_id || "").trim();
          const transferList = providerConfig.transfer_list && typeof providerConfig.transfer_list === "object"
            ? providerConfig.transfer_list as Record<string, unknown> : {};
          const providerDefault = normalizeToE164(String(transferList.default || ""));
          const checks = {
            provider_read_ok: verifyRes.ok,
            transfer_matches: providerTransfer === transferNumber,
            default_transfer_matches: providerDefault === transferNumber,
            other_transfers_match: Object.values(transferList).every(value => normalizeToE164(String(value)) === transferNumber),
            webhook_matches: providerWebhook === webhookUrl,
            prompt_matches: providerPrompt === task.replace(/\r\n/g, "\n").trim(),
            first_sentence_matches: providerFirstSentence === firstSentence,
            pathway_cleared: providerPathway === "",
            model_supports_transfer: !providerConfig.model || providerConfig.model === "base",
            greeting_starts_immediately: providerConfig.wait_for_greeting !== true,
          };
          const routeMatches = Object.values(checks).every(Boolean);
          const mismatch = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key).join(", ");
          const providerFingerprint = await sha256(JSON.stringify({
            blandNumber, transferNumber: providerTransfer, webhookUrl: providerWebhook,
            prompt: providerPrompt, firstSentence: providerFirstSentence,
            pathwayId: providerPathway, defaultTransfer: providerDefault,
          }));
          if (routeMatches) configured++;
          await supabase.from("agents").update({
            inbound_configured: routeMatches, mapping_verified: routeMatches,
            provider_sync_status: routeMatches ? "synced" : "failed",
            last_verification_at: routeMatches ? new Date().toISOString() : null,
            exact_blocker: routeMatches ? "" : `Inbound verification failed: ${mismatch}`,
          }).eq("id", agent.id);
          if (audit?.id) await supabase.from("federal_one_route_audits").update({
            status: routeMatches ? "verified" : "drifted", provider_fingerprint: providerFingerprint,
            configured_at: new Date().toISOString(), verified_at: new Date().toISOString(),
            checks,
            error_message: routeMatches ? null : `Provider read-back mismatch: ${mismatch}`,
          }).eq("id", audit.id);
          results.push({
            agent_id: agent.id,
            agent_name: agent.full_name,
            bland_number: blandNumber,
            talkroute_number: talkrouteNumber,
            transfer_number: transferNumber,
            transfer_route: "hub",
            status: routeMatches ? "verified" : "drifted",
            checks,
          });
        } else {
          if (audit?.id) await supabase.from("federal_one_route_audits").update({
            status: "failed", error_message: String(inboundData.message || inboundData.error || "Provider rejected configuration"),
          }).eq("id", audit.id);
          await supabase.from("agents").update({ inbound_configured: false, mapping_verified: false, provider_sync_status: "failed" }).eq("id", agent.id);
          results.push({
            agent_id: agent.id,
            agent_name: agent.full_name,
            status: "failed",
            error: inboundData.message || inboundData.error || JSON.stringify(inboundData),
            http_status: inboundRes.status,
          });
        }
      } catch (e) {
        if (audit?.id) await supabase.from("federal_one_route_audits").update({ status: "failed", error_message: String(e) }).eq("id", audit.id);
        await supabase.from("agents").update({ inbound_configured: false, mapping_verified: false, provider_sync_status: "failed" }).eq("id", agent.id);
        results.push({
          agent_id: agent.id,
          agent_name: agent.full_name,
          status: "failed",
          error: `Network error: ${String(e)}`,
        });
      }
    }

    return new Response(JSON.stringify({
      success: configured === agents.length,
      configured,
      total: agents.length,
      results,
    }), {
      status: configured === agents.length ? 200 : 502,
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

