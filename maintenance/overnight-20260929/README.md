# Overnight reliability repair — September 28/29, 2026

Production: Federal One Bolt 69928941, Supabase rqvpthnackbulnywwgix.
This change records the backend repairs already applied and verified. It contains no PINs, session tokens, provider credentials, or customer call content.

## What changed

- Added four supporting call-history indexes and removed wide transcript-bearing projections from the operations report.
- Added an isolated `zadarma-history` Edge Function using the working server credential source, gateway JWT verification and a purpose-bound signed scheduler request. No phone API or routing was replaced.
- Changed the existing ten-minute history scheduler to enqueue that function. The worker checks provider timezone, bounds the interval to one day, handles pagination and rejects truncated history.
- Added a service-only transactional import RPC. Historical answers are preserved as answered outcomes without inventing pickup timestamps. Voicemail greeting visits do not create saved voicemail files.
- Corrected reporting so linked outbound callbacks stay outbound, answers from verified history are counted, and transfer associations also match agent assignment. Connection duration still requires actual timing evidence.
- Changed the private retired-PIN archive key to preserve every retired PIN version.
- Rotated the owner, James, Mark and Erick PINs separately as owner-authorized data changes. All new credentials were verified against their intended account, all four previous PINs were rejected, prior sessions invalidated and legacy login links revoked. No credential values are stored here.

## Live deployment

Applied migrations, in order:
1. overnight_reporting_performance
2. isolated_authenticated_zadarma_history
3. switch_zadarma_history_to_server_authorization
4. preserve_retired_pins_across_rotations
5. align_reporting_with_verified_provider_history

`zadarma-history` version 1 is active with verify_jwt=true. `wolf-auth` remains version 52 and `federal-one-v2` remains version 98.
No frontend bundle or phone source was redeployed for these repairs; no Bolt publish command is required.

## Verification

- Same-query low-load timings: monitoring 3212 ms → 76 ms; James queue 382 ms → 133 ms; admin stats 237 ms → 159 ms; operations overview 743 ms → 232 ms. Queue and operations content digests matched after the performance-only change.
- Twelve worker tests passed: invalid/expired/cross-purpose authorization, body/window bounds, credential-source selection, timezone, dry run, provider 401, pagination overflow and failed database import.
- Transactional database import tests passed; all synthetic data rolled back.
- Reporting integration tests passed for a linked outbound callback, a mismatched agent association, an answer with no pickup timestamp, and a voicemail visit. Fixtures rolled back.
- Provider dry run returned HTTP 200 for 146 records. The real September 28 import reconciled 110 calls.
- The next scheduled job ran at 2026-09-29 04:30Z; the worker completed at 04:30:03Z with a clear last_error. Scheduler success alone means queued; worker metadata proves completion.
- In 04:05–04:35Z logs: zero SQLSTATE 57014 cancellations/timeouts, three history requests HTTP 200, six federal-one-v2 requests HTTP 200. This was a quiet period, not a staffed load test.
- One September 28 historical row still labeled inbound had an out_ ID and explicit NOTIFY_OUT_END without NOTIFY_START. Its direction was corrected to outbound, preserving all audio, timestamps and linkage.

## Source and tests

Apply SQL only through reviewed migrations; these changes are already live. Do not replay the deployment just to publish the UI.
Run worker tests with `npx vitest run --config vitest.history.config.ts`.
The database test files are transaction/exception rollback checks, not customer call tests.
The test fixtures reference the authorized existing deployment roster; adjust them for another environment.

## Remaining verification

Agents must use their new PINs and check sound permission, microphone and headset on their actual computers.
A staff inbound call, a staff outbound call, and three consecutive calls with two-way audio remain necessary.
Provider answered status is not proof of two-way audio or that a human rather than a voicemail answered.
Do not reenable the intentionally disabled monitoring login observer or change the working phone routing.
The existing morning readiness check has the updated baseline. More sustained staffed traffic is required before claiming the timeouts are fully eliminated.

