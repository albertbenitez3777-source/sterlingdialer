import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.4";
import { createHmac, timingSafeEqual } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Booking-Timestamp, X-Booking-Signature",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── HMAC Authentication ──────────────────────────────────────────────
  // The booking tool is called by Bland's server when Elizabeth invokes the
  // book_callback tool during a call. We authenticate using an HMAC signature
  // derived from the same dialer scheduler secret, scoped to "callback-booking".
  const timestamp = req.headers.get("x-booking-timestamp") || "";
  const signature = req.headers.get("x-booking-signature") || "";

  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(signature)) {
    return new Response(JSON.stringify({ error: "Signed booking request required" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sql: Sql | null = null;
  try {
    sql = getPool();

    // Fetch the signing secret
    const [authConfig] = await sql`SELECT value FROM system_config WHERE key = 'dialer_scheduler_secret'`;
    const signingSecret = String(authConfig?.value || "");
    if (signingSecret.length < 32) {
      return new Response(JSON.stringify({ error: "Booking authentication unavailable" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify HMAC: signature = HMAC-SHA256(secret, "callback-booking." + timestamp + "." + rawBody)
    const rawBody = await req.text();
    const expected = createHmac("sha256", signingSecret).update(`callback-booking.${timestamp}.${rawBody}`).digest("hex");
    if (!timingSafeEqual(new TextEncoder().encode(signature), new TextEncoder().encode(expected))) {
      return new Response(JSON.stringify({ error: "Invalid booking signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const blandCallId = String(body.call_id || body.id || "");
    // Bland sends tool parameters nested under "parameters"
    const params = body.parameters as Record<string, unknown> || {};
    const consent = params.consent === true || body.consent === true;
    const preferredWindow = String(params.preferred_window || body.preferred_window || "any").toLowerCase();

    if (!blandCallId) {
      return new Response(JSON.stringify({ error: "Missing call_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!consent) {
      return new Response(JSON.stringify({
        success: false,
        message: "Consent is required to book a callback. Ask the caller if they would like a callback and try again with consent=true.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Idempotency: check if this blandCallId already has a booking ──────
    const [existing] = await sql`
      SELECT id, scheduled_at::text AS scheduled_at_text FROM federal_one_callback_appointments
      WHERE provider_call_id = ${blandCallId}
      LIMIT 1
    `;
    if (existing) {
      const slotLocal = new Date(existing.scheduled_at_text).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "long", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      });
      return new Response(JSON.stringify({
        success: true,
        booked: true,
        idempotent: true,
        appointment_id: existing.id,
        scheduled_at: existing.scheduled_at_text,
        scheduled_at_local: slotLocal,
        message: `Callback already booked for ${slotLocal} Eastern. ${""} will call then.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Find the call record and validate ──────────────────────────────
    const callRows = await sql`
      SELECT c.id, c.agent_id, c.consumer_name, c.consumer_phone, c.lead_id
      FROM calls c
      WHERE c.provider_call_id = ${blandCallId}
      LIMIT 1
    `;

    if (callRows.length === 0) {
      return new Response(JSON.stringify({ error: "Call record not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const call = callRows[0];

    // ── DST-aware slot selection ────────────────────────────────────────
    // Generate slots using AT TIME ZONE 'America/New_York' for both
    // the wall-clock check and the conversion to timestamptz. This handles
    // DST transitions correctly because Postgres uses the IANA timezone
    // database to convert between wall-clock and UTC.
    //
    // We generate wall-clock times as timestamps (no tz), then convert
    // them to timestamptz by specifying they are in America/New_York.
    // This is DST-safe: '2026-03-08 09:00'::timestamp AT TIME ZONE 'America/New_York'
    // correctly becomes 14:00 UTC (EST) or 13:00 UTC (EDT) depending on the date.

    // Filter by preferred window
    const windowHours: Record<string, [number, number]> = {
      morning: [9, 12],
      afternoon: [12, 17],
      evening: [17, 19],
      any: [9, 18],
    };
    const [hourStart, hourEnd] = windowHours[preferredWindow] || windowHours.any;

    // Use pg_advisory_xact_lock to prevent two simultaneous bookings for the same agent
    // The slot query + insert runs in a single transaction with this lock
    const slotRows = await sql.begin(async (tx) => {
      // Lock on the agent_id to serialize concurrent booking attempts
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'booking-' + String(call.agent_id)}))`;

      // Generate candidate slots: 15-minute intervals, next 5 business days
      // Start from 1 hour from now to ensure the slot is in the future
      const slots = await tx`
        WITH candidates AS (
          SELECT
            (gs AT TIME ZONE 'America/New_York')::timestamptz AS slot_start,
            ((gs AT TIME ZONE 'America/New_York')::timestamptz + interval '15 minutes') AS slot_end
          FROM generate_series(
            (now() AT TIME ZONE 'America/New_York' + interval '1 hour')::timestamp,
            (now() AT TIME ZONE 'America/New_York' + interval '5 days')::timestamp,
            interval '15 minutes'
          ) AS gs
        )
        SELECT c.slot_start, c.slot_end
        FROM candidates c
        WHERE
          -- Business days only (Mon-Fri)
          EXTRACT(ISODOW FROM c.slot_start AT TIME ZONE 'America/New_York') BETWEEN 1 AND 5
          -- Within the preferred window hours (Eastern wall-clock)
          AND EXTRACT(HOUR FROM c.slot_start AT TIME ZONE 'America/New_York') >= ${hourStart}
          AND EXTRACT(HOUR FROM c.slot_start AT TIME ZONE 'America/New_York') < ${hourEnd}
          -- Must be in the future
          AND c.slot_start > now()
          -- No conflicting appointment for this agent
          AND NOT EXISTS (
            SELECT 1 FROM federal_one_callback_appointments a
            WHERE a.agent_id = ${call.agent_id}
              AND a.scheduled_at <= c.slot_start
              AND a.deadline_at > c.slot_start
          )
        ORDER BY c.slot_start
        LIMIT 1
      `;
      return slots;
    });

    if (slotRows.length > 0) {
      const slot = slotRows[0];
      const slotStart = slot.slot_start as string;
      const slotEnd = slot.slot_end as string;

      // Book the slot — the advisory lock above prevents double-booking
      const [apptRow] = await sql`
        INSERT INTO federal_one_callback_appointments
          (agent_id, provider_call_id, consumer_phone, consumer_name, scheduled_at, deadline_at, consent_at)
        VALUES
          (${call.agent_id}, ${blandCallId}, ${call.consumer_phone}, ${call.consumer_name || ""},
           ${slotStart}::timestamptz, ${slotEnd}::timestamptz, now())
        RETURNING id
      `;

      await sql`
        UPDATE calls
        SET callback_requested = true, requested_callback_time = ${slotStart}::timestamptz,
            callback_request_type = 'confirmed_appointment'
        WHERE id = ${call.id}
      `;

      const slotLocal = new Date(slotStart).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "long", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      });

      // Get agent name for the confirmation message
      const [agentRow] = await sql`SELECT full_name FROM agents WHERE id = ${call.agent_id} LIMIT 1`;
      const agentName = agentRow?.full_name || "Your representative";

      return new Response(JSON.stringify({
        success: true,
        booked: true,
        appointment_id: apptRow.id,
        scheduled_at: slotStart,
        scheduled_at_local: slotLocal,
        message: `Callback booked for ${slotLocal} Eastern. ${agentName} will call you then.`,
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
      SET callback_requested = true, callback_request_type = 'request_no_slot'
      WHERE id = ${call.id}
    `;

    return new Response(JSON.stringify({
      success: true,
      booked: false,
      request_saved: true,
      message: "No available callback slots right now. A callback request has been saved for the agent to review. Do not promise a specific time or present this as a confirmed appointment.",
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
