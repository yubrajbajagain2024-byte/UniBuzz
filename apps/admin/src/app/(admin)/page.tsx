import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BadgeCheck, Building2, CheckCircle2, EyeOff, Film, Flag, Megaphone, MessagesSquare, Scale, ShieldCheck, UserCog, Users, UserX } from "lucide-react";
import {
  getAutoHiddenCounts,
  getMediaJobStats,
  getOverviewStats,
  isMissingFunctionError,
  listAuditLog,
  listReports,
  listRestrictions,
  listStaff,
  STAFF_ROLES,
  type OverviewStats,
} from "@apartment-book/shared";
import { hasRole, requireStaff } from "@/lib/admin";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { PRODUCT_NAME } from "@/lib/brand";
import { fetchBusinessOpsOverview, fetchEventsCounts, fetchQueueCounts, hasBusinessRole, maybeDeployed } from "@/lib/console/server";
import { createClient } from "@/lib/supabase/server";
import { firstParam, plural } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { SetupNotice } from "@/components/ui/setup-notice";
import { AuditRow } from "@/components/audit/audit-list";
import { StatCard } from "@/components/overview/stat-card";
import { ReportRowSummary } from "@/components/reports/report-list";
import { PageHeader } from "@/components/shell/page-header";
import { RoleBadge } from "@/components/staff/role-badge";

export const metadata: Metadata = { title: "Dashboard" };

