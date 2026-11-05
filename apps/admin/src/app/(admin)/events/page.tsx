import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { requireStaff } from "@/lib/admin";
import { fetchConsoleEvents, fetchEventsCounts, maybeDeployed } from "@/lib/console/server";
import { cn, firstParam } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SetupNotice } from "@/components/ui/setup-notice";
import { EventsConsoleList } from "@/components/content/events-console-list";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";

export const metadata: Metadata = { title: "Events" };

const STATUSES = [
  { value: "", label: "Upcoming" },
  { value: "pending", label: "Pending" },
  { value: "scheduled", label: "Scheduled" },
  { value: "cancelled", label: "Cancelled" },
  { value: "hidden", label: "Hidden" },
  { value: "past", label: "Past" },
] as const;
const PAGE = 50;

/** The campus calendar (migration 61): every event from the feeds and the organizations, to hide, cancel or restore. */
export default async function EventsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const access = await requireStaff("/events");
  const params = await searchParams;
  const raw = firstParam(params.status) ?? "";
  const status = STATUSES.some((s) => s.value === raw) ? raw : "";
  const q = (firstParam(params.q) ?? "").trim().slice(0, 100);
  const page = Math.max(0, Math.floor(Number(firstParam(params.page)) || 0));
  const filter = { q: q || undefined, offset: page * PAGE, limit: PAGE, status: status && status !== "past" ? status : undefined, upcoming: status !== "past" };
  const [counts, list] = await Promise.all([maybeDeployed(fetchEventsCounts()), maybeDeployed(fetchConsoleEvents(filter))]);
  const href = (s: string, p = 0) => `/events?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(q ? { q } : {}), ...(p ? { page: String(p) } : {}) }).toString()}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Events"
        description="The campus calendar: events from the university's feeds and from verified organizations. Hiding an event keeps it out of the app even after the next feed sync; organizations awaiting verification are under Support."
      />
      <SectionTabs section="content" admin={access.role !== "moderator"} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Event status" className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <Link
              key={s.value}
              href={href(s.value)}
              prefetch={false}
              aria-current={s.value === status ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm font-medium ring-1 ring-inset",
                s.value === status ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50",
              )}
            >
              {s.label}
              {s.value === "" && counts ? <span className="tabular-nums opacity-70">· {counts.events_upcoming}</span> : null}
            </Link>
          ))}
        </nav>
        <form action="/events" className="flex gap-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <Input name="q" defaultValue={q} placeholder="Search titles" aria-label="Search events" className="h-9 w-56" />
          <Button type="submit" variant="outline" size="sm" aria-label="Search">
            <Search className="h-4 w-4" aria-hidden="true" />
          </Button>
        </form>
      </div>
      {list === null ? <SetupNotice migration="20261113000000_events" what="The events console" /> : <EventsConsoleList events={list.items} />}
      {list && (page > 0 || (page + 1) * PAGE < list.total) ? (
        <div className="flex items-center justify-between text-sm text-gray-600">
          {page > 0 ? (
            <Link href={href(status, page - 1)} prefetch={false} className="font-medium text-brand-600 hover:underline">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span>
            {page * PAGE + 1}–{Math.min((page + 1) * PAGE, list.total)} of {list.total}
          </span>
          {(page + 1) * PAGE < list.total ? (
            <Link href={href(status, page + 1)} prefetch={false} className="font-medium text-brand-600 hover:underline">
              Next
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </div>
  );
}
