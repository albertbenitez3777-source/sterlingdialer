# Private outbound diagnostics

Read-only provider diagnostics for the September 29 outbound incident. This function does not place calls or modify provider settings, campaign state, routing, credentials, or login behavior.

Requires gateway JWT and a separate purpose-bound, five-minute HMAC over the exact request body. Request supports only start/end within a maximum 24-hour window in the last seven days. Only fixed GET endpoints are called. Provider credentials remain server-side. Output contains aggregate external-call dispositions and safe configuration checks, without customer numbers, tokens, raw errors, or IP addresses. No public/client UI integration.

Verification: eight tests pass using `vitest run --config vitest.diagnostics.config.ts`. Deployed as `zadarma-diagnostics` v3 with verify_jwt=true. Live authenticated diagnostic requests returned HTTP200. Provider reports undefined dispositions for numerous zero-second outbound attempts; this diagnostic is not a phone repair or proof of two-way audio. PBX extension online status alone is not sufficient to evaluate browser callback delivery.

Existing production phone and frontend source are unchanged. Server-side operator invocation must retain signing values inside the database/runtime and return only request IDs and sanitized results. Never expose signing values or broaden to arbitrary provider paths.
