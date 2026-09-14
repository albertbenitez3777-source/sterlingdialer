-- Raise concurrency ceiling to allow 5x speed (15 per agent)
ALTER TABLE agents DROP CONSTRAINT agents_dialer_concurrency_range;
ALTER TABLE agents ADD CONSTRAINT agents_dialer_concurrency_range CHECK (dialer_concurrency >= 1 AND dialer_concurrency <= 20);

-- 5x per-agent concurrency
UPDATE agents SET dialer_concurrency = 15 WHERE status = 'active' AND is_owner = false;

-- Global concurrency 45, hourly target 400, activate
UPDATE campaigns
SET state = 'running',
    dialer_activated = true,
    concurrency = 45,
    hourly_call_target = 400
WHERE id = (SELECT id FROM campaigns ORDER BY created_at DESC LIMIT 1);