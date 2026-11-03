import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { requestPasswordReset, RESET_REQUESTED, resetPasswordUrl, resetRequestSchema } from "@apartment-book/shared";
import { Button, Field, Screen } from "@/components/ui";
import { hapticSuccess } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { SITE_URL, supabase } from "@/lib/supabase";
import { textStyle } from "@/lib/theme";
import { useColors } from "@/lib/theme-provider";

/**
 * "Forgot password?" from the login screen (which passes along the email typed there): one field, then "Check your
 * email". The link in that email opens the website's page for choosing a new password (packages/shared/src/auth.ts), so
 * it works on any phone or computer; then the person logs in here. Supabase answers the same whether or not an account
 * exists, and so does this screen.
 */
export default function ForgotPasswordScreen() {
  const colors = useColors();
  const router = useRouter();
  const { email: typed } = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof typed === "string" ? typed : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    const parsed = resetRequestSchema.safeParse({ email });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Enter your email");
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(supabase, parsed.data.email, resetPasswordUrl(SITE_URL));
      hapticSuccess();
      setSent(true);
    } catch (e) {
      setError(errorText(e, "Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Screen>
        <View style={{ gap: 12, paddingTop: 24 }}>
          <Text style={{ ...textStyle.title2, color: colors.text }}>Check your email</Text>
          <Text style={{ color: colors.muted, fontSize: 16 }}>{RESET_REQUESTED}</Text>
          <Text style={{ color: colors.muted, fontSize: 16 }}>The link is good for an hour. It opens a page where you choose a new password; then come back here and log in with it.</Text>
          <Button title="Back to log in" size="large" onPress={() => router.back()} />
          <Button title="Send it again" variant="ghost" onPress={() => setSent(false)} />
        </View>
      </Screen>
    );
  }
  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ gap: 16, paddingTop: 12 }}>
        <Text style={{ ...textStyle.title1, color: colors.text }}>Reset your password</Text>
        <Text style={{ color: colors.muted }}>Enter the email you signed up with and we&apos;ll send a link to choose a new password.</Text>
        <Field label="University email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="you@txstate.edu" autoFocus={!email} returnKeyType="send" onSubmitEditing={submit} />
        {error ? <Text style={{ color: colors.red }}>{error}</Text> : null}
        <Button title="Send reset link" size="large" onPress={submit} loading={busy} />
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={{ textAlign: "center", color: colors.brand, fontWeight: "600" }}>Back to log in</Text>
        </Pressable>
        <View style={{ height: 24 }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
