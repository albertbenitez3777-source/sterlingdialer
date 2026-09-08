/*
# v271: Rewrite pre_call_snapshot using direct UPDATE with subqueries

Eliminates SELECT INTO which nulls variables when no rows match.
Uses a single UPDATE with COALESCE subqueries instead.
*/

CREATE OR REPLACE FUNCTION public.pre_call_snapshot(
  p_call_id uuid,
  p_phone text,
  p_agent_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_phone10 text;
BEGIN
  v_phone10 := right(regexp_replace(p_phone, '\D', '', 'g'), 10);
  IF length(v_phone10) < 7 THEN RETURN; END IF;

  UPDATE calls SET
    consumer_name = CASE WHEN consumer_name = '' THEN COALESCE(
      NULLIF((SELECT l.name FROM leads l WHERE phone_last10(l.telephone_normalized) = v_phone10 ORDER BY l.created_at DESC LIMIT 1), ''),
      NULLIF((SELECT hc.consumer_name FROM calls hc WHERE phone_last10(hc.consumer_phone) = v_phone10 AND hc.id != p_call_id AND hc.is_completed = true ORDER BY hc.created_at DESC LIMIT 1), ''),
      NULLIF((SELECT rl.consumer_name FROM retry_leads rl WHERE phone_last10(rl.phone_normalized) = v_phone10 LIMIT 1), ''),
      ''
    ) ELSE consumer_name END,
    consumer_address = CASE WHEN consumer_address = '' THEN COALESCE(
      NULLIF((SELECT l.address FROM leads l WHERE phone_last10(l.telephone_normalized) = v_phone10 ORDER BY l.created_at DESC LIMIT 1), ''),
      NULLIF((SELECT hc.consumer_address FROM calls hc WHERE phone_last10(hc.consumer_phone) = v_phone10 AND hc.id != p_call_id AND hc.is_completed = true ORDER BY hc.created_at DESC LIMIT 1), ''),
      NULLIF((SELECT rl.address FROM retry_leads rl WHERE phone_last10(rl.phone_normalized) = v_phone10 LIMIT 1), ''),
      ''
    ) ELSE consumer_address END,
    consumer_home_value = CASE WHEN consumer_home_value = '' THEN COALESCE(
      NULLIF((SELECT l.home_value FROM leads l WHERE phone_last10(l.telephone_normalized) = v_phone10 ORDER BY l.created_at DESC LIMIT 1), ''),
      NULLIF((SELECT hc.consumer_home_value FROM calls hc WHERE phone_last10(hc.consumer_phone) = v_phone10 AND hc.id != p_call_id AND hc.is_completed = true ORDER BY hc.created_at DESC LIMIT 1), ''),
      NULLIF((SELECT rl.home_value FROM retry_leads rl WHERE phone_last10(rl.phone_normalized) = v_phone10 LIMIT 1), ''),
      ''
    ) ELSE consumer_home_value END,
    consumer_income_range = CASE WHEN consumer_income_range = '' THEN COALESCE(
      NULLIF((SELECT l.income_range FROM leads l WHERE phone_last10(l.telephone_normalized) = v_phone10 ORDER BY l.created_at DESC LIMIT 1), ''),
      NULLIF((SELECT hc.consumer_income_range FROM calls hc WHERE phone_last10(hc.consumer_phone) = v_phone10 AND hc.id != p_call_id AND hc.is_completed = true ORDER BY hc.created_at DESC LIMIT 1), ''),
      NULLIF((SELECT rl.income_range FROM retry_leads rl WHERE phone_last10(rl.phone_normalized) = v_phone10 LIMIT 1), ''),
      ''
    ) ELSE consumer_income_range END,
    consumer_property_info = CASE WHEN consumer_property_info = '' THEN COALESCE(
      NULLIF((SELECT l.property_information FROM leads l WHERE phone_last10(l.telephone_normalized) = v_phone10 ORDER BY l.created_at DESC LIMIT 1), ''),
      NULLIF((SELECT hc.consumer_property_info FROM calls hc WHERE phone_last10(hc.consumer_phone) = v_phone10 AND hc.id != p_call_id AND hc.is_completed = true ORDER BY hc.created_at DESC LIMIT 1), ''),
      NULLIF((SELECT rl.property_information FROM retry_leads rl WHERE phone_last10(rl.phone_normalized) = v_phone10 LIMIT 1), ''),
      ''
    ) ELSE consumer_property_info END,
    consumer_custom_fields = CASE WHEN consumer_custom_fields = '{}'::jsonb THEN COALESCE(
      NULLIF((SELECT hc.consumer_custom_fields FROM calls hc WHERE phone_last10(hc.consumer_phone) = v_phone10 AND hc.id != p_call_id AND hc.is_completed = true AND hc.consumer_custom_fields != '{}'::jsonb ORDER BY hc.created_at DESC LIMIT 1), '{}'::jsonb),
      '{}'::jsonb
    ) ELSE consumer_custom_fields END
  WHERE id = p_call_id;
END;
$function$;
