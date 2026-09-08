UPDATE campaigns SET state = 'stopped', dialer_activated = false WHERE state = 'running';
UPDATE calls SET queue = 'no_answer', is_completed = true, duration_seconds = 0 WHERE queue = 'pending' AND is_completed = false;
UPDATE leads SET status = 'new' WHERE status = 'in_progress';
