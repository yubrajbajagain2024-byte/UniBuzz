import { Children, isValidElement, useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type ScrollViewProps, type TextInputProps } from "react-native";
import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import type { SFSymbol } from "expo-symbols";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Icon, type IconName } from "@/components/icon";
import { hapticSelect } from "@/lib/haptics";
import { phosphor } from "@/lib/palette";
import { auroraGradient, textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/*
 * Settings' own kit, after Apple's Settings: inset grouped sections on the grouped background, compact rows (44 points,
 * 17-point text), hairline dividers that start where the row's text does, small aurora icon tiles on the main menu, SF
 * Symbols throughout (the Icon component draws them on iOS) and native switches. Every Settings screen is built from it,
 * so they all read the same.
 */

/** A row's height without a line under its title, and the gap round a section's card. */
const ROW_HEIGHT = 44;
const SIDE = 16;
const CARD_RADIUS = 20;
const TILE = 30;
/** Where a divider starts in a section whose rows have icon tiles: past the tile, under the text. */
const TILE_INSET = SIDE + TILE + 14;

/**
 * The grouped colours: light grey round white cards in Light, black round dark-grey cards in Dark, as iOS draws them.
 * The screens' headers take the same background (see the settings screens' options in app/_layout.tsx).
 */
export function useSettingsColors() {
  const { colors, isDark } = useAppTheme();
  return { page: isDark ? colors.bg : colors.panel, card: colors.card, pressed: isDark ? "#2c2c2e" : "#e5e5ea" };
}

/** The scrolling page every Settings screen sits on. */
export function SettingsPage({ children, contentContainerStyle, ...rest }: ScrollViewProps & { children: ReactNode }) {
  const { page } = useSettingsColors();
  return (
    <ScrollView
      style={{ backgroundColor: page }}
      contentContainerStyle={[{ paddingTop: 12, paddingBottom: 48 }, contentContainerStyle]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

/**
 * One inset group: an optional title above it, its rows on a rounded card with a hairline between each two (starting
 * under the text, past the icon tiles when `tiles`), and an optional footnote below it.
 */
export function SettingsSection({ title, footer, tiles = false, children }: { title?: string; footer?: ReactNode; tiles?: boolean; children: ReactNode }) {
  const styles = useStyles();
  const { card } = useSettingsColors();
  const rows = Children.toArray(children).filter((c) => isValidElement(c));
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={[styles.card, { backgroundColor: card }]}>
        {rows.map((row, i) => (
          <View key={(isValidElement(row) && row.key) || i}>
            {i > 0 ? <View style={[styles.divider, { marginLeft: tiles ? TILE_INSET : SIDE }]} /> : null}
            {row}
          </View>
        ))}
      </View>
      {typeof footer === "string" ? <Text style={styles.footer}>{footer}</Text> : footer}
    </View>
  );
}

export type TileTone = "aurora" | "buzz" | "plain";

/**
 * A row's icon: a small rounded tile with a white symbol on the aurora (the main menu's sections), the Buzz mask on
 * Phosphor (Buzz's rows), or the symbol alone in the brand's colour (rows further in).
 */
export function SettingsTile({ name, sf, tone = "aurora" }: { name: IconName; sf?: SFSymbol; tone?: TileTone }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  if (tone === "buzz") {
    return (
      <View style={[styles.tile, { backgroundColor: phosphor.surface2 }]}>
        <MaterialCommunityIcons name="domino-mask" size={18} color={phosphor.accent} />
      </View>
    );
  }
  if (tone === "plain") {
    return (
      <View style={styles.plainTile}>
        <Icon name={name} sf={sf} size={21} color={colors.brand} />
      </View>
    );
  }
  return (
    <View style={[styles.tile, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) }]}>
      <Icon name={name} sf={sf} size={17} color="#ffffff" />
    </View>
  );
}

type RowBase = {
  title: string;
  /** A line under the title, in the secondary colour. */
  subtitle?: string;
  icon?: { name: IconName; sf?: SFSymbol; tone?: TileTone };
  disabled?: boolean;
  accessibilityHint?: string;
};

/**
 * A row that opens something: another screen (a chevron), a page on the website (`external`: an arrow out), or acts
 * at once (`chevron={false}`). `value` is the current choice, at the right in the secondary colour.
 */
export function SettingsRow({ title, subtitle, icon, value, onPress, chevron = true, external = false, busy = false, disabled, accessibilityHint }: RowBase & { value?: string | null; onPress: () => void; chevron?: boolean; external?: boolean; busy?: boolean }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const { pressed: pressedColor } = useSettingsColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole={external ? "link" : "button"}
      accessibilityLabel={value ? `${title}, ${value}` : title}
      accessibilityHint={accessibilityHint ?? subtitle}
      accessibilityState={{ disabled: Boolean(disabled), busy }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: pressedColor }, disabled && { opacity: 0.45 }]}
    >
      {icon ? <SettingsTile {...icon} /> : null}
      <View style={styles.texts}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {busy ? <ActivityIndicator size="small" color={colors.muted} /> : chevron || external ? <Icon name={external ? "open-outline" : "chevron-forward"} sf={external ? "arrow.up.right" : "chevron.right"} size={external ? 15 : 14} weight="semibold" color={colors.faint} /> : null}
    </Pressable>
  );
}

