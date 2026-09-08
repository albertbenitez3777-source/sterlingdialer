import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function escapeCsv(val: string): string {
  if (!val) return "";
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    // Require a valid session token from the request body or query param
    const url = new URL(req.url);
    let sessionToken = url.searchParams.get("token");
    if (!sessionToken && req.method === "POST") {
      try {
        const body = await req.json();
        sessionToken = body.session_token;
      } catch { /* not JSON */ }
    }

    if (!sessionToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: session } = await supabase
      .from("sessions")
      .select("id, agent_id")
      .eq("token", sessionToken)
      .eq("active", true)
      .maybeSingle();

    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify agent is an owner
    const { data: agent } = await supabase
      .from("agents")
      .select("role")
      .eq("id", session.agent_id)
      .maybeSingle();

    if (!agent || agent.role !== "owner") {
      return new Response(JSON.stringify({ error: "Forbidden — owner access only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let allCalls: any[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data: page, error: pageErr } = await supabase
        .from("calls")
        .select("consumer_name, consumer_phone, consumer_address, consumer_home_value, consumer_income_range, created_at, queue, agent_id, transfer_status, duration_seconds")
        .eq("is_live_human", true)
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (pageErr) {
        return new Response(JSON.stringify({ error: pageErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      allCalls = allCalls.concat(page || []);
      if (!page || page.length < pageSize) break;
      from += pageSize;
    }
    const calls = allCalls;

    const { data: agents } = await supabase
      .from("agents")
      .select("id, full_name");

    const agentMap = new Map((agents || []).map((a: any) => [a.id, a.full_name]));

    const header = "Full Name,Telephone,Address,Home Value,Income Range,Date Detected,Queue,Agent,Transfer Status,Call Duration (sec)";
    const rows = (calls || []).map((c: any) => {
      return [
        escapeCsv(c.consumer_name || ""),
        escapeCsv(c.consumer_phone || ""),
        escapeCsv(c.consumer_address || ""),
        escapeCsv(c.consumer_home_value || ""),
        escapeCsv(c.consumer_income_range || ""),
        escapeCsv(c.created_at ? new Date(c.created_at).toLocaleDateString("en-US") : ""),
        escapeCsv(c.queue || ""),
        escapeCsv(agentMap.get(c.agent_id) || c.agent_id || ""),
        escapeCsv(c.transfer_status || ""),
        String(c.duration_seconds ?? ""),
      ].join(",");
    });

    const csv = header + "\n" + rows.join("\n");

    return new Response(csv, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="human-contacts-all-time.csv"',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
