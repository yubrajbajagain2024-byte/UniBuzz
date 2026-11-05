import { useState } from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import { deleteMyAccount } from "@apartment-book/shared";
import { SettingsInfoRow, SettingsPage, SettingsSection, SettingsTextAction } from "@/components/settings/settings-ui";
import { alertWithHaptic } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

/**
 * Account & Profile → Account Management: the account you sign in with, and, at the very bottom, Delete account: a
 * quiet line of red text rather than a red button, but always here, two taps from Settings, as Apple requires of an
 * app with accounts. It asks first, then deletes everything (deleteMyAccount) and signs you out.
 */
export default function AccountManagementScreen() {
  const { user, signOut } = useSession();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  function confirmDelete() {
    alertWithHaptic("warning", "Delete your account?", "Your profile, posts, messages and saved items will be permanently deleted. This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete account",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteMyAccount(supabase);
            await signOut();
            router.dismissTo("/(tabs)");
          } catch (e) {
            setDeleting(false);
            Alert.alert("Could not delete", e instanceof Error ? e.message : "Try again later");
          }
        },
      },
    ]);
  }

  return (
    <SettingsPage contentContainerStyle={{ flexGrow: 1 }}>
      <SettingsSection title="Sign-in" footer="You sign in with your university email.">
        <SettingsInfoRow title="Email" value={user?.email ?? null} />
      </SettingsSection>
      {/* The rest of the screen is left empty, so Delete account sits apart at the bottom. */}
      <View style={{ flex: 1, minHeight: 120 }} />
      <SettingsSection footer="Deleting your account removes your profile, posts, messages and saved items for good.">
        <SettingsTextAction title="Delete account" destructive busy={deleting} onPress={confirmDelete} accessibilityHint="Asks before it permanently deletes your account" />
      </SettingsSection>
    </SettingsPage>
  );
}
