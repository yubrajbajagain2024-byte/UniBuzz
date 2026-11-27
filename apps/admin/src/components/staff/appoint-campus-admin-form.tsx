"use client";

import { useActionState } from "react";
import { School } from "lucide-react";
import { CAMPUS_ADMIN_ROLE } from "@apartment-book/shared";
import { appointCampusAdminAction } from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CampusPicker } from "./campus-picker";

/**
 * Appoint a campus admin with their campuses (owners only: the page shows this to owners, and migration 76 refuses
 * everyone else in SQL). Someone with a confirmed account joins at once; anyone else gets the usual invitation email,
 * which brings the campuses with it when it is claimed.
 */
export function AppointCampusAdminForm({ universities, emailsEnabled }: { universities: readonly { id: string; name: string }[]; emailsEnabled: boolean }) {
  const [state, action, pending] = useActionState(appointCampusAdminAction, null);
  const kept = state?.success ? [] : (state?.values?.universityIds ? String(state.values.universityIds).split(",") : []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Appoint a campus admin</CardTitle>
      </CardHeader>
      <form action={action} className="flex flex-col gap-4 px-5 py-4" key={state?.success ?? "form"}>
        <FormMessage error={state?.error} success={state?.success} />
        <p className="text-sm text-gray-600">{CAMPUS_ADMIN_ROLE.description}</p>
        <Field label="Email" htmlFor="campusAdminEmail" required error={state?.fieldErrors?.email}>
          <Input id="campusAdminEmail" name="email" type="email" required maxLength={320} autoComplete="off" placeholder="name@university.edu" defaultValue={state?.success ? "" : state?.values?.email} />
        </Field>
        <Field label="Campuses" htmlFor="campusAdminCampuses" required error={state?.fieldErrors?.universityIds} hint="They see and act on these campuses' students, content and calendar only.">
          <div id="campusAdminCampuses">
            <CampusPicker universities={universities} defaultSelected={kept} disabled={pending} />
          </div>
        </Field>
        <Button type="submit" loading={pending}>
          <School className="h-4 w-4" aria-hidden="true" />
          Appoint
        </Button>
        <p className="text-xs text-gray-500">
          {emailsEnabled
            ? "Someone with a confirmed account joins at once. Anyone else gets an invitation email for 7 days; they set a password and two-factor sign-in before they can do anything."
            : "Someone with a confirmed account joins at once. Anyone else is only saved as an invitation: this deployment cannot send email yet."}
        </p>
      </form>
    </Card>
  );
}
