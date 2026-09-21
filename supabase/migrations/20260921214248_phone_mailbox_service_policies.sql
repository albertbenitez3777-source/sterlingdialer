-- Browser clients have no direct grants. Authenticated custom sessions are
-- verified in federal-one-v2 before its service-role connection accesses rows.
create policy backend_only on public.federal_one_test_calls
  for all to service_role using (true) with check (true);
create policy backend_only on public.federal_one_voicemails
  for all to service_role using (true) with check (true);
