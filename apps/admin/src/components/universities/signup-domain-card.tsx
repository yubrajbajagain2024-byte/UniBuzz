"use client";

import { useState, useTransition } from "react";
import { Lock, LockOpen } from "lucide-react";
import type { ConsoleUniversity } from "@/lib/console/ops-types";
import { setUniversityDomainAction } from "@/lib/console/staff-actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/console/parts";

/**
 * Who may sign up: the email domain that makes an account a verified student of this campus. Everyone who may open the
 * page sees it; only owners open or close it (migration 77 refuses everyone else). A domain confirmed accounts already
 * sign in with cannot be changed or closed here: their verified campus would vanish (the database says so).
 */
export function SignupDomainCard({ university, canEdit }: { university: ConsoleUniversity; canEdit: boolean }) {
  const [domain, setDomain] = useState("");
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();
  const open = university.emailDomain !== null;

  function submit(next: string | null) {
    setMessage({});
    start(async () => {
      const result = await setUniversityDomainAction({ id: university.id, domain: next ?? "" });
      if (result.ok) {
        setDomain("");
        setMessage({ success: next ? `Sign-up is open to @${next.replace(/^@/, "").trim().toLowerCase()}.` : "Sign-up is closed." });
      } else setMessage({ error: result.error });
    });
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle className="text-base">Sign-up</CardTitle>
        {open ? (
          <Pill tone="green">
            <LockOpen className="h-3 w-3" aria-hidden="true" /> Open to @{university.emailDomain}
          </Pill>
        ) : (
          <Pill tone="gray">
            <Lock className="h-3 w-3" aria-hidden="true" /> Closed
          </Pill>
        )}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <FormMessage error={message.error} success={message.success} />
        <p className="text-sm text-gray-600">
          {open
            ? `${university.verifiedStudents} confirmed account(s) sign in with @${university.emailDomain}: they are this campus's verified students.`
            : "Nobody can sign up for this campus yet. Students can still request it; opening sign-up is an owner's decision."}
        </p>
        {canEdit ? (
          <>
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (window.confirm(`Let anyone with an @${domain.replace(/^@/, "").trim().toLowerCase()} address sign up as a student of ${university.name}?`)) submit(domain);
              }}
            >
              <Field label={open ? "Change the domain" : "Open sign-up to a domain"} htmlFor="uniDomain" className="flex-1" hint="The part after @ in students' university email, e.g. txstate.edu.">
                <Input id="uniDomain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="university.edu" maxLength={253} autoComplete="off" required />
              </Field>
              <Button type="submit" loading={pending} disabled={!domain.trim()}>
                {open ? "Change" : "Open sign-up"}
              </Button>
            </form>
            {open ? (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Close sign-up for @${university.emailDomain}? New students could no longer join ${university.name}.`)) submit(null);
                  }}
                >
                  Close sign-up
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-gray-500">Only owners open or close sign-up for a domain.</p>
        )}
      </CardBody>
    </Card>
  );
}
