"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCampusAdminCampusesAction } from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { CampusPicker } from "./campus-picker";

/**
 * A campus admin's campuses on the team list. Everyone who may read the list sees them; owners may change them (the
 * database refuses anyone else and writes the change, with before and after, to the audit log).
 */
export function CampusEditor({
  userId,
  name,
  campuses,
  universities,
  canEdit,
}: {
  userId: string;
  name: string;
  campuses: readonly { id: string; name: string }[];
  universities: readonly { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(campuses.map((c) => c.id));
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const label = campuses.length ? campuses.map((c) => c.name).join(", ") : "No campus (no access until one is added)";

  function save() {
    setError(undefined);
    start(async () => {
      const result = await setCampusAdminCampusesAction(userId, selected);
      if (result.error) setError(result.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (!editing) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-600">
        <span>
          <span className="font-medium text-gray-700">Campuses:</span> {label}
        </span>
        {canEdit ? (
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setEditing(true)} aria-label={`Change ${name}'s campuses`}>
            Change
          </button>
        ) : null}
      </p>
    );
  }
  return (
    <div className="mt-2 flex max-w-md flex-col gap-2">
      <FormMessage error={error} />
      <CampusPicker universities={universities} selected={selected} onChange={setSelected} disabled={pending} />
      <div className="flex gap-2">
        <Button size="sm" loading={pending} disabled={selected.length === 0} onClick={save}>
          Save campuses
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setSelected(campuses.map((c) => c.id));
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
