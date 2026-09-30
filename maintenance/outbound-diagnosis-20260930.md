# Outbound-only failure investigation — September 30, 2026

No production repair is claimed by this branch. It adds tests against the actual phone component and backend, without changing the phone, routing, authentication, or campaigns.

## Fresh comparisons

- GitHub main: `23299072898012bf6f940359612faeb747c7815e`.
- Published entry: `app-Bdz9m1Oe.js`; phone assets: `phone-DsagajMR.js` and `call-controller-BAf8MI55.js`.
- Live `federal-one-v2` remains v98. Its callback action sends `from=<assigned extension>`, `sip=<assigned extension>`, `to=<normalized international digits>` to the documented callback endpoint.
- The live browser still uses the backend callback flow. A backend comment describing direct SDK dialing is stale; it is not evidence that direct dialing is active.
- Changes since `d00fa36` affect campaign controls, login/reporting, and related UI, without edits to the manual phone component or engine.
- The fetched public v9 SDK is byte-identical to the copy saved during the September 29 investigation. This does not establish its contents before that saved copy.
- The live event webhook and `record_zadarma_call_event` record call events; the reviewed response contains no redirect or hangup instruction.

## Test evidence

`node node_modules/vitest/vitest.mjs run --config vitest.outbound-diagnosis.config.ts`

38 tests pass, including three new actual-component tests and three exact-request backend cases. The component issues a single normalized callback, does not issue hangup through 90 seconds after a simulated confirmed call, allows three consecutive provider-ended calls, and does not retry a rejected callback request. HTTP request assertions verify that plus-formatted, international-digit, and ten-digit US destinations reach the documented endpoint unchanged after normalization.

These tests mock browser/provider events and do not prove live two-way audio or rule out event ordering, browser/network failures, or downstream rejection. Earlier tests that mirrored a simplified state machine were not sufficient to validate the complete component.

## Live outcome and remaining discriminator

The owner reports working inbound audio on Mark's phone. Three morning outbound attempts show the correct destination in the provider's external-call report, with cancelled/zero-second external outcomes. The internal callback answered for 5–7 seconds. That distinguishes the two legs, not the cancellation's origin.

No reproducible production code defect has been identified. The missing evidence is an actual failing session's browser/SIP termination origin and reason, or a controlled same-extension call using a native provider client to isolate the Federal One callback integration. No customer/test call was placed by this investigation, and no support message was sent.
