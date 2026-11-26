import Link from "next/link";
import { Building2, Eye, Gavel, MonitorSmartphone, ShieldAlert, type LucideIcon } from "lucide-react";
import { auditFeedActionLabel, humanizeAuditAction, MODERATION_TARGET_TYPE_VALUES, type AuditEntry } from "@apartment-book/shared";
import { businessAuditDetail } from "@/lib/console/audit-format";
import type { AuditFeedEntry, AuditFeedSource } from "@/lib/console/ops-types";
import { cn, isUuid } from "@/lib/utils";
import { Pill, type Tone } from "@/components/console/parts";
import { Time } from "@/components/common/time";
import { auditHref, auditSummary, FALLBACK_LOOK, LOOKS, typeName } from "./audit-display";

/**
 * One entry of the portal's audit log (migration 71's console_audit_feed), from any of the three logs. Rendered on the
 * server: links filter the log (by actor, by target, by business); "Request" opens where a staff action came from, for
 * owners and admins (the database leaves it out for everyone else).
 */
export const SOURCE_LABELS: Record<AuditFeedSource, { label: string; tone: Tone }> = {
  staff: { label: "Team", tone: "blue" },
  trust_safety: { label: "Trust & Safety", tone: "amber" },
  business: { label: "Business", tone: "violet" },
};

const UNMASK = new Set(["buzz_unmask", "buzz_unmask_subject"]);

/** The team's entries keep the summaries and links the old audit page had (audit-display.ts). */
function asTeamEntry(e: AuditFeedEntry): AuditEntry {
  return {
    id: Number(e.id),
    actorId: e.actor?.id ?? null,
    actorEmail: e.actor?.email ?? null,
    actorName: e.actor?.name ?? null,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    details: e.details ?? {},
    createdAt: e.createdAt,
  };
}

function look(e: AuditFeedEntry): { icon: LucideIcon; className: string } {
  if (e.source === "staff") return LOOKS[e.action] ?? FALLBACK_LOOK;
  if (e.source === "business") return { icon: Building2, className: "bg-violet-100 text-violet-700" };
  if (UNMASK.has(e.action)) return { icon: Eye, className: "bg-red-100 text-red-700" };
  if (/^(sanction_|suspend_|ban|strike_|remove)/.test(e.action)) return { icon: Gavel, className: "bg-amber-100 text-amber-800" };
  return LOOKS[e.action] ?? { icon: ShieldAlert, className: "bg-gray-100 text-gray-700" };
}

function summary(e: AuditFeedEntry): string {
  if (e.source === "staff") return auditSummary(asTeamEntry(e));
  if (e.source === "business") return [e.business?.name, businessAuditDetail(e.details)].filter(Boolean).join(" · ");
  const target = e.targetType ? typeName(e.targetType) || humanizeAuditAction(e.targetType) : null;
  return [target, e.reasonCode ? humanizeAuditAction(e.reasonCode) : null, e.reason].filter(Boolean).join(" · ");
}

function href(e: AuditFeedEntry): string | null {
  if (e.source === "staff") return auditHref(asTeamEntry(e));
  if (e.source === "business") {
    if (e.targetType === "ad" && isUuid(e.targetId)) return `/business/campaigns/${e.targetId}`;
    return e.business && isUuid(e.business.id) ? `/business/advertisers/${e.business.id}` : null;
  }
  if (!isUuid(e.targetId)) return e.targetType === "appeal" ? "/appeals" : null;
  if (e.targetType === "user") return `/users/${e.targetId}`;
  if (e.targetType === "appeal") return "/appeals";
  if (e.targetType && (MODERATION_TARGET_TYPE_VALUES as readonly string[]).includes(e.targetType)) return `/content/${e.targetType}/${e.targetId}`;
  return null;
}

function actorName(e: AuditFeedEntry): string {
  if (!e.actor) return e.source === "business" ? "UniBuzz" : "System";
  return e.actor.name || e.actor.email || (e.actor.kind === "team" ? "A member of the business" : "Staff member");
}

export function AuditFeedRow({ entry, filterHref }: { entry: AuditFeedEntry; filterHref: (change: Record<string, string | null>) => string }) {
  const { icon: Icon, className } = look(entry);
  const label = auditFeedActionLabel(entry.source, entry.action);
  const to = href(entry);
  const line = summary(entry);
  const source = SOURCE_LABELS[entry.source];
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5" data-testid="audit-entry" data-source={entry.source}>
      <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", className)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-gray-900">
          {to ? (
            <Link href={to} prefetch={false} className="hover:underline">
              {label}
            </Link>
          ) : (
            label
          )}
          <Pill tone={source.tone}>{source.label}</Pill>
          {UNMASK.has(entry.action) ? <Pill tone="red">Identity revealed</Pill> : null}
        </p>
        {line ? <p className="text-sm break-words text-gray-700">{line}</p> : null}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-gray-500">
          {entry.actor?.id ? (
            <Link href={filterHref({ actor: entry.actor.id, before: null })} prefetch={false} className="font-medium text-gray-600 hover:underline" title="Only this person's entries">
              {actorName(entry)}
            </Link>
          ) : (
            <span className="font-medium text-gray-600">{actorName(entry)}</span>
          )}
          <span aria-hidden="true">·</span>
          <Time iso={entry.createdAt} />
          {entry.targetId ? (
            <>
              <span aria-hidden="true">·</span>
              <Link href={filterHref({ targetId: entry.targetId, before: null })} prefetch={false} className="hover:underline" title="Everything about the same target">
                same target
              </Link>
            </>
          ) : null}
          {entry.business && isUuid(entry.business.id) ? (
            <>
              <span aria-hidden="true">·</span>
              <Link href={filterHref({ business: entry.business.id, source: null, before: null })} prefetch={false} className="hover:underline">
                this business&apos;s log
              </Link>
            </>
          ) : null}
        </p>
        {entry.context ? <RequestDetails context={entry.context} /> : null}
      </div>
    </li>
  );
}

/**
 * Where a staff action came from. The portal's server reports the browser's address and browser; the API saw the
 * server's (or, for a call made straight from a browser, the browser's). The reported values are claims, which is why
 * both are shown.
 */
function RequestDetails({ context }: { context: NonNullable<AuditFeedEntry["context"]> }) {
  const rows: [string, string | null][] = [
    ["Browser's address (reported by the portal)", context.portalIp],
    ["Address the API saw", context.gatewayIp],
    ["Browser", context.portalUserAgent ?? context.userAgent],
    ["Page", context.portalPath],
    ["API call", context.endpoint],
    ["Session", context.sessionId ? `${context.sessionId.slice(0, 8)}…${context.aal ? ` (${context.aal === "aal2" ? "two-factor" : context.aal})` : ""}` : null],
  ];
  const shown = rows.filter(([, v]) => v);
  if (shown.length === 0) return null;
  return (
    <details className="group mt-1.5 text-xs text-gray-600">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <MonitorSmartphone className="h-3.5 w-3.5" aria-hidden="true" />
        Request
      </summary>
      <dl className="mt-1.5 grid gap-x-3 gap-y-1 rounded-lg bg-gray-50 p-2.5 sm:grid-cols-[max-content_1fr]">
        {shown.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500">{k}</dt>
            <dd className="break-all text-gray-800">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
