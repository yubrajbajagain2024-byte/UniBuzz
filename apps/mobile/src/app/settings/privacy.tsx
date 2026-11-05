import { useState } from "react";
import { useRouter } from "expo-router";
import { PROFILE_SECTIONS, PROFILE_VISIBILITY_OPTIONS, sectionVisibilityOf, visibilityLabel, type ProfileSection, type ProfileSettingsPatch, type ProfileVisibility } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { visibilityQuestion } from "@/components/profile/visibility-row";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/settings-ui";
import { useSaveProfileSettings } from "@/lib/profile-settings";
import { useSession } from "@/lib/session";

const TITLES: Record<ProfileSection, string> = { classes: "Classes", saved: "Saved", liked: "Liked", listings: "Listings" };
const PATCH_KEY: Record<ProfileSection, keyof ProfileSettingsPatch> = { classes: "classesVisibility", saved: "savedVisibility", liked: "likedVisibility", listings: "listingsVisibility" };

/**
 * Settings → Privacy: who can see each of your profile's tabs (Classes, Saved, Liked, Listings), each a row with its
 * choice; a tap offers Everyone, Friends and Only me and saves the one picked at once. Then Buzz: your anonymous posts
 * and how their anonymity works, which never appear on your profile.
 */
export default function PrivacySettingsScreen() {
  const router = useRouter();
  const { profile } = useSession();
  const show = useActionSheet();
  const save = useSaveProfileSettings();
  /** A choice being saved, shown at once and put back if the save fails. */
  const [pending, setPending] = useState<Partial<Record<ProfileSection, ProfileVisibility>>>({});

  const valueOf = (section: ProfileSection): ProfileVisibility | null => pending[section] ?? (profile ? sectionVisibilityOf(profile, section) : null);

  function change(section: ProfileSection) {
    const now = valueOf(section);
    show(
      PROFILE_VISIBILITY_OPTIONS.map((o) => ({
        label: o.label,
        icon: o.value === now ? ("checkmark" as const) : undefined,
        onPress: async () => {
          if (o.value === now) return;
          setPending((p) => ({ ...p, [section]: o.value }));
          await save({ [PATCH_KEY[section]]: o.value });
          setPending((p) => {
            const next = { ...p };
            delete next[section];
            return next;
          });
        },
      })),
      `${visibilityQuestion(section)}?`,
    );
  }

  return (
    <SettingsPage>
      <SettingsSection title="Who can see your profile's tabs" footer="Friends are people you follow who follow you back. Saved, Liked and Listings start as Only me. A tab others may not see doesn't show on your profile for them at all; you always see every tab.">
        {PROFILE_SECTIONS.map((section) => {
          const value = valueOf(section);
          return <SettingsRow key={section} title={TITLES[section]} value={value ? visibilityLabel(value) : null} busy={pending[section] !== undefined} onPress={() => change(section)} accessibilityHint={visibilityQuestion(section)} />;
        })}
      </SettingsSection>
      {/* Buzz is anonymous: its own list and how that works live here, never on your profile or on Home. */}
      <SettingsSection title="Buzz" tiles footer="Buzz is fully anonymous to other students. Your public profile never links to it.">
        <SettingsRow title="My buzzes" subtitle="Everything you posted anonymously" icon={{ name: "eye-off", tone: "buzz" }} onPress={() => router.push("/buzz/mine" as never)} />
        <SettingsRow title="How Buzz anonymity works" icon={{ name: "eye-off", tone: "buzz" }} onPress={() => router.push("/settings/buzz-anonymity" as never)} />
      </SettingsSection>
    </SettingsPage>
  );
}
