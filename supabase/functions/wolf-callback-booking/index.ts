import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";

type Sql = ReturnType<typeof postgres>;

function getPool(): Sql {
  return postgres(dbUrl, {
    max: 1,
    idle_timeout: 3,
    connect_timeout: 10,
    ssl: { rejectUnauthorized: false },
  });
}

function easternToday(): string {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const [month, day, year] = etStr.split("/");
  return `${year}-${month}-${day}`;
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

  let sql: Sql | null = null;
  try {
    sql = getPool();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const blandCallId = String(body.call_id || body.id || "");
    const consent = body.consent === true || body.parameters?.consent === true;
    const preferredWindow = String(body.parameters?.preferred_window || body.preferred_window || "any").toLowerCase();

    if (!blandCallId) {
      return new Response(JSON.stringify({ error: "Missing call_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!consent) {
      return new Response(JSON.stringify({
        success: false,
        message: "Consent is required to book a callback. Ask the caller if they would like a callback and try again.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find the call record and agent
    const callRows = await sql`
      SELECT c.id, c.agent_id, c.consumer_name, c.consumer_phone, c.lead_id,
             a.full_name AS agent_name, a.talkroute_number
      FROM calls c
      JOIN agents a ON a.id = c.agent_id
      WHERE c.provider_call_id = ${blandCallId}
      LIMIT 1
    `;

    if (callRows.length === 0) {
      return new Response(JSON.stringify({ error: "Call record not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const call = callRows[0];
    const today = easternToday();

    // Find available callback slots: 5-30 minute windows in the next 3 business days
    // Slots are in Eastern Time, 9am-6pm, Mon-Fri
    const slotRows = await sql`
      SELECT
        gs::timestamptz AS slot_start,
        (gs::timestamptz + interval '15 minutes') AS slot_end
      FROM generate_series(
        (now() AT TIME ZONE 'America/New_York' + interval '1 hour')::timestamp,
        (now() AT TIME ZONE 'America/New_York' + interval '3 days')::timestamp,
        interval '15 minutes'
      ) AS gs
      WHERE EXTRACT(ISODOW FROM gs AT TIME ZONE 'America/New_York') BETWEEN 1 AND 5
        AND EXTRACT(HOUR FROM gs AT TIME ZONE 'America/New_York') BETWEEN 9 AND 17
        AND NOT EXISTS (
          SELECT 1 FROM federal_one_callback_appointments a
          WHERE a.agent_id = ${call.agent_id}
            AND a.scheduled_at <= gs::timestamptz
            AND a.deadline_at > gs::timestamptz
        )
        AND NOT EXISTS (
          SELECT 1 FROM federal_one_callback_queue q
          WHERE q.agent_id = ${call.agent_id}
            AND q.state IN ('ready', 'reserved', 'dialing')
            AND q.work_day = (gs AT TIME ZONE 'America/New_York')::date
        )
      LIMIT 5
    `;

    if (slotRows.length > 0) {
      // Book the first available slot
      const slot = slotRows[0];
      const slotStart = slot.slot_start as string;
      const slotEnd = slot.slot_end as string;

      const [apptRow] = await sql`
        INSERT INTO federal_one_callback_appointments
          (agent_id, provider_call_id, consumer_phone, consumer_name, scheduled_at, deadline_at, consent_at)
        VALUES
          (${call.agent_id}, ${blandCallId}, ${call.consumer_phone}, ${call.consumer_name || ""},
           ${slotStart}::timestamptz, ${slotEnd}::timestamptz, now())
        RETURNING id
      `;

      // Mark the call with callback info
      await sql`
        UPDATE calls
        SET callback_requested = true, requested_callback_time = ${slotStart}::timestamptz
        WHERE id = ${call.id}
      `;

      const slotLocal = new Date(slotStart).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "long", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      });

      return new Response(JSON.stringify({
        success: true,
        booked: true,
        appointment_id: apptRow.id,
        scheduled_at: slotStart,
        scheduled_at_local: slotLocal,
        message: `Callback booked for ${slotLocal} Eastern. ${call.agent_name} will call then.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // No slots available — save a callback REQUEST (not an appointment)
    await sql`
      INSERT INTO federal_one_callback_queue
        (agent_id, week_start, work_day, phone, source_call_id, source_at, state, result_code)
      VALUES
        (${call.agent_id},
         date_trunc('week', now())::date,
         now()::date,
         ${call.consumer_phone},
         ${call.id},
         now(),
         'ready',
         'callback_request_no_slot')
    `;

    await sql`
      UPDATE calls
      SET callback_requested = true
      WHERE id = ${call.id}
    `;

    return new Response(JSON.stringify({
      success: true,
      booked: false,
      request_saved: true,
      message: "No available callback slots right now. A callback request has been saved for the agent to review. Do not promise a specific time.",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[callback-booking] Error:", String(err));
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (sql) await sql.end();
  }
});
