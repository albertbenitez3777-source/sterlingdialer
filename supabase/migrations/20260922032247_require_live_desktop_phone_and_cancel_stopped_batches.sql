-- Phone presence table: tracks live Zadarma softphone state per agent
CREATE TABLE IF NOT EXISTS public.federal_one_phone_presence (
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.auth_sessions(id) ON DELETE CASCADE,
  connection_state text NOT NULL CHECK (connection_state IN ('idle','connecting','ready','failed')),
  call_state text NOT NULL CHECK (call_state IN ('idle','dialing','ringing-in','answering','active','ending')),
  microphone_granted boolean NOT NULL DEFAULT false,
  device_kind text NOT NULL CHECK (device_kind IN ('desktop','companion')),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, instance_id)
);

ALTER TABLE public.federal_one_phone_presence ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.record_phone_presence(
  p_agent_id uuid, p_instance_id uuid, p_session_id uuid,
  p_connection_state text, p_call_state text,
  p_microphone_granted boolean, p_device_kind text, p_sequence bigint
) RETURNS boolean LANGUAGE plpgsql SET search_path TO 'public' AS $function$
declare v_changed integer;
begin
  if not exists(select 1 from public.auth_sessions s where s.id=p_session_id and s.agent_id=p_agent_id and s.invalidated_at is null and s.expires_at>now()) then
    raise exception 'Valid session required';
  end if;
  insert into public.federal_one_phone_presence as p(agent_id,instance_id,session_id,connection_state,call_state,microphone_granted,device_kind,sequence,last_seen_at)
  values(p_agent_id,p_instance_id,p_session_id,p_connection_state,p_call_state,p_microphone_granted,p_device_kind,p_sequence,now())
  on conflict(agent_id,instance_id) do update set session_id=excluded.session_id,connection_state=excluded.connection_state,
  call_state=excluded.call_state,microphone_granted=excluded.microphone_granted,device_kind=excluded.device_kind,
  sequence=excluded.sequence,last_seen_at=now()
  where p.session_id=excluded.session_id and excluded.sequence>p.sequence;
  get diagnostics v_changed=row_count;
  return v_changed>0;
end; $function$;

REVOKE ALL ON FUNCTION public.record_phone_presence FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_phone_presence TO service_role;
