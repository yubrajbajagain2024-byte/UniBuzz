import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { authErrorMessage, CONFIRMATION_RESENT, EMAIL_NOT_CONFIRMED, resendSignupConfirmation, signInSchema } from "@apartment-book/shared";
import { Button, Field, Screen } from "@/components/ui";
import { SITE_URL, supabase } from "@/lib/supabase";
import { textStyle } from "@/lib/theme";
import { useColors } from "@/lib/theme-provider";

export default function LoginScreen() {
  const colors = useColors();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resend, setResend] = useState<{ busy: boolean; text: string | null; error: boolean }>({ busy: false, text: null, error: false });

  async function submit() {
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check your details");
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (err) return setError(authErrorMessage(err.message));
    // Close only this modal: the screen underneath (a tab, the inbox, a search) re-renders signed in.
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }

  // Logging in is refused until the email is confirmed: offer a new link (the callback sign-up uses). The answer never
  // says whether an account is waiting.
  async function resendLink() {
    setResend({ busy: true, text: null, error: false });
    try {
      await resendSignupConfirmation(supabase, email.trim().toLowerCase(), `${SITE_URL}/auth/callback?next=/`);
      setResend({ busy: false, text: CONFIRMATION_RESENT, error: false });
    } catch (e) {
      setResend({ busy: false, text: e instanceof Error ? e.message : String(e), error: true });
    }
  }

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ gap: 16, paddingTop: 12 }}>
        <Text style={{ ...textStyle.title1, color: colors.text }}>Welcome back</Text>
        <Text style={{ color: colors.muted }}>Log in with your university email.</Text>
        <Field label="University email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="you@txstate.edu" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" placeholder="••••••••" onSubmitEditing={submit} />
        {error ? <Text style={{ color: colors.red }}>{error}</Text> : null}
        {error === EMAIL_NOT_CONFIRMED ? (
          <View style={{ gap: 8 }}>
            {resend.text ? <Text style={{ color: resend.error ? colors.red : colors.muted }}>{resend.text}</Text> : null}
            <Button title="Send a new confirmation link" variant="secondary" onPress={resendLink} loading={resend.busy} />
          </View>
        ) : null}
        <Button title="Log in" size="large" onPress={submit} loading={busy} />
        <Pressable onPress={() => router.replace("/(auth)/signup")}>
          <Text style={{ textAlign: "center", color: colors.brand, fontWeight: "600" }}>New here? Create an account</Text>
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: "/(auth)/forgot-password", params: email.trim() ? { email: email.trim() } : {} })} accessibilityRole="button">
          <Text style={{ textAlign: "center", color: colors.muted }}>Forgot password?</Text>
        </Pressable>
        <View style={{ height: 24 }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
