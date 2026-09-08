import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const UPSTREAM_TIMEOUT_MS = 8000;

// Fixed allowlist: action -> { rpc, args }
// Only these RPCs can be called, only with these exact argument names.
type RpcSpec = { rpc: string; args: string[] };
const RPC_ALLOWLIST: Record<string, RpcSpec> = {
  login: { rpc: "agent_login", args: ["p_pin", "p_ip"] },
  logout: { rpc: "agent_logout", args: ["p_session_token"] },
  verify: { rpc: "verify_session", args: ["p_session_token"] },
  owner_setup: { rpc: "owner_setup_pin", args: ["p_pin"] },
  owner_needs_setup: { rpc: "owner_needs_setup", args: [] },
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeLog(correlationId: string, action: string, message: string, extra?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), correlationId, action, message, ...extra };
  console.log(JSON.stringify(entry));
}

async function callRpc(spec: RpcSpec, args: Record<string, string>, correlationId: string, action: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${spec.rpc}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });

    const elapsed = Date.now() - start;
    safeLog(correlationId, action, "upstream responded", { upstreamStatus: res.status, elapsedMs: elapsed });

    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }

    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (err) {
    const elapsed = Date.now() - start;
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    const code = isAbort ? "TIMEOUT" : "FETCH_ERROR";
    safeLog(correlationId, action, "upstream failed", { code, elapsedMs: elapsed });
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let action = "";
  try {
    const body = await req.json();
    action = String(body.action || "");

    if (action === "login") {
      const pin = String(body.pin || "");
      if (!pin || !/^\d{4}$/.test(pin)) {
        return jsonResponse({ success: false, error: "Invalid PIN format" }, 400);
      }
      const ip = req.headers.get("x-forwarded-for") || "unknown";
      const spec = RPC_ALLOWLIST.login;
      const result = await callRpc(spec, { p_pin: pin, p_ip: ip }, correlationId, action);

      if (!result.ok) {
        return jsonResponse({ success: false, error: "Service temporarily unavailable. Please try again." }, 503);
      }
      const data = result.data as Record<string, unknown> | null;
      if (!data || !data.success) {
        return jsonResponse(data || { success: false, error: "Authentication failed" }, 401);
      }
      return jsonResponse(data, 200);
    }

    if (action === "logout") {
      const sessionToken = String(body.session_token || "");
      if (!sessionToken) {
        return jsonResponse({ success: false, error: "Missing session token" }, 400);
      }
      const spec = RPC_ALLOWLIST.logout;
      const result = await callRpc(spec, { p_session_token: sessionToken }, correlationId, action);
      if (!result.ok) {
        return jsonResponse({ success: false, error: "Service temporarily unavailable. Please try again." }, 503);
      }
      return jsonResponse({ success: true }, 200);
    }

    if (action === "verify") {
      const sessionToken = String(body.session_token || "");
      if (!sessionToken) {
        return jsonResponse({ valid: false }, 200);
      }
      const spec = RPC_ALLOWLIST.verify;
      const result = await callRpc(spec, { p_session_token: sessionToken }, correlationId, action);
      if (!result.ok) {
        return jsonResponse({ error: "Session verification temporarily unavailable. Please try again." }, 503);
      }
      const data = result.data as Record<string, unknown> | null;
      if (!data || typeof data.valid !== "boolean") {
        return jsonResponse({ error: "Session verification temporarily unavailable. Please try again." }, 503);
      }
      if (!data.valid) {
        return jsonResponse({ valid: false }, 200);
      }
      return jsonResponse(data, 200);
    }

    if (action === "owner_setup") {
      const pin = String(body.pin || "");
      if (!pin || !/^\d{4}$/.test(pin)) {
        return jsonResponse({ success: false, error: "PIN must be exactly four digits" }, 400);
      }
      const spec = RPC_ALLOWLIST.owner_setup;
      const result = await callRpc(spec, { p_pin: pin }, correlationId, action);
      if (result.status === 0) {
        return jsonResponse({ success: false, error: "Service temporarily unavailable. Please try again." }, 503);
      }
      const data = result.data as Record<string, unknown> | null;
      if (!data || data.success === false) {
        return jsonResponse({ success: false, error: data?.error || "Setup failed" }, 400);
      }
      return jsonResponse({ success: true }, 200);
    }

    if (action === "owner_needs_setup") {
      const spec = RPC_ALLOWLIST.owner_needs_setup;
      const result = await callRpc(spec, {}, correlationId, action);
      if (result.status === 0) {
        return jsonResponse({ needs_setup: false }, 200);
      }
      const data = result.data as Record<string, unknown> | null;
      if (!data) {
        return jsonResponse({ needs_setup: false }, 200);
      }
      return jsonResponse(data, 200);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch {
    safeLog(correlationId, action, "handler error", { code: "HANDLER_ERROR" });
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
