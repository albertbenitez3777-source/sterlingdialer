# QA-TALKROUTE.md — Manual Acceptance Test Plan

## Transfer Path Repair — Talkroute Delivery

Every interactive control in App.tsx is listed below with its manual acceptance test.
There are 60 onClick handlers across the app.

---

## 1. Login Screen

### 1.1 Owner Setup — Create Admin PIN
- **Control:** "Create Admin PIN" button (GlowButton)
- **Test:** Enter a 4-digit PIN, confirm it, click button.
- **Pass:** Dashboard loads. PIN is saved. No error shown.
- **Fail mode:** Mismatched PINs show error message. Button re-enables.

### 1.2 Login — Enter Dashboard
- **Control:** "Enter Dashboard" button (GlowButton) + PinInput onComplete
- **Test:** Enter correct 4-digit PIN.
- **Pass:** Dashboard loads with admin/agent view.
- **Fail mode:** Wrong PIN shows red error. PinInput shakes. Button re-enables.

---

## 2. Admin Dashboard

### 2.1 Start Campaign
- **Control:** "START CAMPAIGN" button
- **Test:** Click with active agents and leads present.
- **Pass:** Campaign state changes to "running". Stats refresh. Button shows loading state.
- **Fail mode:** No eligible agents → blocking reason displayed. No leads → blocking reason displayed.

### 2.2 Stop Campaign
- **Control:** "STOP CAMPAIGN" button
- **Test:** Click while campaign is running.
- **Pass:** Campaign state changes to "idle". Dialer stops. Stats refresh.

### 2.3 Set Call Limit
- **Control:** Call limit input + save
- **Test:** Change the number, click save.
- **Pass:** Notice "Call limit saved" appears. Stats refresh with new limit.

### 2.4 Save Daily Minute Cap
- **Control:** Minute cap input + save button
- **Test:** Enter a number, click save.
- **Pass:** Notice "Daily minute cap saved". Stats refresh.
- **Error:** API error shown in notice. Button re-enables in finally.

### 2.5 Agent Activation Toggle (per agent)
- **Control:** ACTIVE/OFF toggle button per agent
- **Test:** Click to toggle agent on/off.
- **Pass:** Button shows loading state. Agent status updates in roster. Stats refresh.
- **Error:** API error shown. Button re-enables.

### 2.6 Concurrency Selector (per agent)
- **Control:** LINES: 2/3/5/7 buttons
- **Test:** Click a different concurrency value.
- **Pass:** Selected button highlights. Agent's dialer_concurrency updates.
- **Error:** API error shown. Buttons re-enable.

### 2.7 Direct Number Control — DISABLED
- **Control:** Previously an input + SAVE button. Now shows "Direct routing disabled" notice.
- **Test:** Verify the input field is gone. The notice text is visible.
- **Pass:** No input field rendered. No SAVE button. Notice reads "Direct routing disabled — all transfers go through Talkroute".

### 2.8 Re-Dial Live Transfers (per agent)
- **Control:** "RE-DIAL TRANSFERS" button
- **Test:** Click for an agent with past transfers.
- **Pass:** Progress bar appears. Polling starts. Notice shows count. Stats refresh.
- **Error:** "No transfers to redial" or API error shown. Button re-enables.

### 2.9 Re-Dial Live Humans (per agent)
- **Control:** "RE-DIAL HUMANS" button
- **Test:** Click for an agent with past live humans.
- **Pass:** Progress bar appears. Polling starts. Notice shows count.
- **Error:** "No humans to redial" or API error shown. Button re-enables.

### 2.10 Agent Redial (agent's own view)
- **Control:** "REDIAL" button in agent call list
- **Test:** Agent clicks redial on a past contact.
- **Pass:** Calls are placed. Results appear. Batch ID returned.

### 2.11 Re-Dial Progress Close (X button)
- **Control:** X button on progress bar
- **Test:** Click X while redial is running.
- **Pass:** Progress bar removed from view. Redial continues in background.

### 2.12 Re-Dial Filter Tabs (ALL/ACTIVE/COMPLETED)
- **Control:** Three filter tab buttons
- **Test:** Click each tab.
- **Pass:** Redial analytics table filters correctly.

