"use client";

import { useState } from "react";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { auditActionLabel, listAuditLog, type AuditEntry } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { cn, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/field";
import { Time } from "@/components/common/time";
import { auditHref, auditSummary, FALLBACK_LOOK, LOOKS } from "./audit-display";

const PAGE = 50;

/** One audit entry. Used on the audit page and in the overview's "Recent activity" card. */
export function AuditRow({ entry }: { entry: AuditEntry }) {
  const look = LOOKS[entry.action] ?? FALLBACK_LOOK;
  const Icon = look.icon;
  const actor = entry.actorName || entry.actorEmail || "System";
  const summary = auditSummary(entry);
  const href = auditHref(entry);
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", look.className)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">
          {href ? (
            <Link href={href} className="hover:underline">
              {auditActionLabel(entry.action)}
            </Link>
          ) : (
            auditActionLabel(entry.action)
          )}
        </p>
        {summary ? <p className="text-sm break-words text-gray-700">{summary}</p> : null}
        <p className="mt-0.5 text-xs text-gray-500">
          <span className="font-medium text-gray-600">{actor}</span>
          <span aria-hidden="true"> · </span>
          <Time iso={entry.createdAt} />
        </p>
      </div>
    </li>
  );
}

/** Full audit log: the first page comes from the server, older pages are fetched with the browser client. */
export function AuditList({ initial }: { initial: AuditEntry[] }) {
  const [items, setItems] = useState(initial);
  const [done, setDone] = useState(initial.length < PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last || loading) return;
    setLoading(true);
    setError(null);
    try {
      const older = await listAuditLog(createClient(), { limit: PAGE, before: last.id });
      setItems((cur) => [...cur, ...older.filter((o) => !cur.some((c) => c.id === o.id))]);
      setDone(older.length < PAGE);
    } catch (e) {
      setError(`Could not load older entries. ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return <EmptyState icon={ScrollText} title="No activity yet" description="Team changes, security events and moderation actions are recorded here as they happen." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <ul className="divide-y divide-gray-100">
          {items.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </Card>
      <FormMessage error={error} />
      {!done ? (
        <Button variant="outline" onClick={loadMore} loading={loading} className="self-center">
          Load older
        </Button>
      ) : items.length > PAGE ? (
        <p className="text-center text-xs text-gray-500">That is the whole log.</p>
      ) : null}
    </div>
  );
}
