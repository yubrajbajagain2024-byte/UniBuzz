import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap, Inbox } from "lucide-react";
import { listUniversities } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { fetchUniversityRequests, maybeDeployed } from "@/lib/console/server";
import type { UniversityRequestStatus } from "@/lib/console/ops-types";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam, plural } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { SetupNotice } from "@/components/ui/setup-notice";
import { Time } from "@/components/common/time";
import { EmptyBox, Pill } from "@/components/console/parts";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";
import { UniversityRequestReview } from "@/components/universities/request-review";

export const metadata: Metadata = { title: "Universities" };

const STATUSES: { value: UniversityRequestStatus; label: string }[] = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Added or linked" },
  { value: "declined", label: "Declined" },
];
const PAGE = 50;

/**
 * Students' requests for universities missing from the list (migration 70), for owners and admins of the staff.
 * Students cannot add a university themselves, because the list decides who may sign up. Approving adds one without an
 * email domain; opening sign-up to a domain is a separate step for owners.
 */
export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireStaff("/universities", { permission: "universities.manage" });
  const params = await searchParams;
  const status = STATUSES.find((s) => s.value === firstParam(params.status))?.value ?? "pending";
  const offset = Math.max(0, Math.min(100_000, Number.parseInt(firstParam(params.offset) ?? "0", 10) || 0));
  const supabase = await createClient();
  const [page, universities] = await Promise.all([maybeDeployed(fetchUniversityRequests(status, offset, PAGE)), status === "pending" ? listUniversities(supabase).catch(() => []) : Promise.resolve([])]);
  const href = (next: { status?: UniversityRequestStatus; offset?: number }) => {
    const sp = new URLSearchParams();
    const s = next.status ?? status;
    if (s !== "pending") sp.set("status", s);
    if (next.offset) sp.set("offset", String(next.offset));
    const q = sp.toString();
    return q ? `/universities?${q}` : "/universities";
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Universities"
        description="Students ask for a university missing from the list; the team adds it, links the request to one already listed, or declines it. A university added here has no sign-up domain: opening sign-up is for owners."
      />
      <SectionTabs section="universities" counts={{ "/universities": page?.counts.pending ?? null }} />

      {page === null ? (
        <Card>
          <CardBody>
            <SetupNotice migration="20261122000000_university_requests" what="University requests" />
          </CardBody>
        </Card>
      ) : (
        <>
          <nav aria-label="Request status" className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <Link
                key={s.value}
                href={href({ status: s.value, offset: 0 })}
                prefetch={false}
                aria-current={s.value === status ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm font-medium ring-1 ring-inset",
                  s.value === status ? "bg-brand-50 text-brand-800 ring-brand-300" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50",
                )}
              >
                {s.label}
                <span className="tabular-nums text-gray-500">· {page.counts[s.value]}</span>
              </Link>
            ))}
          </nav>

          <Card>
            {page.items.length === 0 ? (
              <CardBody>
                <EmptyBox
                  icon={status === "pending" ? Inbox : GraduationCap}
                  title={status === "pending" ? "No request is waiting." : "Nothing here yet."}
                  description="A student who cannot find their university in their profile settings asks for it there; the request lands here."
                />
              </CardBody>
            ) : (
              <ul className="divide-y divide-gray-100">
                {page.items.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 px-5 py-4" data-testid="university-request">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{r.name}</span>
                      <Pill tone={r.status === "pending" ? "amber" : r.status === "approved" ? "green" : "gray"}>{r.status === "approved" ? "added" : r.status}</Pill>
                      {r.samePending > 0 ? <Pill tone="blue">{plural(r.samePending + 1, "student")} asked</Pill> : null}
                      <span className="ml-auto text-xs text-gray-500">
                        asked <Time iso={new Date(r.createdAt).toISOString()} />
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
                      {r.city || r.country ? <span>{[r.city, r.country].filter(Boolean).join(", ")}</span> : <span>no city or country given</span>}
                      {r.requester ? (
                        <Link href={`/users/${r.requester.id}`} className="text-brand-600 hover:underline">
                          {r.requester.username ? `@${r.requester.username}` : r.requester.name}
                        </Link>
                      ) : null}
                    </div>
                    {r.note ? <p className="text-sm text-gray-700">“{r.note}”</p> : null}
                    {r.status === "pending" ? (
                      <UniversityRequestReview request={r} universities={universities.map((u) => ({ id: u.id, name: u.name }))} />
                    ) : (
                      <div className="flex flex-col gap-1 text-xs text-gray-600">
                        <span>
                          {r.status === "approved" ? `→ ${r.universityName ?? "a university since removed"}` : "Declined"}
                          {r.decidedBy ? ` by ${r.decidedBy.name}` : ""} {r.decidedAt ? <Time iso={new Date(r.decidedAt).toISOString()} /> : null}
                        </span>
                        {r.response ? <span>Reply: {r.response}</span> : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {offset > 0 || page.nextOffset !== null ? (
            <div className="flex justify-between text-sm">
              {offset > 0 ? (
                <Link href={href({ offset: Math.max(0, offset - PAGE) })} className="font-semibold text-brand-600 hover:underline">
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              {page.nextOffset !== null ? (
                <Link href={href({ offset: page.nextOffset })} className="font-semibold text-brand-600 hover:underline">
                  Next →
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