### 2.13 Performance View Toggle (TODAY/THIS WEEK/ALL TIME)
- **Control:** Three perf-tab buttons
- **Test:** Click each tab.
- **Pass:** Funnel stages, minutes, and agent performance table update with correct time range.
- **Verify:** Funnel now shows 8 stages: Calls Attempted → Live Humans Reached → Transfer Requested → Talkroute Destination Dialed → Agent Answer Confirmed → Bridge Confirmed → Transfer Failed/Unverified → Likely Real Conversation.

### 2.14 Upload Leads
- **Control:** File input + drag-drop zone
- **Test:** Select a CSV file with name/phone columns.
- **Pass:** "Imported N leads" notice. Lead pool count updates.

### 2.15 Contact Search
- **Control:** Search input + search button
- **Test:** Type a phone number or name, click search.
- **Pass:** Results appear in table. Loading state shown during search.

### 2.16 Call Log — Expand Call Detail
- **Control:** Click a call row to expand
- **Test:** Click any row in the call log.
- **Pass:** Row expands to show transcript, recording, transfer details.

### 2.17 Saved Transfers — Save a Transfer
- **Control:** Bookmark icon on a call
- **Test:** Click bookmark on a fire_transfer or human_drop call.
- **Pass:** "Transfer saved" notice. Saved transfers list updates.

### 2.18 Saved Transfers — Remove
- **Control:** X / remove button on a saved transfer
- **Test:** Click remove on a saved transfer.
- **Pass:** Transfer removed from list.

### 2.19 Export Humans
- **Control:** "EXPORT" button
- **Test:** Click export.
- **Pass:** CSV file downloads with human contacts.

### 2.20 Secretary — Send Message
- **Control:** Secretary form submit button
- **Test:** Fill client name/phone, click send.
- **Pass:** Secretary call created. Status shows in list.
- **Error:** API error shown. Button re-enables.

### 2.21 Secretary — Transfer Mode Toggle
- **Control:** Transfer vs message mode selector
- **Test:** Select transfer mode.
- **Pass:** Mode changes. Call uses transfer_phone_number (Talkroute).

### 2.22 Navigation Tabs (Dashboard/Contacts/Leads/Calls/Saved)
- **Control:** Sidebar nav buttons
- **Test:** Click each nav item.
- **Pass:** Active view changes. Correct content renders.

### 2.23 Logout
- **Control:** Logout button in sidebar
- **Test:** Click logout.
- **Pass:** Returns to login screen. Session invalidated.

---

## 3. Agent View

### 3.1 Go Available / Go Offline
- **Control:** "GO AVAILABLE" button in connection banner
- **Test:** Click while offline.
- **Pass:** Banner turns green "ACTIVE". Agent receives calls. Stats refresh.
- **Error:** API error shown. Button re-enables in finally.

### 3.2 Connection Banner — Online/Offline Detection
- **Control:** Automatic (navigator.onLine)
- **Test:** Disconnect wifi while agent is available.
- **Pass:** Banner turns red "DISCONNECTED" within 1 second. Reconnect → banner returns to green/amber.

### 3.3 Agent Call List — View Queues
- **Control:** Automatic on page load + polling
- **Test:** Log in as agent. Navigate to Call Now.
- **Pass:** Human drop and fire transfer queues populate. Loading state shown until data arrives.

### 3.4 Agent — Expand Call Detail
- **Control:** Click a call row
- **Test:** Click any call in agent queue.
- **Pass:** Transcript and recording expand.

### 3.5 Agent — Save Transfer
- **Control:** Bookmark icon
- **Test:** Click bookmark on a transfer.
- **Pass:** "Saved" notice. Saved list updates.

### 3.6 Agent — Secretary
- **Control:** Secretary form
- **Test:** Send a secretary message.
- **Pass:** Call placed. Status updates.

---

## 4. Transfer Accounting Verification

### 4.1 Tool Event Does NOT Set Fire Transfer
- **Test:** Trigger a Bland tool event (transfer tool call).
- **Pass:** `transfer_requested_at` is set. `talkroute_leg_created = true`. `queue` remains "pending" or "human_drop". `queue` is NOT set to "fire_transfer". `bridge_confirmed` remains false.

### 4.2 post_transfer_transcript Sets Bridge Confirmed
- **Test:** Webhook receives `post_transfer_transcript` with non-empty text.
- **Pass:** `talkroute_answered = true`, `bridge_confirmed = true`, `queue = "fire_transfer"`.

