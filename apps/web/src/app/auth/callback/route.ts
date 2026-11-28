import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { recoveryFromUrl, RESET_PASSWORD_PATH } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";
import { friendlyAuthError } from "@/lib/actions/auth";

/**
 * Handles redirects back from Supabase Auth:
 *  - OAuth (Google) and PKCE email links send `?code=...`
 *  - Email confirmation / magic links can send `?token_hash=...&type=...`
 *  - A link Supabase refused (expired, or used already) sends `?error=...&error_code=...&error_description=...`
 *  - A confirmation link of the implicit flow (sign-up, a new link: both apps ask for it) brings its session, or its
 *    refusal, in the fragment, which only the browser sees: it goes on to /email-confirmed, which reads it
 * A recovery link lands on /reset-password with its tokens in the fragment and never comes here (packages/shared/src/
 * auth.ts); a recovery `token_hash` (an email template written that way) is taken to that page once verified.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  const refused = recoveryFromUrl(request.url);
  if (refused.kind === "expired" || refused.kind === "error") {
    if (next === RESET_PASSWORD_PATH || type === "recovery") return NextResponse.redirect(`${origin}${RESET_PASSWORD_PATH}?error=expired`);
    const why = refused.kind === "expired" ? "That link has expired or was already used. Request a new one." : refused.message;
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(why)}`);
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(await friendlyAuthError(error.message))}`);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${type === "recovery" ? RESET_PASSWORD_PATH : next}`);
    if (type === "recovery") return NextResponse.redirect(`${origin}${RESET_PASSWORD_PATH}?error=expired`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(await friendlyAuthError(error.message))}`);
  }

  // Nothing the server can read: a confirmation link of the implicit flow (both apps ask for it, so the link works in
  // any browser) carries its session, or Supabase's refusal, in the URL fragment, which never reaches the server. The
  // browser keeps the fragment through this redirect, and /email-confirmed reads it.
  return NextResponse.redirect(`${origin}/email-confirmed?next=${encodeURIComponent(next)}`);
}
