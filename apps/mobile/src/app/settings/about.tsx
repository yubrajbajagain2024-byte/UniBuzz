import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { APP_NAME } from "@apartment-book/shared";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/settings-ui";
import { SITE_URL } from "@/lib/supabase";

/** A page of the website (the guidelines, the privacy policy, the terms) in the in-app browser. */
function openSitePage(path: string) {
  void WebBrowser.openBrowserAsync(`${SITE_URL}${path}`, { dismissButtonStyle: "close" }).catch(() => {});
}

/**
 * Settings → About & Support: help (your account's standing and appeals, how Buzz anonymity works, the Community
 * Guidelines), the legal pages (Privacy Policy, Terms of Service), and the app's version.
 */
export default function AboutSettingsScreen() {
  const router = useRouter();
  const version = Constants.expoConfig?.version;
  return (
    <SettingsPage>
      <SettingsSection title="Help">
        <SettingsRow title="Account status and appeals" onPress={() => router.push("/settings/account-status" as never)} />
        <SettingsRow title="How Buzz anonymity works" onPress={() => router.push("/settings/buzz-anonymity" as never)} />
        <SettingsRow title="Community Guidelines" external onPress={() => openSitePage("/guidelines")} />
      </SettingsSection>
      <SettingsSection title="Legal" footer={version ? `${APP_NAME} ${version}` : undefined}>
        <SettingsRow title="Privacy Policy" external onPress={() => openSitePage("/privacy")} />
        <SettingsRow title="Terms of Service" external onPress={() => openSitePage("/terms")} />
      </SettingsSection>
    </SettingsPage>
  );
}
