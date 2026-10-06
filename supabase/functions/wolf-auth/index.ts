import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const UPSTREAM_TIMEOUT_MS = 30000;

// Fixed allowlist: action -> { rpc, args }
// Only these RPCs can be called, only with these exact argument names.
type RpcSpec = { rpc: string; args: string[] };
const RPC_ALLOWLIST: Record<string, RpcSpec> = {
  login: { rpc: "agent_login_with_retired_pin_notice", args: ["p_pin", "p_ip"] },
  login_by_token: { rpc: "agent_login_by_token", args: ["p_token", "p_ip"] },
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

function isAuthResult(data: unknown): data is Record<string, unknown> & { success: boolean } {
  return typeof data === "object" && data !== null && !Array.isArray(data) && typeof (data as Record<string, unknown>).success === "boolean";
}

async function callRpc(spec: RpcSpec, args: Record<string, string>, correlationId: string, action: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!supabaseUrl || !serviceRoleKey) {
    safeLog(correlationId, action, "Supabase configuration missing");
    return { ok: false, status: 0, data: null };
  }

  const endpoint = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${spec.rpc}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const start = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    const responseText = await response.text();
    let data: unknown = null;
    if (responseText.trim()) {
      try {
        data = JSON.parse(responseText);
      } catch {
        safeLog(correlationId, action, "Supabase RPC returned invalid JSON", {
          status: response.status,
          elapsedMs: Date.now() - start,
        });
        return { ok: false, status: response.status, data: null };
      }
    }
    if (!response.ok) {
      safeLog(correlationId, action, "Supabase RPC failed", {
        status: response.status,
        elapsedMs: Date.now() - start,
      });
      return { ok: false, status: response.status, data: null };
    }
    safeLog(correlationId, action, "Supabase RPC responded", {
      status: response.status,
      elapsedMs: Date.now() - start,
    });
    return { ok: true, status: response.status, data };
  } catch (err) {
    const errorName = err instanceof Error ? err.name : "";
    safeLog(correlationId, action, "Supabase RPC unavailable", {
      code: errorName === "AbortError" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR",
      elapsedMs: Date.now() - start,
    });
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
      if (!isAuthResult(result.data)) {
        return jsonResponse({ success: false, error: "Authentication service returned an invalid response" }, 503);
      }
      const data = result.data;
      if (!data.success) {
        return jsonResponse(data, 401);
      }
      return jsonResponse(data, 200);
    }

    if (action === "login_by_token") {
      const token = String(body.token || "");
      if (!token || token.length < 30) {
        return jsonResponse({ success: false, error: "Invalid token" }, 400);
      }
      const ip = req.headers.get("x-forwarded-for") || "unknown";
      const spec = RPC_ALLOWLIST.login_by_token;
      const result = await callRpc(spec, { p_token: token, p_ip: ip }, correlationId, action);
      if (!result.ok) {
        return jsonResponse({ success: false, error: "Service temporarily unavailable. Please try again." }, 503);
      }
      if (!isAuthResult(result.data)) {
        return jsonResponse({ success: false, error: "Authentication service returned an invalid response" }, 503);
      }
      const data = result.data;
      if (!data.success) {
        return jsonResponse(data, 401);
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
      if (!result.ok) {
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
