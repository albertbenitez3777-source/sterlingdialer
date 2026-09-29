# Continuous dialing, September 29, 2026

The owner requested removal of the 400-attempt batch cutoff while preserving working calls, three selected agents and the 20-line ceiling.

`campaigns.provider_call_limit = NULL` now explicitly means continuous dialing. Finite limits remain supported for existing callers and voicemail tests. The three batch selectors use a bounded allowance for continuous runs, and the final dispatch check accepts NULL while retaining state, activation, dispatch epoch, matching run, routing and concurrency checks. Existing pacing, exclusions, balance protection, minute protection and Stop behavior remain unchanged. No phone, provider worker, login or routing source was changed.

The administrator Start action sends NULL. The homepage and Call Reports show “Until stopped” and accepted calls in the current run, without a misleading remaining count. Missing statistics still show as unavailable; missing data is not interpreted as continuous mode.

The guarded DDL in `database/continuous-dialer.sql` was applied to production, including all nine read-only allowance assertions. It compares the previous live function definitions before modifying them. `dialer-controls` version 9 was deployed with its existing custom administrator session checks and existing gateway configuration.

The previous run stopped at exactly 400 accepted calls at 16:49:13 UTC. An independent Start occurred at 16:50:03 UTC before this change was enabled. The continuous-mode update changed only the limit and update timestamp on that already-running run, guarded by its start time and epoch 49; it did not restart the campaign or reset its totals. At 16:55:13 UTC the run was active with 61 accepted attempts, including eight accepted after this change, and no recorded worker error.

Validation:

- 56 administrator-control tests passed, including NULL/omitted continuous mode, invalid finite limits, authorization and Stop.
- 53 dashboard tests passed, including continuous counts beyond 400, finite caps, unavailable statistics and stopped state.
- 35 login, workspace, section-isolation and control-freshness tests passed.
- TypeScript check and production build passed. Phone and call-controller bundle hashes remained `phone-DsagajMR.js` and `call-controller-BAf8MI55.js`.
- Nine live database allowance assertions passed without dispatching test calls.

Frontend publication must be verified separately in Bolt after this commit syncs. Do not run the guarded migration again blindly. To restore a finite cap later, choose a value above the current accepted count and retain the current run, unless the owner explicitly requests a new run.
