import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { isMissingFunctionError, listRestrictions, listUsers, searchUsers, type AdminUserRow, type UsersFilter } from "@apartment-book/shared";
import { hasRole, requireStaff } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, firstParam } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SetupNotice } from "@/components/ui/setup-notice";
import { UsersList } from "@/components/users/users-list";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";

export const metadata: Metadata = { title: "Users" };

const FILTERS: { value: UsersFilter; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "suspended", label: "Suspended" },
  { value: "unverified", label: "Verification" },
  { value: "staff", label: "Staff" },
];

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const access = await requireStaff("/users");
  const params = await searchParams;
  const q = (firstParam(params.q) ?? "").trim();
  const filter = FILTERS.find((f) => f.value === firstParam(params.filter))?.value ?? "all";
  const supabase = await createClient();

  let rows: AdminUserRow[] = [];
  let needsMigration = false;
  // The Verification filter is migration 65's; before it the list function refuses the filter by name.
  let needsHealthMigration = false;
  if (q) {
    rows = (await searchUsers(supabase, q, 50)).map((u) => ({ ...u, lastSeenAt: null }));
  } else {
    try {
      rows = await listUsers(supabase, { filter, limit: 50 });
    } catch (error) {
      if (filter === "unverified" && /Invalid filter/i.test(errorMessage(error, ""))) {
        needsHealthMigration = true;
      } else if (!isMissingFunctionError(error)) throw error;
      else needsMigration = true;
      needsMigration = true;
      // Older database: at least the suspended people are listable through migration 15.
      if (needsMigration) rows = (await listRestrictions(supabase, { activeOnly: true, limit: 200 })).map((r) => ({
        userId: r.userId,
        fullName: r.fullName,
        email: r.email,
        avatarUrl: null,
        universityName: null,
        createdAt: r.createdAt,
        lastSeenAt: null,
        suspended: true,
        staffRole: null,
      }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Users" description="Find a person, see what they posted and were reported for, and suspend or unsuspend their account. Suspensions apply to the website and the app at once. Verification lists people whose email is unconfirmed or whose campus is unset." />
      <SectionTabs section="users" admin={hasRole(access, "admin")} />
      <form action="/users" className="flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Search by name or email" aria-label="Search people" className="max-w-md" />
        <Button type="submit" variant="secondary">
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
        </Button>
        {q ? (
          <Link href="/users" className="self-center text-sm font-medium text-gray-600 hover:underline">
            Clear
          </Link>
        ) : null}
      </form>
      {q ? (
        <UsersList key={`q:${q}`} initial={rows} filter="all" pageable={false} emptyTitle={`Nobody matches “${q}”`} emptyDescription="Try part of the name or the exact email address." />
      ) : (
        <>
          {needsMigration ? <SetupNotice migration="16" what="Browsing everyone (search and the suspended list still work)" /> : null}
          {needsHealthMigration ? <SetupNotice migration="20261117000000_console_health" what="The Verification filter" /> : null}
          <UsersList
            key={filter}
            initial={rows}
            filter={filter}
            pageable={!needsMigration}
            emptyTitle={filter === "suspended" ? "No suspended accounts" : filter === "staff" ? "No staff" : filter === "unverified" ? "Everyone is verified" : "No people yet"}
            emptyDescription={
              filter === "suspended"
                ? "Suspend someone from their account page; they show up here while it lasts."
                : filter === "unverified"
                  ? "Every account has a confirmed university email and a campus. Someone who signed up but never confirmed the email shows up here."
                  : "People appear here as they sign up."
            }
          />
        </>
      )}
    </div>
  );
}
