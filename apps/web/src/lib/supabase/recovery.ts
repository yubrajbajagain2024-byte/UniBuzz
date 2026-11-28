import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Client, Database } from "@apartment-book/shared";
import { getSupabaseEnv } from "@/lib/env";

/**
 * A client for one call that sends an email link: a recovery email (requestPasswordReset), a sign-up (its confirmation
 * email) and a new confirmation link (resendSignupConfirmation). The site's own clients use the PKCE flow, whose link
 * works only in the browser that asked for it, so a student who signed up or asked on a laptop could not open the email
 * on their phone. This one uses the implicit flow, whose link carries its tokens in the URL fragment to the page that
 * reads them in any browser: /reset-password for recovery, /email-confirmed for a confirmation (the callback route sends
 * it there). It keeps no session and touches no cookie. The app's client asks for the same kind of link.
 */
export function createEmailLinkClient(): Client {
  const { url, anonKey } = getSupabaseEnv();
  return createClient<Database>(url, anonKey, { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
