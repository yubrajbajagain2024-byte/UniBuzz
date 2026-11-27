import type { Metadata } from "next";
import { getStaffCampuses, listStaff, listStaffInvites, listUniversities } from "@apartment-book/shared";
import { hasRole, requireStaff } from "@/lib/admin";
import { invitationEmailsConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { AddStaffForm } from "@/components/staff/add-staff-form";
import { AppointCampusAdminForm } from "@/components/staff/appoint-campus-admin-form";
import { InvitesList } from "@/components/staff/invites-list";
import { RolesLegend } from "@/components/staff/roles-legend";
import { StaffTable } from "@/components/staff/staff-table";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const access = await requireStaff("/staff", { permission: "staff.view" });
  const supabase = await createClient();
  // Pending invites are admin-only in SQL (admin_invites_list raises "Not allowed" for moderators).
  const canManage = hasRole(access, "admin");
  // Only owners appoint campus admins (migration 76; SQL refuses everyone else).
  const isOwner = access.role === "owner";
  const [members, invites, campuses, universities] = await Promise.all([
    listStaff(supabase),
    canManage ? listStaffInvites(supabase) : [],
    getStaffCampuses(supabase),
    isOwner ? listUniversities(supabase) : [],
  ]);
  const campusesByUser = Object.fromEntries(campuses.members.map((m) => [m.userId, m.universities]));
  const campusesByEmail = Object.fromEntries(campuses.invitations.map((i) => [i.email, i.universities]));
  const universityOptions = universities.map((u) => ({ id: u.id, name: u.name }));
  const emailsEnabled = invitationEmailsConfigured();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Staff" description="Who can open this app and what each person may do. Every change is re-checked in the database and written to the audit log." />
      <SectionTabs section="administration" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <StaffTable members={members} me={access} emailsEnabled={emailsEnabled} campusesByUser={campusesByUser} universities={universityOptions} />
          {canManage ? <InvitesList invites={invites} me={access} emailsEnabled={emailsEnabled} campusesByEmail={campusesByEmail} /> : null}
        </div>
        <div className="flex flex-col gap-4">
          {canManage ? <AddStaffForm me={access} emailsEnabled={emailsEnabled} /> : null}
          {isOwner ? <AppointCampusAdminForm universities={universityOptions} emailsEnabled={emailsEnabled} /> : null}
          <RolesLegend />
        </div>
      </div>
    </div>
  );
}
