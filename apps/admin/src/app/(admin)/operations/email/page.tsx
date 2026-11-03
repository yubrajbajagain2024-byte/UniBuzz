import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { listStaffInvites } from "@apartment-book/shared";
import { hasRole, requireStaff } from "@/lib/admin";
import { invitationEmailsConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { plural } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyBox } from "@/components/console/parts";
import { InvitesList } from "@/components/staff/invites-list";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";

export const metadata: Metadata = { title: "Email" };

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-green-500" : "bg-amber-500"}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="block text-xs text-gray-600">{detail}</span>
      </span>
    </li>
  );
}

/**
 * Every email the platform sends goes through Supabase Auth: sign-up confirmations, password resets and the staff
 * invitations this app sends. This page shows whether this app can send invitations, and the invitations and how
 * their emails went (sent, failed, not sent), with a resend for admins. The Auth templates, the sender and the SMTP
 * settings live in the Supabase dashboard (scripts/configure-auth-email.mjs reports them).
 */
export default async function EmailPage() {
  const access = await requireStaff("/operations/email");
  const admin = hasRole(access, "admin");
  const emailsEnabled = invitationEmailsConfigured();
  const invites = admin ? await listStaffInvites(await createClient()).catch(() => []) : [];
  const failed = invites.filter((i) => i.emailStatus === "failed").length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Email" description="What this app sends and whether it can: staff invitations, through Supabase Auth. Sign-up confirmations and password resets are Auth's own, with the same sender." />
      <SectionTabs section="operations" admin={admin} />

      <Card>
        <CardHeader>
          <CardTitle>Sending</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-gray-100">
          <Check ok={emailsEnabled} label="Invitation emails" detail={emailsEnabled ? "The service-role key is set on the admin app: invitations go out by email with a server-verified link." : "Not configured: set SUPABASE_SERVICE_ROLE_KEY on the admin app. Until then an invitation is a role promised to an email address, and the person signs up on their own."} />
          <Check ok={failed === 0} label="Delivery" detail={failed === 0 ? "No invitation email has failed." : `${plural(failed, "invitation email")} failed; resend below once the cause is fixed.`} />
        </ul>
        <CardBody className="border-t border-gray-100 text-xs text-gray-500">
          The sender address, the templates, the rate limit and custom SMTP are Supabase Auth settings in the dashboard; the built-in service sends a few emails an hour, to members of the Supabase organization only. The owner checks them with the auth email script.
        </CardBody>
      </Card>

      {admin ? (
        invites.length === 0 ? (
          <EmptyBox icon={Mail} title="No outstanding invitations." description="Invite someone under Staff; their invitation and its email show up here." />
        ) : (
          <InvitesList invites={invites} me={access} emailsEnabled={emailsEnabled} />
        )
      ) : (
        <p className="text-sm text-gray-600">Invitations and their emails are managed by admins.</p>
      )}
    </div>
  );
}