/** A fact that is not changed here (your sign-in email): its title and value, nothing to tap. */
export function SettingsInfoRow({ title, value, icon }: { title: string; value: string | null; icon?: RowBase["icon"] }) {
  const styles = useStyles();
  return (
    <View style={styles.row} accessible accessibilityLabel={value ? `${title}, ${value}` : title}>
      {icon ? <SettingsTile {...icon} /> : null}
      <Text style={[styles.title, styles.texts]} numberOfLines={1}>
        {title}
      </Text>
      {value ? (
        <Text style={styles.value} numberOfLines={1} selectable>
          {value}
        </Text>
      ) : null}
    </View>
  );
}

/** A setting that is on or off: a native switch, saved by the screen the moment it flips (`busy` while it saves). */
export function SettingsSwitchRow({ title, subtitle, icon, value, onValueChange, busy = false, disabled, accessibilityHint }: RowBase & { value: boolean; onValueChange: (next: boolean) => void; busy?: boolean }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <View style={[styles.row, disabled && { opacity: 0.45 }]}>
      {icon ? <SettingsTile {...icon} /> : null}
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {busy ? <ActivityIndicator size="small" color={colors.muted} style={{ marginRight: 4 }} /> : null}
      <Switch
        value={value}
        disabled={disabled || busy}
        onValueChange={(next) => {
          hapticSelect();
          onValueChange(next);
        }}
        trackColor={{ true: colors.brand }}
        accessibilityLabel={title}
        accessibilityHint={accessibilityHint ?? subtitle}
      />
    </View>
  );
}

/** One choice of several (Light, Dark, System; a university): a checkmark on the chosen one. */
export function SettingsCheckRow({ title, subtitle, checked, onPress, disabled, trailing }: RowBase & { checked: boolean; onPress: () => void; trailing?: ReactNode }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const { pressed: pressedColor } = useSettingsColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ checked, disabled: Boolean(disabled) }}
      style={({ pressed }) => [styles.row, pressed && !disabled && { backgroundColor: pressedColor }]}
    >
      <View style={[styles.texts, disabled && { opacity: 0.45 }]}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing}
      {checked ? <Icon name="checkmark" sf="checkmark" size={17} weight="semibold" color={colors.brand} /> : null}
    </Pressable>
  );
}

/**
 * A field inside a section, as in Contacts: its label at the left and the text filling the rest (or, `multiline`, the
 * label above the text). `prefix` sits before the text ("@" for a username); `error` replaces the section's footnote.
 */
export function SettingsTextRow({ label, prefix, multiline, style, ...props }: TextInputProps & { label: string; prefix?: string }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  return (
    <View style={[styles.field, multiline && styles.fieldStacked]}>
      <Text style={[styles.fieldLabel, multiline && styles.fieldLabelStacked]}>{label}</Text>
      <View style={styles.fieldInputRow}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor={colors.faint}
          keyboardAppearance={isDark ? "dark" : "light"}
          accessibilityLabel={label}
          multiline={multiline}
          style={[styles.input, multiline && styles.inputMultiline, style]}
          {...props}
        />
      </View>
    </View>
  );
}

