import { useRouter } from "expo-router";
import { classYear, majorAbbreviation, profileStudyLine } from "@apartment-book/shared";
import { SettingsInfoRow, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/settings-ui";
import { useSession } from "@/lib/session";

/**
 * Settings → Account & Profile: your profile (name, username, photo, bio), your school (the university your email
 * verifies, your major and class year), and your account: the email you sign in with, and Account Management.
 */
export default function AccountSettingsScreen() {
  const router = useRouter();
  const { user, profile } = useSession();
  const study = [majorAbbreviation(profile?.program), classYear(profile?.graduation_year)].filter(Boolean).join(" ");
  const line = profile ? profileStudyLine(profile) : null;
  return (
    <SettingsPage>
      <SettingsSection>
        <SettingsRow title="Edit profile" subtitle="Name, username, photo and bio" onPress={() => router.push("/settings/edit-profile")} />
      </SettingsSection>
      <SettingsSection title="School" footer={line ? `Under your name: ${line}` : "Your major, class year and university show under your name, like CS ’28 @ Texas State University."}>
        <SettingsRow title="University" value={profile?.university?.name ?? "Not set"} onPress={() => router.push("/settings/university")} />
        <SettingsRow title="Major & class year" value={study || "Not set"} onPress={() => router.push("/settings/study")} />
      </SettingsSection>
      <SettingsSection title="Account">
        <SettingsInfoRow title="Email" value={user?.email ?? null} />
        <SettingsRow title="Account Management" onPress={() => router.push("/settings/account-management")} accessibilityHint="Delete your account" />
      </SettingsSection>
    </SettingsPage>
  );
}
