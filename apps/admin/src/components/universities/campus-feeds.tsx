"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, Rss } from "lucide-react";
import { EVENT_CATEGORIES } from "@apartment-book/shared";
import type { ConsoleFeed } from "@/lib/console/ops-types";
import { deleteFeedAction, saveFeedAction } from "@/lib/console/staff-actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Pill } from "@/components/console/parts";

type Draft = { id: string | null; name: string; url: string; kind: "ics" | "rss"; enabled: boolean; defaultCategory: string };
const EMPTY: Draft = { id: null, name: "", url: "", kind: "ics", enabled: true, defaultCategory: "other" };

/**
 * A campus's own calendars (ICS or RSS feeds the website's daily sync reads into its Events), moved here from the
 * website's console: owners and admins add, change, pause and remove them through migration 61's functions, which check
 * the address and audit every change. "Sync now" stays on the website's console until it is retired (Phase 9); the daily
 * sync reads every enabled feed either way.
 */
export function CampusFeeds({ universityId, feeds }: { universityId: string; feeds: ConsoleFeed[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setMessage({});
    start(async () => {
      const result = await saveFeedAction({ ...draft, universityId });
      if (result.ok) {
        setDraft(null);
        setMessage({ success: "Saved. The next sync reads it." });
      } else setMessage({ error: result.error });
    });
  }
  function remove(feed: ConsoleFeed) {
    if (!window.confirm(`Remove "${feed.name}"? Its ${feed.upcoming} upcoming event(s) are removed with it.`)) return;
    setMessage({});
    start(async () => {
      const result = await deleteFeedAction(feed.id);
      setMessage(result.ok ? { success: `Removed, with ${result.data.events} event(s).` } : { error: result.error });
    });
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle className="text-base">Calendar feeds</CardTitle>
        {draft ? null : (
          <Button size="sm" variant="outline" onClick={() => setDraft(EMPTY)}>
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Add a feed
          </Button>
        )}
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <FormMessage error={message.error} success={message.success} />
        {draft ? (
          <form onSubmit={save} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="feedName" required>
                <Input id="feedName" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={80} />
              </Field>
              <Field label="Kind" htmlFor="feedKind">
                <Select id="feedKind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "ics" | "rss" })}>
                  <option value="ics">ICS calendar</option>
                  <option value="rss">RSS feed</option>
                </Select>
              </Field>
              <Field label="Address" htmlFor="feedUrl" required className="sm:col-span-2" hint="The calendar's public https address.">
                <Input id="feedUrl" type="url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} required maxLength={2000} placeholder="https://calendar.university.edu/events.ics" />
              </Field>
              <Field label="Category for its events" htmlFor="feedCategory">
                <Select id="feedCategory" value={draft.defaultCategory} onChange={(e) => setDraft({ ...draft, defaultCategory: e.target.value })}>
                  {EVENT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-800">
                <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                Read by the daily sync
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={pending}>
                Save feed
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
        {feeds.length === 0 ? (
          <p className="text-sm text-gray-500">No calendar feeds yet: this campus&apos;s Events come from organizations only.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {feeds.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                    <Rss className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    {f.name}
                    <Pill tone={!f.enabled ? "gray" : f.last_status === "error" ? "red" : "green"}>{!f.enabled ? "Paused" : f.last_status === "error" ? "Failing" : f.last_status ? "Syncing" : "Not synced yet"}</Pill>
                  </p>
                  <p className="truncate text-xs text-gray-500">{f.url}</p>
                  <p className="text-xs text-gray-500">
                    {f.kind.toUpperCase()} · {f.upcoming} upcoming event(s){f.last_error ? ` · ${f.last_error}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => setDraft({ id: f.id, name: f.name, url: f.url, kind: f.kind, enabled: f.enabled, defaultCategory: f.default_category })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" disabled={pending} onClick={() => remove(f)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
