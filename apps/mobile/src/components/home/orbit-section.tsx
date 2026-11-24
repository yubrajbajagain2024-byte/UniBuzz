import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View, type ListViewToken } from "react-native";
import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { cancelAnimation, Easing, runOnJS, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { ADS_EVERY, interleaveAds, listForYou } from "@apartment-book/shared";
import { SponsoredReel } from "@/components/ads/sponsored-reel";
import { Icon } from "@/components/icon";
import { openCompose } from "@/lib/compose-nav";
import { refreshWithHaptic } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useHomeScope } from "@/lib/home-scope";
import { emitPostRemoved, onPostRemoved, takeForYouStale } from "@/lib/posts-events";
import { useStories } from "@/lib/stories-store";
import { itemsForPosts, type ViewerItem } from "@/lib/reel-viewer";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useTabReselect } from "@/lib/tab-reselect";
import { auroraGradient, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { feedAdSpacing, isAdRow, useAdImpressions, useFeedAds, type AdRow } from "@/lib/use-feed-ads";
import { FeedCardContext, FeedClearContext, ViewerPagerLockContext } from "@/lib/viewer-chrome";
import { ReelCommentsSheet } from "./reel-comments-sheet";
import { ReelItem, reelKey } from "./reel-item";
import { markReelsStale } from "./reels-section";
import { STORIES_ROW_HEIGHT, StoriesHeader } from "./stories-row";

/** At most this many feed pages are read for one batch: a run of words-only posts is passed over, not waited on. */
const SCAN_PAGES = 5;

/**
 * The stories row opened from the pill over a later post (the owner's screen recording, 2026-11-22): how long it takes
 * to open or fold on a tap, and how far an upward drag must fold it (or how fast) to finish folding on release rather
 * than spring back open.
 */
const ROW_MS = 280;
const ROW_FOLD_AT = 0.7;
const ROW_FLICK = 500;
/**
 * The room at the very top of the feed, above the open row, that a pull into refreshes it: pulled this far in and let
 * go, the feed reloads, waiting this far down under its spinner meanwhile.
 */
const REFRESH_ROOM = 96;
const REFRESH_PULL = 56;
const REFRESH_HOLD = 48;
/** The post under the open row is a card with rounded top corners, TikTok's. */
const CARD_RADIUS = 12;
/**
 * Pulling the folded row down from the first post (or swiping up from the open row): let go this far along, or with a
 * flick that way (points per millisecond, the scroll view's measure), and it goes all the way, at once; short of it,
 * it springs back. A short pull is enough, TikTok's, rather than half the row's room.
 */
const ROW_COMMIT = 48;
const ROW_FLICK_SPEED = 0.25;

/**
 * How long the row's own settle takes (after a pull or a swipe let go, or a tap), by how far it has to go: quick, and
 * eased out so it starts at speed and lands softly (TikTok's snap), never the scroll view's slower, eased-in glide.
 */
function settleTime(distance: number): number {
  "worklet";
  return Math.max(150, Math.min(260, 110 + distance * 0.6));
}
/** A drag this far down the feed takes the stories pill away; as far up brings it back. */
const TOP_AWAY = 24;


/**
 * Nothing mounts this now: Orbit is the card feed again (ForYouSection, the owner's request of 2026-11-24), and its
 * full-screen pages are the viewer's, one tap on a post away. Kept, like the card feed was, so either can come back.
 *
 * Orbit as it was from 2026-11-21 (the owner's sketch): the campus's posts and reels blended into one list
 * (listForYou, as the card feed uses) and shown TikTok's way, one full-screen page each, swiped up for the next.
 * Every page is a ReelItem, the same component the full-screen viewer draws, so a post's photos swipe sideways, its
 * video plays while its page is on screen, and the rail (like, comments, save, share, "…") and the words sit where they
 * do everywhere else.
 *
 * `active` = Orbit is the page on screen, so its video plays; `preload` = Orbit is the page next to it, and its first
 * posts load ahead of time without playing. A post of nothing but words has no page here (itemsForPosts keeps those
 * with a photo or a video): it is still on its author's profile, in search and at its own address.
 */
export function OrbitSection({ active, preload = false, topInset, height, onTopHidden }: { active: boolean; preload?: boolean; topInset: number; height: number; /** Home's top bar should step away (the post on screen is clear, after a pinch) or come back. */ onTopHidden?: (hidden: boolean) => void }) {
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
  // An animated ref: the row's settle after a drag is started from the UI thread (scrollTo), with no wait on JavaScript.
  const listRef = useAnimatedRef<FlatList<ViewerItem | AdRow>>();

  /**
   * The stories row over the feed, TikTok's Following page (the owner's screen recordings, 2026-11-22), for anyone
   * signed in. Open, the row sits on black under Home's tabs and the post is a card under it, lowered by the row's room
   * with its words and rail put away and its picture raised into it (FeedCardContext); folded, the post has the whole
   * screen and a pill under the tabs counts the new stories.
   *
   * At the top of the feed the row's room is part of the feed itself, TikTok's way: a header above the first post as
   * tall as the row's room (`rowRoom`), with a refresh room above that (REFRESH_ROOM). The feed snaps to the open row
   * (`openAt`), to the first post (`firstAt`, the row folded) and then post by post, so the row folds as the first post is
   * swiped up, and scrolling back up from lower posts stops on the first post with the row still folded; only a further
   * pull down scrolls into the row's room, natively, following the finger, and settles open or back. Pulled on past the
   * open row into the refresh room and let go, the feed reloads. Elsewhere a tap on the pill opens the row over the post
   * on screen instead (`pillOpen`): the card is lowered under it and the feed holds still until a drag up or a tap on the
   * card folds it.
   *
   * `rowOpen` is how open the row is, on the UI thread (the further of the two: the scroll's or the pill's), which the
   * row, the pill and the card's chrome all follow, so nothing re-renders while it moves; `rowShown` is the same for
   * what takes touches. Signed out there is none of this: no header, the feed paging from its first post.
   */
  const storiesOn = user !== null;
  const rowRoom = topInset + STORIES_ROW_HEIGHT;
  /** The feed's offsets with the row open, and on its first post (the row folded); 0 and 0 signed out. */
  const openAt = storiesOn ? REFRESH_ROOM : 0;
  const firstAt = storiesOn ? REFRESH_ROOM + rowRoom : 0;
  const openAtRef = useRef(openAt);
  openAtRef.current = openAt;
  const firstAtRef = useRef(firstAt);
  firstAtRef.current = firstAt;
  /** How far the feed has scrolled, on the UI thread. */
  const scrollY = useSharedValue(openAt);
  /**
   * The feed scrolled down (on to later posts) and not back up since (the owner's brief, 2026-11-22): the stories pill,
   * and only the pill, steps away while the finger drags the feed down past TOP_AWAY, and comes back the moment it drags
   * it up as far, or the feed is at its top (the first post, or the row open). Home's top bar stays. Only the finger's
   * drag decides, never the settle after it, so a small pull that springs back does not make the pill flicker.
   */
  const [scrolledAway, setScrolledAway] = useState(false);
  const awayNow = useSharedValue(0);
  const dragging = useSharedValue(0);
  /**
   * The row's settle, driven on the UI thread: `settleY` eases to the open row or the first post and the feed follows it
   * frame by frame (scrollTo); the first frame also stops the scroll view's own deceleration, so the two never fight.
   * A finger on the feed again stops it at once (onBeginDrag).
   */
  const settleY = useSharedValue(0);
  const settling = useSharedValue(0);
  useAnimatedReaction(
    () => settleY.value,
    (v) => {
      if (settling.value === 1) scrollTo(listRef, 0, v, false);
    },
  );
  /** Where the drag under way began, to tell a swipe up from the open row (see endDrag). */
  const dragFrom = useSharedValue(0);
  const endDragRef = useRef<(y: number, from: number) => void>(() => {});
  const endDrag = useCallback((y: number, from: number) => endDragRef.current(y, from), []);
  // The feed's scroll, its drags' starts and ends, all on the UI thread in one place.
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y;
      scrollY.value = y;
      let away = awayNow.value;
      if (y <= firstAt + 1) away = 0;
      else if (dragging.value === 1) {
        if (y - dragFrom.value > TOP_AWAY) away = 1;
        else if (y - dragFrom.value < -TOP_AWAY) away = 0;
      }
      if (away !== awayNow.value) {
        awayNow.value = away;
        runOnJS(setScrolledAway)(away === 1);
      }
    },
    onBeginDrag: (e) => {
      if (settling.value === 1) {
        cancelAnimation(settleY);
        settling.value = 0;
      }
      dragFrom.value = e.contentOffset.y;
      dragging.value = 1;
    },
    onEndDrag: (e) => {
      dragging.value = 0;
      const y = e.contentOffset.y;
      const from = dragFrom.value;
      const speed = e.velocity?.y ?? 0;
      // The row's two moves settle here, on the UI thread, the moment the finger lifts (the scroll view's own snap would
      // otherwise glide slowly there, or back, on a slow release): a pull down from the folded first post opens it past
      // ROW_COMMIT or on a flick down, and a swipe up from the open row folds it onto the first post the same way.
      let target = -1;
      if (firstAt > 0 && Math.abs(from - firstAt) <= 1 && y < from) {
        target = from - y > ROW_COMMIT || speed < -ROW_FLICK_SPEED ? openAt : firstAt;
      } else if (firstAt > 0 && Math.abs(from - openAt) <= 1 && y > from) {
        target = y - from > ROW_COMMIT || speed > ROW_FLICK_SPEED ? firstAt : openAt;
      }
      if (target >= 0) {
        settling.value = 1;
        settleY.value = y;
        settleY.value = withTiming(target, { duration: settleTime(Math.abs(target - y)), easing: Easing.out(Easing.cubic) }, (done) => {
          if (done) settling.value = 0;
        });
        return;
      }
      runOnJS(endDrag)(y, from);
    },
  });
  /** How open the row is from where the feed is: 1 at the open row (and above it), 0 from the first post on. */
  const scrollOpen = useDerivedValue(() => (firstAt > 0 ? Math.max(0, Math.min(1, (firstAt - scrollY.value) / rowRoom)) : 0));
  /** The row opened from the pill over a later post (1), and that it is (for touches). */
  const pillOpen = useSharedValue(0);
  const [pillShown, setPillShown] = useState(false);
  /** A pinch on a post is under way (ReelItem's feed pinch): the feed holds still until it ends. */
  const [pinchLock, setPinchLock] = useState(false);
  /**
   * The post on screen is clear (a pinch on it, TikTok's clear mode): the stories (the pill or the row) fade away with
   * everything else over it, and Home's top bar too (onClearChange), until it comes back.
   */
  const [clearPage, setClearPage] = useState(false);
  /** The stories step away for a clear post or the feed scrolled down; Home's top bar only for a clear post. */
  const topHidden = clearPage || scrolledAway;
  useEffect(() => {
    onTopHidden?.(clearPage && active);
  }, [clearPage, active, onTopHidden]);
  const clearFade = useSharedValue(0);
  useEffect(() => {
    clearFade.value = withTiming(topHidden ? 1 : 0, { duration: topHidden ? 160 : 220 });
  }, [topHidden, clearFade]);
  const storiesFadeStyle = useAnimatedStyle(() => ({ opacity: 1 - clearFade.value }));
  const rowOpen = useDerivedValue(() => Math.max(scrollOpen.value, pillOpen.value));
  const [rowShown, setRowShown] = useState(storiesOn);
  useAnimatedReaction(
    () => rowOpen.value > 0.5,
    (now, before) => {
      if (now !== before) runOnJS(setRowShown)(now);
    },
  );
  const heightRef = useRef(height);
  heightRef.current = height;
  /**
   * Opens the row, from where the feed really is (its offset on the UI thread, not the post last reported on screen,
   * which lags while a swipe settles): on the first post by scrolling up to the open row; on any other post, the feed
   * finishes coming to rest on the post it is arriving at (smoothly, so a tap mid-settle never leaves it between two
   * posts) while the row opens over that post, both at once.
   */
  /** The row's quick settle (see settleY) from wherever the feed is now: the pill tapped on the first post, a tap folding it. */
  const settleTo = useCallback(
    (target: number) => {
      const y = scrollY.value;
      settling.value = 1;
      settleY.value = y;
      settleY.value = withTiming(target, { duration: settleTime(Math.abs(target - y)), easing: Easing.out(Easing.cubic) }, (done) => {
        if (done) settling.value = 0;
      });
    },
    [scrollY, settleY, settling],
  );
  const openRow = useCallback(() => {
    const top = firstAtRef.current;
    if (top === 0) return;
    const y = scrollY.value;
    const page = heightRef.current;
    if (y < top + page / 2) {
      settleTo(openAtRef.current);
      return;
    }
    listRef.current?.scrollToOffset({ offset: top + Math.round((y - top) / page) * page, animated: true });
    setPillShown(true);
    pillOpen.value = withTiming(1, { duration: ROW_MS, easing: Easing.out(Easing.cubic) });
  }, [pillOpen, scrollY, settleTo]);
  /** Folds the row opened over a post from the pill; at the top of the feed, scrolls on to the first post. */
  const foldRow = useCallback(() => {
    if (pillOpen.value > 0) {
      setPillShown(false);
      pillOpen.value = withTiming(0, { duration: ROW_MS, easing: Easing.out(Easing.cubic) });
      return;
    }
    settleTo(firstAtRef.current);
  }, [pillOpen, settleTo]);
  // Signing in or out starts the row over (the feed reloads for the new account, at its top).
  useEffect(() => {
    setPillShown(false);
    pillOpen.value = 0;
  }, [storiesOn, pillOpen]);
  /** The post as a card under the open row: what of it shows above the bottom bar, and that its chrome takes no touches (see FeedCardContext). */
  const card = useMemo(() => (storiesOn ? { open: rowOpen, height: Math.max(0, height - tabBar - rowRoom), chromeOff: rowShown } : null), [storiesOn, rowOpen, height, tabBar, rowRoom, rowShown]);
  const refreshingNow = useSharedValue(0);

  // Tapping Home again while Orbit is on screen: back to the top of the feed, with the stories row open.
  useTabReselect(() => {
    if (pillOpen.value > 0) {
      setPillShown(false);
      pillOpen.value = 0;
    }
    listRef.current?.scrollToOffset({ offset: openAtRef.current, animated: true });
  }, active);
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
        // A fresh feed starts at its top, where the stories row is open (signed out, on its first post).
        listRef.current?.scrollToOffset({ offset: openAtRef.current, animated: mode === "refresh" });
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

  useEffect(() => {
    refreshingNow.value = refreshing ? 1 : 0;
  }, [refreshing, refreshingNow]);

  const listShown = !(error && (!items || items.length === 0)) && items !== null && rows.length > 0;
  /**
   * Let go inside the refresh room (pulled up past the open row): far enough in, the feed reloads, waiting under its
   * spinner (loadFirst brings it back to the open row); not so far, back to the open row. The room above the open row is
   * not one the feed snaps to on its own (snapToStart false), so this decides. A swipe up from the open row lands on the
   * first post, the row folded, even one long enough to pass it.
   */
  endDragRef.current = (y: number, from: number) => {
    const top = openAtRef.current;
    if (top === 0) return;
    // (A swipe up from the open row, and a pull down from the folded first post, settle on the UI thread: onEndDrag.)
    if (y >= top) return;
    if (top - y >= REFRESH_PULL && !refreshing) {
      listRef.current?.scrollToOffset({ offset: top - REFRESH_HOLD, animated: true });
      void loadFirst("refresh");
    } else {
      listRef.current?.scrollToOffset({ offset: refreshing ? top - REFRESH_HOLD : top, animated: true });
    }
  };
  // A refresh that ends while the feed still waits in the refresh room (loadFirst already moved it if it reloaded).
  useEffect(() => {
    if (!refreshing && scrollY.value < openAtRef.current - 1) listRef.current?.scrollToOffset({ offset: openAtRef.current, animated: true });
  }, [refreshing, scrollY]);

  /**
   * The row opened from the pill over a later post: a vertical drag over the card is its (the feed holds still meanwhile).
   * Up folds it, following the finger, the same post rising into the room; let go past ROW_FOLD_AT (or a flick) it folds,
   * otherwise it springs back open. Sideways drags fail it, so Home's sections still swipe.
   */
  const rowPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(pillShown)
        .activeOffsetY([-10, 10])
        .failOffsetX([-14, 14])
        .onUpdate((e) => {
          pillOpen.value = Math.max(0, Math.min(1, 1 + Math.min(0, e.translationY) / rowRoom));
        })
        .onFinalize((e) => {
          const fold = pillOpen.value < ROW_FOLD_AT || e.velocityY < -ROW_FLICK;
          pillOpen.value = withTiming(fold ? 0 : 1, { duration: fold ? 220 : 180, easing: Easing.out(Easing.cubic) });
          if (fold) runOnJS(setPillShown)(false);
        }),
    [pillShown, pillOpen, rowRoom],
  );
  // The card a pill opens the row over: lowered by the row's room, its top corners rounding, TikTok's.
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pillOpen.value * rowRoom }],
    borderTopLeftRadius: pillOpen.value * CARD_RADIUS,
    borderTopRightRadius: pillOpen.value * CARD_RADIUS,
  }));
  // The refresh's spinner: in the gap a pull past the open row leaves between the row and the first post.
  const spinnerStyle = useAnimatedStyle(() => {
    const gap = Math.max(0, openAt - scrollY.value);
    return { opacity: refreshingNow.value === 1 ? Math.min(1, gap / 16) : Math.min(1, gap / REFRESH_PULL), transform: [{ translateY: gap / 2 - 10 }] };
  });
  /** The list's header with stories: the refresh room and the row's room, black, above the first post. */
  const header = useMemo(() => (firstAt > 0 ? <View style={{ height: firstAt }} /> : undefined), [firstAt]);
  /** Where the feed comes to rest: the open row, the first post, then each post (with stories; signed out it pages). */
  const snaps = useMemo(() => (firstAt > 0 ? [openAt, ...rows.map((_, i) => firstAt + height * i)] : undefined), [firstAt, openAt, rows, height]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index != null);
    if (first && first.index != null) setVisible(first.index);
    countAdsRef.current(viewableItems);
  }).current;

  const create = () => (user ? openCompose(router, "post") : router.push("/(auth)/login"));

  // The stories at the top (components/home/stories-row.tsx).
  const storyGroups = useStories(userId, active);

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
      <Reanimated.FlatList
        ref={listRef}
        data={rows}
        // While the row is open over a later post (from the pill) the feed holds still: its drags are the row's (rowPan).
        // So it does through a pinch on a post (ViewerPagerLockContext), which would otherwise scroll it with two fingers.
        scrollEnabled={!pillShown && !pinchLock}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={header}
        contentOffset={firstAt > 0 ? { x: 0, y: openAt } : undefined}
        style={{ width, height }}
        keyExtractor={(row) => (isAdRow(row) ? row.id : reelKey(row))}
        renderItem={({ item, index }) => {
          const near = index === visible || (active && Math.abs(index - visible) <= 1);
          const page = isAdRow(item) ? (
            <SponsoredReel ad={item.ad} width={width} height={height} topInset={topInset} bottomInset={tabBar} mediaBottom={tabBar} near={near} playing={active && index === visible} />
          ) : (
            <ReelItem reel={item} photoDoubleTap="like" width={width} height={height} topInset={topInset} bottomInset={tabBar} mediaBottom={tabBar} near={near} playing={active && index === visible} onPatch={onPatch} onOpenComments={onOpenComments} onRemoved={onRemoved} />
          );
          // Under the open row at the top, the first post is a card with rounded top corners.
          return index === 0 && firstAt > 0 ? <FirstCard open={scrollOpen}>{page}</FirstCard> : page;
        }}
        extraData={`${visible}:${active}:${height}:${width}`}
        pagingEnabled={firstAt === 0}
        snapToOffsets={snaps}
        snapToStart={false}
        disableIntervalMomentum={firstAt > 0}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: height, offset: firstAt + height * i, index: i })}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={2}
        scrollsToTop={false}
        // Signed in, the pull past the open row into the refresh room refreshes (endDrag), with its own spinner.
        refreshControl={storiesOn ? undefined : <RefreshControl refreshing={refreshing} onRefresh={refreshWithHaptic(() => void loadFirst("refresh"))} tintColor={colors.onMedia} colors={[colors.brand]} progressViewOffset={topInset} />}
      />
    );
    if (storiesOn) {
      body = (
        // Clipped at the bottom bar's top edge, so a card lowered under the row never runs behind the bar.
        <View style={[styles.cardClip, { height: height - tabBar }]}>
          <GestureDetector gesture={rowPan}>
            <Reanimated.View style={[styles.card, { height }, cardStyle]}>
              {body}
              {/* While the row is open over a post from the pill, the post is a preview: a tap brings it up to the whole
                  screen, and nothing under it (its rail, its words, both put away) takes a touch or VoiceOver's focus. */}
              {pillShown ? <Pressable style={StyleSheet.absoluteFill} onPress={foldRow} accessibilityRole="button" accessibilityLabel="Show the post" accessibilityHint="Hides the stories row" accessibilityViewIsModal /> : null}
            </Reanimated.View>
          </GestureDetector>
          {/* Over the feed's black header, in the gap a pull past the open row leaves above the first post. */}
          <Reanimated.View pointerEvents="none" style={[styles.spinner, { top: rowRoom }, spinnerStyle]}>
            <ActivityIndicator color={colors.onMedia} />
          </Reanimated.View>
        </View>
      );
    }
  }

  const open = commentsKey ? (items?.find((i) => reelKey(i) === commentsKey) ?? null) : null;
  // Every page here is a post (Orbit has no anonymous buzzes), so the sheet always has a post to comment on.
  const commentsItem = open && open.sourceType !== "buzz" ? { sourceType: open.sourceType, sourceId: open.sourceId, author: open.author, comments: open.comments, commentsOff: open.commentsOff } : null;
  return (
    <FeedCardContext.Provider value={card}>
    <ViewerPagerLockContext.Provider value={setPinchLock}>
    <FeedClearContext.Provider value={setClearPage}>
    <View style={{ height, backgroundColor: colors.mediaBg }}>
      {body}
      {/* Under Home's own bar: the row of stories, or the pill that brings it back. */}
      {storiesOn ? (
        // A clear post, or the feed scrolled down, takes the stories with it (they fade, and take no touches meanwhile).
        <Reanimated.View pointerEvents={topHidden ? "none" : "box-none"} style={[StyleSheet.absoluteFill, storiesFadeStyle]}>
          <StoriesHeader topInset={topInset} open={rowOpen} rowShown={rowShown} onOpenRow={openRow} groups={storyGroups} me={profile} />
        </Reanimated.View>
      ) : null}
      {/* Posting starts from Create in the middle of the bottom bar, so there is no second "+" here. */}
      {loadingMore && items && visible >= rows.length - 1 ? (
        <View style={[styles.more, { bottom: 6 + tabBar }]} pointerEvents="none">
          <ActivityIndicator color={colors.onMedia} />
        </View>
      ) : null}
      <ReelCommentsSheet reel={commentsItem} onClose={() => setCommentsKey(null)} onCountChange={onCommentCount} />
    </View>
    </FeedClearContext.Provider>
    </ViewerPagerLockContext.Provider>
    </FeedCardContext.Provider>
  );
}

/** The first post under the open row at the top of the feed: its top corners round as the row opens, TikTok's card. */
function FirstCard({ open, children }: { open: Readonly<SharedValue<number>>; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({ borderTopLeftRadius: open.value * CARD_RADIUS, borderTopRightRadius: open.value * CARD_RADIUS }));
  return <Reanimated.View style={[{ overflow: "hidden" }, style]}>{children}</Reanimated.View>;
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
  cardClip: { overflow: "hidden" },
  card: { overflow: "hidden", backgroundColor: colors.mediaBg },
  spinner: { position: "absolute", left: 0, right: 0, alignItems: "center" },
}));
