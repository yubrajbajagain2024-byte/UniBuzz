import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import { normalizeUsername, USERNAME_RULES, usernameProblem, type ProfileWithUniversity } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { HeaderSaveButton, SettingsError, SettingsPage, SettingsSection, SettingsTextRow, useDiscardGuard } from "@/components/settings/settings-ui";
import { useSaveProfileSettings } from "@/lib/profile-settings";
import { useSession } from "@/lib/session";
import { textStyle } from "@/lib/theme";
import { useAppTheme } from "@/lib/theme-provider";
import { useChangeAvatar } from "@/lib/use-change-avatar";

function storedUsername(profile: ProfileWithUniversity | null): string {
  const name: unknown = profile?.username;
  return typeof name === "string" ? name : "";
}

/**
 * Account & Profile → Edit profile: your photo (saved as soon as it uploads, as everywhere), then your name, @username
 * and bio, saved together by Save in the header. Only what changed is sent; leaving with unsaved changes asks first.
 */
export default function EditProfileScreen() {
  const { profile } = useSession();
  const { colors } = useAppTheme();
  const save = useSaveProfileSettings();
  const avatar = useChangeAvatar({ save: true });
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [username, setUsername] = useState(storedUsername(profile));
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Opened before the profile had loaded: filled in once, when it arrives (never over what is being typed).
  const filled = useRef(Boolean(profile));
  useEffect(() => {
    if (filled.current || !profile) return;
    filled.current = true;
    setFullName(profile.full_name);
    setUsername(storedUsername(profile));
    setBio(profile.bio ?? "");
  }, [profile]);

  const handle = normalizeUsername(username);
  const handleChanged = profile !== null && handle !== storedUsername(profile);
  const dirty = profile !== null && (fullName.trim() !== profile.full_name || handleChanged || (bio.trim() || null) !== (profile.bio ?? null));
  const leaveSaved = useDiscardGuard(dirty && !busy);

  async function onSave() {
    if (!profile || busy) return;
    const name = fullName.trim();
    const badName = name ? null : "Enter your name.";
    const badHandle = handleChanged ? usernameProblem(handle) : null;
    setNameError(badName);
    setUsernameError(badHandle);
    if (badName || badHandle) return;
    setBusy(true);
    const problem = await save({ fullName: name, bio: bio.trim() || null, username: handleChanged ? handle : undefined }, { alert: false });
    setBusy(false);
    if (problem === null) return leaveSaved();
    // "That username is taken. Try another one." belongs under the username; anything else under the form.
    if (handleChanged && /username/i.test(problem)) setUsernameError(problem);
    else setNameError(problem);
  }

  return (
    <SettingsPage>
      <Stack.Screen options={{ headerRight: () => <HeaderSaveButton enabled={dirty} busy={busy} onPress={() => void onSave()} /> }} />
      <View style={{ alignItems: "center", gap: 10, marginBottom: 24 }}>
        <Avatar name={fullName || profile?.full_name} url={profile?.avatar_url} size="lg" />
        <Pressable onPress={() => void avatar.change()} disabled={avatar.busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change photo" accessibilityState={{ busy: avatar.busy }}>
          <Text style={[textStyle.headline, { color: avatar.busy ? colors.faint : colors.brand }]}>{avatar.busy ? "Uploading…" : "Change photo"}</Text>
        </Pressable>
      </View>
      <SettingsSection footer={nameError ? <SettingsError message={nameError} /> : undefined}>
        <SettingsTextRow
          label="Name"
          value={fullName}
          onChangeText={(v) => {
            setFullName(v);
            if (nameError) setNameError(null);
          }}
          placeholder="Your name"
          autoCapitalize="words"
          textContentType="name"
          returnKeyType="done"
        />
      </SettingsSection>
      <SettingsSection footer={usernameError ? <SettingsError message={usernameError} /> : USERNAME_RULES}>
        <SettingsTextRow
          label="Username"
          prefix="@"
          value={username}
          onChangeText={(v) => {
            setUsername(v.replace(/^@+/, ""));
            if (usernameError) setUsernameError(null);
          }}
          placeholder="yourname"
          accessibilityHint={USERNAME_RULES}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          maxLength={30}
          returnKeyType="done"
        />
      </SettingsSection>
      <SettingsSection footer="A line or two about you, under your name on your profile.">
        <SettingsTextRow label="Bio" value={bio} onChangeText={setBio} placeholder="Add a bio" multiline />
      </SettingsSection>
    </SettingsPage>
  );
}
