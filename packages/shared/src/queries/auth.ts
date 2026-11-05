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
