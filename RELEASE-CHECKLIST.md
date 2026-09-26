# Federal One stabilization — September 26, 2026

Project: BOLT 69928941 / sb1-azwbv2jh. Supabase: rqvpthnackbulnywwgix.
Production: https://wolf-of-wall-street-ssy3.bolt.host/

## Current status

The database repair is LIVE. The website changes are PREPARED AND TESTED LOCALLY,
not published. Bolt requires acceptance of new terms before workspace operations.
No terms have been accepted, and no account privacy setting has been changed.
Last observed Bolt publication: version 447, September 25 at 12:43 p.m.

No campaigns were started or restarted. Caps, staffing, routing, passwords,
phone credentials, session records, and customer data were not changed.
The login-observer database function remains intentionally disabled.

## Five priorities

| Priority | Work completed | Remaining verification |
| --- | --- | --- |
| Database bottleneck | Removed duplicate delivery-report computations; replaced repeated per-lead call checks with one aggregation. Verified identical complete JSON output and unchanged owner/permissions/security mode. | Observe representative operating load after publication. |
| Login protection | Prepared one 25-second login/restore attempt; temporary failures preserve saved authorization; restore retries back off; simultaneous feature 401s share one verification; stale requests cannot sign out a newer login. | Publish and verify owner and agent sign-in on real devices. |
| Faster essential loading | Prepared page-specific report refreshes; home skips hidden roster/lead/redial/service-health reports; each refresh finishes before the next; old page requests cancel; monitoring backs off when unavailable. | Verify published Home controls and agent activity timing under operating load. |
| Phone isolation | Kept phone, call-controller, presence and App mounting source unchanged. Automated tests preserve one phone mount across navigation, monitoring, token renewal, workspace/chat failures. | Actual inbound/outbound two-way audio and platform/device permissions require a supervised real-device check. |
| Release/rollback gate | Added repeatable type/test/build checks, phone source checksums, guarded application and rollback, and database rollback SQL. | Apply against current Bolt source, rerun there, publish, verify the served asset and UI. |

## Evidence and limits

- Quiet-database measurements: admin report 280.614 ms before / 143.900 ms after.
- Lead report shared-page hits: 66,853 before / 4,637 after. Measured runtime
  71.810 ms before / 78.205 ms after; do not describe this as a measured latency win.
- Report equivalence was checked within the migration transaction at the same
  database time. The migration would roll back on changed results or privileges.
- No statement-timeout events returned for September 26, 14:05–14:19 UTC
  (08:05–08:19 Costa Rica). This short quiet-period check does not prove peak-load reliability.
- At September 26, 14:18:39 UTC, the campaign was stopped, activation false,
  concurrency 12. The review did not change these values.
- 24 local tests passed, plus TypeScript and a Vite production build. Tests use
  synthetic sessions and mocked communications; they do not prove physical audio.
- The current auth service is wolf-auth v48, with a 20-second upstream timeout.
  It returns 503 for database unavailability, rather than claiming a session expired.
- Historical query counters accumulate since September 14; they are not daily totals.
- The entry bundle remains about 305 kB compressed. Further chunk splitting is
  deferred so this stabilization patch does not restructure the working phone.
- Security advisor checks did not identify new report-function permissions.
  Existing warnings concern public execution of agent_login_by_token; its access
  path was not changed during this login-stability repair. Review that separately
  against intended login-link behavior before changing its grants.

## Publication gate

1. Obtain explicit consent for Bolt's new terms, or let the account owner accept
   them. The notice includes model-development data use enabled by default for
   eligible content from October 7, 2026, with an opt-out.
2. Inspect the current Bolt revision and source. Run the guarded patch from the
   project root. A source mismatch stops the patch; reconcile it, never override
   the guard or deploy an old full bundle.
3. Preserve the existing lockfile. Run `npm install --package-lock-only --ignore-scripts`
   for the added react-test-renderer development dependency, inspect the lock diff,
   and install dependencies through the normal project workflow. Do not replace
   the lockfile with one generated from an unrelated checkout.
4. Run `npm run verify:stability` in Bolt. All type checks, all stability tests,
   protected-phone checks and the build must succeed.
5. Publish only after the gate passes. Confirm the live HTML references the new
   asset, then inspect the actual published UI. A successful local build is not
   publication evidence. Keep the previous deployed version available.
6. Verify owner/agent login and restore, initial dialer/team display, read-only
   report navigation and recovery after a temporary network outage. During a
   report outage, the session should remain open and stale controls clearly labeled.
7. With an authorized person on real devices, verify Windows and Mac incoming
   ringtone, accept, both speech directions, outbound dialing and hangup. Never
   place customer test calls or activate a campaign as part of this gate.

## Rollback

Website rollback is independent of database rollback. If the new website has a
regression, use the guarded reverse patch or the previous published version.
The reverse patch refuses to overwrite any file edited after this release.

The database rollback is `database/rollback-report-work.sql`, executed through
Supabase migrations only when justified. It restores the two report functions
and refuses if either definition has changed since this repair. It does not
restart calls, reset sessions, or change permissions.

## Incident handling

Record the timestamp, action, response status and correlation ID without PINs,
session tokens or caller details. Distinguish database timeout, explicitly expired
login, stale report and provider/audio failure. Keep the working phone running
when a report fails. Avoid repeated refreshes, PIN resets or database restarts as
a substitute for identifying the failed layer.

No guarantee of 100% reliability is made. Publication and live-device checks
remain required before calling this release complete.
