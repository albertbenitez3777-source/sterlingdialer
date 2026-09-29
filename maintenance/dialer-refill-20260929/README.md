# Dialer refill proposal — awaiting owner approval

## Verified cause

On September 29 at 17:39:47 UTC (11:39 Costa Rica), the live report showed a shared configured/effective capacity of 25 with two eligible agents, 18 tracked active records, seven available slots, 400 starts in the rolling hour and a pacing allowance of zero. One active record was aged; tracked active records are not proof of simultaneous provider dialing. During the preceding 15 minutes the database recorded 102 provider-accepted attempts and no rejected dispatches or rate/concurrency error matches.

The owner's screenshot showed seven provider rows marked Queued. Provider acceptance and queued records do not prove active dialing. The Bland dashboard could not be checked directly in the review browser because its page returned a gateway connection error; no account-specific provider quota was verified.

The live campaign has a separate 400-start/hour guard and a database constraint disallowing a higher value. This is separate from its NULL continuous run limit. The dispatch worker checks every 20 seconds and sends provider requests sequentially. Its existing advisory lock prevents overlapping workers from occupying database capacity.

## Proposed narrow change

| Setting | Current | Proposed |
| --- | --- | --- |
| Shared simultaneous campaign ceiling | 25 | 25 |
| Internal rolling hourly start ceiling | 400 | 1,000 |
| Existing scheduler interval | 20 seconds | 10 seconds |
| Rolling minute guard at 25 lines | 25 starts | 25 starts |

The proposed hourly ceiling permits up to 2.5 times the hourly call volume and could increase calling costs. It does not guarantee 25 constantly occupied calls. The provider's own limits, call turnover and available leads still apply.

Phone, audio, routing, agent selection, login, provider credentials and dispatch code are unchanged. No campaign start/restart or test call is included. The existing daily safeguards, Stop/run/epoch checks and no-overlap lock remain.

## Approval and application status

Automatic approval review rejected the schema migration because the owner's existing explicit approval covered 25 simultaneous lines, not an increase from 400 to 1,000 starts per hour. Neither the schema change nor the settings/schedule change was applied. Do not apply this proposal until the owner explicitly approves the higher hourly allowance and refill interval.

After approval, re-read live campaign/operator state before using either SQL file. The operational script is guarded to the previously reviewed run and schedule and must fail if they changed. Do not weaken those guards to force a stale proposal through.

1. `database/dialer-refill-pace.sql` raises only the allowed hourly configuration bound after validating the old constraint and read-only pacing assertions.
2. `maintenance/dialer-refill-20260929/apply-settings.sql` changes the exact reviewed running campaign and the existing scheduler interval, records an audit event and verifies the run/epoch remained intact in one transaction.
3. Verify actual provider acceptance/rejection and worker outcomes after the next regular cycles; report tracked capacity separately from provider-active dialing. Roll back the operational settings if new failures appear, without stopping existing calls or restarting the campaign.

## Completed validation

Read-only calls to the actual production pacing helper returned: old allowance at 400/hour = 0; proposed 1,000/hour allowance with 400 already placed = 25; minute guard at 25 starts = 0; hourly guard at 1,000 starts = 0. Shared capacity remained 25 with either one or two agents. An explicitly capped 400-call run still returned zero remaining at its cap.

The preceding scheduler window showed 44 jobs, zero scheduler failures and a mean scheduler invocation time of 42 ms (maximum 229 ms). This measures queue invocation, not the lifetime of the provider worker or a staffed load test.
