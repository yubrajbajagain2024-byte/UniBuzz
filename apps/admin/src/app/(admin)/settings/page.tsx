import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { listUniversities } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { PRODUCT_NAME } from "@/lib/brand";
import { stamp } from "@/lib/console/format";
import { fetchRulePacks, maybeDeployed } from "@/lib/console/server";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupNotice } from "@/components/ui/setup-notice";
import { Pill } from "@/components/console/parts";
import { RulePackToggle } from "@/components/settings/rule-pack-toggle";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";

export const metadata: Metadata = { title: "Settings" };

/**
 * What admins can set: the Buzz moderation engine's rule packs (migration 41; each toggle is audited and reaches the
 * write API at once) and the ad rate card (under Business). The rest of the product's configuration is read-only
 * here: which campuses may sign up comes from the universities table, and paused features stay behind their flags.
 */
export default async function SettingsPage() {
  const access = await requireStaff("/settings", { minRole: "admin" });
  const supabase = await createClient();
  const [packs, universities] = await Promise.all([maybeDeployed(fetchRulePacks()), listUniversities(supabase).catch(() => [])]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" description={`What the team can change about ${PRODUCT_NAME} from here, and what is fixed in the code and the database.`} />
      <SectionTabs section="administration" admin />

      <Card>
        <CardHeader>
          <CardTitle>Buzz rule packs</CardTitle>
        </CardHeader>
        {packs === null ? (
          <CardBody>
            <SetupNotice migration="20261103000000_trust_safety" what="The rule packs" />
          </CardBody>
        ) : (
          <ul className="divide-y divide-gray-100">
            {packs.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-gray-900">{p.id}</span>
                    {p.id === "baseline" ? <Pill tone="gray">always on</Pill> : null}
                  </div>
                  <div className="text-xs text-gray-500">
                    {p.updatedBy && p.updatedAt ? `changed by ${p.updatedBy}, ${stamp(p.updatedAt)}` : "never changed"}
                  </div>
                </div>
                <RulePackToggle id={p.id} enabled={p.enabled} locked={p.id === "baseline"} />
              </li>
            ))}
          </ul>
        )}
        <CardBody className="border-t border-gray-100 text-xs text-gray-500">Every Buzz write is checked against every enabled pack; the strictest outcome wins. The PII and behavioural checks always run. Toggles are audited.</CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Who can sign up</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2 text-sm text-gray-700">
            <p>Sign-up is limited to these university email domains (the form and a database trigger both check). Adding a campus is a row in the universities table, shipped with the seed.</p>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {universities.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="font-medium text-gray-900">{u.name}</span>
                  <span className="font-mono text-xs text-gray-600">@{u.email_domain}</span>
                </li>
              ))}
              {universities.length === 0 ? <li className="px-3 py-2 text-gray-500">No campus rows readable from here.</li> : null}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Elsewhere</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-3 text-sm text-gray-700">
            <p>
              <span className="font-medium text-gray-900">Ad rate card.</span> Prices per placement and period, under Business.{" "}
              <Link href="/business/pricing" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
                Pricing <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </p>
            <p>
              <span className="font-medium text-gray-900">Automatic hiding.</span> Content is hidden once 10 different eligible people report it; Buzz sooner, by its own weighted threshold. Both thresholds live in the database and are not switches.
            </p>
            <p>
              <span className="font-medium text-gray-900">Paused features.</span> Calls stay hidden for the launch; their code and records are kept and only the owner turns them on, through the app&apos;s flags.
            </p>
            <p>
              <span className="font-medium text-gray-900">Your role:</span> {access.role}. Roles are granted under Staff.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
