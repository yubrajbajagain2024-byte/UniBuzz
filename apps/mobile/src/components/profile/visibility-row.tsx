import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import { ownSectionNote, PROFILE_SECTION_NOUNS, PROFILE_VISIBILITY_OPTIONS, visibilityLabel, type ProfileSection, type ProfileVisibility } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { radius, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";

export const VISIBILITY_ICONS: Record<ProfileVisibility, keyof typeof Ionicons.glyphMap> = { public: "earth-outline", friends: "people-outline", private: "lock-closed-outline" };

/** "Who can see your saved posts": the question each setting answers, in the settings and on the Change button. */
export function visibilityQuestion(section: ProfileSection): string {
  return `Who can see your ${PROFILE_SECTION_NOUNS[section]}`;
}

/**
 * The owner's line at the top of Classes, Saved, Liked and Listings: a globe, people or lock, "Only you can see your saved posts",
 * and Change, which offers Everyone, Friends and Only me. The sheet's title names the current one ("… Now: Only me"),
 * since the iOS sheet shows no icons; elsewhere it is ticked as well.
 */
export function VisibilityRow({ section, value, busy, onChange }: { section: ProfileSection; value: ProfileVisibility; busy?: boolean; onChange: (value: ProfileVisibility) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const show = useActionSheet();
  const question = visibilityQuestion(section);
  // "Change who can see your saved posts": the button's name starts with the word it shows.
  const changeLabel = `Change ${question.charAt(0).toLowerCase()}${question.slice(1)}`;
  function change() {
    show(
      PROFILE_VISIBILITY_OPTIONS.map((o) => ({
        label: o.label,
        icon: o.value === value ? ("checkmark" as const) : undefined,
        onPress: () => {
          if (o.value !== value) onChange(o.value);
        },
      })),
      `${question}? Now: ${visibilityLabel(value)}`,
    );
  }
  return (
    <View style={styles.row}>
      <Icon name={VISIBILITY_ICONS[value]} size={16} color={colors.muted} />
      <Text style={styles.note}>{ownSectionNote(section, value)}</Text>
      <Pressable onPress={change} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel={changeLabel} accessibilityState={{ disabled: Boolean(busy), busy: Boolean(busy) }} style={({ pressed }) => [styles.change, pressed && { opacity: 0.6 }]}>
        {busy ? <ActivityIndicator size="small" color={colors.brand} /> : <Text style={styles.changeText}>Change</Text>}
      </Pressable>
    </View>
  );
}

/** What a visitor sees on a tab they may not open: a lock and "Only Sunil's friends can see their classes". */
export function LockedNotice({ message }: { message: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.locked} accessible accessibilityLabel={message}>
      <View style={styles.lockCircle}>
        <Icon name="lock-closed" size={24} color={colors.text} />
      </View>
      <Text style={styles.lockedText}>{message}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  note: { flex: 1, fontSize: 13, color: colors.muted },
  change: { minWidth: 64, minHeight: 30, paddingHorizontal: 12, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  changeText: { fontSize: 13, fontWeight: "700", color: colors.text },
  locked: { alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingVertical: 40 },
  lockCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: colors.text, alignItems: "center", justifyContent: "center" },
  lockedText: { fontSize: 15, fontWeight: "600", color: colors.text, textAlign: "center" },
}));
