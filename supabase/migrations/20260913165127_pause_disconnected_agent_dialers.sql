create or replace function public.federal_one_pause_disconnected_dialers()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer := 0;
begin
  with stale as (
    select s.agent_id
    from public.federal_one_agent_settings s
    where s.personal_dialer_state = 'running'
      and (
        (s.camera_required and s.camera_state <> 'connected')
        or not exists (
          select 1 from public.federal_one_device_heartbeats h
          where h.agent_id = s.agent_id and h.device_kind = 'desktop'
            and h.connection_state = 'online' and h.last_seen_at >= now() - interval '45 seconds'
        )
      )
  ), paused as (
    update public.federal_one_agent_settings s
    set personal_dialer_state = 'paused', updated_at = now()
    from stale where stale.agent_id = s.agent_id
    returning s.agent_id
  )
  update public.agents a set active_for_dialer = false
  from paused where paused.agent_id = a.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.federal_one_pause_disconnected_dialers() from public, anon, authenticated;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'federal-one-pause-disconnected-dialers' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('federal-one-pause-disconnected-dialers', '* * * * *',
    'select public.federal_one_pause_disconnected_dialers();');
end $$;
