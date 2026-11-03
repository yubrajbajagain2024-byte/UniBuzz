/*
 * Signing in and password recovery, beyond the screens: what a recovery link brings when it lands (its tokens, or why
 * it failed), the words the apps say for Supabase Auth's answers, and the texts both apps share. Tested offline
 * (tests/auth.test.mjs).
 *
 * How recovery works here: "Forgot password?" on the website or in the app asks Supabase for a recovery email. Its link
 * goes through Supabase, which checks the token and sends the browser on to the website's /reset-password page with a
 * short-lived session in the URL fragment (`#access_token=…&refresh_token=…&type=recovery`), or with an error there
 * when the link has expired or was used already. The page reads the fragment (recoveryFromUrl), enters the session and
 * lets the person choose a new password. Both apps ask for that kind of link (the "implicit" flow) on purpose: the
 * other kind (PKCE) is bound to the browser that asked, so a student who asked on a laptop could not open the email
 * on their phone. The app's own reset-password screen reads the same URL shape, for a link that opens the app.
 */

/** The address a recovery link lands on, on the website. */
export const RESET_PASSWORD_PATH = "/reset-password";
export function resetPasswordUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, "")}${RESET_PASSWORD_PATH}`;
}

/** A new password: at least 8 characters (the sign-up rule), at most 72 (bcrypt's limit). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/** Said after a reset is asked for, whether or not an account exists: the email never gives that away. */
export const RESET_REQUESTED = "If there's an account for that email, we've sent it a link to choose a new password. Check your inbox, and the spam folder.";
/** A link is good for an hour and for one use (Supabase's "email OTP expiry"). */
export const RESET_LINK_EXPIRED = "This link has expired or was already used. Request a new one and open it within an hour.";
export const PASSWORD_CHANGED = "Your password is changed.";

/**
 * Supabase Auth's answers in the person's words. Never says whether an account exists: "Invalid login credentials" is
 * what Supabase answers for a wrong password and for an unknown email alike, and the words here keep it that way.
 */
export function authErrorMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match. Check them, or reset your password.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first: open the link we sent when you signed up, then log in.";
  if (/rate limit|too many requests|security purposes/i.test(message)) return "Too many tries in a row. Wait a few minutes, then try again.";
  // A suspension from CampConnect Admin sets auth.users.banned_until (its migration 15, live), and Supabase Auth refuses
  // the sign-in with "User is banned": say what it means instead of echoing that.
  if (/banned/i.test(message)) return "This account is suspended. Check the notice in your profile or contact support.";
  if (/different from the old password/i.test(message)) return "Choose a password you haven't used before.";
  if (/auth session missing|session.*(expired|missing)|not authenticated|invalid.*token/i.test(message)) return RESET_LINK_EXPIRED;
  return message;
}

/**
 * What a recovery link brought the page or the app to: a session to enter (the tokens Supabase put in the URL), an
 * expired or used link, another error Supabase named, or nothing about recovery at all (the page was opened by hand).
 */
export type RecoveryLanding = { kind: "session"; accessToken: string; refreshToken: string; type: string } | { kind: "expired" } | { kind: "error"; message: string } | { kind: "none" };

/** The URL's query and fragment together, the fragment winning (Supabase writes the tokens and the errors there). */
function paramsOf(url: string): URLSearchParams {
  const hashAt = url.indexOf("#");
  const fragment = hashAt >= 0 ? url.slice(hashAt + 1) : "";
  const head = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = head.indexOf("?");
  const merged = new URLSearchParams(queryAt >= 0 ? head.slice(queryAt + 1) : "");
  for (const [key, value] of new URLSearchParams(fragment)) merged.set(key, value);
  return merged;
}

export function recoveryFromUrl(url: string | null | undefined): RecoveryLanding {
  if (!url) return { kind: "none" };
  const p = paramsOf(url);
  const code = p.get("error_code");
  const error = p.get("error");
  const description = p.get("error_description") ?? "";
  if (code || error || description) {
    // Supabase sends `error=access_denied&error_code=otp_expired` for a link past its hour or used already.
    if (code === "otp_expired" || error === "access_denied" || /expired|invalid/i.test(description)) return { kind: "expired" };
    return { kind: "error", message: description || "That link didn't work. Request a new one." };
  }
  const accessToken = p.get("access_token");
  const refreshToken = p.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "session", accessToken, refreshToken, type: p.get("type") ?? "recovery" };
  return { kind: "none" };
}
