// Factory helpers for Supabase clients used inside edge functions.
// User-context clients (anon key + forwarded JWT) are the default — they
// honour RLS as the calling user. Service-role clients bypass RLS and are
// reserved for scheduled/system operations.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export function createUserClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    },
  );
}

export function createServiceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
