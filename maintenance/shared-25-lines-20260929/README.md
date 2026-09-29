# Shared 25-line dialer pool — September 29, 2026

The owner requested a maximum of 25 simultaneous campaign calls without reducing capacity to seven lines per selected agent. This change makes the global line setting one shared pool across agents with eligible routes. One eligible agent can use all 25 slots; two agents share the same 25-slot budget. A zero-agent selection still dispatches nothing.

## Changes

- Admin controls and the authenticated controls endpoint accept 1–25 lines.
- Standard and retry lead reservation branches allocate the available global pool fairly among eligible selected agents. Existing occupied calls and reservations consume global capacity.
- Dispatch revalidation no longer imposes an independent seven-line agent cap.
- Operations reporting uses the same shared capacity rule. Per-agent line buttons are replaced with a shared-pool label.
- Continuous mode remains `provider_call_limit = NULL`. Stop, run/epoch checks, eligible routing, lead protections, reservation locking, finite limits on explicitly capped runs and the rolling hourly pacing limit are preserved.

## Deployment and verification

The guarded database migration `shared_twenty_five_line_pool` and `dialer-controls` version 12 were deployed. The running campaign was changed from 20 to 25 in place, preserving its start time, dispatch epoch, continuous mode and agent selection. Mark and Erick were selected; James was not selected. No phone, audio, call-controller, authentication, route or worker scheduling code was changed.

- Admin controls tests: 60 passed.
- Stability/component tests: 39 passed.
- Continuous-mode operations tests: 53 passed.
- SQL assertions passed for all targets 1–25, one through three agents and every free-slot count; allocation never exceeds available capacity and distributes the complete budget. Finite-run and hourly/minute pacing guards were also checked without reserving or placing test calls.
- Type checking, production build and whitespace validation passed.
- Phone and call-controller output chunks remained `phone-DsagajMR.js` and `call-controller-BAf8MI55.js`.
- At 17:24 UTC, nine real provider-accepted records followed the setting change (Mark six, Erick three), with zero rejected/no-provider completed dispatches in that interval.

## Capacity is not guaranteed occupancy

The existing worker checks approximately every 20 seconds and sends provider requests sequentially. The 400-start rolling hourly protection is separate from the removed 400-call batch limit. At 17:20 UTC it was near its ceiling (399 starts), so only one further start was permitted at that instant even though the shared capacity was correctly 25. This change does not claim that 25 calls remain active continuously. Hangups, provider acceptance, available leads and pacing can all reduce observed occupancy. Physical phone/audio performance was not tested.

Frontend publication must be verified separately from backend deployment and source merge.
