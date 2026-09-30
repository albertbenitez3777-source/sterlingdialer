# Call-ending diagnostics — September 30, 2026

## Status
Owner explicitly approved this logging-only change on September 30 at 15:03:31Z. Deployed as zadarma-events v7 at 15:04:20Z (09:04 Costa Rica). Fresh source retrieval confirmed ACTIVE and an exact match with the tested patch. The earlier automatic approval rejection was resolved by this explicit approval.

## Evidence and remaining limitation
Mark's Federal One login was verified in the browser. Enabling the phone returned "No microphone was found." A native Zadarma Webphone attempt on extension 102 to the owner's specifically authorized test number returned "You do not have the sound recording device (microphone)." Neither is a reproduction of the agents' reported outbound error. No new external call was shown for these attempts; the database had zero Mark call records after 14:52:30Z at the check.

Today's six external attempts through 08:49:10 Costa Rica time were cancelled with zero duration. The internal agent callback legs being answered is not proof of a destination connection. The root cause remains unknown. Inbound working remains user-reported success.

## Logging change
Before this change, zadarma-events v6 validated provider signatures and routes events to the existing database RPC, but dropped the provider's status_code (documented Q.931 call-ending code).
Version 7 adds a bounded structured console log only for validated, assigned NOTIFY_END and NOTIFY_OUT_END events:
- Hashed call reference (16 hex characters)
- Event, assigned extension (100/101/102 or other), direction
- Numeric status code 0–127, or null when missing/invalid
- Allowlisted disposition and bounded duration

No phone numbers, recordings, raw payloads, headers, credentials, PINs or session tokens are logged. Failed logging cannot interrupt event saving. No database schema, normalized event, routing, authentication or phone-client change was made.

## Verification
`node --test test/zadarma-end-diagnostics.node.mjs`: seven tests passed.
Tests execute the actual webhook handler with synthetic signed requests and mocked database I/O. They verify signature rejection, route rejection, field filtering, missing codes, logger failures and exact normalized input/HTTP-result parity with v6 for every supported event type. They do not prove physical audio or live call behavior.

Live smoke checks: the existing echo challenge returned HTTP 200 with the expected value. A synthetic unsigned event returned HTTP 401 (Invalid provider signature), without creating a call event. At 15:05:28Z, no authenticated ending events had arrived after deployment, so no new provider call-ending code could yet be evaluated.

## Approval and rollback
Explicit owner approval covered this diagnostic logging on the shared Zadarma call/recording event webhook. Production is now v7. This is diagnostic instrumentation, not a verified fix for outbound connections.
The exact pre-change live source is preserved at maintenance/zadarma-events-v6-before-diagnostics.ts. Rollback consists of restoring that source with the unchanged webhook signature authentication and verify_jwt=false deployment setting.

## Sources
- Provider event fields: https://zadarma.com/en/support/api/
- Supabase console/log sources: https://supabase.com/docs/guides/observability/advanced-log-filtering
