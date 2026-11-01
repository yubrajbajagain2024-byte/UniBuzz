import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { listBlockedPeople, unblockUser } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-ui";
import { ErrorBanner } from "@/components/ui";
import { hapticSuccess } from "@/lib/haptics";
import { errorText, useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { textStyle } from "@/lib/theme";
import { useAppTheme } from "@/lib/theme-provider";

/**
 * Safety & Security → Blocked accounts: everyone you have blocked, newest first, each with Unblock, which asks first.
 * Unblocking shows their posts and comments to you again and lets you message each other (unblockUser).
 */
export default function BlockedAccountsScreen() {
  const { user } = useSession();
  const { colors } = useAppTheme();
  const people = useQuery(() => (user ? listBlockedPeople(supabase, user.id) : Promise.resolve([])), [user?.id]);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  function confirmUnblock(person: { id: string; full_name: string }) {
    const first = person.full_name.split(" ")[0] || person.full_name;
    Alert.alert(`Unblock ${first}?`, "Their posts and comments will show to you again, and you'll be able to message each other.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unblock",
        onPress: async () => {
          if (!user) return;
          setUnblocking(person.id);
          try {
            await unblockUser(supabase, user.id, person.id);
            hapticSuccess();
            people.setData((list) => (list ?? []).filter((p) => p.id !== person.id));
          } catch (e) {
            Alert.alert("Couldn't unblock", errorText(e, "Check your connection and try again."));
          } finally {
            setUnblocking(null);
          }
        },
      },
    ]);
  }

  const list = people.data ?? [];
  return (
    <SettingsPage>
      {people.error ? (
        <View style={{ marginHorizontal: 16, marginBottom: 20 }}>
          <ErrorBanner message={people.error} onRetry={() => void people.refresh()} />
        </View>
      ) : null}
      {people.loading && !people.data ? (
        <ActivityIndicator color={colors.muted} style={{ marginTop: 24 }} />
      ) : list.length === 0 ? (
        <Text style={[textStyle.subheadline, { color: colors.muted, textAlign: "center", marginTop: 32, marginHorizontal: 32 }]}>You haven't blocked anyone. You can block someone from ••• on their profile.</Text>
      ) : (
        <SettingsSection>
          {list.map((p) => (
            <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
              <Avatar name={p.full_name} url={p.avatar_url} size="md" />
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={[textStyle.body, { color: colors.text }]} numberOfLines={1}>
                  {p.full_name}
                </Text>
                {p.username ? (
                  <Text style={[textStyle.footnote, { color: colors.muted }]} numberOfLines={1}>
                    @{p.username}
                  </Text>
                ) : null}
              </View>
              {unblocking === p.id ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : (
                <Pressable onPress={() => confirmUnblock(p)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Unblock ${p.full_name}`} style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.input, opacity: pressed ? 0.7 : 1 })}>
                  <Text style={[textStyle.subheadline, { color: colors.text, fontWeight: "600" }]}>Unblock</Text>
                </Pressable>
              )}
            </View>
          ))}
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
