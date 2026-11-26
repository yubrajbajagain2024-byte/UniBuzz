import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText, X } from "lucide-react";
import { listAuditLog } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { fetchAuditFeed, maybeDeployed } from "@/lib/console/server";
import type { AuditFeedFilters, AuditFeedSource } from "@/lib/console/ops-types";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam, isUuid } from "@/lib/utils";
import { AuditList } from "@/components/audit/audit-list";
import { AuditFeedRow, SOURCE_LABELS } from "@/components/audit/audit-feed";
import { EmptyBox } from "@/components/console/parts";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";
import { Card, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buttonClasses } from "@/components/ui/button";
import { SetupNotice } from "@/components/ui/setup-notice";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 50;
const SOURCES: readonly AuditFeedSource[] = ["staff", "trust_safety", "business"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Actions worth suggesting in the filter; a value ending with "." matches every action that starts with it. */
const SUGGESTED_ACTIONS = [
  "staff.", "invite.", "security.", "user.", "content.", "report.", "university_request.", "university.create", "event_feed.",
  "sanction_apply", "sanction_lift", "appeal_decide", "buzz_unmask", "role_grant", "role_revoke", "rule_pack_toggle", "auto_hide",
];

type Params = { [key: string]: string | string[] | undefined };

/** The filters as the URL carries them, each checked; anything else is dropped. Dates are whole days in UTC. */
function readFilters(params: Params): AuditFeedFilters {
  const f: AuditFeedFilters = {};
  const source = firstParam(params.source);
  if (source && (SOURCES as readonly string[]).includes(source)) f.source = source as AuditFeedSource;
  const actor = firstParam(params.actor)?.trim();
  if (actor && isUuid(actor)) f.actor = actor;
  const action = firstParam(params.action)?.trim();
  if (action && /^[a-z0-9_.]{1,80}$/.test(action)) f.action = action;
  const targetType = firstParam(params.targetType)?.trim();
  if (targetType && /^[a-z_]{1,40}$/.test(targetType)) f.targetType = targetType;
  const targetId = firstParam(params.targetId)?.trim();
  if (targetId && /^[A-Za-z0-9_.:-]{1,80}$/.test(targetId)) f.targetId = targetId;
  const business = firstParam(params.business)?.trim();
  if (business && isUuid(business)) f.business = business;
  const from = firstParam(params.from);
  if (from && DAY.test(from) && !Number.isNaN(Date.parse(`${from}T00:00:00Z`))) f.from = String(Date.parse(`${from}T00:00:00Z`));
  const to = firstParam(params.to);
  if (to && DAY.test(to) && !Number.isNaN(Date.parse(`${to}T23:59:59.999Z`))) f.to = String(Date.parse(`${to}T23:59:59.999Z`));
  const before = firstParam(params.before);
  if (before && /^\d{1,19}-[123]-\d{1,19}$/.test(before)) f.before = before;
  return f;
}

/**
 * The portal's one audit log (migration 71): the team's changes and security events, Trust & Safety's decisions and
 * businesses' changes, merged newest first, append-only. What each person sees is decided in the database: moderators
 * see moderation activity and their own entries, never business entries or where a request came from; owners and
 * admins see everything. Without migration 71 the page shows the team's log as before.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaff("/audit", { permission: "audit.view" });
  const params = await searchParams;
  const filters = readFilters(params);
  const page = await maybeDeployed(fetchAuditFeed(filters, PAGE));

  if (page === null) {
    const entries = await listAuditLog(await createClient(), { limit: 50 });
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Audit log"
          description="Every team change, security event and moderation action, newest first, with who did it and why. Entries cannot be edited or deleted. Moderators see moderation activity and their own rows."
        />
        <SectionTabs section="administration" />
        <SetupNotice migration="20261126000000_audit_feed" what="One log for the team, Trust & Safety and businesses, with where staff actions came from," />
        <AuditList initial={entries} />
      </div>
    );
  }

  const day = (ms: string | undefined) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : "");
  const current: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v && k !== "from" && k !== "to") current[k] = v;
  if (filters.from) current.from = day(filters.from);
  if (filters.to) current.to = day(filters.to);
  const filterHref = (change: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...change })) if (v) sp.set(k, v);
    const q = sp.toString();
    return q ? `/audit?${q}` : "/audit";
  };
  const chips: { key: string; label: string }[] = [];
  if (filters.actor) chips.push({ key: "actor", label: `Person ${filters.actor.slice(0, 8)}…` });
  if (filters.targetType) chips.push({ key: "targetType", label: `Kind: ${filters.targetType}` });
  if (filters.targetId) chips.push({ key: "targetId", label: `Target ${filters.targetId.slice(0, 12)}${filters.targetId.length > 12 ? "…" : ""}` });
  if (filters.business) chips.push({ key: "business", label: `Business ${filters.business.slice(0, 8)}…` });
  const filtered = Object.keys(current).some((k) => k !== "before");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit log"
        description={
          page.contextVisible
            ? "Everything the team changes, every Trust & Safety decision and every change a business makes, newest first, with who did it and why. Entries cannot be edited or deleted. Owners and admins also see where each staff action came from."
            : "Moderation activity and your own changes, newest first, with who did it and why. Entries cannot be edited or deleted."
        }
      />
      <SectionTabs section="administration" />

      <nav aria-label="Logs" className="no-scrollbar -mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-2">
          {[null, ...page.sources].map((s) => {
            const active = (filters.source ?? null) === s;
            return (
              <li key={s ?? "all"}>
                <Link
                  href={filterHref({ source: s, before: null })}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3 text-sm font-medium ring-1 ring-inset",
                    active ? "bg-brand-50 text-brand-800 ring-brand-300" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50",
                  )}
                >
                  {s ? SOURCE_LABELS[s].label : "Everything"}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Card>
        <CardBody>
          <form method="get" action="/audit" className="flex flex-wrap items-end gap-3" aria-label="Filter the audit log">
            {filters.source ? <input type="hidden" name="source" value={filters.source} /> : null}
            {chips.map((c) => (
              <input key={c.key} type="hidden" name={c.key} value={current[c.key]} />
            ))}
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
              Action
              <Input name="action" list="audit-actions" defaultValue={filters.action ?? ""} placeholder="e.g. staff. or sanction_apply" autoComplete="off" />
              <datalist id="audit-actions">
                {SUGGESTED_ACTIONS.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
              From (UTC)
              <Input type="date" name="from" defaultValue={current.from ?? ""} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
              To (UTC)
              <Input type="date" name="to" defaultValue={current.to ?? ""} />
            </label>
            <button type="submit" className={buttonClasses({ size: "sm" })}>
              Filter
            </button>
            {filtered ? (
              <Link href={filters.source ? `/audit?source=${filters.source}` : "/audit"} prefetch={false} className={buttonClasses({ size: "sm", variant: "ghost" })}>
                Clear
              </Link>
            ) : null}
          </form>
          {chips.length ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Other filters">
              {chips.map((c) => (
                <li key={c.key}>
                  <Link href={filterHref({ [c.key]: null, before: null })} prefetch={false} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200">
                    {c.label}
                    <X className="h-3 w-3" aria-label="Remove" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      {page.items.length === 0 ? (
        <EmptyBox icon={ScrollText} title={filtered ? "Nothing matches" : "No activity yet"} description={filtered ? "Try fewer filters or a wider date range." : "Changes, decisions and security events are recorded here as they happen."} />
      ) : (
        <Card>
          <ul className="divide-y divide-gray-100">
            {page.items.map((entry) => (
              <AuditFeedRow key={`${entry.source}:${entry.id}`} entry={entry} filterHref={filterHref} />
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {filters.before ? (
          <Link href={filterHref({ before: null })} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
            Back to the newest
          </Link>
        ) : null}
        {page.nextCursor ? (
          <Link href={filterHref({ before: page.nextCursor })} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
            Older entries
          </Link>
        ) : page.items.length > 0 && filters.before ? (
          <p className="text-xs text-gray-500">That is the oldest entry.</p>
        ) : null}
      </div>
    </div>
  );
}