### 4.3 NO_ANSWER Does Not Count as Bridge
- **Test:** Webhook receives call status "no_answer" after transfer was requested.
- **Pass:** `bridge_confirmed = false`, `talkroute_answered = false`, `queue = "human_drop"`.

### 4.4 transferred_to Only Means Dialed
- **Test:** Webhook receives `transferred_to` but no `post_transfer_transcript`.
- **Pass:** `talkroute_leg_created = true`, `transfer_requested_at` set, but `bridge_confirmed = false`, `talkroute_answered = false`.

### 4.5 Dashboard Metrics Show Correct Counts
- **Test:** View the funnel on the admin dashboard.
- **Pass:** "Transfer Requested" >= "Talkroute Destination Dialed" >= "Agent Answer Confirmed" >= "Bridge Confirmed". "Transfer Failed/Unverified" = "Transfer Requested" - "Bridge Confirmed".

---

## 5. KillStaleCalls Verification

### 5.1 Stale Non-Transfer Call Killed at 150s
- **Test:** A pending outbound call with no transfer_requested_at exceeds 150 seconds.
- **Pass:** Bland `/v1/calls/{id}/stop` is called. DB call marked completed only if stop succeeds.

### 5.2 Transfer Call NOT Killed
- **Test:** A call with `transfer_requested_at` or `talkroute_leg_created = true` exceeds 150 seconds.
- **Pass:** Call is NOT stopped. It continues to wait for the transfer to complete.

---

## 6. One-Agent Live Test Procedure

This is the exact procedure to verify the Talkroute transfer path end-to-end with one agent:

### Prerequisites
1. One agent is logged in, available, transfer-certified, with valid Bland number and Talkroute number.
2. Campaign is stopped.
3. At least one lead with a phone number you can answer.

### Steps

1. **Log in as admin** (owner PIN).
2. **Verify dashboard loads** — all stats, agent roster, funnel, charts render without errors.
3. **Verify the direct-number control is disabled** — each agent card shows "Direct routing disabled — all transfers go through Talkroute" instead of an input field.
4. **Verify the funnel shows 8 stages** including "Transfer Requested", "Talkroute Destination Dialed", "Agent Answer Confirmed", "Bridge Confirmed", "Transfer Failed/Unverified".
5. **Start the campaign** (set call limit to 1 for safety).
6. **Wait for the dialer loop to place one call** — watch the Live Call Monitor for a new "pending" call.
7. **Answer the phone** when it rings.
8. **Say "hello"** and engage with the AI assistant.
9. **When the AI says "connecting you now"**, wait for the Talkroute number to ring.
10. **Answer the Talkroute call** and speak — your voice is the "representative speech".
11. **After the call ends**, check the webhook:
    - `post_transfer_transcript` should contain your speech.
    - `bridge_confirmed = true`, `talkroute_answered = true`, `queue = "fire_transfer"`.
12. **Refresh the dashboard** — the funnel should show:
    - Transfer Requested: 1
    - Talkroute Destination Dialed: 1
    - Agent Answer Confirmed: 1
    - Bridge Confirmed: 1
    - Transfer Failed/Unverified: 0
13. **Check the Live Call Monitor** — the call should show "fire_transfer" outcome with transfer_status "successful".

### Failure diagnosis
- If "Transfer Requested" is 1 but "Bridge Confirmed" is 0: the agent did not answer Talkroute, or the webhook did not receive `post_transfer_transcript`. Check the webhook logs.
- If "Talkroute Destination Dialed" is 0: the Bland call did not attempt a transfer. Check the Bland call logs for the `transfer_phone_number` field.
- If the call shows "fire_transfer" but "Bridge Confirmed" is 0: the old code may still be setting fire_transfer on tool events. Verify the deployed webhook code is current.

---

## Changed Files

