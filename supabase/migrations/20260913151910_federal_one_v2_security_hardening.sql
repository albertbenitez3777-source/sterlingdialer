-- Federal One 2.0 security and query-path hardening.
-- The new tables are deliberately server-only: RLS with no client policy is
-- the intended deny-by-default posture because the app uses verified custom
-- sessions through an Edge Function.

create index if not exists federal_one_chat_sender_idx
  on public.federal_one_chat_messages(sender_agent_id);
create index if not exists federal_one_source_reviewer_idx
  on public.federal_one_source_findings(reviewed_by);
create index if not exists federal_one_video_creator_idx
  on public.federal_one_video_sessions(created_by);

-- These SECURITY DEFINER functions are internal server workflows. Prevent
-- direct REST/RPC invocation by public API roles while preserving service-role
-- access used by the verified Edge Functions.
revoke execute on function public.create_transfer_alert(uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text, text, jsonb)
  from anon, authenticated;
revoke execute on function public.heartbeat_session(text)
  from anon, authenticated;
