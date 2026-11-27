import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap, Lock, LockOpen } from "lucide-react";
import { requireStaff } from "@/lib/admin";
import { fetchConsoleUniversities, maybeDeployed } from "@/lib/console/server";
import { firstParam } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SetupNotice } from "@/components/ui/setup-notice";
import { EmptyBox, Pill } from "@/components/console/parts";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";

export const metadata: Metadata = { title: "Campuses" };

/**
 * Every university on the list (migration 77), for owners and admins of the staff: whether sign-up is open and to which
 * domain, its verified students, its calendar feeds and upcoming events. Each opens its campus page.
 */
export default async function CampusesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireStaff("/universities/campuses", { permission: "universities.manage" });
  const q = (firstParam((await searchParams).q) ?? "").trim().slice(0, 80);
  const list = await maybeDeployed(fetchConsoleUniversities(q || null));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Campuses" description="Every university on the list: who may sign up, its verified students and its calendar." />
      <SectionTabs section="universities" />
      {list === null ? (
        <SetupNotice migration="20261202000000_university_console.sql" what="The campus list, its details and its sign-up domain" />
      ) : (
        <>
          <form className="max-w-sm" action="/universities/campuses">
            <Input name="q" defaultValue={q} placeholder="Search by name or domain" aria-label="Search campuses" />
          </form>
          {list.length === 0 ? (
            <EmptyBox icon={GraduationCap} title="No campus matches" />
          ) : (
            <Card>
              <ul className="divide-y divide-gray-100">
                {list.map((u) => (
                  <li key={u.id}>
                    <Link href={`/universities/campuses/${u.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-gray-900">{u.name}</span>
                        <span className="block truncate text-xs text-gray-500">{[u.city, u.country].filter(Boolean).join(", ") || "No location yet"} · {u.timezone}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        {u.emailDomain ? (
                          <Pill tone="green">
                            <LockOpen className="h-3 w-3" aria-hidden="true" /> @{u.emailDomain}
                          </Pill>
                        ) : (
                          <Pill tone="gray">
                            <Lock className="h-3 w-3" aria-hidden="true" /> Sign-up closed
                          </Pill>
                        )}
                        <span>{u.verifiedStudents} verified</span>
                        <span>· {u.feeds} feed(s)</span>
                        <span>· {u.upcomingEvents} upcoming</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
