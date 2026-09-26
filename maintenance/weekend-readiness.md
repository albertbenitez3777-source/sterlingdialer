# Federal One weekend verification — September 26, 2026

## Live repairs
- Login response deadline now includes response body; saved-session restoration settles after success and cannot reset navigation on reconnect; local logout clears immediately while remote revocation has a five-second deadline; owner setup uses a bounded request.
- Published Bolt asset: app-C6XroGew.js. 29 focused tests, TypeScript, production build, and protected-phone source checks passed in Bolt.
- Camera direct table privileges revoked for anon/authenticated; verified SELECT/INSERT/UPDATE/DELETE/TRUNCATE denied and service-role backend access preserved.
- federal-one-v2 version91 ACTIVE; deployed source matched approved camera-only diff. Camera read/write database errors return503 instead of false success/empty lists. Seven synthetic backend checks passed.

## Checks completed
- Database still running since Sep25 17:13:35Z; zero lock waits at Sep26 15:36Z.
- No statement-timeout or SIP401 text in four log streams from14:48–15:35Z. Quiet-period evidence, not physical phone proof.
- Owner, James(supervisor), Mark and Erick roles match intended mapping. Dashboard roster has only three working agents. Campaign remains stopped/activationfalse.
- Report inspected: Costa Rica day bounds, provider events override mislabeled direction, receiving legs link on calls.id AND agent_id; current presence stale for all agents at check. Attendance totals are recorded coverage, not a complete reconstruction of past logins.
- Mailbox handlers constrain list/audio access to verified agent identity.65 records have65 private storage objects. Saved-voicemail alert counts are James37,Mark14,Erick14, matching recording counts; all65 have same-agent/same-caller alert matches. This is database evidence, not proof the user saw an alert or played the audio.
- Camera frame-view route limits access to owner/admin or James's supervisor identity. Ordinary agents denied in source tests.
- Frontend rollback tested in isolated files: restores exact before content and rejects a conflicting edit before writing. No live rollback performed.

## Remaining limitations / follow-ups
- Secure owner PIN handoff rejected by automatic approval review before prompting user; no credentials entered and no bypass attempted. Authenticated admin/agent live navigation and session refresh remain unverified.
- Windows/Mac microphones, speakers, ringtone and both speech directions require real-device test calls. No customer calls or dialer activation performed.
- Existing agent_login_by_token public execution advisory remains for separate intended-login-link review; do not revoke blindly and break login.
- Broad historical source-string tests were not certified passing. Focused current stability suite passed.
- Existing large JavaScript bundle warning remains; no speculative phone refactor.
- Camera snapshot monitoring does not require LiveKit; optional live-video service configuration not physically verified. No secret values inspected.
- Rollback preserves previous runtime source; do not automatically restore the removed broad camera permissions.

Backend source reconciliation: Bolt whole-file source differs from deployed v90. Only the two exact camera error-handling blocks are synchronized, preserving unrelated Bolt changes. The backend deployed through Supabase remains verified v91.
