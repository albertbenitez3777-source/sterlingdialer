import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    // Get current campaign
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("state, started_at, provider_call_limit")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!campaign) {
      return new Response(JSON.stringify({ error: "No campaign found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const startedAt = campaign.started_at;

    // ── Connection funnel + minutes + machine-waste (since campaign start) ──
    const { data: funnelData, error: funnelErr } = await supabase.rpc("get_funnel_stats", {
      p_start: startedAt, p_end: new Date(Date.now() + 60000).toISOString(),
    });
    const funnel = funnelErr ? null : funnelData;

    // ── Today / week / all-time funnels ──
    const nowIso = new Date(Date.now() + 60000).toISOString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: funnelToday } = await supabase.rpc("get_funnel_stats", { p_start: todayStart.toISOString(), p_end: nowIso });
    const { data: funnelWeek } = await supabase.rpc("get_funnel_stats", { p_start: new Date(Date.now() - 7 * 86400000).toISOString(), p_end: nowIso });
    const { data: funnelAll } = await supabase.rpc("get_funnel_stats", { p_start: "1900-01-01T00:00:00Z", p_end: nowIso });

    // ── Recent errors / health ──
    const { data: errorsRecent } = await supabase.rpc("get_recent_errors", { p_limit: 20 });

    // ── Queue breakdown (kept from original) ──
    const { data: queueBreakdown } = await supabase
      .from("calls")
      .select("queue")
      .gte("created_at", startedAt)
      .eq("call_direction", "outbound")
      .not("provider_call_id", "is", null);

    const queueCounts: Record<string, number> = {};
    for (const row of queueBreakdown ?? []) {
      queueCounts[row.queue] = (queueCounts[row.queue] || 0) + 1;
    }

    // ── Long calls sample (kept from original) ──
    const { data: longCalls } = await supabase
      .from("calls")
      .select("duration_seconds, consumer_name, consumer_phone, agent_id")
      .gte("created_at", startedAt)
      .eq("call_direction", "outbound")
      .gt("duration_seconds", 60)
      .order("duration_seconds", { ascending: false })
      .limit(10);

    // ── Priority vs regular lead calls (kept from original) ──
    const { data: priorityCalls } = await supabase
      .from("calls")
      .select("lead_id")
      .gte("created_at", startedAt)
      .eq("call_direction", "outbound")
      .not("provider_call_id", "is", null);

    let priorityCallCount = 0;
    let regularCallCount = 0;
    if (priorityCalls && priorityCalls.length > 0) {
      const leadIds = priorityCalls.map(c => c.lead_id).filter(Boolean);
      if (leadIds.length > 0) {
        const { data: leadInfo } = await supabase
          .from("leads")
          .select("id, is_priority")
          .in("id", leadIds);
        for (const li of leadInfo ?? []) {
          if (li.is_priority) priorityCallCount++;
          else regularCallCount++;
        }
      }
    }

    // ── Per-agent breakdown with funnel fields ──
    const { data: agentCalls } = await supabase
      .from("calls")
      .select("agent_id, queue, is_live_human, duration_seconds, bridge_confirmed, talkroute_answered, transfer_requested_at")
      .gte("created_at", startedAt)
      .eq("call_direction", "outbound")
      .not("provider_call_id", "is", null);

    const agentNames: Record<string, string> = {};
    const { data: agents } = await supabase.from("agents").select("id, full_name").eq("status", "active");
    for (const a of agents ?? []) {
      agentNames[a.id] = a.full_name;
    }

    type AgentAgg = {
      calls: number; live: number; transfers: number; no_answer: number; voicemail: number;
      avg_duration: number; max_duration: number;
      bridge_confirmed: number; talkroute_answered: number; transfers_requested: number;
      likely_real: number; productive_seconds: number; wasted_seconds: number; total_seconds: number;
    };
    const agentStats: Record<string, AgentAgg> = {};
    const agentDurations: Record<string, number[]> = {};

    for (const call of agentCalls ?? []) {
      const aid = call.agent_id || "unassigned";
      if (!agentStats[aid]) {
        agentStats[aid] = { calls: 0, live: 0, transfers: 0, no_answer: 0, voicemail: 0, avg_duration: 0, max_duration: 0, bridge_confirmed: 0, talkroute_answered: 0, transfers_requested: 0, likely_real: 0, productive_seconds: 0, wasted_seconds: 0, total_seconds: 0 };
        agentDurations[aid] = [];
      }
      const s = agentStats[aid];
      s.calls++;
      if (call.is_live_human) s.live++;
      if (call.queue === "fire_transfer") s.transfers++;
      if (call.queue === "no_answer") s.no_answer++;
      if (call.queue === "voice_message") s.voicemail++;
      if (call.bridge_confirmed) s.bridge_confirmed++;
      if (call.talkroute_answered) s.talkroute_answered++;
      if (call.queue === "fire_transfer" || call.transfer_requested_at) s.transfers_requested++;
      if (call.bridge_confirmed && call.duration_seconds >= 45) s.likely_real++;
      if (call.bridge_confirmed) s.productive_seconds += call.duration_seconds || 0;
      if (call.queue === "no_answer" || call.queue === "voice_message" || !call.is_live_human) s.wasted_seconds += call.duration_seconds || 0;
      s.total_seconds += call.duration_seconds || 0;
      if (call.duration_seconds && call.duration_seconds > s.max_duration) s.max_duration = call.duration_seconds;
      if (call.duration_seconds && call.duration_seconds > 0) agentDurations[aid].push(call.duration_seconds);
    }

    for (const aid of Object.keys(agentStats)) {
      const durs = agentDurations[aid];
      agentStats[aid].avg_duration = durs.length > 0 ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
    }

    // ── Remaining leads (kept from original) ──
    const { count: remainingPriority } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("is_priority", true)
      .in("status", ["new", "in_progress", "closed"]);

    const { count: remainingRegular } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("is_priority", false)
      .eq("status", "new");

    const report = {
      campaign_state: campaign.state,
      campaign_started: startedAt,
      call_limit: campaign.provider_call_limit,

      // Connection funnel (since campaign start)
      funnel: funnel ? {
        calls_attempted: funnel.calls_attempted ?? 0,
        live_humans_reached: funnel.live_humans_reached ?? 0,
        transfers_requested: funnel.transfers_requested ?? 0,
        talkroute_answered: funnel.talkroute_answered ?? 0,
        bridge_confirmed: funnel.bridge_confirmed ?? 0,
        likely_real_conversation: funnel.likely_real_conversation ?? 0,
      } : null,

      // Minutes / cost (since campaign start)
      minutes: funnel ? {
        total_minutes: funnel.total_minutes ?? 0,
        productive_minutes: funnel.productive_minutes ?? 0,
        wasted_minutes: funnel.wasted_minutes ?? 0,
        machine_minutes: funnel.machine_minutes ?? 0,
        avg_ai_leg_seconds: funnel.avg_ai_leg_seconds ?? 0,
      } : null,

      // Machine waste
      machine_waste: funnel ? {
        machines_detected: funnel.machines_detected ?? 0,
        avg_machine_seconds: funnel.avg_machine_seconds ?? 0,
      } : null,

      // Time-windowed funnels
      funnel_today: funnelToday ?? null,
      funnel_week: funnelWeek ?? null,
      funnel_all: funnelAll ?? null,

      // Errors / health
      errors_recent: errorsRecent ?? [],

      // Kept from original
      total_calls: funnel?.calls_attempted ?? queueCounts["pending"] ?? 0,
      priority_calls: priorityCallCount,
      regular_calls: regularCallCount,
      live_humans: funnel?.live_humans_reached ?? 0,
      fire_transfers: funnel?.fire_transfer_count ?? queueCounts["fire_transfer"] ?? 0,
      voicemail_calls: funnel?.voice_message_count ?? queueCounts["voice_message"] ?? 0,
      no_answer: queueCounts["no_answer"] || 0,
      human_drop: queueCounts["human_drop"] || 0,
      voice_message: queueCounts["voice_message"] || 0,
      pending: queueCounts["pending"] || 0,
      avg_duration_seconds: funnel?.avg_ai_leg_seconds ?? 0,
      max_duration_seconds: longCalls?.[0]?.duration_seconds ?? 0,
      calls_over_60_seconds: longCalls?.length || 0,
      long_calls_sample: (longCalls ?? []).map(c => ({
        name: c.consumer_name,
        phone: c.consumer_phone,
        duration: c.duration_seconds,
        agent: agentNames[c.agent_id] || "unknown"
      })),
      per_agent: Object.entries(agentStats).map(([aid, s]) => ({
        agent: agentNames[aid] || aid,
        calls: s.calls,
        live_humans: s.live,
        transfers: s.transfers,
        no_answer: s.no_answer,
        voicemail: s.voicemail,
        avg_duration: s.avg_duration,
        max_duration: s.max_duration,
        connect_rate: s.calls > 0 ? Math.round((s.live / s.calls) * 100) : 0,
        bridge_confirmed: s.bridge_confirmed,
        talkroute_answered: s.talkroute_answered,
        transfers_requested: s.transfers_requested,
        likely_real_conversation: s.likely_real,
        productive_minutes: Math.round((s.productive_seconds / 60) * 10) / 10,
        wasted_minutes: Math.round((s.wasted_seconds / 60) * 10) / 10,
        total_minutes: Math.round((s.total_seconds / 60) * 10) / 10,
      })),
      remaining_priority_leads: remainingPriority || 0,
      remaining_regular_leads: remainingRegular || 0,
    };

    return new Response(JSON.stringify(report, null, 2), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
