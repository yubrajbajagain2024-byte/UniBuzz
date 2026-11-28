import type { Client } from "../types/models";
import { authErrorMessage, RESET_LINK_EXPIRED, type RecoveryLanding } from "../auth";

/*
 * Password recovery through Supabase Auth (see ../auth.ts for how the pieces fit). Every error comes back in the
 * person's words (authErrorMessage), never as Supabase's own.
 */

/**
 * Asks Supabase to email a recovery link that lands on `redirectTo` (resetPasswordUrl). Supabase answers the same for
 * an unknown email as for a known one, so nothing here learns whether an account exists. The client must use the
 * implicit flow (the app's does; the website makes one for this call), or the link works only in the browser that asked.
 */
export async function requestPasswordReset(supabase: Client, email: string, redirectTo: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw new Error(authErrorMessage(error.message));
}

/**
 * Asks Supabase to send a new sign-up confirmation link to `email`, landing on `redirectTo` (the same callback sign-up
 * uses). Supabase answers alike whether or not an unconfirmed account exists for it, so the apps always say
 * CONFIRMATION_RESENT and never learn which; it sends nothing for an unknown or already-confirmed address and refuses a
 * repeat within a minute ("For security purposes…", in the person's words). No account is created here: only sign-up
 * creates one, through the university email-domain trigger.
 */
export async function resendSignupConfirmation(supabase: Client, email: string, redirectTo: string): Promise<void> {
  const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } });
  if (error) throw new Error(authErrorMessage(error.message));
}

/** Enters the session a recovery link carried, so the new password can be set. A refused session means the link is stale. */
export async function enterRecoverySession(supabase: Client, landing: Extract<RecoveryLanding, { kind: "session" }>): Promise<void> {
  const { error } = await supabase.auth.setSession({ access_token: landing.accessToken, refresh_token: landing.refreshToken });
  if (error) throw new Error(RESET_LINK_EXPIRED);
}

/** Sets the signed-in person's password (after a recovery link, or from Settings). Supabase refuses the old one again. */
export async function setNewPassword(supabase: Client, password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(authErrorMessage(error.message));
}
