import { type ReactNode, type Ref } from "react";
import { Animated, Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { SlidingTabs } from "@/components/sliding-tabs";
import { auroraGradient, radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import type { InboxFilter, InboxPage } from "./inbox-utils";
import { Icon } from "@/components/icon";

/** The two pages of the inbox, left to right: the order of the pager and of the labels above it. */
export const INBOX_PAGES: { value: InboxPage; label: string }[] = [
  { value: "chats", label: "Chats" },
  { value: "groups", label: "Groups" },
];

/** The pills under the search box; Requests is only offered on Chats (a request is a direct chat). */
export const INBOX_FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "requests", label: "Requests" },
];

/** Heights of the header's rows: the title, Chats | Groups, the search field (with the room above and below it) and the pills. */
const TOP_ROW = 52;
const TABS_ROW = 44;
const SEARCH_FIELD = 46;
const SEARCH_ROOM = space.md;
const CHIP = 32;
const FILTERS_ROOM = space.sm;

/** The signed-in header's whole height, below the status bar: how far the Messages tab's lists start down, under it. */
export const INBOX_HEADER_HEIGHT = TOP_ROW + TABS_ROW + SEARCH_ROOM + SEARCH_FIELD + SEARCH_ROOM + CHIP + FILTERS_ROOM;

/**
 * The Messages tab's own top bar, below the status bar: the big "Messages" title with the new-message pencil at the right
 * of the same row, then Chats | Groups above the pager with Home's sliding violet underline (`scrollX` is the pager's
 * offset and `pageWidth` the width of one page, so the underline follows the finger), `children` (the search field) and
 * the All | Unread | Requests pills that narrow the page (Requests on Chats only, each pill carrying its count). The tab
 * scrolls all of it away with the list (app/(tabs)/messages.tsx); a drag that starts on the title or between the
 * controls goes through to the list underneath, so it scrolls as if the header were part of it. Signed out, the bar
 * shows only the title.
 */
export function InboxHeader({ signedIn, page, onPage, scrollX, pageWidth, requestCount, filter, unreadChats, pageUnread, onFilter, onNewChat, children }: { signedIn: boolean; page: InboxPage; onPage: (page: InboxPage) => void; scrollX: Animated.Value; pageWidth: number; requestCount: number; filter: InboxFilter; unreadChats: number; /** Unread messages on each page, for the red badges on Chats and Groups. */ pageUnread?: Partial<Record<InboxPage, number>>; onFilter: (filter: InboxFilter) => void; onNewChat: () => void; children?: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();

  function pickFilter(next: InboxFilter) {
    if (next === filter) return;
    // Silent: the pill's highlight is the feedback (no haptic).
    onFilter(next);
  }
  const pills = page === "groups" ? INBOX_FILTERS.filter((f) => f.value !== "requests") : INBOX_FILTERS;
  const countOf = (f: InboxFilter) => (f === "unread" ? unreadChats : f === "requests" ? requestCount : 0);

  return (
    <View pointerEvents="box-none" style={styles.chrome}>
      <View pointerEvents="box-none" style={styles.topRow}>
        <Text pointerEvents="none" style={styles.title} accessibilityRole="header" numberOfLines={1}>
          Messages
        </Text>
        {signedIn ? (
          <Pressable onPress={onNewChat} hitSlop={8} accessibilityRole="button" accessibilityLabel="New message" style={({ pressed }) => [styles.compose, pressed && { opacity: 0.6 }]}>
            <Icon name="create-outline" size={24} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      {signedIn ? (
        <View style={styles.tabs}>
          <SlidingTabs sections={INBOX_PAGES} section={page} onSelect={onPage} scrollX={scrollX} pageWidth={pageWidth} tint={colors.accent} tintGradient={auroraGradient(colors.auroraGlow, 90)} labelColor={colors.text} dimColor={colors.muted} gap={110} fontSize={16} badges={pageUnread} />
        </View>
      ) : null}
      {children}
      {signedIn ? (
        <View pointerEvents="box-none" style={styles.filters} accessibilityRole="tablist">
          {pills.map((f) => {
            const selected = f.value === filter;
            const n = countOf(f.value);
            const count = n > 0 ? (n > 99 ? "99+" : String(n)) : null;
            return (
              <Pressable key={f.value} onPress={() => pickFilter(f.value)} accessibilityRole="tab" accessibilityLabel={count ? `${f.label}, ${count}` : f.label} accessibilityState={{ selected }} style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !selected && { opacity: 0.7 }]}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.label}</Text>
                {count ? <Text style={[styles.chipCount, selected && styles.chipTextSelected]}>{count}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The rounded search box of the inbox and the new-chat screen: magnifier, the words, a clear button once something is
 * typed, and (when `onCancel` is given and the box is in use) a Cancel that leaves the search.
 */
export function InboxSearchField({ value, onChangeText, placeholder = "Search", autoFocus, inputRef, onFocusChange, showCancel = false, onCancel, accessibilityLabel, compact = false }: { value: string; onChangeText: (text: string) => void; placeholder?: string; autoFocus?: boolean; inputRef?: Ref<TextInputInstance>; onFocusChange?: (focused: boolean) => void; showCancel?: boolean; onCancel?: () => void; accessibilityLabel?: string; /** New Message: a slimmer field (40 points, Explore's height) with even room above and below. */ compact?: boolean }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  return (
    <View pointerEvents="box-none" style={styles.searchRow}>
      <View style={[styles.search, compact && styles.searchCompact]}>
        <Icon name="search" size={compact ? 17 : 18} color={colors.muted} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          keyboardAppearance={isDark ? "dark" : "light"}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          autoFocus={autoFocus}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          accessibilityLabel={accessibilityLabel ?? placeholder}
          style={styles.input}
        />
        {value ? (
          <Pressable onPress={() => onChangeText("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="close-circle" size={18} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>
      {showCancel && onCancel ? (
        <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel search" style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  chrome: { backgroundColor: colors.bar },
  // The title and the pencil share one row, so the tabs and the search box sit a row higher.
  topRow: { height: TOP_ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: space.lg },
  compose: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flexShrink: 1, ...textStyle.largeTitle, color: colors.text },
  // The labels row, as tall as Home's, with the hairline the sliding underline sits on.
  tabs: { height: TABS_ROW, flexDirection: "row", marginHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  filters: { flexDirection: "row", gap: space.sm, paddingHorizontal: 20, paddingBottom: FILTERS_ROOM },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: CHIP, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.input },
  chipSelected: { backgroundColor: colors.brandSoft },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  chipTextSelected: { color: colors.brand },
  chipCount: { fontSize: 12, fontWeight: "700", color: colors.muted },
  searchRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 20, paddingTop: SEARCH_ROOM, paddingBottom: SEARCH_ROOM },
  // The input fill, not the card colour: the screen behind it is white in light and black in dark.
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 16, height: SEARCH_FIELD },
  // Compact: a 40-point field with its icon and words drawn closer, the same room above and below.
  searchCompact: { height: 40, gap: 8, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
  cancel: { fontSize: 15, fontWeight: "600", color: colors.text },
}));
