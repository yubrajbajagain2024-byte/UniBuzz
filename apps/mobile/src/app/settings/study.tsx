import { useEffect, useRef, useState } from "react";
import { Stack } from "expo-router";
import { GRADUATION_YEAR_PROBLEM, parseGraduationYear, profileStudyLine } from "@apartment-book/shared";
import { HeaderSaveButton, SettingsError, SettingsPage, SettingsSection, SettingsTextRow, useDiscardGuard } from "@/components/settings/settings-ui";
import { useSaveProfileSettings } from "@/lib/profile-settings";
import { useSession } from "@/lib/session";

/**
 * Account & Profile → Major & class year: the two fields, the line they make under your name ("CS ’28 @ Texas State
 * University") shown as you type, and Save in the header. A year the database would refuse says so under the fields.
 */
export default function StudySettingsScreen() {
  const { profile } = useSession();
  const save = useSaveProfileSettings();
  const [program, setProgram] = useState(profile?.program ?? "");
  const [year, setYear] = useState(profile?.graduation_year ? String(profile.graduation_year) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filled = useRef(Boolean(profile));
  useEffect(() => {
    if (filled.current || !profile) return;
    filled.current = true;
    setProgram(profile.program ?? "");
    setYear(profile.graduation_year ? String(profile.graduation_year) : "");
  }, [profile]);

  const typedYear = parseGraduationYear(year);
  const dirty = profile !== null && ((program.trim() || null) !== (profile.program ?? null) || (Number.isNaN(typedYear) ? true : typedYear !== (profile.graduation_year ?? null)));
  const leaveSaved = useDiscardGuard(dirty && !busy);
  const preview = profileStudyLine({ program, graduation_year: Number.isNaN(typedYear) ? null : typedYear, university: profile?.university ?? null });

  async function onSave() {
    if (!profile || busy) return;
    if (Number.isNaN(typedYear)) return setError(GRADUATION_YEAR_PROBLEM);
    setBusy(true);
    const problem = await save({ program: program.trim() || null, graduationYear: typedYear }, { alert: false });
    setBusy(false);
    if (problem === null) leaveSaved();
    else setError(problem);
  }

  return (
    <SettingsPage>
      <Stack.Screen options={{ headerRight: () => <HeaderSaveButton enabled={dirty} busy={busy} onPress={() => void onSave()} /> }} />
      <SettingsSection footer={error ? <SettingsError message={error} /> : preview ? `Under your name: ${preview}` : "Your major, class year and university show under your name, like CS ’28 @ Texas State University."}>
        <SettingsTextRow label="Major" value={program} onChangeText={setProgram} placeholder="Computer Science" autoCapitalize="words" returnKeyType="done" />
        <SettingsTextRow
          label="Class year"
          value={year}
          onChangeText={(v) => {
            setYear(v.replace(/\D/g, "").slice(0, 4));
            if (error) setError(null);
          }}
          placeholder="2028"
          keyboardType="number-pad"
          maxLength={4}
          accessibilityHint="The year you graduate"
        />
      </SettingsSection>
    </SettingsPage>
  );
}
