"use client";

import { useState, useTransition } from "react";
import type { ConsoleUniversityRequest } from "@/lib/console/ops-types";
import { decideUniversityRequestAction } from "@/lib/console/staff-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";

type Decision = "approve" | "link" | "decline";

/**
 * Decide one student's request (migration 70). Approve adds the university as named here (the student's spelling can
 * be corrected first) and never with an email domain: opening sign-up to a domain is a separate step for owners.
 * Link points the request at a university already listed. Decline closes it. The reply is what the student reads;
 * the decision and the reply go to the audit log.
 */
export function UniversityRequestReview({ request, universities }: { request: ConsoleUniversityRequest; universities: { id: string; name: string }[] }) {
  const [decision, setDecision] = useState<Decision>(request.similar.length ? "link" : "approve");
  const [name, setName] = useState(request.name);
  const [city, setCity] = useState(request.city ?? "");
  const [country, setCountry] = useState(request.country ?? "");
  const [universityId, setUniversityId] = useState(request.similar[0]?.id ?? "");
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await decideUniversityRequestAction({ id: request.id, decision, name, city, country, universityId: universityId || null, response });
      if (!res.ok) setError(res.error);
      else
        setDone(
          decision === "approve"
            ? `Added ${res.data.universityName ?? name}. Students can choose it now; sign-up stays closed to any new domain.`
            : decision === "link"
              ? `Linked to ${res.data.universityName ?? "the university"}.`
              : "Declined.",
        );
    });
  }

  if (done) return <p className="text-sm text-green-700">{done}</p>;
  const id = (k: string) => `${request.id}-${k}`;
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Decision" className="flex flex-wrap gap-2">
        {(
          [
            ["approve", "Add as a new university"],
            ["link", "Already listed: link it"],
            ["decline", "Decline"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-sm ring-1 ring-inset ring-gray-300 has-[:checked]:bg-brand-50 has-[:checked]:ring-brand-300">
            <input type="radio" name={id("decision")} value={value} checked={decision === value} onChange={() => setDecision(value)} className="accent-brand-600" />
            {label}
          </label>
        ))}
      </div>

      {decision === "approve" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" htmlFor={id("name")} required className="sm:col-span-3">
            <Input id={id("name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
          </Field>
          <Field label="City" htmlFor={id("city")}>
            <Input id={id("city")} value={city} onChange={(e) => setCity(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Country" htmlFor={id("country")}>
            <Input id={id("country")} value={country} onChange={(e) => setCountry(e.target.value)} maxLength={120} />
          </Field>
        </div>
      ) : null}

      {decision === "link" ? (
        <Field label="University already listed" htmlFor={id("university")} required>
          <Select id={id("university")} value={universityId} onChange={(e) => setUniversityId(e.target.value)}>
            <option value="">Choose…</option>
            {request.similar.length ? (
              <optgroup label="Similar names">
                {request.similar.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.city ? ` · ${u.city}` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="All universities">
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
      ) : null}

      <Field label="Reply to the student (optional)" htmlFor={id("response")}>
        <Textarea id={id("response")} value={response} onChange={(e) => setResponse(e.target.value)} maxLength={1000} rows={2} placeholder={decision === "decline" ? "Why it was not added" : "Shown under their request"} />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant={decision === "decline" ? "outline" : undefined} loading={pending} disabled={pending || (decision === "link" && !universityId) || (decision === "approve" && name.trim().length < 3)} onClick={submit}>
          {decision === "approve" ? "Add university" : decision === "link" ? "Link request" : "Decline request"}
        </Button>
        {request.samePending > 0 && decision !== "decline" ? (
          <span className="text-xs text-gray-600">Also answers {request.samePending === 1 ? "1 other request" : `${request.samePending} other requests`} for this name.</span>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
