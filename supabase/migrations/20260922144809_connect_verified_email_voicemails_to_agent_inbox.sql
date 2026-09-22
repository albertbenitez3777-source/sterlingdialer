INSERT INTO public.system_config(key,value) VALUES('voicemail_ingest_secret',encode(extensions.gen_random_bytes(32),'hex')) ON CONFLICT(key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.import_verified_zadarma_voicemail(p_message jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_secret text; v_body text:=p_message::text; v_timestamp text:=floor(extract(epoch FROM clock_timestamp()))::bigint::text; v_response extensions.http_response;
BEGIN
 IF coalesce(p_message->>'message_id','') !~ '^gmail:[a-f0-9]+:' OR p_message->>'extension' NOT IN ('100','101','102') OR length(v_body)>22000000 THEN RAISE EXCEPTION 'Invalid verified voicemail'; END IF;
 SELECT value INTO v_secret FROM system_config WHERE key='voicemail_ingest_secret';
 IF length(coalesce(v_secret,''))<32 THEN RAISE EXCEPTION 'Voicemail receiver is not configured'; END IF;
 SELECT * INTO v_response FROM extensions.http(('POST','https://rqvpthnackbulnywwgix.supabase.co/functions/v1/voicemail-ingest',ARRAY[
  extensions.http_header('x-voicemail-timestamp',v_timestamp),
  extensions.http_header('x-voicemail-signature',encode(extensions.hmac(convert_to(v_timestamp||'.'||v_body,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex'))
 ],'application/json',v_body)::extensions.http_request);
 IF v_response.status<>200 THEN RAISE EXCEPTION 'Voicemail receiver returned %: %',v_response.status,left(v_response.content,200); END IF;
 RETURN v_response.content::jsonb;
END;
$$;
REVOKE ALL ON FUNCTION public.import_verified_zadarma_voicemail(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_verified_zadarma_voicemail(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_saved_agent_voicemail()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 INSERT INTO agent_inbox(agent_id,type,title,body,consumer_phone)
 VALUES(NEW.agent_id,'callback','New voicemail','A saved voicemail is ready. Open your phone and choose Voicemail to listen and call back.',NEW.caller_number);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_saved_agent_voicemail() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_saved_agent_voicemail AFTER INSERT ON public.federal_one_voicemails FOR EACH ROW EXECUTE FUNCTION public.notify_saved_agent_voicemail();


