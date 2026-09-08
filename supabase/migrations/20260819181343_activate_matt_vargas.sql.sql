-- Activate Matt Vargas: un-archive, enable for dialer, set concurrency
UPDATE agents
SET status = 'active',
    active_for_dialer = true,
    dialer_concurrency = 7,
    available_for_transfer = true,
    mapping_verified = true,
    logged_in = true,
    last_seen_at = NOW()
WHERE full_name = 'Matt Vargas';
