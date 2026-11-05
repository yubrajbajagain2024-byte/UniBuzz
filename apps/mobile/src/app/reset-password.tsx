import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { enterRecoverySession, newPasswordSchema, PASSWORD_MAX, PASSWORD_MIN, PASSWORD_CHANGED, recoveryFromUrl, RESET_LINK_EXPIRED, setNewPassword } from "@apartment-book/shared";
import { Button, Field, Screen } from "@/components/ui";
import { hapticSuccess } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { textStyle } from "@/lib/theme";
import { useColors } from "@/lib/theme-provider";

/** Entering the session a link carried: not yet, done, or refused (the link was stale). */
type Entered = "pending" | "ready" | { refused: string };

/**
 * "Choose a new password", two ways in: a recovery link that opens the app (apartmentbook://reset-password, or an
 * Expo Go address, with the tokens Supabase put after the # as on the website: packages/shared/src/auth.ts), whose
 * session is entered first; or Settings → Safety & Security → Change password while signed in. A link that has
 * expired or was used already, or the screen reached with neither, offers to request a link.
 */
export default function ResetPasswordScreen() {
  const colors = useColors();
  const router = useRouter();
  // What the link brought: its query, as the router hands it over (a link's `url` event fires before this screen mounts
  // its own listener, so Linking.useURL alone would miss it), and the whole address, for a fragment on a cold start.
  const { user, loading } = useSession();
  const params = useLocalSearchParams<Record<string, string>>();
  const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
  const url = Linking.useURL();
  const found = useMemo(() => {
    const fromQuery = recoveryFromUrl(query ? `?${query}` : null);
    return fromQuery.kind !== "none" ? fromQuery : recoveryFromUrl(url);
  }, [query, url]);
  const [entered, setEntered] = useState<Entered>("pending");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Opened by a link: afterwards the person is signed in, and goes to Home rather than back to Settings. */
  const fromLink = found.kind === "session";

  useEffect(() => {
    if (found.kind !== "session") return;
    let live = true;
    enterRecoverySession(supabase, found).then(
      () => live && setEntered("ready"),
      (e: unknown) => live && setEntered({ refused: errorText(e, RESET_LINK_EXPIRED) }),
    );
    return () => {
      live = false;
    };
  }, [found]);

  async function submit() {
    const parsed = newPasswordSchema.safeParse({ password, confirm });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the password");
    setBusy(true);
    setError(null);
    try {
      await setNewPassword(supabase, parsed.data.password);
      hapticSuccess();
      Alert.alert(PASSWORD_CHANGED, fromLink ? "You're logged in." : undefined, [{ text: "OK", onPress: () => (fromLink ? router.replace("/(tabs)") : router.back()) }]);
    } catch (e) {
      setError(errorText(e, "Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  // What the screen can do: a link's session once entered, or the signed-in person's own (Change password).
  const ready = fromLink ? entered === "ready" : found.kind === "none" && user !== null;
  const checking = (fromLink && entered === "pending") || (found.kind === "none" && loading);
  if (checking) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </Screen>
    );
  }
  if (!ready) {
    const expired = found.kind !== "none";
    const why = found.kind === "error" ? found.message : typeof entered === "object" ? entered.refused : expired ? RESET_LINK_EXPIRED : "To choose a new password, request a link and open it on this phone.";
    return (
      <Screen>
        <View style={{ gap: 12, paddingTop: 24 }}>
          <Text style={{ ...textStyle.title2, color: colors.text }}>{expired ? "This link has expired" : "Open the link from your email"}</Text>
          <Text style={{ color: colors.muted, fontSize: 16 }}>{why}</Text>
          <Button title="Request a new link" size="large" onPress={() => router.replace("/(auth)/forgot-password")} />
          <Button title="Log in" variant="ghost" onPress={() => router.replace("/(auth)/login")} />
        </View>
      </Screen>
    );
  }
  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ gap: 16, paddingTop: 12 }}>
        <Text style={{ ...textStyle.title1, color: colors.text }}>Choose a new password</Text>
        <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" placeholder={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters`} autoFocus />
        <Field label="Type it again" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" placeholder="The same password" returnKeyType="done" onSubmitEditing={submit} />
        {error ? <Text style={{ color: colors.red }}>{error}</Text> : null}
        <Button title="Save new password" size="large" onPress={submit} loading={busy} />
        <View style={{ height: 24 }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
