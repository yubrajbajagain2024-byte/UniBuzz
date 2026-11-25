import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@/components/icon";
import { INBOX_MEASURES } from "@/components/messages/inbox-header";
import { radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/** The bar's three levels: the section labels, the search field with the filter button, the quick filters. */
const TABS_ROW = 42;
const SEARCH_ROW = 52;
const CHIPS_ROW = 44;
/** The bar's whole height: the pages start this far down, under it, and it slides up this far as they scroll. */
export const DISCOVERY_BAR_HEIGHT = TABS_ROW + SEARCH_ROW + CHIPS_ROW;
const FIELD = 38;

/** Explore's look, or Messages' (Events): the inbox's rows, field, pencil-style button and filled pills, measure for measure. */
export type DiscoveryLook = "explore" | "messages";
const M = INBOX_MEASURES;
/** The bar's whole height in each look: the pages start this far down, under it. */
export function discoveryBarHeight(look: DiscoveryLook): number {
  return look === "messages" ? M.TABS_ROW + M.SEARCH_ROOM + M.SEARCH_FIELD + M.SEARCH_ROOM + M.CHIP + M.FILTERS_ROOM : DISCOVERY_BAR_HEIGHT;
}

/** A chip in the bottom row: a quick filter (`on` when in force) or a choice made in the sheet (`removable`). */
export type DiscoveryChip = { key: string; label: string; on: boolean; removable: boolean; onPress: () => void };

/**
 * Explore's and Events' search and filters, in three levels and nothing else: the section labels (`tabs`, the screen's
 * SlidingTabs), one search field with the filter button beside it (its count says how many filters are on), and one row
 * of small round pills, see-through with a hairline ring: the page's few quick filters, each a tap, then one for every
 * choice made in the filter sheet (with an ×, a tap from being dropped), and Clear when anything is on. A filter in force
 * is UniBuzz blue, its ring and words, on the soft blue fill. Every advanced choice lives in the sheet the button opens. The
 * screen floats the bar over its pages and slides it away as they scroll (useCollapsingHeader); its height is fixed
 * (discoveryBarHeight), so the pages never move under it. `look` "messages" (Events, the owner's brief of 2026-11-25)
 * draws it as Messages' top is drawn, measure for measure (INBOX_MEASURES): no line under the labels, the inbox's taller
 * search field, the filter button bare like the inbox's pencil, and filled pills; Explore keeps its own look.
 */
export function DiscoveryBar({ tabs, query, onQuery, placeholder, searching = false, filterCount, onOpenFilters, filterHint, chips, onClear, look = "explore" }: { look?: DiscoveryLook; tabs: ReactNode; query: string; onQuery: (text: string) => void; placeholder: string; searching?: boolean; filterCount: number; onOpenFilters: () => void; filterHint: string; chips: DiscoveryChip[]; onClear: () => void }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const on = filterCount > 0;
  const m = look === "messages";
  return (
    <View>
      <View style={[styles.tabs, m && styles.mTabs]}>{tabs}</View>
      <View style={[styles.searchRow, m && styles.mSearchRow]}>
        <View style={[styles.search, m && styles.mSearch]}>
          <View style={[styles.searchMark, m && styles.mSearchMark]}>{searching ? <ActivityIndicator size="small" color={colors.muted} /> : <Icon name="search" sf="magnifyingglass" size={m ? 18 : 17} color={colors.muted} />}</View>
          <TextInput value={query} onChangeText={onQuery} placeholder={placeholder} placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} returnKeyType="search" autoCorrect={false} autoCapitalize="none" accessibilityLabel={placeholder} style={[styles.input, m && styles.mInput]} />
          {query ? (
            <Pressable onPress={() => onQuery("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <Icon name="close-circle" sf="xmark.circle.fill" size={17} color={colors.faint} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={onOpenFilters} hitSlop={6} accessibilityRole="button" accessibilityLabel={on ? `Filters, ${filterCount} on` : "Filters"} accessibilityHint={filterHint} style={({ pressed }) => [m ? styles.mFilterButton : [styles.filterButton, on && styles.filterButtonOn], pressed && { opacity: 0.7 }]}>
          <Icon name="options-outline" sf="line.3.horizontal.decrease" size={m ? 24 : 19} weight={m ? "regular" : "semibold"} color={on ? colors.brand : colors.text} />
          {on ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{filterCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.chips, m && styles.mChips]}>
        {chips.map((c) => (
          <Pressable
            key={c.key}
            onPress={c.onPress}
            accessibilityRole="button"
            accessibilityLabel={c.removable ? `${c.label}, remove filter` : c.label}
            accessibilityState={c.removable ? undefined : { selected: c.on }}
            hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
            style={({ pressed }) => [styles.chip, c.on && styles.chipOn, m && styles.mChip, m && c.on && styles.mChipOn, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.chipText, m && styles.mChipText, c.on && styles.chipTextOn]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {c.label}
            </Text>
            {c.removable ? <Icon name="close" sf="xmark" size={10} weight="bold" color={colors.brand} /> : null}
          </Pressable>
        ))}
        {on ? (
          <Pressable onPress={onClear} hitSlop={6} accessibilityRole="button" accessibilityLabel="Clear all filters" style={({ pressed }) => [styles.clear, pressed && { opacity: 0.6 }]}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // The labels row, with the hairline the sliding underline sits on.
  tabs: { height: TABS_ROW, flexDirection: "row", marginHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  // Messages' look (inbox-header.tsx), measure for measure: its labels row with no line under it, its search row and
  // field, the filter button bare and as tall as the field like the inbox's pencil, its filled pills.
  mTabs: { height: M.TABS_ROW, borderBottomWidth: 0 },
  mSearchRow: { height: M.SEARCH_ROOM * 2 + M.SEARCH_FIELD, gap: space.md, paddingHorizontal: 20 },
  mSearch: { height: M.SEARCH_FIELD, gap: 10, paddingHorizontal: 16 },
  // The magnifier in a slot as wide as itself, so the words start where the inbox's do.
  mSearchMark: { width: 18 },
  mInput: { fontSize: 16 },
  mFilterButton: { width: 40, height: M.SEARCH_FIELD, alignItems: "center", justifyContent: "center", marginRight: -8 },
  mChips: { height: M.CHIP + M.FILTERS_ROOM, paddingHorizontal: 20, paddingBottom: M.FILTERS_ROOM },
  mChip: { height: M.CHIP, gap: 6, paddingHorizontal: 14, borderWidth: 0, backgroundColor: colors.input },
  mChipOn: { backgroundColor: colors.brandSoft },
  mChipText: { fontSize: 13, fontWeight: "600" },
  searchRow: { height: SEARCH_ROW, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 16 },
  search: { flex: 1, height: FIELD, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 12 },
  searchMark: { width: 20, alignItems: "center" },
  input: { flex: 1, ...textStyle.body, color: colors.text, paddingVertical: 0 },
  // As tall as the field, round, on the same fill; tinted while a filter is on, with the count on its corner.
  filterButton: { width: FIELD, height: FIELD, borderRadius: FIELD / 2, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  filterButtonOn: { backgroundColor: colors.brandSoft },
  badge: { position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 10, fontWeight: "700", color: colors.onBrand },
  // Small round pills: nothing behind them, a hairline round them; UniBuzz blue when on.
  chips: { height: CHIPS_ROW, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 16, paddingBottom: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 30, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  chipText: { ...textStyle.footnote, fontWeight: "600", color: colors.text },
  chipTextOn: { color: colors.brand },
  clear: { height: 30, paddingHorizontal: 4, justifyContent: "center" },
  clearText: { ...textStyle.footnote, fontWeight: "600", color: colors.muted },
}));
