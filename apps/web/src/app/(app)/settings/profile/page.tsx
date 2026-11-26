import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listMyUniversityRequests, listUniversities } from "@apartment-book/shared";
import { getCurrentProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/utils";
import { ProfileForm, RequestUniversityForm } from "@/components/profile/profile-form";
import { DeleteAccount } from "@/components/profile/delete-account";
import { BuzzSettingsLinks } from "@/components/buzz/settings-links";

export const metadata: Metadata = { title: "Profile settings" };

export default async function ProfileSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireUser("/settings/profile");
  const params = await searchParams;
  const welcome = firstParam(params.welcome) === "1";
  const supabase = await createClient();
  // The student's own university requests (migration 70); null where the database does not have them yet.
  const [profile, universities, requests] = await Promise.all([getCurrentProfile(), listUniversities(supabase), listMyUniversityRequests(supabase).catch(() => null)]);
  if (!profile) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{welcome ? `Welcome, ${profile.full_name.split(" ")[0]}!` : "Profile settings"}</h1>
        <p className="text-sm text-gray-600">
          {welcome ? "Pick your university to join its community: its students, posts and Buzz, plus housing and items near campus." : "Update how other students see you."}
        </p>
      </div>
      <ProfileForm profile={profile} universities={universities} welcome={welcome} />
      {welcome ? null : <BuzzSettingsLinks />}
      <RequestUniversityForm requests={requests} />
      <DeleteAccount />
    </div>
  );
}
