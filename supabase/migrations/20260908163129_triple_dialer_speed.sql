/*
# Triple dialer speed: raise concurrency to 9 per agent, 27 global

1. Changes
   - Each agent's dialer_concurrency raised from 3 to 9
   - Campaign global concurrency raised from 9 to 27
   - This triples the number of simultaneous calls
*/

UPDATE agents SET dialer_concurrency = 9 WHERE status = 'active' AND is_owner = false;
UPDATE campaigns SET concurrency = 27 WHERE id = (SELECT id FROM campaigns ORDER BY created_at DESC LIMIT 1);
