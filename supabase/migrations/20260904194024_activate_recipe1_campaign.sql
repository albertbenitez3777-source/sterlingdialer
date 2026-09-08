UPDATE campaigns
SET state = 'running',
    dialer_activated = true,
    provider_call_limit = 9000
WHERE id = 'e871658f-698b-4c70-89e5-1ff161a1c2e5';