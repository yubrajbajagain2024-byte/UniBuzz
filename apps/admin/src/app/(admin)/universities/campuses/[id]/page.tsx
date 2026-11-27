import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireStaff } from "@/lib/admin";
import { fetchConsoleUniversity, fetchEventFeeds } from "@/lib/console/server";
import { StatCard } from "@/components/overview/stat-card";
import { CampusDetailsForm } from "@/components/universities/campus-details-form";
import { CampusFeeds } from "@/components/universities/campus-feeds";
import { SignupDomainCard } from "@/components/universities/signup-domain-card";
import { PageHeader } from "@/components/shell/page-header";
import { SectionTabs } from "@/components/shell/section-tabs";
import { CalendarDays, GraduationCap, Rss } from "lucide-react";

export const metadata: Metadata = { title: "Campus" };

/**
 * One campus (migration 77), for owners and admins: its details, who may sign up (owners open or close it), and its
 * calendar feeds (moved here from the website's console). Every change is checked and audited in the database.
 */
export default async function CampusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const access = await requireStaff(`/universities/campuses/${id}`, { permission: "universities.manage" });
  const [university, feeds] = await Promise.all([fetchConsoleUniversity(id), fetchEventFeeds()]);
  const mine = feeds.filter((f) => f.university_id === id);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/universities/campuses" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All campuses
      </Link>
      <PageHeader title={university.name} description={[university.city, university.country].filter(Boolean).join(", ") || undefined} />
      <SectionTabs section="universities" />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Verified students" value={university.verifiedStudents} hint={university.emailDomain ? `@${university.emailDomain}` : "Sign-up closed"} icon={GraduationCap} />
        <StatCard label="Calendar feeds" value={university.feeds} icon={Rss} />
        <StatCard label="Upcoming events" value={university.upcomingEvents} href="/events" icon={CalendarDays} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <CampusDetailsForm university={university} />
          <CampusFeeds universityId={university.id} feeds={mine} />
        </div>
        <SignupDomainCard university={university} canEdit={access.role === "owner"} />
      </div>
    </div>
  );
}
