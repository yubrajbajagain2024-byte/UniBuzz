// Unit tests for password recovery and sign-in's words (src/auth.ts, src/schemas: newPasswordSchema and
// resetRequestSchema), offline: what a recovery link brings when it lands, in its fragment or its query, on the website
// or as a deep link into the app; Supabase's answers in the person's words, never saying whether an account exists;
// the rules for a new password. Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The sources import their siblings without an extension, as the bundlers resolve them; this hook adds it (as in media.test.mjs).
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) {
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const A = await import("../src/auth.ts");
const S = await import("../src/schemas/index.ts");
const TOKENS = "access_token=eyJhbGciOi.payload.sig&expires_at=1800000000&expires_in=3600&refresh_token=abc123&token_type=bearer&type=recovery";

test("recoveryFromUrl: the session Supabase put in the fragment, on the website and in a deep link into the app", () => {
  const web = A.recoveryFromUrl(`https://unibuzz.example/reset-password#${TOKENS}`);
  assert.deepEqual(web, { kind: "session", accessToken: "eyJhbGciOi.payload.sig", refreshToken: "abc123", type: "recovery" });
  assert.equal(A.recoveryFromUrl(`apartmentbook://reset-password#${TOKENS}`).kind, "session");
  assert.equal(A.recoveryFromUrl(`exp://192.168.1.50:8082/--/reset-password#${TOKENS}`).kind, "session", "an Expo Go link");
  // Tokens in the query (a link made by hand) read the same; the fragment wins when both carry something.
  assert.equal(A.recoveryFromUrl(`apartmentbook://reset-password?${TOKENS}`).kind, "session");
  const both = A.recoveryFromUrl(`https://unibuzz.example/reset-password?refresh_token=old#${TOKENS}`);
  assert.equal(both.kind === "session" && both.refreshToken, "abc123");
});

test("recoveryFromUrl: an expired or used link, in the fragment or the query, and other errors by their words", () => {
  const expired = "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
  assert.deepEqual(A.recoveryFromUrl(`https://unibuzz.example/reset-password#${expired}`), { kind: "expired" });
  assert.deepEqual(A.recoveryFromUrl(`https://unibuzz.example/reset-password?${expired}`), { kind: "expired" });
  assert.deepEqual(A.recoveryFromUrl("https://unibuzz.example/reset-password#error=access_denied"), { kind: "expired" });
  assert.deepEqual(A.recoveryFromUrl("https://unibuzz.example/reset-password#error=server_error&error_code=unexpected_failure&error_description=Something+broke"), { kind: "error", message: "Something broke" });
  assert.equal(A.recoveryFromUrl("https://unibuzz.example/reset-password#error=server_error").kind, "error");
});

test("recoveryFromUrl: nothing about recovery in the URL, or no URL at all", () => {
  assert.deepEqual(A.recoveryFromUrl("https://unibuzz.example/reset-password"), { kind: "none" });
  assert.deepEqual(A.recoveryFromUrl("https://unibuzz.example/reset-password#access_token=only"), { kind: "none" }, "half a session is none");
  assert.deepEqual(A.recoveryFromUrl(null), { kind: "none" });
  assert.deepEqual(A.recoveryFromUrl(""), { kind: "none" });
});

test("authErrorMessage: Supabase's answers in the person's words, never telling whether an account exists", () => {
  const wrong = A.authErrorMessage("Invalid login credentials");
  assert.match(wrong, /don't match/);
  assert.doesNotMatch(wrong, /no account|not found|exist/i);
  assert.match(A.authErrorMessage("Email not confirmed"), /Confirm your email/);
  assert.match(A.authErrorMessage("For security purposes, you can only request this after 56 seconds."), /Too many tries/);
  assert.match(A.authErrorMessage("email rate limit exceeded"), /Too many tries/);
  assert.match(A.authErrorMessage("New password should be different from the old password."), /haven't used before/);
  assert.equal(A.authErrorMessage("Auth session missing!"), A.RESET_LINK_EXPIRED);
  assert.equal(A.authErrorMessage("Network request failed"), "Network request failed", "anything else is passed on");
});

test("resetPasswordUrl and the shared texts", () => {
  assert.equal(A.resetPasswordUrl("https://unibuzz.example/"), "https://unibuzz.example/reset-password");
  assert.equal(A.resetPasswordUrl("http://localhost:3061"), "http://localhost:3061/reset-password");
  assert.match(A.RESET_REQUESTED, /^If there's an account/);
  assert.doesNotMatch(A.RESET_REQUESTED, /no account/i);
});

test("newPasswordSchema: at least 8 characters, typed twice the same; resetRequestSchema tidies the email", () => {
  assert.equal(S.newPasswordSchema.safeParse({ password: "short", confirm: "short" }).success, false);
  const mismatch = S.newPasswordSchema.safeParse({ password: "longenough1", confirm: "longenough2" });
  assert.equal(mismatch.success, false);
  assert.deepEqual(mismatch.error.issues[0].path, ["confirm"]);
  assert.match(mismatch.error.issues[0].message, /don't match/);
  assert.equal(S.newPasswordSchema.safeParse({ password: "longenough1", confirm: "longenough1" }).success, true);
  assert.equal(S.newPasswordSchema.safeParse({ password: "x".repeat(73), confirm: "x".repeat(73) }).success, false, "bcrypt's 72");
  assert.deepEqual(S.resetRequestSchema.parse({ email: "  MAYA.T@TxState.edu " }), { email: "maya.t@txstate.edu" }, "tidied before it is checked: iOS adds a space after an address");
  assert.deepEqual(S.signInSchema.parse({ email: "Maya.T@txstate.edu ", password: "x" }), { email: "maya.t@txstate.edu", password: "x" });
  assert.equal(S.createSignUpSchema(["txstate.edu"]).safeParse({ fullName: "Ann Author", email: "ann@txstate.edu ", password: "longenough1" }).success, true);
  assert.equal(S.resetRequestSchema.safeParse({ email: "not an email" }).success, false);
});
