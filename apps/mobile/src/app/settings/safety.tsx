import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { listBlockedIds, setShowActiveStatus } from "@apartment-book/shared";
import { SettingsPage, SettingsRow, SettingsSection, SettingsSwitchRow } from "@/components/settings/settings-ui";
import { alertWithHaptic, hapticSuccess } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";

/**
 * Settings → Safety & Security: the people you have blocked; your activity status (saved at once, through the one call
 * that may show it again, set_show_active_status: migration 22); and reports: your account's standing (warnings, removed
 * content, appeals), the Community Guidelines, and how to report something.
 */
export default function SafetySettingsScreen() {
  const router = useRouter();
  const { user, profile, refreshProfile } = useSession();
  const [blocked, setBlocked] = useState<number | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // Counted again each time you come back (after unblocking someone, say).
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let live = true;
      listBlockedIds(supabase, user.id).then(
        (ids) => live && setBlocked(ids.length),
        () => {},
      );
      return () => {
        live = false;
      };
    }, [user]),
  );

  async function flipActive(next: boolean) {
    setActive(next);
    setBusy(true);
    try {
      await setShowActiveStatus(supabase, next);
      await refreshProfile();
      hapticSuccess();
    } catch (e) {
      alertWithHaptic("error", "Couldn't save", errorText(e, "Check your connection and try again."));
    } finally {
      setBusy(false);
      setActive(null);
    }
  }

  return (
    <SettingsPage>
      <SettingsSection footer="The posts and comments of people you block are hidden from you, and neither of you can message the other.">
        <SettingsRow title="Blocked accounts" value={blocked === null ? null : String(blocked)} onPress={() => router.push("/settings/blocked")} />
      </SettingsSection>
      <SettingsSection footer="Others see when you're active, and people you've messaged see when you were last active. Turn it off and you won't see theirs, and messages to you show Seen but not Delivered.">
        <SettingsSwitchRow title="Activity status" value={active ?? profile?.show_active_status ?? true} busy={busy} onValueChange={(next) => void flipActive(next)} />
      </SettingsSection>
      <SettingsSection title="Reports" footer="To report a post, a comment or a person, use ••• on it. Our team reviews every report.">
        <SettingsRow title="Account status" subtitle="Warnings, removed content and appeals" onPress={() => router.push("/settings/account-status" as never)} />
        <SettingsRow title="Community Guidelines" external onPress={() => void WebBrowser.openBrowserAsync(`${SITE_URL}/guidelines`, { dismissButtonStyle: "close" }).catch(() => {})} />
      </SettingsSection>
    </SettingsPage>
  );
}
