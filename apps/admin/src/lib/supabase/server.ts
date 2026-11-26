import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Client, Database } from "@apartment-book/shared";
import { getSupabaseEnv } from "@/lib/env";
import { portalRequestHeaders } from "@/lib/request-context";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers, acting as
 * the signed-in staff member (anon key + their session). Create a new one per request.
 * Its requests carry the staff member's address, browser and page (lib/request-context.ts),
 * which the database records with their audit log rows.
 */
export async function createClient(): Promise<Client> {
  const [cookieStore, context] = await Promise.all([cookies(), portalRequestHeaders()]);
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    global: { headers: context },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component where cookies are read-only; the proxy refreshes sessions.
        }
      },
    },
  });
}
