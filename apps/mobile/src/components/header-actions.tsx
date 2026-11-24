import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import type { SymbolWeight } from "expo-symbols";
import { useRouter } from "expo-router";
import { useSession } from "@/lib/session";
import { useColors } from "@/lib/theme-provider";
import { useUnreadNotifications } from "@/lib/use-unread";
import { Icon } from "@/components/icon";

/** Each button's square: the symbol in the middle, a 6pt hitSlop round it. */
export const HEADER_ACTION_SIZE = 36;

/** The width of HeaderActions' row for that many buttons (36pt squares, 4pt apart). */
export function headerActionsWidth(count: number): number {
  return count * HEADER_ACTION_SIZE + (count - 1) * 4;
}

/**
 * The top-right corner of Home, in the owner's own order (2026-11-21): with `explore`, the compass, which opens Explore
 * (app/housing.tsx: Housing | Roommate | Marketplace, which left the bottom bar when Events took its place); the
 * Notifications bell, which opens the notifications screen with a badge of how many are unread while signed in; then
 * the magnifier, which opens the search screen (app/search.tsx: people, topics, posts and what is popular on every
 * campus). `color` lets Home paint them white over the Orbit feed (with `iconStyle`'s shadow); `inHeader` adds the
 * right margin a native header does not give its headerRight. `weight` sets the glyphs' stroke (Home's are bold).
 */
export function HeaderActions({ color, inHeader = false, iconStyle, explore = false, weight }: { color?: string; inHeader?: boolean; iconStyle?: StyleProp<TextStyle>; explore?: boolean; weight?: SymbolWeight }) {
  const colors = useColors();
  const router = useRouter();
  const { user } = useSession();
  const unread = useUnreadNotifications(user?.id ?? null);
  return (
    <View style={[styles.row, inHeader && styles.inHeader]}>
      {explore ? (
        <Pressable onPress={() => router.push("/housing" as never)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Explore" accessibilityHint="Housing, roommates and the marketplace" style={styles.button}>
          <Icon name="compass-outline" sf="safari" size={25} weight={weight} color={color ?? colors.text} style={iconStyle} />
        </Pressable>
      ) : null}
      <Pressable onPress={() => router.push("/notifications")} hitSlop={6} accessibilityRole="button" accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} style={styles.button}>
        <Icon name="notifications-outline" size={26} weight={weight} color={color ?? colors.text} style={iconStyle} />
        {unread > 0 ? (
          <View style={[styles.badge, { backgroundColor: colors.dangerFill }]}>
            <Text style={[styles.badgeText, { color: colors.onBrand }]} numberOfLines={1}>
              {unread > 99 ? "99+" : unread}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable onPress={() => router.push("/search" as never)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Search" accessibilityHint="People, topics, posts and what is popular" style={styles.button}>
        <Icon name="search-outline" sf="magnifyingglass" size={25} weight={weight} color={color ?? colors.text} style={iconStyle} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  button: { width: HEADER_ACTION_SIZE, height: HEADER_ACTION_SIZE, alignItems: "center", justifyContent: "center" },
  inHeader: { marginRight: 8 },
  // The red count over the bell's top-right shoulder, overlapping it, with no ring round it (the owner's reference,
  // Instagram's, 2026-11-23): it sits on whatever is behind it, the feed's picture included.
  badge: { position: "absolute", top: 2, right: 1, minWidth: 17, height: 17, borderRadius: 8.5, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 10, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
