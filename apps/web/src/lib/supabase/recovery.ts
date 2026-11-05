import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Client, Database } from "@apartment-book/shared";
import { getSupabaseEnv } from "@/lib/env";

/**
 * A client for one call: asking Supabase for a recovery email (requestPasswordReset). The site's own clients use the
 * PKCE flow, whose link works only in the browser that asked for it, so a student who asked on a laptop could not open
 * the email on their phone. This one uses the implicit flow, whose link carries its tokens to /reset-password in any
 * browser (packages/shared/src/auth.ts explains the whole flow). It keeps no session and touches no cookie.
 */
export function createRecoveryClient(): Client {
  const { url, anonKey } = getSupabaseEnv();
  return createClient<Database>(url, anonKey, { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
