import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Notifications from "expo-notifications";
import { SettingsPage, SettingsRow, SettingsSection, SettingsSwitchRow } from "@/components/settings/settings-ui";
import { useSaveProfileSettings } from "@/lib/profile-settings";
import { useSession } from "@/lib/session";

const PHONE = Platform.OS === "ios" ? "iPhone" : "phone";

/**
 * Settings → Notifications: what UniBuzz tells you about (new places near campus, saved at once with the switch), and
 * whether your phone lets it: read from the system each time you come back here, with a row that opens UniBuzz in the
 * phone's own Settings, where banners, sounds and badges are chosen.
 */
export default function NotificationSettingsScreen() {
  const { profile } = useSession();
  const save = useSaveProfileSettings();
  const [nearby, setNearby] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const readPermission = useCallback(() => {
    Notifications.getPermissionsAsync().then(
      (p) => setAllowed(p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL),
      () => setAllowed(null),
    );
  }, []);
  useFocusEffect(readPermission);
  // Back from the phone's Settings: what was chosen there shows here.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => state === "active" && readPermission());
    return () => sub.remove();
  }, [readPermission]);

  const value = nearby ?? profile?.notify_nearby_listings ?? true;
  async function flip(next: boolean) {
    // Shown at once; afterwards the reloaded profile says what was saved (the old value, if the save failed).
    setNearby(next);
    setBusy(true);
    await save({ notifyNearbyListings: next });
    setBusy(false);
    setNearby(null);
  }

  return (
    <SettingsPage>
      <SettingsSection title="Tell me about">
        <SettingsSwitchRow title="New places near campus" subtitle="Within 2 miles of your campus" value={value} busy={busy} onValueChange={(next) => void flip(next)} />
      </SettingsSection>
      <SettingsSection footer={`Choose banners, sounds and badges for UniBuzz in your ${PHONE}'s Settings.`}>
        <SettingsRow title="Notifications" value={allowed === null ? null : allowed ? "On" : "Off"} external onPress={() => void Linking.openSettings()} accessibilityHint={`Opens UniBuzz in your ${PHONE}'s Settings`} />
      </SettingsSection>
    </SettingsPage>
  );
}
