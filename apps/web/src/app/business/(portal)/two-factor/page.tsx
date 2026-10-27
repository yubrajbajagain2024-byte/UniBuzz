import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getAdminStanding } from "@apartment-book/shared";
import { PORTAL_TWO_FACTOR_PATH, portalPath, requirePortalSession } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { StaffTwoFactor } from "@/components/staff/two-factor";

export const metadata: Metadata = { title: "Two-factor sign-in" };

/**
 * Before the admin screens open for a staff admin whose session has not passed two-factor sign-in on this host: a code
 * from their authenticator app, or adding one (the same account and app as CampConnect Admin). An admin who already
 * passed goes on to the screens; everyone else gets "not found", like requireAdmin().
 */
export default async function PortalTwoFactorPage() {
  const session = await requirePortalSession(PORTAL_TWO_FACTOR_PATH);
  const standing = session.role === "admin" ? await getAdminStanding(await createClient(), session.role) : null;
  const adminPath = await portalPath("/admin");
  if (standing === "admin") redirect(adminPath);
  if (standing !== "mfa_required") notFound();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4" data-testid="portal-two-factor">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold leading-tight text-gray-900">Two-factor sign-in</h1>
      </header>
      <StaffTwoFactor doneHref={adminPath} subject="Reviewing businesses" />
    </div>
  );
}
