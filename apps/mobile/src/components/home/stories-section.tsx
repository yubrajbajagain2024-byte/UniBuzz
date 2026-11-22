import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icon";
import { StoryPlayer } from "@/components/stories/story-player";
import { openHomeSection } from "@/lib/home-section";
import { useSession } from "@/lib/session";
import { refreshStories, useStories } from "@/lib/stories-store";
import { useTabBarInset } from "@/lib/tab-bar";
import { auroraGradient, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useCreateMenu } from "./create-menu";

/** The bars sit this far under the status bar, with Home's tab labels just below them (HOME_TOP_BAR_HEIGHT's TOP_GAP). */
const BARS_TOP = 2;

/**
 * Home → Stories, the page left of Orbit (the owner's brief, 2026-11-21): the stories themselves, playing, rather than
 * a row or a grid of rings to tap. Whoever's stories this person may see are the pages of one player (StoryPlayer,
 * components/stories/story-player.tsx), the very one the full-screen viewer draws: each story edge to edge on black
 * and whole, a bar for each along the very top filling as it plays, the name at the bottom left and the rail down the
 * right as on a post, and the reply pill just above the floating bottom bar (`bottomInset`), which stays in view here
 * — this is a page of Home, not a screen over it, so there is no Close.
 *
 * The first story starts as soon as the tab is on screen and they play on by themselves; a tap on the right goes to
 * the next, on the left back; a sideways swipe turns to the next person like a cube, and one past the last person is
 * handed to Home's pager, so Orbit is a swipe away as it is from any page. Past the last story of the last person the
 * page moves on to Orbit of its own accord, which is what lies beyond the stories. Only what the database lets this
 * person see is ever here (migration 58's rules). Signed out there is nothing but the invitation to log in.
 */
export function StoriesSection({ active, topInset, height }: { active: boolean; topInset: number; height: number }) {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const create = useCreateMenu();
  const colors = useColors();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBar = useTabBarInset();
  const groups = useStories(user?.id ?? null, active);
  const userId = user?.id ?? null;

  // Loaded once the store has answered for this person: until then, neither the stories nor "nobody has shared one".
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!userId || !active) return;
    let stale = false;
    void refreshStories(userId).finally(() => {
      if (!stale) setLoaded(true);
    });
    return () => {
      stale = true;
    };
  }, [userId, active]);

  /** Past the last story of the last person: on to Orbit, the page beside this one. */
  const onDone = useCallback(() => openHomeSection("foryou"), []);
  // A new person's stories (or one whose stories ran out) rebuild the player rather than leaving it on a stale page.
  const key = useMemo(() => groups.map((g) => g.author.id).join("|"), [groups]);

  // The session is read from the phone at startup: until it has answered, nobody is asked to log in.
  if (sessionLoading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.onMedia} size="large" />
      </View>
    );
  }
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
  if (groups.length === 0) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: topInset }]}>
        {loaded ? (
          <>
            <Icon name="camera-outline" size={48} color={colors.onMediaMuted} />
            <Text style={styles.stateTitle}>No stories yet</Text>
            <Text style={styles.stateBody}>Photos and videos your campus shares for a day play here. Share the first one.</Text>
            <Pressable onPress={() => create()} style={styles.stateButton} accessibilityRole="button">
              <Icon name="add" size={18} color={colors.onBrand} />
              <Text style={styles.stateButtonText}>Add to your story</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={colors.onMedia} size="large" />
        )}
      </View>
    );
  }
  if (height <= 0) return <View style={styles.screen} />;
  return (
    <View style={{ width, height, backgroundColor: colors.mediaBg }}>
      {/* The bars are pinned above Home's tabs, right under the status bar; the story itself runs on behind both. */}
      <StoryPlayer key={key} groups={groups} start={0} width={width} height={height} barsTop={insets.top + BARS_TOP} bottomInset={tabBar} active={active} onDone={onDone} />
    </View>
  );
}

/** The page is black in both themes: it is nothing but pictures and video. */
const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.mediaBg },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  stateTitle: { ...textStyle.title3, color: colors.onMedia, textAlign: "center", marginTop: 6 },
  stateBody: { color: colors.onMediaMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  stateButton: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora), borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, marginTop: 12 },
  stateButtonText: { color: colors.onBrand, fontSize: 15, fontWeight: "700" },
}));
