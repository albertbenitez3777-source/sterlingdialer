/*
# Insert Erick's + Mark's transfer phone numbers as leads assigned to James

Creates lead entries from all successful fire transfers to Erick Jackson
and Mark Carlson, assigned to James Spencer for redial.
*/

INSERT INTO public.leads (
  name, telephone_original, telephone_normalized, status, source, is_priority, assigned_agent_id
)
SELECT DISTINCT ON (c.consumer_phone)
  c.consumer_name,
  c.consumer_phone,
  c.consumer_phone,
  'new',
  'transfer_redial_erick_mark_to_james',
  true,
  'c242abef-c01e-490b-bab6-859cd89bd08a'
FROM public.calls c
WHERE c.queue = 'fire_transfer'
  AND c.transfer_status = 'successful'
  AND c.agent_id IN (
    'bf021c46-10ca-45a4-b800-08f5e181834e',
    '03f30cd4-b21e-4a40-a611-df6cfd49d0ff'
  )
  AND c.consumer_phone IS NOT NULL
  AND c.consumer_phone <> ''
  AND c.consumer_phone !~ '^\+?1?(800|855|866|877|888|844|833)'
ON CONFLICT DO NOTHING;
