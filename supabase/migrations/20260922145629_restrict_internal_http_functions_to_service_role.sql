DO $$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='extensions' AND p.proname LIKE 'http%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature); END LOOP; END; $$;

