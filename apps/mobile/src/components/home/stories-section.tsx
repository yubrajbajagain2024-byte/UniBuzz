import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useRouter } from "expo-router";
import { STORY_RING, STORY_RING_GAP, type StoryGroup } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { refreshWithHaptic } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { handStories, refreshStories, useStories } from "@/lib/stories-store";
import { useTabBarInset } from "@/lib/tab-bar";
import { auroraGradient, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useCreateMenu } from "./create-menu";

/** Three rings to a row on every phone: the ring is what is left of the row once the gutters and the gaps are taken. */
const COLUMNS = 3;
const GUTTER = 16;
const GAP = 12;
/** A ring no bigger than this, however wide the phone: on a large one the rings sit in from the edges instead of growing. */
const RING_MAX = 112;

/** One row of the grid, by the person whose stories it is. */
type Cell = { key: string; group: StoryGroup | null };

/**
 * Home → Stories, the page left of Orbit (the owner's sketch, 2026-11-21): everyone whose stories this person may see,
 * as a page of rings rather than the row that used to sit across the top of the feed. "Your story" comes first (your
 * photo with a + to share one; once you have one, your own ring, which opens it), then the unseen in the aurora ring,
 * the seen in a quiet grey one, a first name under each. A tap opens them full screen (app/stories), swiping on from
 * there through the rest of the page, as the row's taps did. Only what the database lets this person see is ever here
 * (migration 58's rules). Signed out there is nothing to show but the invitation to log in.
 */
export function StoriesSection({ active, topInset, onScroll }: { active: boolean; topInset: number; onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void }) {
  const { user, profile } = useSession();
  const router = useRouter();
  const create = useCreateMenu();
  const colors = useColors();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const tabBar = useTabBarInset();
  const groups = useStories(user?.id ?? null, active);
  const [refreshing, setRefreshing] = useState(false);
  const inset = useMemo(() => listInset(topInset), [topInset]);

  const mine = groups.find((g) => g.mine) ?? null;
  const others = useMemo(() => groups.filter((g) => !g.mine), [groups]);
  // Your own ring first, whether or not you have a story: its cell is the one that shares one.
  const cells = useMemo<Cell[]>(() => [{ key: "mine", group: mine }, ...others.map((g) => ({ key: g.author.id, group: g }))], [mine, others]);

  const ring = Math.min(RING_MAX, Math.floor((width - GUTTER * 2 - GAP * (COLUMNS - 1)) / COLUMNS));
  const photo = ring - 2 * (STORY_RING + STORY_RING_GAP);

  const open = useCallback(
    (group: StoryGroup) => {
      const list = mine ? [mine, ...others] : others;
      const index = list.indexOf(group);
      handStories(list, index < 0 ? 0 : index);
      router.push({ pathname: "/stories/[id]", params: { id: group.author.id } });
    },
    [mine, others, router],
  );

  const refresh = useCallback(() => {
    if (!user) return;
    setRefreshing(true);
    void refreshStories(user.id).finally(() => setRefreshing(false));
  }, [user]);
  // A pull that came back while the page was left behind never leaves the spinner turning.
  useEffect(() => {
    if (!active) setRefreshing(false);
  }, [active]);

  const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

  if (!user) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: topInset }]}>
        <Icon name="camera-outline" size={48} color={colors.faint} />
        <Text style={styles.stateTitle}>Stories from your campus</Text>
        <Text style={styles.stateBody}>Log in to see the photos and videos students share for a day.</Text>
        <Pressable onPress={() => router.push("/(auth)/login")} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Log in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AnimatedFlatList
        data={cells}
        keyExtractor={(c: Cell) => c.key}
        numColumns={COLUMNS}
        {...inset.list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        columnWrapperStyle={styles.row}
        contentContainerStyle={{ paddingTop: inset.paddingTop + 12, paddingBottom: 32 + tabBar, paddingHorizontal: GUTTER, gap: 18 }}
        accessibilityLabel="Stories"
        renderItem={({ item }: { item: Cell }) => {
          const g = item.group;
          const isMine = item.key === "mine";
          const label = isMine ? (g ? `Your story, ${g.stories.length} ${g.stories.length === 1 ? "story" : "stories"}` : "Your story") : `${g!.author.full_name}'s story${g!.seen ? ", seen" : ""}`;
          const lit = isMine ? Boolean(g) : !g!.seen;
          return (
            <Pressable
              onPress={() => (g ? open(g) : create())}
              style={({ pressed }) => [styles.cell, { width: ring }, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityHint={isMine && !g ? "Share a photo or video that disappears after 24 hours" : undefined}
            >
              <View style={[styles.ring, { width: ring, height: ring, borderRadius: ring / 2 }, lit ? { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) } : isMine ? styles.ringNone : styles.ringSeen]}>
                <View style={[styles.ringGap, { width: ring - 2 * STORY_RING, height: ring - 2 * STORY_RING, borderRadius: (ring - 2 * STORY_RING) / 2 }]}>
                  <Avatar name={isMine ? profile?.full_name : g!.author.full_name} url={isMine ? (profile?.avatar_url ?? null) : g!.author.avatar_url} size={photo} online={false} />
                </View>
                {/* The + to share: on its own once you have stories (a tap on the photo opens them), on the whole ring when you have none. */}
                {isMine ? (
                  <Pressable onPress={create} hitSlop={6} accessibilityRole="button" accessibilityLabel="Add to your story" style={[styles.plus, { borderColor: colors.bg }]}>
                    <Icon name="add" size={16} color="#fff" weight="bold" />
                  </Pressable>
                ) : null}
              </View>
              <Text style={[styles.name, !isMine && g!.seen && styles.nameSeen]} numberOfLines={1}>
                {isMine ? "Your story" : firstName(g!.author.full_name)}
              </Text>
            </Pressable>
          );
        }}
        ListFooterComponent={
          others.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.stateBody}>Nobody has shared a story yet. Share one and it shows here for a day.</Text>
            </View>
          ) : undefined
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshWithHaptic(refresh)} progressViewOffset={inset.progressViewOffset} />}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  // The rings sit from the row's start, so a short last row lines up under the one above it.
  row: { gap: GAP, justifyContent: "flex-start" },
  cell: { alignItems: "center", gap: 8 },
  pressed: { opacity: 0.75 },
  ring: { alignItems: "center", justifyContent: "center" },
  ringSeen: { backgroundColor: colors.border },
  ringNone: { backgroundColor: "transparent" },
  // The gap between the ring and the photo, in the page's own colour.
  ringGap: { backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  plus: { position: "absolute", right: 2, bottom: 2, width: 26, height: 26, borderRadius: 13, borderWidth: 2.5, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 13, fontWeight: "600", color: colors.text, textAlign: "center" },
  nameSeen: { color: colors.muted, fontWeight: "500" },
  empty: { paddingTop: 20, paddingHorizontal: 16 },
  stateTitle: { ...textStyle.title3, color: colors.text, textAlign: "center", marginTop: 6 },
  stateBody: { color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  stateButton: { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora), borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, marginTop: 12 },
  stateButtonText: { color: colors.onBrand, fontSize: 15, fontWeight: "700" },
}));
