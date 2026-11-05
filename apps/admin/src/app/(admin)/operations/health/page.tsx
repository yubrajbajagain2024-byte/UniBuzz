import type { Metadata } from "next";
import { Activity, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { requireStaff } from "@/lib/admin";
import { fetchSystemHealth, maybeDeployed } from "@/lib/console/server";
import type { SystemHealth } from "@/lib/console/ops-types";
import { cn, plural } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupNotice } from "@/components/ui/setup-notice";
import { Time } from "@/components/common/time";
import { LiveRefresh } from "@/components/console/live-refresh";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";

export const metadata: Metadata = { title: "System health" };

const HOUR = 3_600_000;
const ageMs = (iso: string | null) => (iso ? Date.now() - new Date(iso).getTime() : null);
const gb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(0)} MB`);

type State = "ok" | "warn" | "bad" | "none";
const TONE: Record<State, string> = { ok: "text-green-700 bg-green-50 ring-green-200", warn: "text-amber-800 bg-amber-50 ring-amber-200", bad: "text-red-700 bg-red-50 ring-red-200", none: "text-gray-600 bg-gray-50 ring-gray-200" };
const ICON: Record<State, typeof CheckCircle2> = { ok: CheckCircle2, warn: Clock, bad: AlertTriangle, none: Activity };

function Row({ state, label, value, detail }: { state: State; label: string; value: string; detail?: string }) {
  const Icon = ICON[state];
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", TONE[state])}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm font-medium text-gray-900">{label}</span>
          <span className="text-sm tabular-nums text-gray-800">{value}</span>
        </span>
        {detail ? <span className="block text-xs text-gray-500">{detail}</span> : null}
      </span>
    </li>
  );
}

/** What each part of the document says, as a state and a sentence. Numbers and times only: the document names nobody. */
function rows(h: SystemHealth) {
  const out: { state: State; label: string; value: string; detail?: string }[] = [];
  if (h.media) {
    const age = ageMs(h.media.oldest_pending_at);
    out.push({
      state: h.media.failing > 0 ? "bad" : age !== null && age > HOUR ? "warn" : "ok",
      label: "Media worker",
      value: `${plural(h.media.pending, "job")} waiting`,
      detail: h.media.failing > 0 ? `${plural(h.media.failing, "job")} failing: ${h.media.last_error ?? "see Media jobs"}` : h.media.last_done_at ? `${h.media.done_24h} done in 24 h; last at ${new Date(h.media.last_done_at).toLocaleString()}` : "nothing done yet",
    });
  } else out.push({ state: "none", label: "Media worker", value: "not in this database", detail: "The media queue exists on production only (CampConnect Admin's schema)." });
  out.push({
    state: h.feeds.failing > 0 ? "bad" : h.feeds.enabled > 0 && (ageMs(h.feeds.last_synced_at) ?? Infinity) > 6 * HOUR ? "warn" : h.feeds.enabled > 0 ? "ok" : "none",
    label: "Event feed sync",
    value: `${h.feeds.enabled} enabled, ${h.feeds.failing} failing`,
    detail: h.feeds.last_synced_at ? `last sync ${new Date(h.feeds.last_synced_at).toLocaleString()}; ${h.feeds.items_seen} items seen in all` : "no feed has synced yet (Vercel Cron runs the sync hourly)",
  });
  out.push({
    state: h.activity.latest_day ? ((ageMs(h.activity.recorded_at) ?? Infinity) > 36 * HOUR ? "warn" : "ok") : "none",
    label: "Daily activity snapshot",
    value: h.activity.latest_day ? `${h.activity.latest_day}: ${plural(h.activity.dau, "active student")}` : "none yet",
    detail: h.activity.recorded_at ? `recorded ${new Date(h.activity.recorded_at).toLocaleString()} by the platform-activity job` : "The platform-activity cron job writes one row per campus and day.",
  });
  out.push({
    state: h.moderation.reports_open > 0 && (ageMs(h.moderation.oldest_open_report_at) ?? 0) > 48 * HOUR ? "warn" : "ok",
    label: "Moderation backlog",
    value: `${h.moderation.reports_open} reports · ${h.moderation.queue_open} queue · ${h.moderation.appeals_open} appeals${h.moderation.auto_hides_pending !== null ? ` · ${h.moderation.auto_hides_pending} auto-hidden` : ""}`,
    detail: h.moderation.oldest_open_report_at ? `oldest open report ${new Date(h.moderation.oldest_open_report_at).toLocaleString()}` : "nothing open",
  });
  if (h.staff) out.push({ state: h.staff.without_second_factor > 0 ? "warn" : "ok", label: "Staff second factors", value: `${h.staff.total - h.staff.without_second_factor} of ${h.staff.total} enrolled`, detail: h.staff.without_second_factor > 0 ? "Staff without a second factor cannot act until they set one up under Security." : undefined });
  out.push({ state: "ok", label: "Storage", value: `${plural(h.storage.objects, "file")}`, detail: `${h.storage.uploads} in the uploads bucket` });
  out.push({ state: "ok", label: "Database size", value: gb(h.database.size_bytes) });
  if (h.migrations) out.push({ state: "ok", label: "Migrations applied", value: String(h.migrations.count), detail: h.migrations.latest ? `latest ${h.migrations.latest}${h.migrations.latest_applied_at ? `, ${new Date(h.migrations.latest_applied_at).toLocaleString()}` : ""}` : undefined });
  else out.push({ state: "none", label: "Migrations applied", value: "unknown", detail: "This database has no public._migrations table (the setup script keeps it on production)." });
  return out;
}

/** One page for "is everything running": the scheduled jobs, the workers, the sync, the backlog, from migration 65's document. */
export default async function HealthPage() {
  const access = await requireStaff("/operations/health");
  const health = await maybeDeployed(fetchSystemHealth());

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="System health" description="Whether the scheduled jobs, the media worker and the feed sync are running, and how much waits for the team. Numbers and times only." actions={health ? <LiveRefresh generatedAt={new Date(health.generated_at).getTime()} /> : null} />
      <SectionTabs section="operations" admin={access.role !== "moderator"} />
      {health === null ? (
        <SetupNotice migration="20261117000000_console_health" what="System health" />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Services</CardTitle>
            </CardHeader>
            <ul className="divide-y divide-gray-100">
              {rows(health).map((r) => (
                <Row key={r.label} {...r} />
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Scheduled jobs</CardTitle>
            </CardHeader>
            {health.cron === null ? (
              <CardBody className="text-sm text-gray-600">This database has no pg_cron, so there are no scheduled jobs to show (production has them).</CardBody>
            ) : health.cron.length === 0 ? (
              <CardBody className="text-sm text-gray-600">No jobs scheduled.</CardBody>
            ) : (
              <ul className="divide-y divide-gray-100">
                {health.cron.map((j) => {
                  const state: State = !j.active ? "none" : j.last_status === "failed" ? "bad" : j.last_status === null ? "warn" : "ok";
                  return <Row key={j.name} state={state} label={j.name} value={j.schedule} detail={j.last_started_at ? `${j.last_status ?? "ran"} ${new Date(j.last_started_at).toLocaleString()}${j.last_message ? ` — ${j.last_message}` : ""}` : j.active ? "has not run yet" : "paused"} />;
                })}
              </ul>
            )}
            <CardBody className="border-t border-gray-100 text-xs text-gray-500">
              Generated <Time iso={health.generated_at} />. Jobs run inside the database (pg_cron); the media worker and the feed sync run on Vercel and report here through their tables.
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
