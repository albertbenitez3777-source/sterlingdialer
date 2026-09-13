import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const contactKey = (name: string, phone: string) => {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return digits ? `phone:${digits}` : `name:${name.trim().toLowerCase().replace(/\s+/g, "-")}`;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Service configuration unavailable" }, 503);
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const body = await req.json() as Record<string, unknown>;
    const sessionToken = String(body.session_token || "");
    const { data: verified, error: verifyError } = await supabase.rpc("verify_session", { p_session_token: sessionToken });
    if (verifyError) return json({ error: "Session verification unavailable" }, 503);
    if (!verified?.valid || !verified.agent?.id) return json({ error: "Invalid or expired session" }, 401);
    const agent = verified.agent as { id: string; full_name: string; role: string };
    const action = String(body.action || "");

    if (action === "get_federal_one_v2") {
      const [{ data: route, error: routeError }, { data: settings }, { data: messages }] = await Promise.all([
        supabase.from("agents").select("bland_number,talkroute_number,transfer_certified,inbound_configured").eq("id", agent.id).single(),
        supabase.from("federal_one_agent_settings").select("personal_dialer_state,number_certification_state,camera_state,camera_verified_at,mobile_companion_only").eq("agent_id", agent.id).maybeSingle(),
        supabase.from("federal_one_chat_messages").select("id,sender_agent_id,sender_name,message_kind,body,created_at").eq("room_key", "team").order("created_at", { ascending: false }).limit(50),
      ]);
      if (routeError) return json({ error: "Agent route unavailable" }, 500);
      return json({ route, settings, messages: (messages || []).reverse() });
    }

    if (action === "set_federal_one_camera_state") {
      const cameraState = String(body.camera_state || "");
      if (!["disconnected", "requesting", "connected", "blocked"].includes(cameraState)) return json({ error: "Invalid camera state" }, 400);
      const payload: Record<string, unknown> = { agent_id: agent.id, camera_state: cameraState, updated_at: new Date().toISOString() };
      if (cameraState === "connected") payload.camera_verified_at = new Date().toISOString();
      const { error } = await supabase.from("federal_one_agent_settings").upsert(payload, { onConflict: "agent_id" });
      return error ? json({ error: "Camera state could not be saved" }, 500) : json({ success: true });
    }

    if (action === "send_federal_one_message") {
      const message = String(body.message || "").trim().slice(0, 2000);
      if (!message) return json({ error: "Message is required" }, 400);
      const { data, error } = await supabase.from("federal_one_chat_messages").insert({
        room_key: "team", sender_agent_id: agent.id, sender_name: agent.full_name, message_kind: "agent", body: message,
      }).select("id,sender_agent_id,sender_name,message_kind,body,created_at").single();
      return error ? json({ error: "Message could not be saved" }, 500) : json({ message: data });
    }

    if (action === "get_source_findings") {
      const clientName = String(body.client_name || "").trim();
      const clientPhone = String(body.client_phone || "");
      const { data, error } = await supabase.from("federal_one_source_findings").select("*")
        .eq("contact_key", contactKey(clientName, clientPhone)).order("created_at", { ascending: false }).limit(100);
      return error ? json({ error: "Findings could not be loaded" }, 500) : json({ findings: data || [] });
    }

    if (action === "save_source_finding") {
      const clientName = String(body.client_name || "").trim().slice(0, 200);
      const clientPhone = String(body.client_phone || "").slice(0, 40);
      const sourceName = String(body.source_name || "Web source").trim().slice(0, 120);
      const sourceUrl = String(body.source_url || "").trim().slice(0, 2000);
      const findingValue = String(body.finding_value || "").trim().slice(0, 2000);
      const findingType = String(body.finding_type || "other");
      if (!clientName || !findingValue || !/^https?:\/\//i.test(sourceUrl)) return json({ error: "Client, finding, and source link are required" }, 400);
      if (!["phone", "email", "address", "property", "business", "web", "other"].includes(findingType)) return json({ error: "Invalid finding type" }, 400);
      const { data, error } = await supabase.from("federal_one_source_findings").insert({
        created_by: agent.id, contact_key: contactKey(clientName, clientPhone), client_name: clientName,
        client_phone: clientPhone || null, source_name: sourceName, source_url: sourceUrl,
        finding_type: findingType, finding_value: findingValue, match_status: "possible", confidence: 50,
      }).select("*").single();
      return error ? json({ error: "Finding could not be saved" }, 500) : json({ finding: data });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[federal-one-v2]", error);
    return json({ error: "Federal One service unavailable" }, 500);
  }
});
