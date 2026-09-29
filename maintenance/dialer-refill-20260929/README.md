# Dialer refill correction — approved and applied September 29

## Verified cause

On September 29 at 17:39:47 UTC (11:39 Costa Rica), the live report showed a shared configured/effective capacity of 25 with two eligible agents, 18 tracked active records, seven available slots, 400 starts in the rolling hour and a pacing allowance of zero. One active record was aged; tracked active records are not proof of simultaneous provider dialing. During the preceding 15 minutes the database recorded 102 provider-accepted attempts and no rejected dispatches or rate/concurrency error matches.

The owner's screenshot showed seven provider rows marked Queued. Provider acceptance and queued records do not prove active dialing. The Bland dashboard could not be checked directly in the review browser because its page returned a gateway connection error; no account-specific provider quota was verified.

Before this correction, the campaign had a separate 400-start/hour guard and a database constraint disallowing a higher value. This is separate from its NULL continuous run limit. The dispatch worker checked every 20 seconds and sent provider requests sequentially. Its existing advisory lock prevents overlapping workers from occupying database capacity.

## Applied narrow change

| Setting | Before | After |
| --- | --- | --- |
| Shared simultaneous campaign ceiling | 25 | 25 |
| Internal rolling hourly start ceiling | 400 | 1,000 |
| Existing scheduler interval | 20 seconds | 10 seconds |
| Rolling minute guard at 25 lines | 25 starts | 25 starts |

The approved hourly ceiling permits up to 2.5 times the hourly call volume and can increase calling costs. It does not guarantee 25 constantly occupied calls. The provider's own limits, call turnover and available leads still apply.

Phone, audio, routing, agent selection, login, provider credentials and dispatch code are unchanged. No campaign start/restart or test call is included. The existing daily safeguards, Stop/run/epoch checks and no-overlap lock remain.

## Approval and application status

Automatic approval review initially rejected the schema migration because the owner's earlier explicit approval covered 25 simultaneous lines, not an increase from 400 to 1,000 starts per hour. No changes were made by that rejected attempt. At 12:00 Costa Rica time on September 29, the owner explicitly approved the 1,000-start/hour ceiling and 10-second refill interval.

After a fresh live-state check, migration `dialer_refill_pace_capacity` succeeded. The operational settings were applied at 18:01:49.972498 UTC (12:01 Costa Rica). The campaign retained its running state, original start time, dispatch epoch 49, NULL run limit, 25-line ceiling and agent selection (Mark and Erick on, James off). The existing scheduler command fingerprint remained identical; only its interval changed. No Bolt publication is required because no frontend or phone source changed.

These SQL files are a guarded record of this specific change, not scripts to rerun blindly. Re-read live operator state before any future application, and never weaken the guards to force a stale script through.

1. `database/dialer-refill-pace.sql` raises only the allowed hourly configuration bound after validating the old constraint and read-only pacing assertions.
2. `maintenance/dialer-refill-20260929/apply-settings.sql` changes the exact reviewed running campaign and the existing scheduler interval, records an audit event and verifies the run/epoch remained intact in one transaction.
3. Verify actual provider acceptance/rejection and worker outcomes after regular cycles; report tracked capacity separately from provider-active dialing. If this change causes new failures, restore the prior hourly target and interval without stopping existing calls or restarting the campaign.

## Completed validation

Read-only calls to the actual production pacing helper returned: old allowance at 400/hour = 0; proposed 1,000/hour allowance with 400 already placed = 25; minute guard at 25 starts = 0; hourly guard at 1,000 starts = 0. Shared capacity remained 25 with either one or two agents. An explicitly capped 400-call run still returned zero remaining at its cap.

The preceding scheduler window showed 44 jobs, zero scheduler failures and a mean scheduler invocation time of 42 ms (maximum 229 ms). This measures queue invocation, not the lifetime of the provider worker or a staffed load test.

At 18:02:44 UTC, 17 new calls had been provider-accepted since application (Mark nine, Erick eight), with zero rejected dispatches and zero rate/concurrency error matches. The live report showed 23 tracked active calls, zero reservations, effective capacity 25, an hourly target of 1,000 and a remaining pacing allowance of eight despite 410 starts in the rolling hour. This confirms the old 400/hour gate no longer blocked refill. It does not prove all tracked calls were simultaneously connected at the provider.

The post-change security advisor check returned the same pre-existing informational RLS-without-policy notice and no new campaign-related notices.
