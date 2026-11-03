import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { listUniversities, matchUniversities, universityChoice, verifiedCampus, type University } from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { SettingsCheckRow, SettingsPage, SettingsSection } from "@/components/settings/settings-ui";
import { ErrorBanner } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { useSaveProfileSettings } from "@/lib/profile-settings";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/**
 * Account & Profile → University: a searchable list in place of the old row of chips. Your university is the one your
 * confirmed sign-in address proves (verifiedCampus): it comes first, sealed, and it is the only one you can choose; every
 * other says which address it needs (universityChoice). An account no university verifies chooses freely, as before.
 * A choice is saved at once.
 */
export default function UniversitySettingsScreen() {
  const { user, profile } = useSession();
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const save = useSaveProfileSettings();
  const universities = useQuery(() => listUniversities(supabase), []);
  const [verified, setVerified] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  /** The choice on screen: the saved one, or the one being saved. */
  const [chosen, setChosen] = useState<string | null>(profile?.university_id ?? null);
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    if (!saving) setChosen(profile?.university_id ?? null);
  }, [profile?.university_id, saving]);
  useEffect(() => {
    if (!user) return;
    let live = true;
    verifiedCampus(supabase, user, profile?.role).then(
      (campus) => live && setVerified(campus),
      () => live && setVerified(null),
    );
    return () => {
      live = false;
    };
  }, [user, profile?.role]);

  const verifiedId = verified?.id ?? null;
  const domain = user?.email?.split("@")[1]?.toLowerCase() ?? null;
  const list = useMemo(() => matchUniversities(universities.data ?? [], query, verifiedId), [universities.data, query, verifiedId]);
  const mine = list.filter((u) => u.id === verifiedId);
  const others = list.filter((u) => u.id !== verifiedId);

  async function choose(u: University) {
    if (u.id === chosen || saving) return;
    const before = chosen;
    setChosen(u.id);
    setSaving(u.id);
    const problem = await save({ universityId: u.id });
    setSaving(null);
    if (problem !== null) setChosen(before);
  }

  const row = (u: University) => {
    const choice = universityChoice(u, verifiedId, domain);
    // The one you have now, even if your email no longer proves it, stays ticked and says so.
    const note = u.id === chosen && !choice.verified && verifiedId !== null ? "Not verified by your email" : (choice.note ?? u.city ?? undefined);
    return (
      <SettingsCheckRow
        key={u.id}
        title={u.name}
        subtitle={note}
        checked={u.id === chosen}
        disabled={!choice.selectable}
        onPress={() => void choose(u)}
        trailing={saving === u.id ? <ActivityIndicator size="small" color={colors.muted} /> : choice.verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={18} color={colors.brand} accessibilityLabel="Verified" /> : null}
      />
    );
  };

  const loading = universities.loading || verified === undefined;
  return (
    <SettingsPage>
      <View style={styles.search}>
        <Icon name="search" sf="magnifyingglass" size={17} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search universities"
          placeholderTextColor={colors.faint}
          keyboardAppearance={isDark ? "dark" : "light"}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel="Search universities"
          style={styles.searchInput}
        />
      </View>
      {universities.error ? (
        <View style={{ marginHorizontal: 16, marginBottom: 20 }}>
          <ErrorBanner message={universities.error} onRetry={() => void universities.refresh()} />
        </View>
      ) : null}
      {loading ? (
        <ActivityIndicator color={colors.muted} style={{ marginTop: 24 }} />
      ) : (
        <>
          {mine.length > 0 ? (
            <SettingsSection title="Your university" footer="Your university is the one your sign-in email proves, so everyone can trust the university under your name.">
              {mine.map(row)}
            </SettingsSection>
          ) : null}
          {others.length > 0 ? (
            <SettingsSection title={verifiedId ? "Other universities" : "Universities"} footer={verifiedId ? undefined : "Your sign-in email isn't verified by a university on UniBuzz, so your choice shows as not verified."}>
              {others.map(row)}
            </SettingsSection>
          ) : null}
          {list.length === 0 ? <SettingsSection footer={`No university matches “${query.trim()}”.`}>{[]}</SettingsSection> : null}
        </>
      )}
    </SettingsPage>
  );
}

const useStyles = makeStyles((colors, scheme) => ({
  search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 24, paddingHorizontal: 12, borderRadius: 12, borderCurve: "continuous", backgroundColor: scheme === "dark" ? colors.input : "rgba(118,118,128,0.12)" },
  searchInput: { flex: 1, ...textStyle.body, color: colors.text, paddingVertical: 9 },
}));
