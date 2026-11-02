"use client";

import { useActionState, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { enterRecoverySession, PASSWORD_MAX, PASSWORD_MIN, recoveryFromUrl, RESET_LINK_EXPIRED } from "@apartment-book/shared";
import { updatePasswordAction } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** The page's address, read once on the client (the server has no fragment to read). */
const noop = () => () => {};
const useHref = () => useSyncExternalStore(noop, () => window.location.href, () => null);

/** Entering the session a link carried: not yet, done, or refused (the link was stale). */
type Entered = "pending" | "ready" | { refused: string };

/**
 * "Choose a new password", where a recovery link lands. The link's tokens are in the URL fragment, which never reaches
 * the server: this reads them (recoveryFromUrl), enters the session they carry and takes them off the address bar, then
 * the form sets the password through a server action, as every write on the site does. Someone already signed in (a
 * link the callback route exchanged, or a person who came from the site) sees the form at once; an expired or used
 * link, or the page opened by hand, is told how to get a link.
 */
export function ResetPasswordForm({ hasSession, initialError }: { hasSession: boolean; initialError?: string }) {
  const href = useHref();
  const found = useMemo(() => (initialError ? ({ kind: "expired" } as const) : recoveryFromUrl(href)), [href, initialError]);
  const [entered, setEntered] = useState<Entered>("pending");
  const [state, action, pending] = useActionState(updatePasswordAction, null);

  useEffect(() => {
    if (found.kind !== "session") return;
    let live = true;
    // The site's browser client (PKCE) leaves a fragment like this alone; the session is entered by hand.
    enterRecoverySession(createClient(), found).then(
      () => {
        window.history.replaceState(window.history.state, "", window.location.pathname);
        if (live) setEntered("ready");
      },
      (e: unknown) => live && setEntered({ refused: e instanceof Error ? e.message : RESET_LINK_EXPIRED }),
    );
    return () => {
      live = false;
    };
  }, [found]);

  if (state?.success) {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage success={state.success} />
        <p className="text-sm text-gray-600">You&apos;re logged in here. In the UniBuzz app, log in with your new password.</p>
        <Link href="/" className={buttonClasses({ size: "lg" })}>
          Continue to UniBuzz
        </Link>
      </div>
    );
  }
  // What the page can do: the session a link carried, once entered (the address is then read again, without the
  // tokens, so what was entered is remembered here rather than read from it), or one the server already had.
  const ready = entered === "ready" || (found.kind === "none" && hasSession);
  const checking = !ready && (href === null || (found.kind === "session" && entered === "pending"));
  if (checking) {
    return (
      <p className="text-center text-sm text-gray-600" role="status">
        Checking your link…
      </p>
    );
  }
  if (!ready) {
    const why =
      found.kind === "error" ? found.message : typeof entered === "object" ? entered.refused : found.kind === "none" ? "Open the link from your email to choose a new password. Need one?" : RESET_LINK_EXPIRED;
    return (
      <div className="flex flex-col gap-4">
        <FormMessage error={why} />
        <Link href="/forgot-password" className={buttonClasses({ size: "lg" })}>
          Request a new link
        </Link>
        <p className="text-center text-sm text-gray-600">
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage error={state?.error} />
      <Field label="New password" htmlFor="password" error={state?.fieldErrors?.password} hint={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoFocus />
      </Field>
      <Field label="Type it again" htmlFor="confirm" error={state?.fieldErrors?.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />
      </Field>
      <Button type="submit" size="lg" loading={pending}>
        Save new password
      </Button>
    </form>
  );
}
