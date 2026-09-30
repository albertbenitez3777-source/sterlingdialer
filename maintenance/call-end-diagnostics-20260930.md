# Call-ending diagnostics proposal — September 30, 2026

## Status
Not deployed. Automatic approval review rejected the production deployment because the shared Zadarma event webhook also handles recording events and an earlier instruction protects the voicemail webhook. Do not merge or deploy without explicit owner approval for this specific diagnostic change.

## Evidence and remaining limitation
Mark's Federal One login was verified in the browser. Enabling the phone returned "No microphone was found." A native Zadarma Webphone attempt on extension 102 to the owner's specifically authorized test number returned "You do not have the sound recording device (microphone)." Neither is a reproduction of the agents' reported outbound error. No new external call was shown for these attempts; the database had zero Mark call records after 14:52:30Z at the check.

Today's six external attempts through 08:49:10 Costa Rica time were cancelled with zero duration. The internal agent callback legs being answered is not proof of a destination connection. The root cause remains unknown. Inbound working remains user-reported success.

## Proposed change
The current live zadarma-events v6 validates provider signatures and routes events to the existing database RPC, but drops the provider's status_code (documented Q.931 call-ending code).
The proposal adds a bounded structured console log only for validated, assigned NOTIFY_END and NOTIFY_OUT_END events:
- Hashed call reference (16 hex characters)
- Event, assigned extension (100/101/102 or other), direction
- Numeric status code 0–127, or null when missing/invalid
- Allowlisted disposition and bounded duration

No phone numbers, recordings, raw payloads, headers, credentials, PINs or session tokens are logged. Failed logging cannot interrupt event saving. No database schema, normalized event, routing, authentication or phone-client change is proposed.

## Verification
`node --test test/zadarma-end-diagnostics.node.mjs`: seven tests passed.
Tests execute the actual webhook handler with synthetic signed requests and mocked database I/O. They verify signature rejection, route rejection, field filtering, missing codes, logger failures and exact normalized input/HTTP-result parity with v6 for every supported event type. They do not prove physical audio or live call behavior.

## Approval and rollback
Owner approval must explicitly cover adding this diagnostic logging to the shared Zadarma call/recording event webhook. Until approved, production remains v6.
The exact pre-change live source is preserved at maintenance/zadarma-events-v6-before-diagnostics.ts. Rollback consists of restoring that source with the unchanged webhook signature authentication and verify_jwt=false deployment setting.

## Sources
- Provider event fields: https://zadarma.com/en/support/api/
- Supabase console/log sources: https://supabase.com/docs/guides/observability/advanced-log-filtering
