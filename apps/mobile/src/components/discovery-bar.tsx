import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@/components/icon";
import { radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/** The bar's three levels: the section labels, the search field with the filter button, the quick filters. */
const TABS_ROW = 42;
const SEARCH_ROW = 52;
const CHIPS_ROW = 44;
/** The bar's whole height: the pages start this far down, under it, and it slides up this far as they scroll. */
export const DISCOVERY_BAR_HEIGHT = TABS_ROW + SEARCH_ROW + CHIPS_ROW;
const FIELD = 38;

/** A chip in the bottom row: a quick filter (`on` when in force) or a choice made in the sheet (`removable`). */
export type DiscoveryChip = { key: string; label: string; on: boolean; removable: boolean; onPress: () => void };

/**
 * Explore's and Events' search and filters, in three levels and nothing else: the section labels (`tabs`, the screen's
 * SlidingTabs), one search field with the filter button beside it (its count says how many filters are on), and one row
 * of small round pills, see-through with a hairline ring: the page's few quick filters, each a tap, then one for every
 * choice made in the filter sheet (with an ×, a tap from being dropped), and Clear when anything is on. A filter in force
 * is UniBuzz blue, its ring and words, on the soft blue fill. Every advanced choice lives in the sheet the button opens. The
 * screen floats the bar over its pages and slides it away as they scroll (useCollapsingHeader); its height is fixed
 * (DISCOVERY_BAR_HEIGHT), so the pages never move under it.
 */
export function DiscoveryBar({ tabs, query, onQuery, placeholder, searching = false, filterCount, onOpenFilters, filterHint, chips, onClear }: { tabs: ReactNode; query: string; onQuery: (text: string) => void; placeholder: string; searching?: boolean; filterCount: number; onOpenFilters: () => void; filterHint: string; chips: DiscoveryChip[]; onClear: () => void }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const on = filterCount > 0;
  return (
    <View>
      <View style={styles.tabs}>{tabs}</View>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <View style={styles.searchMark}>{searching ? <ActivityIndicator size="small" color={colors.muted} /> : <Icon name="search" sf="magnifyingglass" size={17} color={colors.muted} />}</View>
          <TextInput value={query} onChangeText={onQuery} placeholder={placeholder} placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} returnKeyType="search" autoCorrect={false} autoCapitalize="none" accessibilityLabel={placeholder} style={styles.input} />
          {query ? (
            <Pressable onPress={() => onQuery("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <Icon name="close-circle" sf="xmark.circle.fill" size={17} color={colors.faint} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={onOpenFilters} hitSlop={6} accessibilityRole="button" accessibilityLabel={on ? `Filters, ${filterCount} on` : "Filters"} accessibilityHint={filterHint} style={({ pressed }) => [styles.filterButton, on && styles.filterButtonOn, pressed && { opacity: 0.7 }]}>
          <Icon name="options-outline" sf="line.3.horizontal.decrease" size={19} weight="semibold" color={on ? colors.brand : colors.text} />
          {on ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{filterCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
        {chips.map((c) => (
          <Pressable
            key={c.key}
            onPress={c.onPress}
            accessibilityRole="button"
            accessibilityLabel={c.removable ? `${c.label}, remove filter` : c.label}
            accessibilityState={c.removable ? undefined : { selected: c.on }}
            hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
            style={({ pressed }) => [styles.chip, c.on && styles.chipOn, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.chipText, c.on && styles.chipTextOn]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
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
