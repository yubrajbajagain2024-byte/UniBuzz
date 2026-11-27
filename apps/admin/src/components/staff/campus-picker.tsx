"use client";

/**
 * The campuses a campus admin acts for: a checkbox per university, posted as `universityIds` (1 to 20; the database
 * checks the same). Controlled by `selected` when an editor keeps the state; otherwise each box keeps its own.
 */
export function CampusPicker({
  universities,
  selected,
  defaultSelected = [],
  onChange,
  disabled = false,
}: {
  universities: readonly { id: string; name: string }[];
  selected?: readonly string[];
  defaultSelected?: readonly string[];
  onChange?: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const controlled = selected !== undefined;
  function toggle(id: string, on: boolean) {
    if (!onChange || !controlled) return;
    onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  }
  if (universities.length === 0) return <p className="text-sm text-gray-500">No universities are listed yet.</p>;
  return (
    <fieldset className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg border border-gray-200 p-2" disabled={disabled}>
      <legend className="sr-only">Campuses</legend>
      {universities.map((u) => (
        <label key={u.id} className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            name="universityIds"
            value={u.id}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            {...(controlled ? { checked: selected.includes(u.id), onChange: (e) => toggle(u.id, e.target.checked) } : { defaultChecked: defaultSelected.includes(u.id) })}
          />
          {u.name}
        </label>
      ))}
    </fieldset>
  );
}