/** A quiet action in the text's own colour, alone on its line (Account Management's Delete account). */
export function SettingsTextAction({ title, onPress, destructive = false, busy = false, accessibilityHint }: { title: string; onPress: () => void; destructive?: boolean; busy?: boolean; accessibilityHint?: string }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const { pressed: pressedColor } = useSettingsColors();
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={accessibilityHint} accessibilityState={{ busy }} style={({ pressed }) => [styles.row, styles.actionRow, pressed && { backgroundColor: pressedColor }]}>
      {busy ? <ActivityIndicator size="small" color={colors.muted} /> : <Text style={[styles.title, { color: destructive ? colors.red : colors.brand }]}>{title}</Text>}
    </Pressable>
  );
}

/** A form's Save at the right of its header: bold in the brand's colour, dimmed until something changed, a spinner while it saves. */
export function HeaderSaveButton({ enabled, busy, onPress }: { enabled: boolean; busy: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  if (busy) return <ActivityIndicator color={colors.muted} style={{ marginHorizontal: 6 }} />;
  return (
    <Pressable onPress={onPress} disabled={!enabled} hitSlop={10} accessibilityRole="button" accessibilityLabel="Save" accessibilityState={{ disabled: !enabled }} style={{ paddingHorizontal: 6 }}>
      <Text style={[styles.headerSave, { color: enabled ? colors.brand : colors.faint }]}>Save</Text>
    </Pressable>
  );
}

/**
 * A form with unsaved changes asks before it goes (Back, the swipe back): Keep editing, or Discard. Call the returned
 * `leaveSaved` once a Save has gone through: the form then goes back without asking.
 */
export function useDiscardGuard(dirty: boolean): () => void {
  const navigation = useNavigation();
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  usePreventRemove(dirty && !saved, ({ data }) => {
    Alert.alert("Discard changes?", "Your changes haven't been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  // Back only once the guard has let go (the render after `saved`), or it would ask.
  useEffect(() => {
    if (saved && router.canGoBack()) router.back();
  }, [saved, router]);
  return useCallback(() => setSaved(true), []);
}

/** A footnote under a section that is an error rather than a hint. */
export function SettingsError({ message }: { message: string }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return <Text style={[styles.footer, { color: colors.red }]}>{message}</Text>;
}

const useStyles = makeStyles((colors) => ({
  section: { marginBottom: 28, marginHorizontal: SIDE },
  sectionTitle: { ...textStyle.footnote, color: colors.muted, marginLeft: SIDE, marginBottom: 7 },
  card: { borderRadius: CARD_RADIUS, borderCurve: "continuous", overflow: "hidden" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  footer: { ...textStyle.footnote, color: colors.muted, marginHorizontal: SIDE, marginTop: 7 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: ROW_HEIGHT, paddingHorizontal: SIDE, paddingVertical: 10 },
  actionRow: { justifyContent: "center" },
  texts: { flex: 1, gap: 2 },
  title: { ...textStyle.body, color: colors.text },
  subtitle: { ...textStyle.footnote, color: colors.muted },
  value: { ...textStyle.body, color: colors.muted, maxWidth: "52%", textAlign: "right" },
  tile: { width: TILE, height: TILE, borderRadius: 8, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  plainTile: { width: TILE, alignItems: "center", justifyContent: "center" },
  field: { flexDirection: "row", alignItems: "center", minHeight: ROW_HEIGHT, paddingHorizontal: SIDE, gap: 12 },
  fieldStacked: { flexDirection: "column", alignItems: "stretch", paddingVertical: 10, gap: 4 },
  fieldLabel: { ...textStyle.body, color: colors.text, width: 104 },
  fieldLabelStacked: { ...textStyle.footnote, color: colors.muted, width: undefined },
  fieldInputRow: { flex: 1, flexDirection: "row", alignItems: "center" },
  prefix: { ...textStyle.body, color: colors.muted },
  input: { flex: 1, ...textStyle.body, color: colors.text, paddingVertical: 11 },
  inputMultiline: { minHeight: 72, paddingVertical: 2, textAlignVertical: "top" },
  headerSave: { ...textStyle.headline },
}));
