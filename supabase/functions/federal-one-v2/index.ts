import { whatsUp } from "./whatsup.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { zadarma } from "./zadarma.ts";
import { testCalls } from "./test-calls.ts";
import { mailbox } from "./mailbox.ts";
import { phonePresence } from "./phone-presence.ts";

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

const clean = (value: unknown, max = 240) => String(value || "").trim().slice(0, max);
const q = (value: string) => encodeURIComponent(value);

function buildResearchSources(name: string, phone: string, email: string, address: string) {
  const [first = "", ...rest] = name.split(/\s+/);
  const last = rest.pop() ?? "";
  const ttNameSlug = first && last ? `${first}-${last}` : name.replace(/\s+/g, "-");
  const digits = phone.replace(/\D/g, "");
  const ttPhone = digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : "";
  const ttAddress = address ? address.replace(/[,#.]+/g, "").replace(/\s+/g, "-") : "";
  const exact = [`"${name}"`, phone ? `"${phone}"` : "", address ? `"${address}"` : "", email ? `"${email}"` : ""].filter(Boolean).join(" ");
  const addrParts = address ? address.replace(/[,]+/g, " ").replace(/\s+/g, " ").trim().split(" ") : [];
  const cityStateZip = addrParts.length >= 3 ? addrParts.slice(-3).join("") : "";

  const sources: Array<{ id: string; name: string; group: string; url: string }> = [];

  sources.push({ id: "tt_name", name: "That's Them (Name)", group: "That's Them", url: `https://thatsthem.com/name/${encodeURIComponent(ttNameSlug)}` });
  if (ttPhone) sources.push({ id: "tt_phone", name: "That's Them (Phone)", group: "That's Them", url: `https://thatsthem.com/phone/${ttPhone}` });
  if (ttAddress) sources.push({ id: "tt_address", name: "That's Them (Address)", group: "That's Them", url: `https://thatsthem.com/address/${encodeURIComponent(ttAddress)}` });
  if (email) sources.push({ id: "tt_email", name: "That's Them (Email)", group: "That's Them", url: `https://thatsthem.com/email/${encodeURIComponent(email)}` });

  sources.push({ id: "google_exact", name: "Google exact", group: "Google Searches", url: `https://www.google.com/search?q=${q(exact)}` });
  sources.push({ id: "google_prev_addr", name: "Google previous addresses", group: "Google Searches", url: `https://www.google.com/search?q=${q(`"${name}" "previous address" OR formerly OR "used to live" OR "property records" ${address || ""}`)}` });
  sources.push({ id: "google_emails", name: "Google emails", group: "Google Searches", url: `https://www.google.com/search?q=${q(`"${name}" ${address || phone || ""} ${email || `"@gmail" OR "@yahoo" OR "@icloud" contact`}`)}` });
  sources.push({ id: "google_spouse", name: "Google spouse / relatives", group: "Google Searches", url: `https://www.google.com/search?q=${q(`"${name}" spouse OR wife OR husband OR married OR relative OR associate ${address || phone || ""}`)}` });

  sources.push({ id: "bing", name: "Bing", group: "Web", url: `https://www.bing.com/search?q=${q(exact)}` });
  sources.push({ id: "duckduckgo", name: "DuckDuckGo", group: "Web", url: `https://duckduckgo.com/?q=${q(exact)}` });
  sources.push({ id: "brave", name: "Brave Search", group: "Web", url: `https://search.brave.com/search?q=${q(exact)}` });

  const tpsUrl = cityStateZip
    ? `https://www.truepeoplesearch.com/results?name=${q(name)}&citystatezip=${q(cityStateZip)}`
    : `https://www.truepeoplesearch.com/results?name=${q(name)}`;
  sources.push({ id: "tps_name", name: "TruePeopleSearch", group: "People Search", url: tpsUrl });
  if (digits.length === 10) sources.push({ id: "tps_phone", name: "TruePeopleSearch (Phone)", group: "People Search", url: `https://www.truepeoplesearch.com/results?phoneno=${digits}` });
  sources.push({ id: "fps_name", name: "FastPeopleSearch", group: "People Search", url: `https://www.fastpeoplesearch.com/name/${q(ttNameSlug)}` });
  if (digits.length === 10) sources.push({ id: "fps_phone", name: "FastPeopleSearch (Phone)", group: "People Search", url: `https://www.fastpeoplesearch.com/${digits}` });
  sources.push({ id: "ftn_name", name: "FamilyTreeNow", group: "People Search", url: `https://www.familytreenow.com/search/people?first=${q(first)}&last=${q(last)}` });
  sources.push({ id: "spf_name", name: "SearchPeopleFree", group: "People Search", url: `https://www.searchpeoplefree.com/find/${q(ttNameSlug)}` });
  sources.push({ id: "cbc_name", name: "CyberBackgroundChecks", group: "People Search", url: `https://www.cyberbackgroundchecks.com/people/${q(ttNameSlug)}` });

  sources.push({ id: "courtlistener", name: "CourtListener", group: "Records", url: `https://www.courtlistener.com/?q=${q(name)}&type=r` });
  sources.push({ id: "sec", name: "SEC EDGAR", group: "Records", url: `https://www.sec.gov/edgar/search/#/q=${q(name)}` });
  sources.push({ id: "licenses", name: "Public licenses", group: "Records", url: `https://www.google.com/search?q=${q(`"${name}" ${phone || address || ""} site:.gov license`)}` });
  sources.push({ id: "business", name: "Business records", group: "Records", url: `https://www.google.com/search?q=${q(`"${name}" ${phone || address || ""} business company officer`)}` });

  return sources;
}

const addText = (set: Set<string>, value: unknown) => {
  if (typeof value === "string" && value.trim()) set.add(value.trim());
  if (Array.isArray(value)) value.forEach(item => addText(set, item));
};

function collectKnownFields(rows: Array<Record<string, unknown>>, seed: { phone: string; email: string; address: string }) {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const addresses = new Set<string>();
  const associates = new Set<string>();
  addText(emails, seed.email); addText(phones, seed.phone); addText(addresses, seed.address);
  const inspect = (value: unknown, key = "") => {
    if (value == null) return;
    if (Array.isArray(value)) return value.forEach(item => inspect(item, key));
    if (typeof value === "object") return Object.entries(value as Record<string, unknown>).forEach(([nestedKey, nestedValue]) => inspect(nestedValue, nestedKey));
    const text = String(value).trim();
    if (!text) return;
    if (/e-?mail/i.test(key) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) addText(emails, text);
    if (/(phone|telephone|mobile|cell)/i.test(key)) addText(phones, text);
    if (/(address|street|residence)/i.test(key)) addText(addresses, text);
    if (/(spouse|associate|relative|co.?applicant|partner)/i.test(key)) addText(associates, text);
  };
  rows.forEach(row => {
    addText(phones, row.telephone_original); addText(phones, row.telephone_normalized);
    addText(phones, row.consumer_phone); addText(addresses, row.address); addText(addresses, row.consumer_address);
    inspect(row.custom_fields, "custom_fields"); inspect(row.consumer_custom_fields, "consumer_custom_fields");
  });
  return {
    emails: [...emails].slice(0, 20), phones: [...phones].slice(0, 20),
    addresses: [...addresses].slice(0, 20), associates: [...associates].slice(0, 20),
    records_checked: rows.length,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Service configuration unavailable" }, 503);
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const body = await req.json() as Record<string, unknown>;

    // Zadarma NOTIFY_END webhook: voicemail recording ingest (no session required)
    if (body.event === "NOTIFY_END" && body.pbx_call_id) {
      const disposition = String(body.disposition || "");
      const internal = String(body.internal || "");
      const callerId = String(body.caller_id || "");
      const pbxCallId = String(body.pbx_call_id || "");
      const durationSec = parseInt(String(body.duration || "0"), 10);
      if (disposition !== "no answer" || !["100", "101", "102"].includes(internal)) return json({ ok: true, skipped: true });
      // Verify signature from Zadarma
      const { data: cfgRows } = await supabase.from("system_config").select("key,value").in("key", ["zadarma_api_key", "zadarma_api_secret"]);
      const cfg = Object.fromEntries((cfgRows || []).map((r: { key: string; value: string }) => [r.key, r.value]));
      const zadarmaSecret = Deno.env.get("ZADARMA_API_SECRET") || cfg.zadarma_api_secret || "";
      // Look up agent by extension
      const { data: agent } = await supabase.from("agents").select("id").eq("zadarma_sip_login", `566918-${internal}`).single();
      if (!agent) return json({ ok: true, skipped: true });
      // Deduplicate
      const { data: existing } = await supabase.from("federal_one_voicemails").select("id").eq("provider_message_id", `zadarma:${pbxCallId}`).maybeSingle();
      if (existing) return json({ ok: true, duplicate: true });
      // Fetch recording from Zadarma
      const { createHash, createHmac } = await import("node:crypto");
      const zadarmaKey = Deno.env.get("ZADARMA_API_KEY") || cfg.zadarma_api_key || "";
      if (!zadarmaKey || !zadarmaSecret) return json({ ok: true, skipped: true, reason: "no_api_creds" });
      const recPath = "/v1/pbx/record/request/";
      const recParams = { pbx_call_id: pbxCallId, lifetime: "86400" };
      const sorted = Object.entries(recParams).sort(([a], [b]) => a.localeCompare(b));
      const query = new URLSearchParams(sorted).toString();
      const digest = createHash("md5").update(query).digest("hex");
      const sig = btoa(createHmac("sha1", zadarmaSecret).update(recPath + query + digest).digest("hex"));
      try {
        const recResp = await fetch(`https://api.zadarma.com${recPath}?${query}`, {
          headers: { Authorization: `${zadarmaKey}:${sig}` }, signal: AbortSignal.timeout(15000),
        });
        const recData = await recResp.json();
        if (recData.status === "success" && recData.link) {
          const audioResp = await fetch(recData.link, { signal: AbortSignal.timeout(30000) });
          if (audioResp.ok) {
            const audioBytes = new Uint8Array(await audioResp.arrayBuffer());
            if (audioBytes.length >= 16 && audioBytes.length <= 15_728_640) {
              const ext = recData.link.includes(".mp3") ? "mp3" : recData.link.includes(".ogg") ? "ogg" : "wav";
              const mime = ext === "mp3" ? "audio/mpeg" : ext === "ogg" ? "audio/ogg" : "audio/wav";
              const storagePath = `${agent.id}/${createHash("sha256").update(pbxCallId).digest("hex")}.${ext}`;
              await supabase.storage.from("agent-voicemail").upload(storagePath, audioBytes, { contentType: mime, upsert: true });
              await supabase.from("federal_one_voicemails").insert({
                agent_id: agent.id, provider_message_id: `zadarma:${pbxCallId}`,
                caller_number: callerId.replace(/[^+\d]/g, "").slice(0, 16) || null,
                received_at: new Date().toISOString(),
                duration_seconds: durationSec > 0 ? Math.min(durationSec, 3600) : null,
                storage_path: storagePath,
              });
              return json({ ok: true, stored: true });
            }
          }
        }
      } catch { /* recording not yet available, will retry on next notification */ }
      return json({ ok: true, recording_pending: true });
    }

    const sessionToken = String(body.session_token || "");
    const { data: verified, error: verifyError } = await supabase.rpc("verify_session", { p_session_token: sessionToken });
    if (verifyError) return json({ error: "Session verification unavailable" }, 503);
    if (!verified?.valid || !verified.agent?.id) return json({ error: "Invalid or expired session" }, 401);
    const agent = verified.agent as { id: string; full_name: string; role: string };
    const action = String(body.action || "");
    if (action.startsWith("phone_presence_")) {
      const result = await phonePresence(supabase, agent, body);
      return json(result.data, result.status);
    }
    if (action.startsWith("mailbox_")) {
      const result = await mailbox(supabase, agent, body);
      return json(result.data, result.status);
    }
    if (action.startsWith("phone_test_")) {
      const result = await testCalls(supabase, agent, body);
      return json(result.data, result.status);
    }
    const chat = await whatsUp(supabase, agent, body);
    if (chat) return json(chat.data, chat.status);

    if (action === "get_team_status") {
      if (!["owner", "administrator", "supervisor"].includes(agent.role)) return json({ error: "Administrator access required" }, 403);
      const [{ data: agents, error: agentsError }, { data: settings }, { data: heartbeats }, { data: routes }, { data: phones }] = await Promise.all([
        supabase.from("agents").select("id,full_name,status,active_for_dialer,available_for_transfer,inbound_configured,mapping_verified,provider_sync_status,last_verification_at").eq("status", "active").eq("is_owner", false).order("full_name"),
        supabase.from("federal_one_agent_settings").select("agent_id,personal_dialer_state,camera_state,camera_verified_at,number_certification_state,updated_at"),
        supabase.from("federal_one_device_heartbeats").select("agent_id,device_kind,connection_state,last_seen_at").order("last_seen_at", { ascending: false }),
        supabase.from("federal_one_route_audits").select("agent_id,status,checks,verified_at,created_at").order("created_at", { ascending: false }),
        supabase.from("federal_one_phone_presence").select("agent_id,instance_id,connection_state,call_state,microphone_granted,device_kind,last_seen_at").gte("last_seen_at", new Date(Date.now() - 45_000).toISOString()),
      ]);
      if (agentsError) return json({ error: "Team health could not be loaded" }, 500);
      const latest = <T extends { agent_id: string }>(rows: T[] | null | undefined, id: string) => (rows || []).find(row => row.agent_id === id) || null;
      return json({
        services: { database: "online", bland_api_key: Boolean(Deno.env.get("BLAND_API_KEY")), webhook_signature: Boolean(Deno.env.get("BLAND_WEBHOOK_SECRET")), federal_one_v2: "online" },
        agents: (agents || []).map(row => ({ ...row, settings: latest(settings, row.id), device: latest(heartbeats, row.id), route: latest(routes, row.id), phone: latest(phones, row.id) })),
        checked_at: new Date().toISOString(),
      });
    }

    if (action === "get_federal_one_v2") {
      const [{ data: route, error: routeError }, { data: settings }, { data: messages }, { data: activeClient }] = await Promise.all([
        supabase.from("agents").select("bland_number,talkroute_number,transfer_certified,inbound_configured,zadarma_sip_login").eq("id", agent.id).single(),
        supabase.from("federal_one_agent_settings").select("personal_dialer_state,number_certification_state,camera_state,camera_verified_at,mobile_companion_only").eq("agent_id", agent.id).maybeSingle(),
        supabase.from("federal_one_chat_messages").select("id,sender_agent_id,sender_name,message_kind,body,created_at").eq("room_key", "team").order("created_at", { ascending: false }).limit(50),
        supabase.from("federal_one_active_clients").select("contact_key,client_name,client_phone,client_snapshot,updated_at").eq("agent_id", agent.id).maybeSingle(),
      ]);
      if (routeError) return json({ error: "Agent route unavailable" }, 500);
      let clientNotes: unknown[] = [];
      if (activeClient?.contact_key) {
        const { data } = await supabase.from("federal_one_client_notes").select("id,agent_id,client_name,body,created_at").eq("contact_key", activeClient.contact_key).eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(20);
        clientNotes = data || [];
      }
      return json({ route: { ...route, zadarma_number: route?.talkroute_number }, settings, messages: (messages || []).reverse(), active_client: activeClient || null, client_notes: clientNotes });
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

    if (action === "set_personal_dialer_state") {
      const state = clean(body.state, 30);
      if (!["stopped", "ready", "running", "paused"].includes(state)) return json({ error: "Invalid dialer state" }, 400);
      const { data: currentSettings } = await supabase.from("federal_one_agent_settings").select("camera_required,camera_state").eq("agent_id", agent.id).maybeSingle();
      if (state === "running" && currentSettings?.camera_required && currentSettings.camera_state !== "connected") {
        return json({ error: "Join the desktop workroom before starting calls" }, 409);
      }
      const { error } = await supabase.from("federal_one_agent_settings").upsert({
        agent_id: agent.id, personal_dialer_enabled: state !== "stopped", personal_dialer_state: state, updated_at: new Date().toISOString(),
      }, { onConflict: "agent_id" });
      if (!error) await supabase.from("agents").update({ active_for_dialer: state === "running" }).eq("id", agent.id);
      return error ? json({ error: "Dialer state could not be saved" }, 500) : json({ success: true, state });
    }

    if (action === "device_heartbeat") {
      const deviceKey = clean(body.device_key, 80);
      const deviceKind = clean(body.device_kind, 20);
      if (!deviceKey || !["desktop", "phone", "tablet"].includes(deviceKind)) return json({ error: "Invalid device" }, 400);
      const { error } = await supabase.from("federal_one_device_heartbeats").upsert({
        agent_id: agent.id, device_key: deviceKey, device_kind: deviceKind,
        connection_state: "online", last_seen_at: new Date().toISOString(),
      }, { onConflict: "agent_id,device_key" });
      return error ? json({ error: "Connection status could not be saved" }, 500) : json({ success: true });
    }

    if (action === "phone_presence_update") {
      const instanceId = String(body.instance_id || "");
      const sequence = Number(body.sequence ?? -1);
      const connectionState = String(body.connection_state || "idle");
      const callStateVal = String(body.call_state || "idle");
      const micGranted = body.microphone_granted === true;
      const deviceKind = String(body.device_kind || "desktop");
      if (!instanceId || sequence < 0) return json({ error: "Invalid presence data" }, 400);
      const sessionRow = await supabase.from("auth_sessions").select("id").eq("agent_id", agent.id).is("invalidated_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!sessionRow.data) return json({ error: "No active session" }, 401);
      const { data: ok, error: rpcErr } = await supabase.rpc("record_phone_presence", {
        p_agent_id: agent.id, p_instance_id: instanceId, p_session_id: sessionRow.data.id,
        p_connection_state: connectionState, p_call_state: callStateVal,
        p_microphone_granted: micGranted, p_device_kind: deviceKind, p_sequence: sequence,
      });
      if (rpcErr) return json({ error: "Presence could not be recorded" }, 500);
      return json({ success: true, recorded: ok });
    }

    if (action === "phone_presence_list") {
      if (!["owner", "administrator", "supervisor"].includes(agent.role)) return json({ error: "Admin access required" }, 403);
      const cutoff = new Date(Date.now() - 45_000).toISOString();
      const { data, error: presErr } = await supabase.from("federal_one_phone_presence").select("agent_id,instance_id,connection_state,call_state,microphone_granted,device_kind,sequence,last_seen_at").gte("last_seen_at", cutoff);
      if (presErr) return json({ error: "Phone status unavailable" }, 500);
      return json({ phones: data || [] });
    }

    if (action === "set_active_client") {
      const clientName = clean(body.client_name, 200);
      const clientPhone = clean(body.client_phone, 40);
      if (!clientName) return json({ error: "Client name is required" }, 400);
      const snapshot = typeof body.client_snapshot === "object" && body.client_snapshot ? body.client_snapshot : {};
      const { error } = await supabase.from("federal_one_active_clients").upsert({
        agent_id: agent.id, contact_key: contactKey(clientName, clientPhone), client_name: clientName,
        client_phone: clientPhone || null, client_snapshot: snapshot, updated_at: new Date().toISOString(),
      }, { onConflict: "agent_id" });
      return error ? json({ error: "Client could not be synced" }, 500) : json({ success: true });
    }

    if (action === "add_client_note") {
      const clientName = clean(body.client_name, 200);
      const clientPhone = clean(body.client_phone, 40);
      const note = clean(body.note, 2000);
      if (!clientName || !note) return json({ error: "Client and note are required" }, 400);
      const { data, error } = await supabase.from("federal_one_client_notes").insert({
        agent_id: agent.id, contact_key: contactKey(clientName, clientPhone), client_name: clientName, body: note,
      }).select("id,agent_id,client_name,body,created_at").single();
      return error ? json({ error: "Note could not be saved" }, 500) : json({ success: true, note: data });
    }

    if (action === "log_direct_call") {
      const clientName = clean(body.client_name, 200);
      const clientPhone = clean(body.client_phone, 40);
      if (!clientName || !clientPhone) return json({ error: "Client and phone are required" }, 400);
      const { data, error } = await supabase.from("federal_one_direct_calls").insert({
        agent_id: agent.id, contact_key: contactKey(clientName, clientPhone), client_name: clientName,
        client_phone: clientPhone, route: "zadarma", outcome: "opened",
      }).select("id,opened_at").single();
      return error ? json({ error: "Call launch could not be logged" }, 500) : json({ success: true, direct_call: data });
    }

    if (action === "complete_direct_call") {
      const directCallId = clean(body.direct_call_id, 80);
      const outcome = clean(body.outcome, 30);
      const notes = clean(body.notes, 2000);
      if (!directCallId || !["answered", "no_answer", "voicemail", "wrong_number", "callback", "completed"].includes(outcome)) return json({ error: "Choose a valid call result" }, 400);
      const { error } = await supabase.from("federal_one_direct_calls").update({ outcome, notes: notes || null, completed_at: new Date().toISOString() }).eq("id", directCallId).eq("agent_id", agent.id);
      return error ? json({ error: "Call result could not be saved" }, 500) : json({ success: true });
    }

    if (action === "start_source_search") {
      const clientName = clean(body.client_name, 200);
      const clientPhone = clean(body.client_phone, 40);
      const clientEmail = clean(body.client_email, 320);
      const clientAddress = clean(body.client_address, 500);
      if (!clientName) return json({ error: "Client name is required" }, 400);
      const sources = buildResearchSources(clientName, clientPhone, clientEmail, clientAddress);
      const phoneDigits = clientPhone.replace(/\D/g, "").slice(-10);
      const leadQueries = [supabase.from("leads").select("id,name,telephone_original,telephone_normalized,address,custom_fields,created_at").ilike("name", clientName).limit(50)];
      const callQueries = [supabase.from("calls").select("id,consumer_name,consumer_phone,consumer_address,consumer_custom_fields,created_at").ilike("consumer_name", clientName).limit(50)];
      if (phoneDigits) {
        leadQueries.push(supabase.from("leads").select("id,name,telephone_original,telephone_normalized,address,custom_fields,created_at").eq("telephone_normalized", phoneDigits).limit(50));
        callQueries.push(supabase.from("calls").select("id,consumer_name,consumer_phone,consumer_address,consumer_custom_fields,created_at").eq("consumer_phone", phoneDigits).limit(50));
      }
      const researchAdmin = ["owner", "administrator"].includes(agent.role);
      const internalResults = await Promise.all([...leadQueries.map(query => researchAdmin ? query : query.eq("assigned_agent_id", agent.id)), ...callQueries.map(query => researchAdmin ? query : query.eq("agent_id", agent.id))]);
      const knownRows = new Map<string, Record<string, unknown>>();
      internalResults.forEach(result => (result.data || []).forEach((row: Record<string, unknown>) => knownRows.set(String(row.id), row)));
      const known = collectKnownFields([...knownRows.values()], { phone: clientPhone, email: clientEmail, address: clientAddress });
      const { data, error } = await supabase.from("federal_one_research_sessions").insert({
        created_by: agent.id, contact_key: contactKey(clientName, clientPhone), client_name: clientName,
        client_phone: clientPhone || null, client_email: clientEmail || null, client_address: clientAddress || null,
        status: "ready", source_count: sources.length, sources,
      }).select("id,status,source_count,sources,created_at").single();
      return error ? json({ error: "Search could not be prepared" }, 500) : json({ research: { ...data, known } });
    }

    if (action === "get_source_findings") {
      const clientName = String(body.client_name || "").trim();
      const clientPhone = String(body.client_phone || "");
      let findingsQuery = supabase.from("federal_one_source_findings").select("*").eq("contact_key", contactKey(clientName, clientPhone));
      if (!["owner", "administrator"].includes(agent.role)) findingsQuery = findingsQuery.eq("created_by", agent.id);
      const { data, error } = await findingsQuery.order("created_at", { ascending: false }).limit(100);
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

    if (action === "camera_status") {
      const cameraOn = body.camera_on === true;
      const frame = typeof body.frame === "string" && body.frame.length < 200_000 ? body.frame : null;
      const now = new Date().toISOString();
      const payload: Record<string, unknown> = {
        agent_id: agent.id, full_name: agent.full_name, camera_on: cameraOn, updated_at: now,
      };
      if (cameraOn && !frame) payload.connected_at = now;
      if (frame) payload.last_frame = frame;
      if (!cameraOn) { payload.last_frame = null; payload.connected_at = null; }
      await supabase.from("federal_one_camera_status").upsert(payload, { onConflict: "agent_id" });
      return json({ ok: true });
    }

    if (action === "get_camera_statuses") {
      if (!["owner", "administrator", "supervisor"].includes(agent.role)) return json({ error: "Admin access required" }, 403);
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      const withFrames = body.include_frames === true;
      const cols = withFrames
        ? "agent_id,full_name,camera_on,last_frame,updated_at,connected_at"
        : "agent_id,full_name,camera_on,updated_at,connected_at";
      const { data } = await supabase.from("federal_one_camera_status").select(cols).gte("updated_at", fiveMinAgo);
      return json({ cameras: data || [] });
    }

    if (action.startsWith("zadarma_")) {
      const result = await zadarma(supabase, agent, body);
      return json(result.data, result.status);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[federal-one-v2]", error);
    return json({ error: "Federal One service unavailable" }, 500);
  }
});
