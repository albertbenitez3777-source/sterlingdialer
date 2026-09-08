-- Reset owner admin PIN to 7779
-- Uses the existing set_agent_pin function which handles salt generation and hashing
SELECT public.set_agent_pin('Owner Administrator', '7779');

-- Log the reset
INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
VALUES ('owner_pin_reset', 'agent', '2b8f575b-a287-4338-8857-a30856675305', jsonb_build_object('method', 'manual_reset'));
