import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

let cached: { url: string; key: string; client: SupabaseClient } | null = null;

// Use PostgREST's managed connection pool. The previous adapter opened a new
// direct Postgres pool on every request, never closed it, and used unsupported
// query.append calls for table reads and writes.
export function createDbClient(_dbUrl: string, supabaseUrl: string, serviceRoleKey: string) {
  if (cached?.url === supabaseUrl && cached.key === serviceRoleKey) return cached.client;

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(12000),
      }),
    },
  });
  cached = { url: supabaseUrl, key: serviceRoleKey, client };
  return client;
}
