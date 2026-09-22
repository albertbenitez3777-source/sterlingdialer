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

const inboundTaskTemplate = (agentName: string) => `You are Elizabeth Sterling, the assistant for ${agentName}.

RULES — follow exactly:
1. The instant you hear an answering machine, voicemail, or automated system — HANG UP immediately and say nothing.
2. If a live person speaks, say your first_sentence ONCE, then WAIT up to 3 seconds for their reply.
3. MISSED CALL / RETURNING A CALL: If the caller says they are returning a call or missed a call, say: "Thank you for calling back. You've reached ${agentName}'s office. ${agentName} can explain the reason for the call. May I connect you now?"
4. WHY ARE YOU CALLING / WHAT IS THIS ABOUT: Say: "I help connect callers with ${agentName}. I don't have the details to discuss, but ${agentName} can explain. Would you like me to transfer you?"
5. I DON'T KNOW THAT AGENT: Say: "That's okay—you don't need to know ${agentName} personally. They can help clarify why you were contacted. May I connect you?" Never require callers to know the agent's name before transferring.
6. QUESTIONS ABOUT A CASE: Say: "${agentName} is handling your matter and can discuss the details with you. May I connect you?" Never invent legal authority, deadlines, urgency, or private details.
7. When the caller agrees or directly requests the agent, say: "Certainly. Please hold while I connect you to ${agentName}." Then invoke the transfer tool immediately and remain completely silent while it connects.
8. Do NOT transfer if they decline in ANY way, or if there is no reply within 3 seconds, or if the line is silent.
9. Respect refusals, wrong-number reports, and do-not-call requests. Say "I understand, thank you for your time" and HANG UP.
10. IF ASKED "Are you a robot/AI?": Answer truthfully: "Yes, I'm an AI assistant for ${agentName}." Then continue the conversation.
11. Never claim an urgent legal matter, lawsuit, deadline, or case-agent status.
12. Never disclose debt amounts, account details, or financial information.
13. NEVER repeat your first_sentence. NEVER argue. NEVER say anything after the transfer trigger phrase. Remain completely silent after invoking the transfer.`;

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
      const expectedFingerprint = await sha256(JSON.stringify({ blandNumber, transferNumber, webhookUrl, task, firstSentence }));
      const { data: audit } = await supabase.from("federal_one_route_audits").insert({
        agent_id: agent.id, bland_number: blandNumber, talkroute_number: talkrouteNumber,
        webhook_url: webhookUrl, expected_fingerprint: expectedFingerprint, status: "pending",
      }).select("id").single();

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
          const verifyRes = await fetch(`https://api.bland.ai/v1/inbound/${encodeURIComponent(blandNumber)}`, {
            headers: { "authorization": blandApiKey },
          });
          const verifyData = await verifyRes.json().catch(() => ({})) as Record<string, unknown>;
          const providerConfig = (verifyData.data || verifyData) as Record<string, unknown>;
          const providerTransfer = normalizeToE164(String(providerConfig.transfer_phone_number || ""));
          const providerWebhook = String(providerConfig.webhook || providerConfig.webhook_url || "");
          const routeMatches = verifyRes.ok && providerTransfer === transferNumber && providerWebhook === webhookUrl;
          const providerFingerprint = await sha256(JSON.stringify({
            blandNumber, transferNumber: providerTransfer, webhookUrl: providerWebhook,
            task: String(providerConfig.task || ""), firstSentence: String(providerConfig.first_sentence || ""),
          }));
          if (routeMatches) configured++;
          await supabase.from("agents").update({
            inbound_configured: routeMatches, mapping_verified: routeMatches,
            provider_sync_status: routeMatches ? "synced" : "failed",
            last_verification_at: routeMatches ? new Date().toISOString() : null,
            exact_blocker: routeMatches ? "" : "Inbound route differs from the Federal One configuration",
          }).eq("id", agent.id);
          if (audit?.id) await supabase.from("federal_one_route_audits").update({
            status: routeMatches ? "verified" : "drifted", provider_fingerprint: providerFingerprint,
            configured_at: new Date().toISOString(), verified_at: new Date().toISOString(),
            checks: { provider_read_ok: verifyRes.ok, transfer_matches: providerTransfer === transferNumber, webhook_matches: providerWebhook === webhookUrl },
            error_message: routeMatches ? null : "Provider read-back did not match the expected Talkroute or webhook",
          }).eq("id", audit.id);
          results.push({
            agent_id: agent.id,
            agent_name: agent.full_name,
            bland_number: blandNumber,
            talkroute_number: talkrouteNumber,
            transfer_number: transferNumber,
            transfer_route: "hub",
            status: routeMatches ? "verified" : "drifted",
            checks: { transfer_matches: providerTransfer === transferNumber, webhook_matches: providerWebhook === webhookUrl },
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
