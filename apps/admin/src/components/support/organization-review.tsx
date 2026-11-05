"use client";

import { useState, useTransition } from "react";
import { setOrganizationAction } from "@/lib/console/staff-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Verify (publishes its pending events), decline by hiding, or restore an organization; an optional note for the audit row. */
export function OrganizationReview({ id, verified, status }: { id: string; verified: boolean; status: "active" | "hidden" }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function act(input: { verified?: boolean; status?: "active" | "hidden" }, label: string) {
    setError(null);
    start(async () => {
      const res = await setOrganizationAction({ id, ...input, note });
      if (!res.ok) setError(res.error);
      else setDone(label);
    });
  }

  if (done) return <span className="text-sm text-green-700">{done}</span>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the audit log (optional)" className="h-8 min-w-48 flex-1 text-xs" maxLength={2000} />
        {!verified && status === "active" ? (
          <Button type="button" size="sm" disabled={pending} onClick={() => act({ verified: true }, "Verified · its pending events are published")}>
            Verify
          </Button>
        ) : null}
        {verified ? (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => act({ verified: false }, "Verification removed · its events go back to pending")}>
            Unverify
          </Button>
        ) : null}
        {status === "active" ? (
          <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" disabled={pending} onClick={() => act({ status: "hidden" }, "Hidden")}>
            Hide
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => act({ status: "active" }, "Restored")}>
            Restore
          </Button>
        )}
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