const cardLink = "inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const access = await requireStaff("/");
  const params = await searchParams;
  const denied = STAFF_ROLES.find((r) => r.value === firstParam(params.denied));
  const supabase = await createClient();

  // Migration 16 gives the counts in one call; without it the page still works from the older functions.
  let stats: OverviewStats | null = null;
  let needsMigration = false;
  try {
    stats = await getOverviewStats(supabase);
  } catch (error) {
    if (!isMissingFunctionError(error)) throw error;
    needsMigration = true;
  }
  // Content reports hid automatically and nobody reviewed yet (main's report auto-hide migration; null without it).
  const flaggedPending = await getAutoHiddenCounts(supabase).then(
    (c) => c.pending,
    (error: unknown) => {
      if (isMissingFunctionError(error)) return null;
      throw error;
    },
  );
  const admin = hasRole(access, "admin");
  const [user, profile, openReports, media, staff, recent, suspended, queue, events, business] = await Promise.all([
    getCurrentUser(),
    getCurrentProfile(),
    listReports(supabase, { status: "open", limit: 5 }),
    getMediaJobStats(supabase),
    listStaff(supabase),
    listAuditLog(supabase, { limit: 8 }),
    stats ? [] : listRestrictions(supabase, { activeOnly: true, limit: 200 }),
    // Trust & Safety's queue counts (appeals), the events console's (organizations, feeds) and, for admins who run
    // businesses, what waits under Business: each null where the database does not have the function.
    maybeDeployed(fetchQueueCounts()),
    maybeDeployed(fetchEventsCounts()),
    admin && (await hasBusinessRole()) ? maybeDeployed(fetchBusinessOpsOverview()) : Promise.resolve(null),
  ]);
  const staffWithoutFactor = staff.filter((m) => m.mfaEnrolled === false).length;

  // Alerts: something is wrong or at risk. Pending decisions: someone is waiting for the team.
  const alerts: { tone: "red" | "amber"; text: string; href: string }[] = [];
  if (media.failing > 0) alerts.push({ tone: "red", text: `${plural(media.failing, "media job")} failing`, href: "/support/issues" });
  if (events && events.feeds_failing > 0) alerts.push({ tone: "red", text: `${plural(events.feeds_failing, "calendar feed")} failing to sync`, href: "/support/issues" });
  if (staffWithoutFactor > 0) alerts.push({ tone: "amber", text: `${plural(staffWithoutFactor, "staff member")} without a second factor`, href: "/staff" });
  if (access.lastOwner) alerts.push({ tone: "amber", text: "You are the only owner", href: "/staff" });
  if (business && business.ads.oldestInReviewAt && business.generatedAt - business.ads.oldestInReviewAt > 48 * 3_600_000) alerts.push({ tone: "amber", text: "An ad has waited over 48 hours for review", href: "/business/campaigns" });
  const decisions: { count: number; label: string; href: string; icon: typeof Flag }[] = [
    { count: stats?.reportsOpen ?? openReports.length, label: "open reports", href: "/reports", icon: Flag },
    { count: flaggedPending ?? 0, label: "items hidden by reports, waiting for review", href: "/flagged", icon: EyeOff },
    { count: queue?.appeals ?? 0, label: "open appeals", href: "/appeals", icon: Scale },
    { count: events?.organizations_pending ?? 0, label: "organizations awaiting verification", href: "/support", icon: BadgeCheck },
    ...(business ? [{ count: business.businesses.pending, label: "businesses awaiting review", href: "/business/advertisers?status=pending", icon: Building2 }, { count: business.ads.inReview, label: "ads in review", href: "/business/campaigns", icon: Megaphone }] : []),
  ].filter((d) => d.count > 0);
  const name = profile?.full_name || user?.email?.split("@")[0] || "You";
  const myRole = STAFF_ROLES.find((r) => r.value === access.role);
  const reportsOpen = stats?.reportsOpen ?? openReports.length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Dashboard" description={`What needs attention on ${PRODUCT_NAME} right now: the numbers, what is wrong, and who is waiting for a decision. Everything here changes the same database the website and the app read.`} />
      {denied ? <FormMessage error={`That page needs the ${denied.label.toLowerCase()} role.`} /> : null}
      {needsMigration ? <SetupNotice migration="16" what="The overview counts, people browsing and the hidden-content list" /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open reports" value={reportsOpen} hint={stats ? `${stats.reportsClosed7d} closed in 7 days` : undefined} href="/reports" icon={Flag} tone={reportsOpen > 0 ? "amber" : "green"} />
        <StatCard label="Suspended accounts" value={stats?.suspendedActive ?? suspended.length} hint="active suspensions" href="/users?filter=suspended" icon={UserX} tone="red" />
        <StatCard
          label="Hidden content"
          value={stats?.hiddenContent ?? "–"}
          hint={flaggedPending ? `${plural(flaggedPending, "item")} hidden by reports, waiting for review` : "reversible, owner still sees it"}
          href={flaggedPending ? "/flagged" : "/content"}
          icon={EyeOff}
          tone={flaggedPending ? "red" : "amber"}
        />
        <StatCard label="Media queue" value={media.pending} hint={media.failing > 0 ? `${plural(media.failing, "job")} failing` : `${media.done} done`} href="/media" icon={Film} tone={media.failing > 0 ? "red" : "gray"} />
        <StatCard label="People" value={stats?.usersTotal ?? "–"} hint={stats ? `${stats.usersNew7d} new this week · ${stats.usersActive24h} active today` : undefined} href="/users" icon={Users} tone="brand" />
        <StatCard label="Listings" value={stats?.listingsTotal ?? "–"} hint="apartments, items and roommate posts" icon={Building2} />
        <StatCard label="Posts and Buzz" value={stats ? `${stats.postsTotal} · ${stats.buzzTotal}` : "–"} hint="posts and reels · Buzz threads" icon={MessagesSquare} />
        <StatCard label="Staff" value={staff.length} hint={STAFF_ROLES.map((r) => `${staff.filter((m) => m.role === r.value).length} ${r.label.toLowerCase()}`).join(" · ")} href="/staff" icon={UserCog} tone="brand" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
          </CardHeader>
          {alerts.length === 0 ? (
            <CardBody className="flex items-center gap-2 text-sm text-gray-600">
              <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
              Nothing is failing: media jobs, calendar feeds and staff second factors are all in order.
            </CardBody>
          ) : (
            <ul className="divide-y divide-gray-100">
              {alerts.map((a) => (
                <li key={a.text}>
                  <Link href={a.href} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-gray-50">
                    <AlertTriangle className={`h-4 w-4 shrink-0 ${a.tone === "red" ? "text-red-600" : "text-amber-600"}`} aria-hidden="true" />
                    <span className="flex-1 text-gray-900">{a.text}</span>
                    <ArrowRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pending decisions</CardTitle>
          </CardHeader>
          {decisions.length === 0 ? (
            <CardBody className="flex items-center gap-2 text-sm text-gray-600">
              <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
              Nobody is waiting for the team.
            </CardBody>
          ) : (
            <ul className="divide-y divide-gray-100">
              {decisions.map((d) => {
                const Icon = d.icon;
                return (
                  <li key={d.href}>
                    <Link href={d.href} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-gray-50">
                      <Icon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                      <span className="flex-1 text-gray-900">
                        <span className="font-semibold tabular-nums">{d.count}</span> {d.label}
                      </span>
                      <ArrowRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>Open reports</CardTitle>
              <Link href="/reports" className={cardLink}>
                All reports
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </CardHeader>
            {openReports.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-600">Nothing waiting. New reports from the website and the app show up here.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {openReports.map((report) => (
                  <ReportRowSummary key={report.id} report={report} />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>Recent activity</CardTitle>
              <Link href="/audit" className={cardLink}>
                Audit log
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </CardHeader>
            {recent.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-600">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {recent.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>You</CardTitle>
          </CardHeader>
          <CardBody className="flex items-start gap-4">
            <Avatar name={name} src={profile?.avatar_url ?? null} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-gray-900">{name}</p>
              {user?.email ? <p className="truncate text-sm text-gray-600">{user.email}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <RoleBadge role={access.role} />
                <Badge tone="green">
                  <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
                  Two-factor on
                </Badge>
              </div>
              {myRole ? <p className="mt-3 text-sm text-gray-600">{myRole.description}</p> : null}
              {access.lastOwner ? <p className="mt-2 text-sm text-amber-800">You are the only owner. Make someone else an owner before stepping back or deleting your account.</p> : null}
              <Link href="/security" className={`${cardLink} mt-3`}>
                Manage two-factor authentication
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
