import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.4";
import { timingSafeEqual } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
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

/** Constant-time string comparison to prevent timing attacks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
}

/** Bland sends prompt variables as strings — normalize "true"/"True"/"1" to boolean. */
function parseBool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val.toLowerCase() === "true" || val === "1";
  return false;
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

  // ── Bearer Token Authentication ──────────────────────────────────────
  // Bland's custom-tool headers send a static bearer token. We verify it
  // against the 'callback_booking_token' stored in system_config.
  // This is a documented Bland tool header — Bland cannot compute HMAC,
  // so we use an opaque bearer token that is verified server-side.
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Authorization required" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const providedToken = authHeader.slice(7);

  let sql: Sql | null = null;
  try {
    sql = getPool();

    // Fetch the bearer token from system_config
    const [tokenConfig] = await sql`SELECT value FROM system_config WHERE key = 'callback_booking_token'`;
    const expectedToken = String(tokenConfig?.value || "");
    if (expectedToken.length < 32) {
      return new Response(JSON.stringify({ error: "Booking authentication not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!safeEqual(providedToken, expectedToken)) {
      return new Response(JSON.stringify({ error: "Invalid authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse the request body ──────────────────────────────────────────
    // Bland sends the body we defined in the tool: call_id, phone_number,
    // consent, preferred_window — all as strings (prompt variables).
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const blandCallId = String(body.call_id || body.id || "");
    const consent = parseBool(body.consent);
    const preferredWindow = String(body.preferred_window || "any").toLowerCase();

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

    // ── Idempotency: check if this blandCallId already has a booking ──────
    // This check runs INSIDE the transaction below too, but we do a quick
    // pre-check to avoid the transaction overhead for duplicates.
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
        message: `Callback already booked for ${slotLocal} Eastern.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Preferred window filtering ──────────────────────────────────────
    const windowHours: Record<string, [number, number]> = {
      morning: [9, 12],
      afternoon: [12, 17],
      evening: [17, 19],
      any: [9, 18],
    };
    const [hourStart, hourEnd] = windowHours[preferredWindow] || windowHours.any;

    // ── Atomic slot selection + INSERT ──────────────────────────────────
    // The slot query AND the INSERT run inside a single transaction with
    // pg_advisory_xact_lock on the agent_id. This prevents two simultaneous
    // requests from booking the same slot — the lock serializes them, and
    // the INSERT inside the transaction means the slot is reserved before
    // the lock releases.
    const result = await sql.begin(async (tx) => {
      // Lock on the agent_id to serialize concurrent booking attempts
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'booking-' + String(call.agent_id)}))`;

      // Re-check idempotency inside the transaction (race condition)
      const [recheck] = await tx`
        SELECT id, scheduled_at::text AS scheduled_at_text FROM federal_one_callback_appointments
        WHERE provider_call_id = ${blandCallId}
        LIMIT 1
      `;
      if (recheck) {
        return { type: "idempotent" as const, existing: recheck };
      }

      // Generate candidate slots: 15-minute intervals, next 5 business days
      // DST-safe: uses AT TIME ZONE 'America/New_York' for wall-clock conversion
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
          EXTRACT(ISODOW FROM c.slot_start AT TIME ZONE 'America/New_York') BETWEEN 1 AND 5
          AND EXTRACT(HOUR FROM c.slot_start AT TIME ZONE 'America/New_York') >= ${hourStart}
          AND EXTRACT(HOUR FROM c.slot_start AT TIME ZONE 'America/New_York') < ${hourEnd}
          AND c.slot_start > now()
          AND NOT EXISTS (
            SELECT 1 FROM federal_one_callback_appointments a
            WHERE a.agent_id = ${call.agent_id}
              AND a.scheduled_at <= c.slot_start
              AND a.deadline_at > c.slot_start
          )
        ORDER BY c.slot_start
        LIMIT 1
      `;

      if (slots.length > 0) {
        const slot = slots[0];
        const slotStart = slot.slot_start as string;
        const slotEnd = slot.slot_end as string;

        // INSERT inside the transaction — slot is reserved before lock releases
        const [apptRow] = await tx`
          INSERT INTO federal_one_callback_appointments
            (agent_id, provider_call_id, consumer_phone, consumer_name, scheduled_at, deadline_at, consent_at)
          VALUES
            (${call.agent_id}, ${blandCallId}, ${call.consumer_phone}, ${call.consumer_name || ""},
             ${slotStart}::timestamptz, ${slotEnd}::timestamptz, now())
          RETURNING id
        `;

        await tx`
          UPDATE calls
          SET callback_requested = true, requested_callback_time = ${slotStart}::timestamptz,
              callback_request_type = 'confirmed_appointment'
          WHERE id = ${call.id}
        `;

        return { type: "booked" as const, appointment_id: apptRow.id, slotStart, slotEnd };
      }

      // No slots available — save a callback REQUEST inside the transaction
      await tx`
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

      await tx`
        UPDATE calls
        SET callback_requested = true, callback_request_type = 'request_no_slot'
        WHERE id = ${call.id}
      `;

      return { type: "no_slot" as const };
    });

    if (result.type === "idempotent") {
      const slotLocal = new Date(result.existing.scheduled_at_text).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "long", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      });
      return new Response(JSON.stringify({
        success: true,
        booked: true,
        idempotent: true,
        appointment_id: result.existing.id,
        scheduled_at: result.existing.scheduled_at_text,
        scheduled_at_local: slotLocal,
        message: `Callback already booked for ${slotLocal} Eastern.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (result.type === "booked") {
      const slotLocal = new Date(result.slotStart).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "long", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      });

      const [agentRow] = await sql`SELECT full_name FROM agents WHERE id = ${call.agent_id} LIMIT 1`;
      const agentName = agentRow?.full_name || "Your representative";

      return new Response(JSON.stringify({
        success: true,
        booked: true,
        appointment_id: result.appointment_id,
        scheduled_at: result.slotStart,
        scheduled_at_local: slotLocal,
        message: `Callback booked for ${slotLocal} Eastern. ${agentName} will call you then.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // No slot available
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
