import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarDays, EyeOff, Flag, Scale, UserX } from "lucide-react";
import { getAutoHiddenCounts, isMissingFunctionError, listReports, listRestrictions } from "@apartment-book/shared";
import { getMyCampuses, requireStaff } from "@/lib/admin";
import { fetchAppeals, fetchEventsCounts } from "@/lib/console/server";
import { createClient } from "@/lib/supabase/server";
import { plural } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportRowSummary } from "@/components/reports/report-list";
import { PageHeader } from "@/components/shell/page-header";
import { StatCard } from "./stat-card";

/** A count from a scoped function, or null where its migration is not live yet (the card then says so). */
async function countOrNull(work: () => Promise<number>): Promise<number | null> {
  try {
    return await work();
  } catch (error) {
    if (isMissingFunctionError(error) || /not_found|Not allowed|PGRST202/i.test(String((error as Error)?.message ?? error))) return null;
    throw error;
  }
}

/**
 * A campus admin's overview (the "My campus" section, permission campus.overview, migration 76): what needs them on
 * their own campuses. Every number comes from a function SQL scopes to the caller's campuses (migrations 73 to 75), so
 * nothing here can show another campus's students, content or calendar; a function not yet live shows a dash.
 */
export async function CampusOverview() {
  await requireStaff("/", { permission: "campus.overview" });
  const supabase = await createClient();
  const [campuses, openReports, flagsPending, appealsOpen, events, suspended] = await Promise.all([
    getMyCampuses(),
    listReports(supabase, { status: "open", limit: 200 }).catch((error: unknown) => {
      // Not live yet, or (no campus assigned) refused: the card shows a dash rather than failing the page.
      if (isMissingFunctionError(error) || /Not allowed|not_found/i.test(String((error as Error)?.message ?? error))) return null;
      throw error;
    }),
    countOrNull(async () => (await getAutoHiddenCounts(supabase)).pending),
    countOrNull(async () => (await fetchAppeals("open", 0, 100)).items.length),
    fetchEventsCounts().catch(() => null),
    countOrNull(async () => (await listRestrictions(supabase, { activeOnly: true, limit: 200 })).length),
  ]);
  const names = campuses.map((c) => c.name);
  const show = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My campus"
        description={names.length ? `You act for ${names.join(", ")}: only these campuses' students, content and calendar.` : "No campus is assigned to you yet. Ask an owner to add one."}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Open reports" value={show(openReports?.length)} hint="About your campus's students" href="/reports" icon={Flag} tone={openReports?.length ? "amber" : "gray"} />
        <StatCard label="Hidden by reports" value={show(flagsPending)} hint="Waiting for a review" href="/flagged" icon={EyeOff} tone={flagsPending ? "amber" : "gray"} />
        <StatCard label="Open appeals" value={show(appealsOpen)} hint="Suspensions and bans go to admins" href="/appeals" icon={Scale} tone={appealsOpen ? "amber" : "gray"} />
        <StatCard label="Organizations to verify" value={show(events?.organizations_pending)} hint="On your campus calendar" href="/events" icon={BadgeCheck} tone={events?.organizations_pending ? "brand" : "gray"} />
        <StatCard label="Upcoming events" value={show(events?.events_upcoming)} hint="Scheduled on your calendar" href="/events" icon={CalendarDays} />
        <StatCard label="Suspended students" value={show(suspended)} hint="Your campus's, now" href="/users?filter=suspended" icon={UserX} tone={suspended ? "red" : "gray"} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Latest open reports</CardTitle>
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            All reports <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </CardHeader>
        <CardBody className="p-0">
          {openReports && openReports.length ? (
            <ul className="divide-y divide-gray-100">
              {openReports.slice(0, 5).map((r) => (
                <ReportRowSummary key={r.id} report={r} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-gray-500 sm:px-5">{openReports ? "Nothing open on your campuses." : "Reports are not available yet."}</p>
          )}
          {openReports && openReports.length > 5 ? <p className="px-4 pb-4 text-xs text-gray-500 sm:px-5">{plural(openReports.length - 5, "more report")} in Reports.</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}
