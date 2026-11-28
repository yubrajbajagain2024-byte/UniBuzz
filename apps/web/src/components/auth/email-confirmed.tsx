"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { recoveryFromUrl, RESET_PASSWORD_PATH } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { buttonClasses } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";

/** The page's address, read once on the client (the server has no fragment to read). */
const noop = () => () => {};
const useHref = () => useSyncExternalStore(noop, () => window.location.href, () => null);

type Outcome = "pending" | "signed-in" | "confirmed" | { error: string };

/**
 * Where a confirmation link lands (sign-up, or a new link): its session is in the URL fragment (the implicit flow both
 * apps ask for, so the link works in any browser, including a phone's when the student signed up on a laptop or in the
 * app). Supabase has confirmed the email before sending the browser here; this signs the student in on this browser,
 * takes the tokens off the address bar and goes on to `next`. A refused link (expired, or used already) says how to get
 * a new one; a recovery link that lands here by mistake goes on to /reset-password with its fragment.
 */
export function EmailConfirmed({ next }: { next: string }) {
  const href = useHref();
  const router = useRouter();
  const found = useMemo(() => recoveryFromUrl(href), [href]);
  const [outcome, setOutcome] = useState<Outcome>("pending");

  useEffect(() => {
    if (found.kind !== "session") return;
    if (found.type === "recovery") {
      window.location.replace(`${RESET_PASSWORD_PATH}${window.location.hash}`);
      return;
    }
    let live = true;
    createClient()
      .auth.setSession({ access_token: found.accessToken, refresh_token: found.refreshToken })
      .then(({ error }) => {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
        if (!live) return;
        if (error) {
          // The email is confirmed all the same (Supabase did that before the redirect): logging in works.
          setOutcome("confirmed");
          return;
        }
        setOutcome("signed-in");
        router.replace(next);
        router.refresh();
      });
    return () => {
      live = false;
    };
  }, [found, next, router]);

  const login = (
    <Link href={`/login?next=${encodeURIComponent(next)}`} className={buttonClasses({ size: "lg" })}>
      Log in
    </Link>
  );

  if (href === null || (found.kind === "session" && outcome === "pending") || outcome === "signed-in") {
    return <p className="text-center text-sm text-gray-600" role="status">Confirming your email…</p>;
  }
  if (outcome === "confirmed") {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage success="Your email is confirmed. Log in to continue." />
        {login}
      </div>
    );
  }
  if (found.kind === "expired" || found.kind === "error") {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage error={found.kind === "expired" ? "This confirmation link has expired or was already used. If you have confirmed already, just log in; otherwise log in to get a new link." : found.message} />
        {login}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <FormMessage error="This page needs the link from your confirmation email. Open the newest one, or log in to get a new link." />
      {login}
    </div>
  );
}
