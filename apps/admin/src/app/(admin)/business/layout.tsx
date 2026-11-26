import type { ReactNode } from "react";
import { Database, KeyRound } from "lucide-react";
import { fetchBusinessOpsOverview, hasBusinessRole, maybeDeployed, requireConsoleAdmin } from "@/lib/console/server";
import { EmptyBox } from "@/components/console/parts";
import { BusinessTabs } from "@/components/business/business-tabs";
import { PageHeader } from "@/components/shell/page-header";

/**
 * Business: the advertisers, their campaigns, payments, pricing, students' reports and the business audit log, for
 * owners and admins of the staff in a two-factor session, whom Business v2's own functions accept since migration 67
 * (admin_standing). Moderators and everyone else get the not-found page; each function checks the caller again.
 */
export default async function BusinessLayout({ children }: { children: ReactNode }) {
  await requireConsoleAdmin("/business");
  if (!(await hasBusinessRole())) {
    return (
      <EmptyBox
        icon={KeyRound}
        title="Business tools are not available to this account"
        description="The database does not count this account as an admin for businesses, ads and payments. Since migration 67 that means a staff owner or admin, not suspended, in a session that passed two-factor sign-in; on a database without 67, the admin role on the account (granted with grant_role())."
      />
    );
  }
  const overview = await maybeDeployed(fetchBusinessOpsOverview());
  if (!overview) {
    return (
      <EmptyBox
        icon={Database}
        title="Business needs migration 63"
        description="This database does not have the Business functions yet (20261115000000_console_business.sql, which needs Business v2's migrations before it). Until then the business portal's own admin pages are the way to review businesses and ads."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="console-business">
      <PageHeader title="Business" description="The advertisers, their campaigns, payments and pricing, students' reports and the business audit log." />
      <BusinessTabs counts={{ advertisers: overview.businesses.pendingConfirmed, campaigns: overview.ads.inReview, reports: overview.reports.open }} />
      {children}
    </div>
  );
}
