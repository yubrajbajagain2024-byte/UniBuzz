import { useCallback, useEffect } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Avatar } from "@/components/avatar";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/settings-ui";
import { Button, Card } from "@/components/ui";
import { THEME_PREFERENCES } from "@/lib/palette";
import { useSession } from "@/lib/session";
import { useAppTheme } from "@/lib/theme-provider";
import { useChangeAvatar } from "@/lib/use-change-avatar";

/**
 * Settings, Apple's way: your photo at the top as before, then a short menu of sections, each opening its own screen
 * with the system's push: Account & Profile, Privacy and Safety & Security; Notifications and Appearance; About &
 * Support. Nothing on this screen needs saving: a new photo is saved as soon as it is uploaded.
 */
export default function SettingsScreen() {
  const { user, profile, loading, refreshProfile } = useSession();
  const router = useRouter();
  const { preference } = useAppTheme();
  const avatar = useChangeAvatar({ save: true });

  useEffect(() => {
    if (!loading && !user) router.replace("/(auth)/login");
  }, [loading, user, router]);
  // The profile as it is now, not as it was when the app opened: a choice made since on the website shows here.
  useFocusEffect(
    useCallback(() => {
      void refreshProfile();
    }, [refreshProfile]),
  );

  const appearance = THEME_PREFERENCES.find((o) => o.value === preference)?.label ?? null;
  return (
    <SettingsPage>
      <View style={{ marginHorizontal: 16, marginBottom: 28 }}>
        <Card style={{ alignItems: "center" }}>
          <Avatar name={profile?.full_name} url={profile?.avatar_url} size="xl" />
          <Button title="Change photo" variant="secondary" icon="image-outline" onPress={() => void avatar.change()} loading={avatar.busy} />
        </Card>
      </View>
      <SettingsSection tiles>
        <SettingsRow title="Account & Profile" icon={{ name: "person-circle", sf: "person.crop.circle.fill" }} onPress={() => router.push("/settings/account")} accessibilityHint="Your profile, university, major and class year, and your account" />
        <SettingsRow title="Privacy" icon={{ name: "hand-left", sf: "hand.raised.fill" }} onPress={() => router.push("/settings/privacy")} accessibilityHint="Who can see your classes, saved, liked and listings, and Buzz" />
        <SettingsRow title="Safety & Security" icon={{ name: "shield-checkmark", sf: "checkmark.shield.fill" }} onPress={() => router.push("/settings/safety")} accessibilityHint="Blocked accounts, activity status, account status and reports" />
      </SettingsSection>
      <SettingsSection tiles>
        <SettingsRow title="Notifications" icon={{ name: "notifications", sf: "bell.badge.fill" }} onPress={() => router.push("/settings/notifications")} />
        <SettingsRow title="Appearance" value={appearance} icon={{ name: "contrast", sf: "circle.lefthalf.filled" }} onPress={() => router.push("/settings/appearance")} />
      </SettingsSection>
      <SettingsSection tiles>
        <SettingsRow title="About & Support" icon={{ name: "information-circle", sf: "info.circle.fill" }} onPress={() => router.push("/settings/about")} accessibilityHint="Help, Community Guidelines, the Privacy Policy and the Terms" />
      </SettingsSection>
    </SettingsPage>
  );
}
