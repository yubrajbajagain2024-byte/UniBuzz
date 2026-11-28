# fix/signup-confirmation-email

- **Owner:** Sunil. **As of 2026-11-27:** branched from `main` at `7b73861`. Written by an AI session. No migration.
- **Purpose:** new students could not register: sign-up answered "Error sending confirmation email" (2026-11-27, every
  attempt from 18:51 UTC, all from the iOS app).

## The cause (production, read-only, 2026-11-27)

- Production's Auth sends email through **custom SMTP on Gmail** (`smtp.gmail.com:465`, a personal `@gmail.com`
  sender, "Unibuzz"; confirm email on, 30 emails an hour, links valid an hour, no send-email hook). Auth's logs: every
  failed sign-up got `535 5.7.8 Username and Password not accepted … BadCredentials - gsmtp`. Gmail no longer accepts
  the stored password: Gmail's SMTP takes only an **app password**, which Google revokes when the account's password
  changes, its 2-Step Verification is reset, or it flags the account. Not code, not a migration: sign-up's code had not
  changed since 2026-11-02 and 72 to 78 touch no account; the email-domain trigger answers with a different error.
- **No incomplete or duplicate accounts:** Supabase rolls a sign-up back when its email fails. The 7 failed attempts
  left no `auth.users` row and no profile; no unconfirmed account and no duplicate address on production. Those
  students can simply sign up again once email works.
- The confirmation template (`{{ .ConfirmationURL }}` only) and the redirect allow-list are fine; the website's host is
  the site URL, so its callback is always allowed.
- Staging sends with Supabase's built-in sender (two emails an hour, only to members of the Supabase organization).

## What this branch changes

- **Plain words for email failures** (`packages/shared/src/auth.ts`): `EMAIL_NOT_SENT` for a delivery failure ("Error
  sending … email", an address the built-in sender will not deliver to), `EMAIL_LIMIT_REACHED` for the project's hourly
  email limit (it said "Too many tries", blaming the student), `EMAIL_NOT_CONFIRMED`, `CONFIRMATION_RESENT`. The app's
  sign-up showed Supabase's raw text for every error; it goes through `authErrorMessage` now.
- **A new confirmation link** (`resendSignupConfirmation` in `packages/shared/src/queries/auth.ts`): "Send a new link"
  after signing up and when logging in is refused until the email is confirmed, on the website
  (`resendConfirmationAction`) and in the app. It creates nothing and never says whether an account is waiting;
  Supabase sends one email a minute per account.
- **Confirmation links work in any browser**: the website's sign-up and new links use the implicit flow, as password
  recovery already did (`createEmailLinkClient`, `apps/web/src/lib/supabase/recovery.ts`), so a link opened on a phone
  works for a student who signed up on a laptop. A link's session arrives in the URL fragment, which the callback
  route cannot read: it now sends the browser on to **`/email-confirmed`**, which signs the student in on that browser,
  takes the tokens off the address bar and goes on (an expired or used link says what to do). Before this, a link from
  the app (which always asked for this kind of link) ended on the website's "Invalid sign-in link" though the email was
  confirmed.
- Strict university verification is unchanged: only sign-up creates an account, through the `auth.users` email-domain
  trigger; a new link for any other address sends nothing.

## Tests (2026-11-27, staging)

- New `supabase/tests/staging/auth-email.mjs` **11/11** with real emails: staging's Auth SMTP pointed for the run at a
  throwaway Ethereal mailbox (`supabase/tests/staging/mailbox.mjs`, read back over HTTPS), then put back. A refused SMTP
  login reproduces the failure (500 "Error sending confirmation email", `EMAIL_NOT_SENT`, no account left); with a
  working SMTP: one unconfirmed account and its email; login refused until confirmed; no second account on signing up
  again; a new link refused within the minute, then sent; the older link spent, the newest confirming; login; the
  confirmed address making no account and no email; a non-university address refused by the trigger with nothing sent;
  password recovery by email.
- New `apps/web/e2e/signup-email.mjs` **6/6** in Chrome against the website on staging (port 3010, staging's site URL):
  sign-up; the email's link opened in another browser, signed in there; login before confirming offering a new link,
  refused at once and sent a minute later, the newest link signing in; the older link spent; a link as the app asks
  for it signing in on the website; a non-university address refused.
- The app on the iOS Simulator (iPhone 16e, Expo Go, Metro against staging): the failing SMTP shows "We couldn't send
  the email just now…" with no account left; with email working, "Check your email" with **Send a new link** (refused
  within the minute, then sent); login before confirming shows **Send a new confirmation link**; the newest link opened
  in the Simulator's Safari confirmed the email and signed in on the website; the app then logged in (a fresh session).
  The app's web build could not be used: it stops on an iOS-only accessibility call React Native Web lacks (existing).
- Existing suites updated and passing: `apps/web/e2e/password-recovery.mjs` 9/9 and
  `supabase/tests/staging/auth-recovery.mjs` 14/14. Both confirmed through a magic link, after which Supabase now
  **discards the sign-up password** of an unconfirmed account (its guard against pre-registered addresses), so their
  password login failed: they confirm through a sign-up link, as the email does. Both also know the new limit wording.
- `npm run check` (9 tasks), `test:shared` 321/321.
- Staging afterwards: built-in sender again, every test account deleted.

## Production (each step waits on the owner)

1. **Restore email now:** a new Google app password for the Gmail sender (Google account → Security → 2-Step
   Verification on → App passwords), entered in Supabase → Authentication → Emails → SMTP Settings → Password (by the
   owner in the dashboard, so it never passes through a session). Then one real sign-up with a university address.
2. **Then move off Gmail** (recommended): a transactional provider on a domain UniBuzz owns, for example **Resend**
   (free: 3,000 emails a month, 100 a day; SPF and DKIM on the domain; sender such as `no-reply@<domain>`) or Postmark.
   Gmail allows about 500 emails a day, stops whenever the app password is revoked, and a personal address as sender
   is more likely to be filtered by the university's mail system. Resend cannot send from a domain it has not verified,
   so it needs a domain first.
3. Merge this branch's PR (it deploys the website: `/email-confirmed`, sign-up's any-browser links), and publish the
   app's part with an EAS update to builds with a matching fingerprint.