| File | Change |
|------|--------|
| `supabase/migrations/talkroute_delivery_repair.sql` | New migration: fixes get_admin_stats, dialer_next_batch, campaign_start, count_available_agents |
| `supabase/functions/wolf-dialer-loop/index.ts` | killStaleCalls uses /stop endpoint, 150s threshold, only marks completed on success; placeBlandCall forces talkroute_number, removes transfer_word, adds post_transfer_transcript webhook event |
| `supabase/functions/wolf-provider/index.ts` | All call paths force talkroute_number (hub route), remove transfer_word, add post_transfer_transcript; set_agent_direct_number action disabled |
| `supabase/functions/wolf-configure-inbound/index.ts` | Forces talkroute_number, removes transfer_word, adds post_transfer_transcript |
| `supabase/functions/wolf-webhook/index.ts` | Tool events set transfer_requested_at only (not fire_transfer); bridge_confirmed/talkroute_answered only on post_transfer_transcript or MERGED state; is_live_human not inferred from transfer attempt |
| `supabase/functions/wolf-backfill/index.ts` | Replaces isTransferSuccessful with isBridgeConfirmed (post_transfer_transcript only); transferRequested and transferFailed separated |
| `src/App.tsx` | Direct-number control replaced with disabled notice; funnel expanded to 8 stages with 5 transfer metrics; CampaignSummary type extended; 4 error-swallowing handlers fixed to show errors; dead direct-number state/handler removed |
| `src/index.css` | CSS for disabled direct-number notice |
| `QA-TALKROUTE.md` | This file |

---

## 7. Control Audit Results — Error Handling, Double-Submit, Finally Cleanup, Data Refresh

Every interactive control in App.tsx was audited for the 4 required properties.

### Controls that now show errors (fixed in this pass)

| Control | Location | Fix Applied |
|---------|----------|-------------|
| Agent toggle (ACTIVE/OFF) | line ~979 | Was `catch { /* ignore */ }` — now shows "Network error — could not toggle agent" |
| Concurrency selector (LINES) | line ~992 | Was `catch { /* ignore */ }` — now shows "Network error — could not set concurrency" |
| Go Available/Offline toggle | line ~889 | Was `catch { /* ignore */ }` — now shows "Network error — could not toggle availability" |
| Delete saved transfer | line ~826 | Was `catch { /* ignore */ }` — now shows "Network error" or API error message |

### Controls already correct (error shown, double-submit prevented, finally cleanup, data refresh)

| Control | Error display | Double-submit guard | Finally cleanup | Data refresh |
|---------|--------------|--------------------|-----------------|--------------| 
| Owner setup (Create PIN) | setupError shown | settingUp disables button | setSettingUp(false) | N/A (navigates away) |
| Login (Enter Dashboard) | loginError shown | loggingIn disables button | setLoggingIn(false) | Session loaded |
| Start Campaign | notice shown | startingCampaign guard | setStartingCampaign(false) | loadAdminStats |
| Stop Campaign | notice shown | stoppingCampaign guard | setStoppingCampaign(false) | loadAdminStats |
| Save Daily Minute Cap | notice shown | savingCap disables button | setSavingCap(false) | loadAdminStats |
| Agent Redial (power dial) | notice shown | agentRedialing guard | setAgentRedialing(false) | loadQueues via polling |
| Save Transfer (bookmark) | notice shown | savingTransferIds Set guard | removed from Set | loadSavedTransfers |
| Upload Leads | notice shown | importing guard | setImporting(false) | loadLeadPool |
| Re-dial Live Transfers | notice shown | redialingAgent guard | setRedialingAgent(null) | loadAdminStats + polling |
| Re-dial Live Humans | notice shown | redialingHumans guard | setRedialingHumans(null) | loadAdminStats + polling |
| Secretary call | notice shown | placingSecCall guard | setPlacingSecCall(false) | refreshes secretary list |
| Contact search | results cleared on error | N/A (debounced) | setSearching(false) | results update |
| Logout | silent (acceptable — clears state) | N/A | N/A | state cleared |

### Controls with no error handling needed (UI-only, no API call)

- Navigation tab clicks (setActiveNav)
- Mobile menu toggle
- Notice/toast dismiss (X button)
- Call row expand/collapse
- Redial progress close (X button)
- Redial filter tabs (local state)
- Performance view toggle (local state)
- Secretary mode toggle (local state)
- Call log filter dropdown (local state)

### Removed dead code

- `setAgentDirectNumber` async handler (line 1008-1028) — deleted
- `directNumberEdits` state — deleted
- `savingDirectNumber` state — deleted

These were left over from the disabled direct-number control. No remaining references.
