import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Film, Rss } from "lucide-react";
import { listMediaJobs } from "@apartment-book/shared";
import { requireStaff, hasRole } from "@/lib/admin";
import { fetchEventFeeds, maybeDeployed } from "@/lib/console/server";
import { createClient } from "@/lib/supabase/server";
import { plural } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Time } from "@/components/common/time";
import { EmptyBox, Pill } from "@/components/console/parts";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";

export const metadata: Metadata = { title: "Issues" };

/**
 * Things that are broken for people right now and need a fix rather than a decision: media jobs that keep failing (a
 * photo or video that should be hidden, released or deleted and is not), and calendar feeds that fail to sync (a
 * campus whose events stop updating).
 */
export default async function IssuesPage() {
  const access = await requireStaff("/support/issues");
  const supabase = await createClient();
  const [jobs, feeds] = await Promise.all([listMediaJobs(supabase, { pendingOnly: true, limit: 200 }).catch(() => []), maybeDeployed(fetchEventFeeds())]);
  const failing = jobs.filter((j) => j.attempts > 0 && j.lastError);
  const brokenFeeds = (feeds ?? []).filter((f) => f.enabled && f.last_status === "error");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Issues" description="What is failing for people right now: media jobs that keep erroring and calendar feeds that no longer sync. Decisions (reports, appeals, verifications) are under Moderation and Requests." />
      <SectionTabs section="support" admin={hasRole(access, "admin")} />

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Failing media jobs</CardTitle>
          <Link href="/media" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
            Media jobs
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </CardHeader>
        {failing.length === 0 ? (
          <CardBody>
            <EmptyBox icon={CheckCircle2} title="No media job is failing." description={`${plural(jobs.length, "job")} waiting in the queue, none with an error.`} />
          </CardBody>
        ) : (
          <ul className="divide-y divide-gray-100">
            {failing.map((j) => (
              <li key={j.id} className="flex flex-col gap-1 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Film className="h-4 w-4 text-gray-500" aria-hidden="true" />
                  <span className="font-medium text-gray-900">{j.kind}</span>
                  <span className="truncate font-mono text-xs text-gray-600">{j.ref}</span>
                  <Pill tone="red">{plural(j.attempts, "attempt")}</Pill>
                  <span className="ml-auto text-xs text-gray-500">
                    next try <Time iso={j.nextAttemptAt} />
                  </span>
                </div>
                <p className="text-xs text-red-700">{j.lastError}</p>
                {j.targetType && j.targetId ? (
                  <Link href={`/content/${j.targetType}/${j.targetId}`} className="text-xs font-medium text-brand-600 hover:underline">
                    the content it belongs to
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Calendar feeds failing to sync</CardTitle>
          <Link href="/events" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
            Events
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </CardHeader>
        {feeds === null ? (
          <CardBody className="text-sm text-gray-600">This database does not have the events console yet.</CardBody>
        ) : brokenFeeds.length === 0 ? (
          <CardBody>
            <EmptyBox icon={CheckCircle2} title="Every enabled feed synced." description={`${plural(feeds.filter((f) => f.enabled).length, "feed")} enabled. Feeds are added and edited in the website's staff console.`} />
          </CardBody>
        ) : (
          <ul className="divide-y divide-gray-100">
            {brokenFeeds.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Rss className="h-4 w-4 text-gray-500" aria-hidden="true" />
                  <span className="font-medium text-gray-900">{f.name}</span>
                  <Pill tone="gray">{f.kind}</Pill>
                  <span className="text-xs text-gray-600">{f.university_name}</span>
                  <span className="ml-auto text-xs text-gray-500">
                    last tried <Time iso={f.last_synced_at} />
                  </span>
                </div>
                <p className="truncate font-mono text-xs text-gray-600">{f.url}</p>
                <p className="text-xs text-red-700">{f.last_error ?? "sync failed"}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
