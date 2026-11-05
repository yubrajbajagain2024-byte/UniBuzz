import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Building2, Inbox, Scale } from "lucide-react";
import { requireStaff, hasRole } from "@/lib/admin";
import { fetchBusinessOpsOverview, fetchConsoleOrganizations, fetchQueueCounts, hasBusinessRole, maybeDeployed } from "@/lib/console/server";
import { plural } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupNotice } from "@/components/ui/setup-notice";
import { Time } from "@/components/common/time";
import { EmptyBox, Pill } from "@/components/console/parts";
import { StatCard } from "@/components/overview/stat-card";
import { OrganizationReview } from "@/components/support/organization-review";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";

export const metadata: Metadata = { title: "Support" };

/**
 * What people are waiting on the team for: organizations asking to be verified (their events stay pending until
 * then), businesses asking to be reviewed (admins, under Business), and appeals (Moderation). There is no ticket
 * system: a student reaches the team through reports and appeals, a business through its application and its ads.
 */
export default async function SupportPage() {
  const access = await requireStaff("/support");
  const admin = hasRole(access, "admin");
  const [organizations, counts, business] = await Promise.all([
    maybeDeployed(fetchConsoleOrganizations({ verified: false, status: "active" })),
    maybeDeployed(fetchQueueCounts()),
    admin && (await hasBusinessRole()) ? maybeDeployed(fetchBusinessOpsOverview()) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Support" description="Requests waiting on the team. Organizations are verified here; businesses under Business; appeals under Moderation." />
      <SectionTabs section="support" admin={admin} counts={{ "/support": organizations?.length ?? null, "/appeals": counts?.appeals ?? null }} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Organizations awaiting verification" value={organizations?.length ?? "–"} hint="their events stay pending until then" icon={BadgeCheck} tone={organizations?.length ? "amber" : "green"} />
        <StatCard label="Open appeals" value={counts?.appeals ?? "–"} hint="against sanctions" href="/appeals" icon={Scale} tone={counts?.appeals ? "amber" : "green"} />
        {business ? (
          <StatCard label="Businesses awaiting review" value={business.businesses.pending} hint={`${plural(business.ads.inReview, "ad")} in review`} href="/business/advertisers?status=pending" icon={Building2} tone={business.businesses.pending ? "amber" : "green"} />
        ) : (
          <StatCard label="Businesses awaiting review" value="–" hint={admin ? "needs the UniBuzz admin role on your account" : "admins only"} icon={Building2} />
        )}
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Organizations asking to be verified</CardTitle>
          <Link href="/events" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
            Events
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </CardHeader>
        {organizations === null ? (
          <CardBody>
            <SetupNotice migration="20261113000000_events" what="Organizations" />
          </CardBody>
        ) : organizations.length === 0 ? (
          <CardBody>
            <EmptyBox icon={Inbox} title="No organization is waiting." description="A student who creates an organization in the app lands here until a staff member verifies it." />
          </CardBody>
        ) : (
          <ul className="divide-y divide-gray-100">
            {organizations.map((o) => (
              <li key={o.id} className="flex flex-col gap-2 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{o.name}</span>
                  <Pill tone="amber">unverified</Pill>
                  <Pill tone="gray">{o.kind}</Pill>
                  <span className="ml-auto text-xs text-gray-500">
                    asked <Time iso={o.created_at} />
                  </span>
                </div>
                {o.description ? <p className="text-sm text-gray-700">{o.description}</p> : null}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
                  <span>{o.university_name}</span>
                  {o.creator_username ? <span>created by @{o.creator_username}</span> : null}
                  <span>{plural(o.members, "member")}</span>
                  <span>{plural(o.events, "event")} pending</span>
                  {o.website ? (
                    <a href={o.website} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                      website
                    </a>
                  ) : null}
                </div>
                <OrganizationReview id={o.id} verified={o.verified} status={o.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
