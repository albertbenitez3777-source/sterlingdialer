/*
# Insert John's transfer phone numbers as leads assigned to Erick

Creates lead entries from all successful fire transfers to John McCarthy,
assigned to Erick Jackson for redial.
*/

INSERT INTO public.leads (
  name, telephone_original, telephone_normalized, status, source, is_priority, assigned_agent_id
)
SELECT DISTINCT ON (c.consumer_phone)
  c.consumer_name,
  c.consumer_phone,
  c.consumer_phone,
  'new',
  'transfer_redial_john_to_erick',
  true,
  'bf021c46-10ca-45a4-b800-08f5e181834e'
FROM public.calls c
WHERE c.queue = 'fire_transfer'
  AND c.transfer_status = 'successful'
  AND c.agent_id = '1b01a583-98c5-439a-999e-d312c68106c3'
  AND c.consumer_phone IS NOT NULL
  AND c.consumer_phone <> ''
  AND c.consumer_phone !~ '^\+?1?(800|855|866|877|888|844|833)'
ON CONFLICT DO NOTHING;
