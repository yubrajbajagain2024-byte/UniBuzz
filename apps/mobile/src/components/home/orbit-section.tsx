import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View, type ListViewToken } from "react-native";
import { useRouter } from "expo-router";
import { ADS_EVERY, interleaveAds, listForYou } from "@apartment-book/shared";
import { SponsoredReel } from "@/components/ads/sponsored-reel";
import { Icon } from "@/components/icon";
import { openCompose } from "@/lib/compose-nav";
import { refreshWithHaptic } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useHomeScope } from "@/lib/home-scope";
import { emitPostRemoved, onPostRemoved, takeForYouStale } from "@/lib/posts-events";
import { itemsForPosts, type ViewerItem } from "@/lib/reel-viewer";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useTabReselect } from "@/lib/tab-reselect";
import { auroraGradient, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { feedAdSpacing, isAdRow, useAdImpressions, useFeedAds, type AdRow } from "@/lib/use-feed-ads";
import { ReelCommentsSheet } from "./reel-comments-sheet";
import { ReelItem, reelKey } from "./reel-item";
import { markReelsStale } from "./reels-section";

/** At most this many feed pages are read for one batch: a run of words-only posts is passed over, not waited on. */
const SCAN_PAGES = 5;

/**
 * Home → Orbit, the landing page (2026-11-21, the owner's sketch): the campus's posts and reels blended into one list
 * (listForYou, as the card feed used before) and shown TikTok's way, one full-screen page each, swiped up for the next.
 * Every page is a ReelItem, the same component the full-screen viewer draws, so a post's photos swipe sideways, its
 * video plays while its page is on screen, and the rail (like, comments, save, share, "…") and the words sit where they
 * do everywhere else.
 *
 * `active` = Orbit is the page on screen, so its video plays; `preload` = Orbit is the page next to it, and its first
 * posts load ahead of time without playing. A post of nothing but words has no page here (itemsForPosts keeps those
 * with a photo or a video): it is still on its author's profile, in search and at its own address.
 */
export function OrbitSection({ active, preload = false, topInset, height }: { active: boolean; preload?: boolean; topInset: number; height: number }) {
  // The floating bottom bar covers the page's bottom: the words and the rail sit above it, the picture runs on beneath.
  const tabBar = useTabBarInset();
  const { user, profile } = useSession();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const colors = useColors();
  const styles = useStyles();
  // Your university or all of them, from the dropdown on Orbit; someone without a university sees everything.
  const [scope] = useHomeScope();
  const universityId = scope.campus === "all" || !profile?.university_id ? undefined : profile.university_id;
  const universityRef = useRef(universityId);
  universityRef.current = universityId;
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const [items, setItems] = useState<ViewerItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [visible, setVisible] = useState(0);
  const [commentsKey, setCommentsKey] = useState<string | null>(null);
  const listRef = useRef<FlatList<ViewerItem | AdRow>>(null);
  // Tapping Home again while Orbit is on screen: back to the first post.
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), active);
  const seq = useRef(0);
  /** The last feed page that has been read, and whether there is anything after it. */
  const page = useRef(0);
  const done = useRef(false);
  /** `done` for rendering: a feed shorter than the first ad's place ends with the ad once there are no more posts. */
  const [ended, setEnded] = useState(false);
  const busyMore = useRef(false);
  const started = useRef(false);
  /** Who the pages on screen were fetched for: hearts and "Saved" belong to one person. */
  const loadedFor = useRef<string | null>(null);
  const count = useRef(0);
  useEffect(() => {
    count.current = items?.length ?? 0;
  }, [items]);
  // Sponsored pages between the posts (the first after ADS_FIRST_AFTER, then at most one per ADS_EVERY), each a page of
  // its own, from the same place in the market as the card feed's ads.
  /** Goes up each time a first page lands (the first load, a pull-to-refresh): the ads are asked for again then. */
  const [adsRound, setAdsRound] = useState(0);
  const ads = useFeedAds("for_you", items?.length ?? 0, Boolean(userId), ended, adsRound);
  const rows = useMemo<(ViewerItem | AdRow)[]>(
    () => interleaveAds((items ?? []).map((item) => ({ id: item.sourceId, item })), ads, ADS_EVERY, feedAdSpacing(ended)).map((r) => (r.kind === "ad" ? { id: `ad-${r.ad.id}`, ad: r.ad } : r.item.item)),
    [items, ads, ended],
  );
  const countAds = useAdImpressions("for_you");
  const countAdsRef = useRef(countAds);
  countAdsRef.current = countAds;

  /**
   * Full-screen pages from the feed, starting at the page after `from`: the posts with a photo or a video, with their
   * counts and saves. A feed page of nothing but words has none, so the next is read, up to SCAN_PAGES of them, rather
   * than ending Orbit on a run of words. `seen` keeps a post that a newly published one shifted onto two pages from
   * being listed twice.
   */
  const pagesAfter = useCallback(async (from: number, seen: Set<string>) => {
    let at = from;
    for (let scanned = 0; scanned < SCAN_PAGES; scanned++) {
      const result = await listForYou(supabase, { universityId: universityRef.current, page: at + 1 });
      at = result.page;
      const fresh = result.items.filter((p) => !seen.has(p.id));
      const found = await itemsForPosts(fresh, userIdRef.current);
      if (found.length > 0 || !result.hasMore) return { items: found, page: at, hasMore: result.hasMore };
    }
    return { items: [], page: at, hasMore: true };
  }, []);

  const loadFirst = useCallback(
    async (mode: "initial" | "refresh") => {
      const id = ++seq.current;
      takeForYouStale();
      if (mode === "refresh") setRefreshing(true);
      setError(null);
      try {
        const first = await pagesAfter(0, new Set());
        if (id !== seq.current) return;
        page.current = first.page;
        done.current = !first.hasMore;
        setEnded(done.current);
        setItems(first.items);
        setAdsRound((n) => n + 1);
        setVisible(0);
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      } catch (e) {
        if (id !== seq.current) return;
        // A failed pull-to-refresh keeps what is already on screen.
        if (count.current === 0) setError(errorText(e, "Could not load your feed. Check your connection and try again."));
      } finally {
        if (id === seq.current) setRefreshing(false);
      }
    },
    [pagesAfter],
  );

  const loadMore = useCallback(async () => {
    if (busyMore.current || done.current || !started.current || page.current === 0) return;
    const id = seq.current;
    busyMore.current = true;
    setLoadingMore(true);
    try {
      const more = await pagesAfter(page.current, new Set((items ?? []).map((i) => i.sourceId)));
      if (id !== seq.current) return;
      page.current = more.page;
      if (!more.hasMore) {
        done.current = true;
        setEnded(true);
      }
      if (more.items.length > 0) {
        setItems((prev) => {
          const seen = new Set((prev ?? []).map(reelKey));
          return [...(prev ?? []), ...more.items.filter((i) => !seen.has(reelKey(i)))];
        });
      }
    } catch {
      // Quietly give up: reaching the end again retries.
    } finally {
      busyMore.current = false;
      setLoadingMore(false);
    }
  }, [pagesAfter, items]);

  // Another choice in the dropdown (own campus or global) starts the feed over, once it has loaded at all.
  const scopedFor = useRef(universityId);
  useEffect(() => {
    if (scopedFor.current === universityId) return;
    scopedFor.current = universityId;
    if (started.current) void loadFirst("refresh");
  }, [universityId, loadFirst]);

  // Nothing is fetched until Orbit is opened or comes next to the page on screen; after that, something new to this feed
  // (a post or a reel by this person) or a change of account reloads it. Keyed on both flags, not on "either", so
  // arriving on Orbit from next door checks again: nothing published meanwhile is missed.
  useEffect(() => {
    if (!active && !preload) return;
    if (!started.current) {
      started.current = true;
      loadedFor.current = userId;
      void loadFirst("initial");
    } else if (takeForYouStale() || loadedFor.current !== userId) {
      loadedFor.current = userId;
      void loadFirst("refresh");
    }
  }, [active, preload, userId, loadFirst]);

  // A post deleted anywhere (its own screen, the viewer, another feed) goes from here too, without a reload.
  useEffect(() => onPostRemoved((id) => setItems((prev) => (prev ? prev.filter((i) => i.sourceId !== id) : prev))), []);

  // Leaving Home (for a profile, a listing, login…) closes the comments sheet so it never floats over another screen.
  useEffect(() => {
    if (!active) setCommentsKey(null);
  }, [active]);

  const onPatch = useCallback((key: string, patch: Partial<ViewerItem>) => {
    setItems((prev) => (prev ? prev.map((i) => (reelKey(i) === key ? { ...i, ...patch } : i)) : prev));
  }, []);
  const onRemoved = useCallback((key: string) => {
    setItems((prev) => {
      if (!prev) return prev;
      // A deleted reel is a feed post the Reels feed lists as well.
      if (prev.find((i) => reelKey(i) === key)?.kind === "reel") markReelsStale();
      return prev.filter((i) => reelKey(i) !== key);
    });
    const sep = key.indexOf(":");
    if (key.slice(0, sep) === "post") emitPostRemoved(key.slice(sep + 1));
  }, []);
  const onOpenComments = useCallback((item: { sourceType: string; sourceId: string }) => setCommentsKey(reelKey(item)), []);
  const onCommentCount = useCallback(
    (delta: number) => {
      if (!commentsKey) return;
      setItems((prev) => (prev ? prev.map((i) => (reelKey(i) === commentsKey ? { ...i, comments: Math.max(0, i.comments + delta) } : i)) : prev));
    },
    [commentsKey],
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index != null);
    if (first && first.index != null) setVisible(first.index);
    countAdsRef.current(viewableItems);
  }).current;

  const create = () => (user ? openCompose(router, "post") : router.push("/(auth)/login"));

  if (height <= 0) return <View style={styles.fill} />;

  let body;
  if (error && (!items || items.length === 0)) {
    body = (
      <View style={[styles.fill, styles.centered, { paddingTop: topInset }]}>
        <Icon name="cloud-offline-outline" size={44} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>Your feed did not load</Text>
        <Text style={styles.stateBody}>{error}</Text>
        <Pressable onPress={() => void loadFirst("initial")} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (items === null) {
    body = (
      <View style={[styles.fill, styles.centered]}>
        <ActivityIndicator color={colors.onMedia} size="large" />
      </View>
    );
  } else if (rows.length === 0) {
    body = (
      <View style={[styles.fill, styles.centered, { paddingTop: topInset }]}>
        <Icon name="sparkles-outline" size={48} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>Nothing here yet</Text>
        <Text style={styles.stateBody}>{universityId ? "Photos and videos from your campus show up here." : "Photos and videos from students show up here."}</Text>
        <Pressable onPress={create} style={styles.stateButton} accessibilityRole="button">
          <Icon name="add" size={18} color={colors.onBrand} />
          <Text style={styles.stateButtonText}>Post the first one</Text>
        </Pressable>
        <Pressable onPress={() => void loadFirst("refresh")} hitSlop={8} style={{ marginTop: 14 }} accessibilityRole="button">
          <Text style={styles.again}>{refreshing ? "Checking…" : "Check again"}</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={rows}
        style={{ width, height }}
        keyExtractor={(row) => (isAdRow(row) ? row.id : reelKey(row))}
        renderItem={({ item, index }) => {
          const near = index === visible || (active && Math.abs(index - visible) <= 1);
          return isAdRow(item) ? (
            <SponsoredReel ad={item.ad} width={width} height={height} topInset={topInset} bottomInset={tabBar} near={near} playing={active && index === visible} />
          ) : (
            <ReelItem reel={item} width={width} height={height} topInset={topInset} bottomInset={tabBar} near={near} playing={active && index === visible} onPatch={onPatch} onOpenComments={onOpenComments} onRemoved={onRemoved} />
          );
        }}
        extraData={`${visible}:${active}:${height}:${width}`}
        pagingEnabled
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={2}
        scrollsToTop={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshWithHaptic(() => void loadFirst("refresh"))} tintColor={colors.onMedia} colors={[colors.brand]} progressViewOffset={topInset} />}
      />
    );
  }

  const open = commentsKey ? (items?.find((i) => reelKey(i) === commentsKey) ?? null) : null;
  // Every page here is a post (Orbit has no anonymous buzzes), so the sheet always has a post to comment on.
  const commentsItem = open && open.sourceType !== "buzz" ? { sourceType: open.sourceType, sourceId: open.sourceId, author: open.author, comments: open.comments, commentsOff: open.commentsOff } : null;
  return (
    <View style={{ height, backgroundColor: colors.mediaBg }}>
      {body}
      {/* Posting starts from Create in the middle of the bottom bar, so there is no second "+" here. */}
      {loadingMore && items && visible >= rows.length - 1 ? (
        <View style={[styles.more, { bottom: 6 + tabBar }]} pointerEvents="none">
          <ActivityIndicator color={colors.onMedia} />
        </View>
      ) : null}
      <ReelCommentsSheet reel={commentsItem} onClose={() => setCommentsKey(null)} onCountChange={onCommentCount} />
    </View>
  );
}

/** Orbit stays black in both themes (it sits behind photos and video), so it draws with the media colours, not the screen ones. */
const useStyles = makeStyles((colors) => ({
  fill: { flex: 1, backgroundColor: colors.mediaBg },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  stateTitle: { color: colors.onMedia, ...textStyle.title3, marginTop: 6 },
  stateBody: { color: colors.onMediaMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  stateButton: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora), borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12, marginTop: 12 },
  stateButtonText: { color: colors.onBrand, fontSize: 15, fontWeight: "700" },
  again: { color: colors.onMediaMuted, fontWeight: "600" },
  more: { position: "absolute", left: 0, right: 0, alignItems: "center" },
}));
