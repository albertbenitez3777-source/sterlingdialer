/*
# Stop campaign for trial test analysis

Stopping the campaign after ~22 calls to analyze results.
Marks any remaining pending calls as completed/no_answer.
*/

-- Stop the campaign
UPDATE campaigns 
SET state = 'stopped', dialer_status = 'idle'
WHERE state = 'running';

-- Complete any pending calls that are still active
UPDATE calls 
SET is_completed = true, queue = 'no_answer'
WHERE is_completed = false AND queue = 'pending'
AND created_at >= (SELECT started_at FROM campaigns ORDER BY created_at DESC LIMIT 1);
