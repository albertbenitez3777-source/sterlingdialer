-- Wrap the existing, battle-tested batch allocator with a strict Eastern-time
-- daily ceiling. Overflow reservations are released before any provider call.
do $$
begin
  if to_regprocedure('public.dialer_next_batch_unbounded()') is null
     and to_regprocedure('public.dialer_next_batch()') is not null then
    alter function public.dialer_next_batch() rename to dialer_next_batch_unbounded;
  end if;
end $$;

create or replace function public.dialer_next_batch()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target integer := 2000;
  v_used integer := 0;
  v_remaining integer := 0;
  v_payload jsonb;
  v_calls jsonb := '[]'::jsonb;
  v_keep jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index integer := 0;
  v_call_id uuid;
  v_retry_lead_id uuid;
begin
  select least(coalesce(daily_call_target, 2000), 2000)
    into v_target from public.campaigns order by created_at desc limit 1;

  select count(*)::integer into v_used
  from public.calls
  where call_direction = 'outbound'
    and created_at >= (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York');

  v_remaining := greatest(v_target - v_used, 0);
  if v_remaining = 0 then
    return jsonb_build_object('success', true, 'calls', '[]'::jsonb, 'calls_to_dial', 0,
      'skipped', 'daily_call_target', 'daily_target', v_target, 'daily_used', v_used);
  end if;

  v_payload := public.dialer_next_batch_unbounded();
  if coalesce((v_payload->>'success')::boolean, false) is false then return v_payload; end if;
  v_calls := coalesce(v_payload->'calls', '[]'::jsonb);
  if jsonb_array_length(v_calls) <= v_remaining then
    return v_payload || jsonb_build_object('daily_target', v_target, 'daily_used', v_used);
  end if;

  for v_item in select value from jsonb_array_elements(v_calls)
  loop
    if v_index < v_remaining then
      v_keep := v_keep || jsonb_build_array(v_item);
    else
      v_call_id := nullif(v_item->>'call_id', '')::uuid;
      v_retry_lead_id := nullif(v_item->>'retry_lead_id', '')::uuid;
      update public.leads set status = 'new'
      where id = (select lead_id from public.calls where id = v_call_id)
        and status = 'in_progress';
      if v_retry_lead_id is not null then
        update public.retry_leads set status = 'new', dialed_at = null
        where id = v_retry_lead_id and status = 'in_progress';
      end if;
      delete from public.calls
      where id = v_call_id and coalesce(provider_call_id, '') = '';
    end if;
    v_index := v_index + 1;
  end loop;

  return v_payload || jsonb_build_object('calls', v_keep, 'calls_to_dial', jsonb_array_length(v_keep),
    'daily_target', v_target, 'daily_used', v_used, 'daily_limited', true);
end;
$$;

revoke all on function public.dialer_next_batch_unbounded() from public, anon, authenticated;
revoke all on function public.dialer_next_batch() from public, anon, authenticated;
