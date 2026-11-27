"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import type { ConsoleUniversity } from "@/lib/console/ops-types";
import { updateUniversityAction } from "@/lib/console/staff-actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * A campus's details (owners and admins; migration 77 checks the same, the name unique, the time zone one PostgreSQL
 * knows, the coordinates together, and audits every change with what it was). Never the sign-up domain.
 */
export function CampusDetailsForm({ university }: { university: ConsoleUniversity }) {
  const [form, setForm] = useState({
    name: university.name,
    shortName: university.shortName ?? "",
    city: university.city ?? "",
    country: university.country ?? "",
    timezone: university.timezone,
    latitude: university.latitude?.toString() ?? "",
    longitude: university.longitude?.toString() ?? "",
  });
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const coordinate = (v: string) => (v.trim() === "" ? null : Number(v));

  function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage({});
    start(async () => {
      const result = await updateUniversityAction({ id: university.id, ...form, latitude: coordinate(form.latitude), longitude: coordinate(form.longitude) });
      setMessage(result.ok ? { success: "Saved." } : { error: result.error });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Campus details</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={save} className="flex flex-col gap-4">
          <FormMessage error={message.error} success={message.success} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="uniName" required>
              <Input id="uniName" value={form.name} onChange={set("name")} required minLength={2} maxLength={120} />
            </Field>
            <Field label="Short name" htmlFor="uniShort" hint="Shown where space is tight, e.g. Texas State.">
              <Input id="uniShort" value={form.shortName} onChange={set("shortName")} maxLength={30} />
            </Field>
            <Field label="City" htmlFor="uniCity">
              <Input id="uniCity" value={form.city} onChange={set("city")} maxLength={120} />
            </Field>
            <Field label="Country" htmlFor="uniCountry">
              <Input id="uniCountry" value={form.country} onChange={set("country")} maxLength={120} />
            </Field>
            <Field label="Time zone" htmlFor="uniTz" required hint="Events on its calendar are shown in it, e.g. America/Chicago.">
              <Input id="uniTz" value={form.timezone} onChange={set("timezone")} required maxLength={64} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude" htmlFor="uniLat" hint="Both or neither.">
                <Input id="uniLat" inputMode="decimal" value={form.latitude} onChange={set("latitude")} />
              </Field>
              <Field label="Longitude" htmlFor="uniLng">
                <Input id="uniLng" inputMode="decimal" value={form.longitude} onChange={set("longitude")} />
              </Field>
            </div>
          </div>
          <div>
            <Button type="submit" loading={pending}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save details
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
