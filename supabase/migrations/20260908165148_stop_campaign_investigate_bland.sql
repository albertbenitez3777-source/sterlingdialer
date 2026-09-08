/*
# Stop campaign and investigate Bland issue

1. Stop the running campaign to prevent wasted calls
2. All calls from this campaign have start_at=null on Bland's side
3. Bland queues but never dials - possible max_duration issue
4. Need to redeploy dialer with max_duration=8 (last working value)
*/

UPDATE campaigns 
SET state = 'stopped', dialer_activated = false, dialer_status = 'stopped'
WHERE state = 'running';
