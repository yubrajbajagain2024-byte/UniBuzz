import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";
import { requireStaff } from "@/lib/admin";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { stamp } from "@/lib/console/format";
import { fetchAppeals, maybeDeployed } from "@/lib/console/server";
import { cn, firstParam } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";
import { SetupNotice } from "@/components/ui/setup-notice";
import { EmptyBox, Pill } from "@/components/console/parts";
import { AppealReview } from "@/components/moderation/appeal-review";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";

export const metadata: Metadata = { title: "Appeals" };

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "upheld", label: "Upheld" },
  { value: "reversed", label: "Reversed" },
  { value: "reduced", label: "Reduced" },
  { value: "all", label: "All" },
] as const;
const PAGE = 30;
const SANCTION_LABELS: Record<string, string> = { warning: "Warning", mute: "Mute", suspension: "Suspension", ban: "Ban", removal: "Removal" };
const categoryLabel = (c: string | null) => (c ? c.replace(/_/g, " ") : "Uncategorised");
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

/**
 * Appeals against sanctions (Trust & Safety, migration 41), reviewed blind: the sanction, the appealed content and the
 * appeal text, never a person. For Buzz the times are cut to the day. Whether you may decide one comes from the
 * database (never your own action; suspensions and bans for admins).
 */
export default async function AppealsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const access = await requireStaff("/appeals");
  const params = await searchParams;
  const raw = firstParam(params.status) ?? "open";
  const status = STATUSES.some((s) => s.value === raw) ? raw : "open";
  const page = Math.max(0, Math.floor(Number(firstParam(params.page)) || 0));
  const [user, profile, list] = await Promise.all([getCurrentUser(), getCurrentProfile(), maybeDeployed(fetchAppeals(status, page * PAGE, PAGE))]);
  const actorName = profile?.full_name || user?.email?.split("@")[0] || "You";
  const href = (s: string, p = 0) => `/appeals?status=${s}${p ? `&page=${p}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Appeals" description="People appealing a warning, mute, suspension, ban or removal. Reviewed blind: the sanction, the content and the appeal, never who. You cannot decide an appeal against your own action; suspensions and bans are for admins." />
      <SectionTabs section="moderation" admin={access.role !== "moderator"} />
      <nav aria-label="Appeal status" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s.value}
            href={href(s.value)}
            prefetch={false}
            aria-current={s.value === status ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center rounded-full px-3 text-sm font-medium ring-1 ring-inset",
              s.value === status ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50",
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      {list === null ? (
        <SetupNotice migration="20261103000000_trust_safety" what="Appeals" />
      ) : list.items.length === 0 ? (
        <EmptyBox icon={Scale} title={status === "open" ? "No open appeals." : `No ${status === "all" ? "" : `${status} `}appeals.`} description="Appeals are reviewed by someone other than the person who acted. They arrive here from the website and the app." />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.items.map((a) => {
            const anon = a.sanction.origin === "anon";
            return (
              <li key={a.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200" data-testid="appeal">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={a.sanction.kind === "ban" || a.sanction.kind === "suspension" ? "red" : "amber"}>{SANCTION_LABELS[a.sanction.kind] ?? a.sanction.kind}</Pill>
                  <Pill tone={anon ? "violet" : "gray"}>{anon ? "Buzz origin" : "Public origin"}</Pill>
                  {a.sanction.category ? <span className="text-xs text-gray-700">{categoryLabel(a.sanction.category)}</span> : null}
                  <span className="ml-auto text-xs text-gray-500">{anon ? day(a.createdAt) : stamp(a.createdAt)}</span>
                </div>
                {a.contentExcerpt ? (
                  <div className="mt-2">
                    <div className="mb-1 text-xs text-gray-500">Appealed {a.contentLabel ?? "content"}</div>
                    <blockquote className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">{a.contentExcerpt}</blockquote>
                  </div>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">“{a.text}”</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{a.sanction.until ? `Sanction until ${anon ? day(a.sanction.until) : stamp(a.sanction.until)}` : a.sanction.kind === "ban" ? "Permanent" : "No end time"}</span>
                  {a.sanction.liftedAt ? <span>· lifted</span> : null}
                  <span className="ml-auto flex items-center gap-2">
                    {a.status !== "open" ? <Pill tone={a.status === "upheld" ? "gray" : "green"}>{a.status}</Pill> : null}
                    {a.queueId ? (
                      <Link href={`/reports`} className="text-brand-600 hover:underline">
                        queue
                      </Link>
                    ) : null}
                    {a.status === "open" && a.canReview ? <AppealReview appealId={a.id} actorName={actorName} /> : null}
                    {a.status === "open" && !a.canReview ? <span>not yours to decide</span> : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {list && (page > 0 || list.nextOffset !== null) ? (
        <div className="flex items-center justify-between">
          {page > 0 ? (
            <Link href={href(status, page - 1)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          {list.nextOffset !== null ? (
            <Link href={href(status, page + 1)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Older
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
