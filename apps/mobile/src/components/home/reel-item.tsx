import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Alert, Animated, Easing, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { Image, type ImageLoadEventData } from "expo-image";
import type { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { cancelAnimation, FadeIn, FadeOut, runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import type { SFSymbol, SymbolWeight } from "expo-symbols";
import { APP_NAME, captionParts, deleteFeedPost, type Buzz, getApartmentsByIds, getFeedPost, getOrCreateDirectConversation, hasPublicComments, inquiryPrefill, likePost, listingChatPrefill, reelPath, REPORT_REASONS, reportContent, setPostPinned, sharedPostPath, startBusinessInquiry, toggleSaved, unlikePost, type BusinessSummary, type FeedMedia, type Reel, type ReportReason } from "@apartment-book/shared";
import { hapticLike, hapticSelect, hapticTap, alertWithHaptic } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { emitPostPinned, onPostPinned } from "@/lib/posts-events";
import { canShareAudience, postLink, useOpenMention } from "@/lib/post-details";
import { asViewerItem, posterAt, viewerThumb, type ViewerItem } from "@/lib/reel-viewer";
import { shareBuzz, upvoteBuzz, voteOnBuzz } from "@/lib/buzz-actions";
import { DOUBLE_TAP_MS, HeartBursts, type HeartBurstsHandle } from "@/components/heart-burst";
import { usePressScale } from "@/components/ui";
import { useBuzzItem } from "@/lib/buzz-store";
import { AliasAvatar } from "@/components/buzz/parts";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useActionSheet } from "../action-sheet";
import { PostLink } from "../post-bits";
import { useShareSheet } from "../share-sheet";
import { Icon, useBounceOn } from "@/components/icon";
import { FeedCardContext, FeedClearContext, ViewerChromeContext, ViewerClockContext, ViewerClosingContext, ViewerPagerLockContext, ViewerZoomContext } from "@/lib/viewer-chrome";
import { hasDrawn, lendPlayer, returnPlayer } from "@/lib/video-handoff";
import { VIDEO_AUDIO_MODE, VIDEO_MUTED } from "@/lib/video-sound";
import { usePageSwipe, type PageSlides } from "@/lib/viewer-swipe";
import { wantTimeUpdates } from "@/lib/video-ticks";
import { BOOST_RATE, HOLD_MS, SpeedBadge, TIMELINE_TOUCH, VideoTimeline } from "@/components/video-controls";
import { useReduceMotion } from "@/lib/accessibility";
import { Zoomable } from "@/components/zoomable";
import { useOpenProfile } from "@/lib/open-profile";

/**
 * The shades over a reel are true gradients of a media colour (the same in both themes), each stop that colour at a
 * share of its strength along an eased ramp, so nothing bands even on a blown-out white frame. `share(t)` runs top (0)
 * to bottom (1).
 */
function scrimGradient(scrim: string, share: (t: number) => number, stops = 10): string {
  const m = /rgba?\(([^)]+)\)/.exec(scrim);
  const [r = "0", g = "0", b = "0", a = "1"] = m ? m[1]!.split(",").map((x) => x.trim()) : [];
  const list = Array.from({ length: stops + 1 }, (_, i) => {
    const t = i / stops;
    return `rgba(${r},${g},${b},${(Number(a) * share(t)).toFixed(3)}) ${(t * 100).toFixed(1)}%`;
  });
  return `linear-gradient(to bottom, ${list.join(", ")})`;
}
/** Bottom shade: from nothing at its top edge, already a light tint behind the rail's first counts, nearly the full scrim at the bottom. */
const bottomShare = (t: number) => 0.96 * Math.pow(t, 0.7);
/** Tall enough to sit under the whole rail (like, comments, save, share, "…") with room to fade in above the like. */
const SHADE_HEIGHT = 540;
/** The rail's bottom padding: the "…" centre 46pt above the bottom inset, Instagram's geometry (half its 42pt square over it). */
const OVERLAY_PAD = 25;
/**
 * The rail's column (2026-11-22, the owner's brief: bold, symmetrical, a little further right): its width, the square
 * every glyph is centred in, so the column lines up whatever each symbol's own shape, and the room between two buttons
 * (each step down the rail as tall as before).
 */
const RAIL_WIDTH = 60;
const RAIL_ICON = 42;
const RAIL_GAP = 13;
/** A saved post's bookmark: TikTok's warm gold, as the liked heart is red. */
const SAVED_TINT = "#FFC93C";
/**
 * The words (the name, the title and caption, the link) sit right on what is under them, TikTok's way: their last line
 * WORDS_GAP above the bottom inset on a photo, just over the timeline's touch band on a video (so a tap on the words
 * never lands on the timeline), and they grow upward from there, however many lines they have.
 */
const WORDS_GAP = 10;
const WORDS_OVER_TIMELINE = TIMELINE_TOUCH + 2;
/** How long the words take to settle on their new line when the slide on show turns from a photo to a video or back. */
const WORDS_GLIDE_MS = 220;
/**
 * A carousel's dots sit this far above the words at the page's bottom, TikTok's way, on a dark pill DOTS_PAD bigger than
 * them all round, as iOS draws its page dots over a photo, so they show on a white one too.
 */
const DOTS_GAP = 10;
const DOT_SIZE = 6;
const DOTS_PAD = 5;

/** How long "…" waits for your reel's pin state when the read-ahead has not answered yet. */
const PIN_READ_WAIT_MS = 1200;

export const reelKey = (reel: { sourceType: string; sourceId: string }) => `${reel.sourceType}:${reel.sourceId}`;

/** Whether this page draws its pictures yet (see the `pictures` prop). */
const PicturesContext = createContext(true);
/**
 * The page's photo zoom: `zoomed` is 1 on the UI thread while one of its photos is zoomed in (Zoomable sets it), `fade`
 * follows it smoothly for what steps aside meanwhile (the shades), and `onChange` tells the page in JS.
 */
/** `doubleTap`: a double tap on a photo zooms it (the viewer); otherwise it likes, a pinch still zooming (the feeds). */
type PhotoZoom = { zoomed: SharedValue<number>; fade: SharedValue<number>; onChange: (zoomed: boolean) => void; doubleTap: boolean };
const PhotoZoomContext = createContext<PhotoZoom | null>(null);
/** The video's timeline sits this far above the page's bottom inset, under the words and the rail. */
const TIMELINE_BOTTOM = 0;
/** The "2×" pill sits this far under the row drawn over the page's top. */
const BADGE_TOP = 10;
/**
 * A feed's pinch, TikTok's (the owner's brief, 2026-11-22): the picture follows the fingers between these scales and
 * springs back on release; a pinch that went in past CLEAR_AT leaves the page clear (nothing drawn over it), and one that
 * went out past UNCLEAR_AT brings everything back.
 */
const PINCH_MIN = 0.75;
const PINCH_MAX = 4;
const CLEAR_AT = 1.12;
const UNCLEAR_AT = 0.92;
const PINCH_BACK = { damping: 22, stiffness: 240, mass: 0.8 };

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

type Props = {
  /** A reel from the Reels feed, or a page of the viewer (a reel, or a post with its photos and videos). */
  reel: Reel | ViewerItem;
  width: number;
  height: number;
  topInset: number;
  /** How much of the page's bottom the floating bar covers: the caption and the rail sit above it. */
  bottomInset: number;
  /**
   * The room at the page's bottom that pictures stay out of: the bottom navigation bar's, where it is drawn (Orbit, and
   * the viewer opened over the tabs), 0 where nothing is (see mediaBox). Photos and videos are placed in the page above it.
   */
  mediaBottom?: number;
  /** The rail's inset from the screen's right edge (8 by default; the full-screen viewer's sits nearer the edge). */
  railRight?: number;
  /** Close enough to the visible page (one behind, two ahead) to have its player loaded and waiting. */
  near: boolean;
  /** This is the visible reel and the Reels section is on screen. */
  playing: boolean;
  onPatch: (key: string, patch: Partial<Reel>) => void;
  onOpenComments: (reel: ViewerItem) => void;
  onRemoved: (key: string) => void;
  /** For a post with several photos or videos: the one to start on. */
  initialSlide?: number;
  /** Where that slide's video had got to in the feed when it was tapped (seconds): it goes on from there, once. */
  startAt?: number;
  /** The feed's own player for that video (iOS): played on here as it is, with no reload (see video-handoff.ts). */
  borrowed?: VideoPlayer;
  /**
   * The bottom of the row drawn over the page's top. The page's pictures start at the screen's top edge, under the status
   * bar and that row; a carousel's dots sit just below it.
   */
  contentTop?: number;
  /** The slide on screen changed (and once at the start): the viewer's zoom closes onto it. */
  onSlideChange?: (key: string, slide: number) => void;
  /** The slide it starts on has drawn its picture (its photo, its video's frame): the viewer's zoom waits for that. */
  onShown?: () => void;
  /** The same, by its key: the viewer takes away the picture that stood in for a page loaded by its id. */
  onDrawn?: (key: string) => void;
  /**
   * The picture the page stood in with while its post loaded (a grid square's own, already loaded): the first slide
   * shows it until its own picture is ready, so the swap never flashes black.
   */
  standIn?: string;
  /**
   * False while the viewer zooms open on another page: this one, off screen meanwhile, draws no picture yet. A large
   * photo or poster is decoded and resized on the main thread as it arrives, and there it would make the zoom stutter.
   */
  pictures?: boolean;
  /**
   * What a double tap on a photo does: "zoom" (the full-screen viewer, Photos style) or "like" (the feeds: Orbit, TikTok's
   * way, a pinch still zooming). A double tap on a video always likes (a buzz: upvotes).
   */
  photoDoubleTap?: "zoom" | "like";
};

/**
 * One full-screen page: a reel's video, or a post's photos and videos swiped sideways (dots show where you are), under
 * the same overlay for every page: the creator's name and words, and the rail (like, comments, save, share, "…"). A
 * video plays while its page (and its slide) is on screen; a tap pauses it. Every photo and video is shown whole, in its
 * own shape, never cropped or stretched, as big as the screen allows and centred on it (see photoLayout, placeVideo);
 * whatever of the screen it leaves is pure black, TikTok's way, in both themes (see MediaFrame). The words and the rail
 * are white over shades on every page. A double tap anywhere on the picture likes, TikTok's way, a heart rising where
 * it landed (HeartBursts); in the viewer a photo's double tap zooms instead (`photoDoubleTap`), and a photo always zooms
 * with a pinch, Photos style (pinch, double tap, then pan: see Zoomable), the words, the rail and
 * the shades stepping aside while it is zoomed and the viewer's pager holding still. A video plays at 1×; pressed and
 * held, it runs at 2× until the finger lifts, Instagram's way, with a "2×" pill at the top. Its timeline along the bottom
 * shows how far it has played and drags to fast-forward or rewind (see VideoTimeline): the video holds on the frame under
 * the finger, and the words and the rail step aside while it is dragged or held.
 */
export const ReelItem = memo(function ReelItem({ reel: source, width, height, topInset, bottomInset, mediaBottom = 0, railRight = 2, near, playing, onPatch, onOpenComments, onRemoved, initialSlide = 0, startAt, borrowed, contentTop = topInset + 54, onSlideChange, onShown, onDrawn, standIn, pictures = true, photoDoubleTap = "zoom" }: Props) {
  const reel = useMemo(() => asViewerItem(source), [source]);
  /**
   * A buzz's page: anonymous. Its alias, words and votes are the Buzz item's own, live from Buzz's store, so a vote here
   * shows on its card at once and the other way round; nothing of the post overlay (a name, a profile, likes, saves, the
   * post menu) is drawn, and every post action below returns at once for it.
   */
  const isBuzz = reel.sourceType === "buzz";
  const liveBuzz = useBuzzItem<Buzz>(reel.buzz?.id);
  const buzz = reel.buzz ? (liveBuzz ?? reel.buzz) : null;
  const { user } = useSession();
  const router = useRouter();
  const openProfile = useOpenProfile();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const colors = useColors();
  const styles = useStyles();
  const [userPaused, setUserPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  /**
   * The heart's taps, TikTok's way: felt and shown at once, sent one at a time with only the newest wish going next, so
   * quick taps are never dropped or land out of order. `likeShown` is the heart as last shown (taps can come faster than
   * renders); `likeConfirmed` what the server last agreed to, put back if it refuses.
   */
  const likeShown = useRef({ likedByMe: false, likes: 0 });
  const likeWanted = useRef<boolean | null>(null);
  const likeSending = useRef(false);
  const likeConfirmed = useRef<{ likedByMe: boolean; likes: number } | null>(null);
  // Between taps the heart is the reel's own (a like in the viewer, a fresh load); while taps are sent it is theirs.
  if (likeWanted.current === null && !likeSending.current) {
    likeShown.current = { likedByMe: reel.likedByMe, likes: reel.likes };
    likeConfirmed.current = null;
  }
  const [messageBusy, setMessageBusy] = useState(false);
  // A business's video tour (reels_feed knows only the person who posted the listing): the business, shown and linked,
  // and "Message" opens the inquiry chat, where the business can only reply.
  const [business, setBusiness] = useState<BusinessSummary | null>(null);
  useEffect(() => {
    if (source.sourceType !== "apartment") return;
    let live = true;
    getApartmentsByIds(supabase, [source.sourceId])
      .then(([a]) => {
        if (live && a?.business) setBusiness(a.business);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [source.sourceType, source.sourceId]);
  /** The rail heart's pop (scale), and the hearts a double tap spawns where it landed (HeartBursts), TikTok's. */
  const pop = useRef(new Animated.Value(1)).current;
  const popAnim = useRef<Animated.CompositeAnimation | null>(null);
  const hearts = useRef<HeartBurstsHandle>(null);
  /** Single tap pauses, double tap likes: the pause waits a beat to see whether a second tap follows. */
  const lastTap = useRef(0);
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (pendingTap.current && clearTimeout(pendingTap.current)), []);

  const key = reelKey(reel);
  /** Its first picture is drawn (see onShown, onDrawn). */
  const firstDrawn = useCallback(() => {
    onShown?.();
    onDrawn?.(key);
  }, [onShown, onDrawn, key]);
  const firstShown = onShown || onDrawn ? firstDrawn : undefined;
  /** How far each video has got, for the viewer to hand back to the feed as it closes (none on the Reels tab). */
  const clocks = useContext(ViewerClockContext);
  const onClock = useCallback((index: number, read: (() => number) | null) => clocks?.set(key, index, read), [clocks, key]);
  const own = !isBuzz && user?.id === reel.author.id;
  const isTour = reel.sourceType === "apartment" || reel.sourceType === "roommate";
  /** What the menus and alerts call it. */
  const noun = isTour || reel.kind === "reel" ? "reel" : "post";
  const media = reel.media;
  /** One video and nothing else (every reel): drawn on its own, as before; anything else goes through the sideways pager. */
  const single = media.length === 1 && media[0]!.type === "video" ? (media[0] as Extract<FeedMedia, { type: "video" }>) : null;
  /** The slide on screen, for a post with several photos or videos. */
  const [slide, setSlide] = useState(() => Math.max(0, Math.min(media.length - 1, initialSlide)));
  const slideIsVideo = media[slide]?.type === "video";
  // Where the pictures sit between the top row and the words (see mediaRoom): the slides and the zoom's heart use it.
  // Pictures are placed in the page above the bottom bar (`box`), the words' room measured from its bottom (`room`).
  const { boxH, room } = useMemo(() => mediaBox(height, contentTop, bottomInset, mediaBottom), [height, contentTop, bottomInset, mediaBottom]);
  /** How tall the words are right now: the dots ride above them, so they move together as a caption opens or closes. */
  const [wordsHeight, setWordsHeight] = useState(0);
  // The words' line: just over the timeline on a video, right on the bottom inset on a photo, gliding between the two
  // when a post's slides change kind (on the UI thread; at once with Reduce Motion), never jumping.
  const reduceMotion = useReduceMotion();
  const wordsTarget = (slideIsVideo ? WORDS_OVER_TIMELINE : WORDS_GAP) - WORDS_GAP;
  const wordsLift = useSharedValue(wordsTarget);
  useEffect(() => {
    wordsLift.value = reduceMotion ? wordsTarget : withTiming(wordsTarget, { duration: WORDS_GLIDE_MS });
  }, [wordsTarget, reduceMotion, wordsLift]);
  const wordsStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -wordsLift.value }] }));
  /**
   * The feed's handover. Its own player (iOS) plays the slide it was tapped on at every visit to the page, so that video
   * always goes on from where it is, and the feed has it back exactly there however far the viewer went. A time to start
   * from (Android) is used once: a later visit starts the video from the beginning as usual.
   */
  const [startFrom, setStartFrom] = useState(startAt);
  const [lentPlayer] = useState(borrowed);
  const [firstSlide] = useState(slide);
  const started = useCallback(() => setStartFrom(undefined), []);
  /**
   * A post with several photos or videos: its slides sit side by side on a strip that the page's swipe moves (see
   * usePageSwipe). `settled` is the slide the strip last came to rest on: its video plays, and players wait beside it.
   */
  const pager = media.length > 1;
  const stripPos = useSharedValue(-slide * width);
  const [settled, setSettled] = useState(slide);
  // Halfway through a swipe the page takes the slide coming in (its dots, its colours), as iOS's page dots do. Reanimated
  // follows the values the worklets capture (media, width), so they need no dependency list.
  useAnimatedReaction(
    () => Math.max(0, Math.min(media.length - 1, Math.round(-stripPos.value / Math.max(width, 1)))),
    (i, prev) => {
      if (prev !== null && i !== prev) runOnJS(setSlide)(i);
    },
  );
  // A new width (the phone turned) keeps the strip on its slide.
  useEffect(() => {
    cancelAnimation(stripPos);
    stripPos.value = -settled * width;
  }, [width, settled, stripPos]);
  /** VoiceOver's swipe up or down on a slide: the next one or the previous one. */
  const goTo = useCallback(
    (i: number) => {
      const target = Math.max(0, Math.min(media.length - 1, i));
      stripPos.value = withTiming(-target * width, { duration: 260 }, (finished) => {
        if (finished) runOnJS(setSettled)(target);
      });
    },
    [media.length, width, stripPos],
  );
  const slides = useMemo<PageSlides | null>(() => (pager ? { count: media.length, pos: stripPos, onLand: setSettled } : null), [pager, media.length, stripPos]);
  /**
   * A photo zoomed in (1) or a video's timeline under a finger (1), on the UI thread: the page's own sideways swipe stands
   * down at once, so the finger pans the photo or scrubs the video instead of turning the slide or going back.
   */
  const photoZoomed = useSharedValue(0);
  const timelineHeld = useSharedValue(0);
  const swipeLock = useDerivedValue(() => Math.max(photoZoomed.value, timelineHeld.value));
  /** Sideways: the carousel, then back to where the viewer was opened from (only in the viewer). */
  const { gesture: swipe, swipedJustNow } = usePageSwipe(width, slides, swipeLock);
  /** The page is clear (1: a feed's pinch, see below), on the UI thread: the shades go with everything else. */
  const clearOn = useSharedValue(0);
  /** The shades step aside smoothly while a photo is zoomed or the page is clear (see MediaFrame). */
  const zoomFade = useSharedValue(0);
  useAnimatedReaction(
    () => Math.max(photoZoomed.value, clearOn.value),
    (now, before) => {
      if (now !== before) zoomFade.value = withTiming(now, { duration: 180 });
    },
  );
  /** A photo is zoomed in (JS): the words and the rail step aside, and the viewer's pager holds still meanwhile. */
  const [zoomedIn, setZoomedIn] = useState(false);
  const lockPager = useContext(ViewerPagerLockContext);
  const pagerLocked = useRef(false);
  const onZoomChange = useCallback(
    (z: boolean) => {
      setZoomedIn(z);
      if (lockPager && pagerLocked.current !== z) {
        pagerLocked.current = z;
        lockPager(z);
      }
    },
    [lockPager],
  );
  // A page that goes while zoomed gives the pager back (only the page that locked it: others come and go meanwhile).
  useEffect(
    () => () => {
      if (pagerLocked.current) {
        pagerLocked.current = false;
        lockPager?.(false);
      }
    },
    [lockPager],
  );
  const photoZoom = useMemo<PhotoZoom>(() => ({ zoomed: photoZoomed, fade: zoomFade, onChange: onZoomChange, doubleTap: photoDoubleTap === "zoom" }), [photoZoomed, zoomFade, onZoomChange, photoDoubleTap]);

  /**
   * A feed's pinch (photoDoubleTap "like": Orbit), TikTok's and Instagram's way (the owner's brief, 2026-11-22): on a
   * photo or a video alike, the picture follows the fingers (the point under them stays under them) and springs back
   * as they lift. A pinch that went in leaves the page clear: the name, the caption, the rail, the dots, the timeline
   * and the shades all fade away, and only the picture shows, with a small button in the corner to bring them back.
   * They come back too on a pinch out, and on moving to another post. The feed holds still while a pinch is under way
   * (ViewerPagerLockContext), and so does the page's own sideways swipe (it gives up on a second finger). In the viewer,
   * where a photo zooms Photos style instead (Zoomable), none of this applies.
   */
  const feedZoom = photoDoubleTap === "like";
  const [clear, setClear] = useState(false);
  const [pinching, setPinching] = useState(false);
  // Moving on to another post (or away from the feed) brings everything back on this one.
  useEffect(() => {
    if (!playing) setClear(false);
  }, [playing]);
  useEffect(() => {
    clearOn.value = clear || pinching ? 1 : 0;
  }, [clear, pinching, clearOn]);
  // The feed and the screen clear with the post on screen: Orbit's stories, Home's top bar (FeedClearContext).
  const reportClear = useContext(FeedClearContext);
  const clearShown = (clear || pinching) && playing;
  // Only the clear post speaks, and only of itself: clear as it goes clear, not as that ends (or it goes). The posts
  // beside it, never clear, say nothing, so they cannot bring the bar back over a clear one.
  useEffect(() => {
    if (!reportClear || !clearShown) return;
    reportClear(true);
    return () => reportClear(false);
  }, [reportClear, clearShown]);
  const pinchScale = useSharedValue(1);
  const pinchX = useSharedValue(0);
  const pinchY = useSharedValue(0);
  const pinchFromX = useSharedValue(0);
  const pinchFromY = useSharedValue(0);
  const pinchPeak = useSharedValue(1);
  const pinchLow = useSharedValue(1);
  const pinchStarted = useCallback(
    (on: boolean) => {
      setPinching(on);
      lockPager?.(on);
    },
    [lockPager],
  );
  const pinchEnded = useCallback((peak: number, low: number) => {
    if (peak > CLEAR_AT) setClear(true);
    else if (low < UNCLEAR_AT) setClear(false);
  }, []);
  /** Each video slide's player, by slide, as its page video registers it: the timeline reads and moves it. */
  const [players, setPlayers] = useState<ReadonlyMap<number, VideoPlayer>>(() => new Map());
  const onPlayer = useCallback(
    (i: number, player: VideoPlayer | null) =>
      setPlayers((prev) => {
        if (player ? prev.get(i) === player : !prev.has(i)) return prev;
        const next = new Map(prev);
        if (player) next.set(i, player);
        else next.delete(i);
        return next;
      }),
    [],
  );
  /** A finger is held on the playing video: it runs at 2× until it lifts. */
  const [boosted, setBoosted] = useState(false);
  /** A finger is dragging the timeline: the video holds still on the frame under it. */
  const [scrubbing, setScrubbing] = useState(false);
  /** A tap on the page that ends a swipe is part of the swipe: it neither pauses, likes, nor opens anything. */
  const unlessSwiped = (act: () => void) => () => {
    if (!swipedJustNow()) act();
  };
  /** Photos uploaded without their size: measured as they load, so each still sits in its own shape. */
  const [aspects, setAspects] = useState<Record<number, number>>({});
  const onAspect = useCallback((i: number, aspect: number) => setAspects((prev) => (prev[i] === aspect ? prev : { ...prev, [i]: aspect })), []);
  const aspectAt = (i: number): number | null => {
    const m = media[i];
    return m ? (aspectOf(m) ?? aspects[i] ?? null) : null;
  };
  useEffect(() => {
    onSlideChange?.(key, slide);
  }, [onSlideChange, key, slide]);
  /**
   * Collapsed, the description is one line like Instagram's. Whether it was cut is measured, not guessed (see
   * onTextLayout).
   */
  const oneLine = [reel.title, reel.caption].filter(Boolean).join(" · ");
  const [clipped, setClipped] = useState(false);
  const canExpand = clipped || oneLine.includes("\n");
  /** A posted reel's or post's link (migration 44), in a pill under the words. Video tours have none. */
  const link = postLink(reel.link);
  /** Comments turned off by the author: no comment button. */
  const commentsOff = reel.commentsOff ?? false;
  /** Only a Global or campus post can be sent into a chat (see canShareAudience); a video tour is always Global. */
  const shareable = canShareAudience(reel.audience ?? "global");
  const openMention = useOpenMention();
  const poster = viewerThumb(media) ?? "";
  const login = () => router.push("/(auth)/login");
  /** Your own posted reel: pinned to your profile or not. A Reel does not carry it, so it is read once the reel is on screen (null until then). */
  const [pinned, setPinned] = useState<boolean | null>(null);
  const readingPin = useRef(false);
  // Read ahead, while your reel plays, so "…" opens at once and always acts on the reel you are looking at.
  useEffect(() => {
    if (!playing || !own || isTour || pinned !== null) return;
    let alive = true;
    getFeedPost(supabase, reel.sourceId).then(
      (post) => {
        if (alive && post) setPinned(Boolean(post.pinned_at));
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [playing, own, isTour, pinned, reel.sourceId]);
  // Pinned or unpinned elsewhere (the profile grid, the post screen) while this reel is mounted.
  useEffect(() => {
    if (isTour || isBuzz) return;
    return onPostPinned((id, next) => {
      if (id === reel.sourceId) setPinned(next);
    });
  }, [isTour, isBuzz, reel.sourceId]);

  // Scrolling away clears a manual pause and a stretched-out caption, so coming back starts fresh.
  useEffect(() => {
    if (!playing) {
      setUserPaused(false);
      setExpanded(false);
      setBoosted(false);
    }
  }, [playing]);
  // A new slide starts playing (if it is a video) at 1×, whatever the last one was doing.
  useEffect(() => {
    setUserPaused(false);
    setBoosted(false);
  }, [slide]);
  /** The paused controls (play, and sound above it): shown only while a video is paused, faded in and out. */
  const showControls = userPaused && slideIsVideo;
  const controls = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(controls, { toValue: showControls ? 1 : 0, duration: showControls ? 160 : 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [showControls, controls]);
  /** The viewer's chrome fade while a page zooms open or closed (none on the Reels tab), and Orbit's while its stories row is open. */
  const chrome = useContext(ViewerChromeContext);
  const card = useContext(FeedCardContext);
  // In a feed the clear page fades it away and back (zoomFade follows clearOn there: no photo zooms Photos style).
  const chromeStyle = useAnimatedStyle(() => ({ opacity: (chrome ? chrome.value : 1) * (card ? 1 - card.open.value : 1) * (feedZoom ? 1 - zoomFade.value : 1) }));
  /**
   * The words, the rail, the dots and the paused controls step aside, quickly, while a photo is zoomed, a video is held at
   * 2× or its timeline is dragged, so nothing is drawn over what the finger is doing; they come back as it ends.
   */
  const hushed = zoomedIn || boosted || scrubbing;
  const quiet = useSharedValue(0);
  useEffect(() => {
    quiet.value = withTiming(hushed ? 1 : 0, { duration: hushed ? 140 : 220 });
  }, [hushed, quiet]);
  const quietStyle = useAnimatedStyle(() => ({ opacity: 1 - quiet.value }));
  /** The viewer is closing: this page's video (the one going back to the feed) plays on whatever a tap had asked. */
  const closing = useContext(ViewerClosingContext);

  /** The heart jumps when it fills and dips when it empties, so the tap is felt even before the count moves. */
  function animateHeart(liked: boolean) {
    popAnim.current?.stop();
    pop.setValue(1);
    // RN's default rest thresholds (0.001) keep a lively spring "settling" for a second or more; these end it once it looks still.
    const settle = { useNativeDriver: true, restDisplacementThreshold: 0.01, restSpeedThreshold: 2 } as const;
    popAnim.current = Animated.sequence(
      liked
        ? [Animated.timing(pop, { toValue: 1.35, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }), Animated.spring(pop, { toValue: 1, friction: 5, tension: 180, ...settle })]
        : [Animated.timing(pop, { toValue: 0.82, duration: 90, useNativeDriver: true }), Animated.spring(pop, { toValue: 1, friction: 6, tension: 160, ...settle })],
    );
    popAnim.current.start();
  }

  /** The heart (or a double tap's like) changes now; the server hears it after, one tap at a time. */
  function setLike(next: boolean) {
    const now = likeShown.current;
    likeConfirmed.current ??= { ...now };
    likeWanted.current = next;
    const shown = { likedByMe: next, likes: Math.max(0, now.likes + (next === now.likedByMe ? 0 : next ? 1 : -1)) };
    likeShown.current = shown;
    onPatch(key, shown);
    void sendLikes();
  }
  async function sendLikes() {
    const { sourceType, sourceId } = reel;
    // A buzz has votes, not likes (toggleLike never gets here for one).
    if (likeSending.current || !user || sourceType === "buzz") return;
    likeSending.current = true;
    try {
      let sent: boolean | null = null;
      while (likeWanted.current !== null && likeWanted.current !== sent) {
        const next: boolean = likeWanted.current;
        if (next) await likePost(supabase, user.id, sourceType, sourceId);
        else await unlikePost(supabase, user.id, sourceType, sourceId);
        sent = next;
      }
      likeConfirmed.current = { ...likeShown.current };
    } catch {
      if (likeConfirmed.current) {
        likeShown.current = { ...likeConfirmed.current };
        onPatch(key, likeConfirmed.current);
      }
    } finally {
      likeSending.current = false;
      likeWanted.current = null;
    }
  }

  function toggleLike() {
    if (reel.sourceType === "buzz") return;
    if (!user) return login();
    const next = !likeShown.current.likedByMe;
    // Felt before anything else happens: no render, animation or request stands in front of it.
    if (next) hapticLike();
    else hapticTap();
    animateHeart(next);
    setLike(next);
  }

  /**
   * A double tap's like: always felt, never an unlike. On a buzz it is an upvote (a buzz has votes, not likes), never
   * taken back either. Says whether it landed, so a heart is drawn only for a like that counts.
   */
  function likeNow(): boolean {
    if (isBuzz) return buzz ? upvoteBuzz(buzz.id) : false;
    if (!user) {
      login();
      return false;
    }
    hapticLike();
    if (!likeShown.current.likedByMe) {
      animateHeart(true);
      setLike(true);
    }
    return true;
  }

  async function toggleSave() {
    if (reel.sourceType === "buzz") return;
    if (!user) return login();
    // A selection tick as the bookmark fills (or empties), as everywhere else you save.
    hapticSelect();
    const before = reel.savedByMe;
    onPatch(key, { savedByMe: !before });
    try {
      onPatch(key, { savedByMe: await toggleSaved(supabase, user.id, reel.sourceType, reel.sourceId) });
    } catch {
      onPatch(key, { savedByMe: before });
    }
  }

  /**
   * Taps on the picture, TikTok's way: a double tap anywhere likes (never unlikes; a buzz upvotes) with a heart where the
   * finger landed, and every further tap of a quick run adds a heart; a lone tap pauses or plays a video once it is clear
   * no second tap follows. In the viewer a photo's taps are its zoom's instead (`photoDoubleTap` "zoom", see Zoomable).
   * The tap's place is read from the slide, which covers the page (its picture takes no touches of its own).
   */
  function onMediaTap(e: GestureResponderEvent) {
    if (swipedJustNow()) return;
    if (!slideIsVideo && photoDoubleTap === "zoom") return;
    const { locationX: x, locationY: y } = e.nativeEvent;
    const now = Date.now();
    if (pendingTap.current) {
      clearTimeout(pendingTap.current);
      pendingTap.current = null;
    }
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = now;
      if (likeNow()) hearts.current?.burst(x, y);
      return;
    }
    lastTap.current = now;
    if (!slideIsVideo) return;
    pendingTap.current = setTimeout(() => {
      pendingTap.current = null;
      // A swipe that began while it waited (the swipe back, the next slide) was what the finger meant: no pause.
      if (!swipedJustNow()) setUserPaused((p) => !p);
    }, DOUBLE_TAP_MS);
  }

  /**
   * Press and hold a playing video: it runs at 2× until the finger lifts (onPressOut, also when a scroll takes the touch),
   * then straight back to 1×. A held photo, or a paused video, does nothing.
   */
  function holdStart() {
    if (!slideIsVideo || userPaused || !playing || scrubbing || swipedJustNow()) return;
    hapticTap();
    setBoosted(true);
  }
  function holdEnd() {
    setBoosted(false);
  }

  /** Instagram's share sheet: send the reel to friends as a chat card, or "Share to…" the link with the system sheet. */
  function share() {
    if (reel.sourceType === "buzz") return;
    const type = reel.sourceType;
    const url = `${SITE_URL}${reelPath({ sourceType: type, sourceId: reel.sourceId })}`;
    const label = reel.title ?? (reel.caption ? reel.caption.slice(0, 80) : `${reel.author.name} on ${APP_NAME}`);
    const target = { target_type: type, target_id: reel.sourceId };
    shareSheet.open(
      {
        ...target,
        kind: isTour ? "listing" : reel.kind,
        path: sharedPostPath(target),
        title: reel.title,
        caption: reel.caption?.trim() ? reel.caption.trim() : null,
        image_url: poster || null,
        author: { id: reel.author.id, name: reel.author.name, avatar_url: reel.author.avatarUrl },
      },
      { url, label },
    );
  }

  async function message() {
    if (isBuzz) return;
    if (!user) return login();
    if (messageBusy) return;
    setMessageBusy(true);
    try {
      // A tour of a business's listing opens the inquiry chat; when the business has not loaded yet, the inquiry is
      // tried first anyway (a student's own listing answers "not from a business", and the direct chat follows).
      if (business || reel.sourceType === "apartment") {
        const inquiry = await startBusinessInquiry(supabase, "apartment", reel.sourceId).catch((e: unknown) => {
          if (!business && e instanceof Error && e.message.includes("not from a business")) return null;
          throw e;
        });
        if (inquiry) {
          router.push({ pathname: "/messages/[id]", params: { id: inquiry, prefill: inquiryPrefill(business?.name ?? "there", reel.title ?? "your listing") } });
          return;
        }
      }
      const conv = await getOrCreateDirectConversation(supabase, reel.author.id);
      // A roommate tour opens the chat with a first message about the post, as the listing's own Inbox button does.
      const listing = reel.sourceType === "roommate";
      router.push({ pathname: "/messages/[id]", params: listing ? { id: conv, prefill: listingChatPrefill(reel.author.name, reel.title), targetType: "roommate", targetId: reel.sourceId } : { id: conv } });
    } catch (e) {
      Alert.alert("Message", e instanceof Error ? e.message : "Could not start the chat. Try again.");
    } finally {
      setMessageBusy(false);
    }
  }

  function openListing() {
    if (reel.sourceType === "apartment") router.push({ pathname: "/apartments/[id]", params: { id: reel.sourceId } });
    else if (reel.sourceType === "roommate") router.push({ pathname: "/roommates/[id]", params: { id: reel.sourceId } });
  }

  function report() {
    // A buzz is reported through Buzz's own menu and moderation, never into the posts' reports.
    if (reel.sourceType === "buzz") return;
    const targetType = reel.sourceType;
    if (!user) return login();
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: async () => {
          await reportContent(supabase, user.id, { targetType, targetId: reel.sourceId, reason: r.value as ReportReason }).catch(() => {});
          Alert.alert("Thanks", `Our team will review this ${noun}.`);
        },
      })),
      "Why are you reporting this?",
    );
  }

  function confirmDelete() {
    alertWithHaptic("warning", `Delete this ${noun}?`, "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteFeedPost(supabase, reel.sourceId);
            onRemoved(key);
          } catch (e) {
            Alert.alert("Could not delete", e instanceof Error ? e.message : "Try again");
          }
        },
      },
    ]);
  }

  /** Like a post's menu: pin your own reel to the top of your profile, or unpin it. The profile grids hear about it straight away. */
  async function togglePin(next: boolean) {
    setPinned(next);
    try {
      await setPostPinned(supabase, reel.sourceId, next);
      hapticTap();
      emitPostPinned(reel.sourceId, next);
    } catch (e) {
      setPinned(!next);
      alertWithHaptic("error", next ? "Could not pin" : "Could not unpin", errorText(e));
    }
  }

  // The overlay is name and caption only (like TikTok), so the listing and the chat live behind "…".
  async function more() {
    if (isBuzz) return;
    // Usually known already (read while the reel plays). If that read has not answered or failed, ask again, but hold
    // the menu for a moment at most: without an answer it opens without the Pin item, which the next tap will have.
    let pinNow = own && !isTour ? pinned : null;
    if (own && !isTour && pinNow === null) {
      if (readingPin.current) return;
      readingPin.current = true;
      const read = getFeedPost(supabase, reel.sourceId).then(
        (post) => (post ? Boolean(post.pinned_at) : null),
        () => null,
      );
      void read.then((value) => {
        if (value !== null) setPinned(value);
      });
      pinNow = await Promise.race([read, new Promise<null>((resolve) => setTimeout(() => resolve(null), PIN_READ_WAIT_MS))]);
      readingPin.current = false;
    }
    show([
      ...(isTour ? [{ label: "View listing", icon: "open-outline" as const, onPress: openListing }] : []),
      ...(own ? [] : [{ label: `Message ${business ? business.name : reel.author.name.split(" ")[0]}`, icon: "chatbubble-ellipses-outline" as const, onPress: () => void message() }]),
      ...(pinNow !== null ? [{ label: pinNow ? "Unpin from profile" : "Pin to profile", icon: pinNow ? ("pin" as const) : ("pin-outline" as const), onPress: () => void togglePin(!pinNow) }] : []),
      ...(own && !isTour ? [{ label: `Delete ${noun}`, icon: "trash-outline" as const, destructive: true, onPress: confirmDelete }] : []),
      ...(own ? [] : [{ label: "Report", icon: "flag-outline" as const, destructive: true, onPress: report }]),
    ]);
  }

  /** The photo or video on screen, and its place on the page. */
  const shown = media[slide];
  const shownPlace = shown ? (shown.type === "photo" ? photoLayout(aspectAt(slide), width, boxH, room) : placeVideo(aspectAt(slide), width, boxH, room)) : null;
  // As a card under Orbit's open stories row (FeedCardContext): the picture on screen rises to the middle of what shows
  // of the card, or to its top when it is taller than that, so the card shows the picture rather than the black above it.
  const cardLift = card && shownPlace ? Math.max(0, (card.height - shownPlace.height) / 2) - shownPlace.top : 0;
  // The pinch: the media layer scales about its middle and moves so the point first under the fingers stays under them
  // (the card's lift included), then springs back as they lift.
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(feedZoom)
        .onStart((e) => {
          pinchFromX.value = e.focalX;
          pinchFromY.value = e.focalY;
          pinchPeak.value = 1;
          pinchLow.value = 1;
          runOnJS(pinchStarted)(true);
        })
        .onUpdate((e) => {
          const s = Math.max(PINCH_MIN, Math.min(PINCH_MAX, e.scale));
          const lift = card ? card.open.value * cardLift : 0;
          pinchScale.value = s;
          pinchX.value = e.focalX - pinchFromX.value + (pinchFromX.value - width / 2) * (1 - s);
          pinchY.value = e.focalY - pinchFromY.value + (pinchFromY.value - lift - height / 2) * (1 - s);
          pinchPeak.value = Math.max(pinchPeak.value, s);
          pinchLow.value = Math.min(pinchLow.value, s);
        })
        .onEnd(() => {
          runOnJS(pinchEnded)(pinchPeak.value, pinchLow.value);
        })
        .onFinalize(() => {
          pinchScale.value = withSpring(1, PINCH_BACK);
          pinchX.value = withSpring(0, PINCH_BACK);
          pinchY.value = withSpring(0, PINCH_BACK);
          runOnJS(pinchStarted)(false);
        }),
    [feedZoom, card, cardLift, width, height, pinchScale, pinchX, pinchY, pinchFromX, pinchFromY, pinchPeak, pinchLow, pinchStarted, pinchEnded],
  );
  const pageGesture = useMemo(() => (feedZoom ? Gesture.Simultaneous(swipe, pinch) : swipe), [feedZoom, swipe, pinch]);
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (card ? card.open.value * cardLift : 0) + pinchY.value }, { translateX: pinchX.value }, { scale: pinchScale.value }],
  }));
  /** Plays while its page (and slide) is on screen, unless paused by a tap or held still under the timeline's finger. */
  const playNow = playing && (closing || (!userPaused && !scrubbing));
  /** The slide's video player and its length, for its timeline (once the player has registered). */
  const slidePlayer = slideIsVideo ? (players.get(slide) ?? null) : null;
  const slideLength = shown?.type === "video" ? (shown.durationSeconds ?? null) : null;

  return (
    <PicturesContext.Provider value={pictures}>
    <PhotoZoomContext.Provider value={photoZoom}>
    <GestureDetector gesture={pageGesture}>
    {/* On the Reels tab the page trims what runs past it (a video's sides, a carousel's next slides); in the viewer the
        screen and the zoom's opening do, so the opening can show a whole video (see wholeVideo). */}
    <View style={{ width, height, overflow: chrome ? "visible" : "hidden", backgroundColor: colors.mediaBg }}>
      <CardLift lifted={card !== null || feedZoom} style={liftStyle}>
      {single ? (
        <>
          <VideoSlide uri={single.playbackUrl} poster={poster} aspect={aspectOf(single)} width={width} height={height} boxH={boxH} mounted={near} playing={playNow} topInset={topInset} bottomInset={bottomInset} room={room} index={0} startAt={startFrom} borrowed={lentPlayer} onStarted={started} onClock={onClock} onShown={firstShown} standIn={standIn} boost={boosted} onPlayer={onPlayer} />
          <Pressable style={StyleSheet.absoluteFill} onPress={onMediaTap} onLongPress={holdStart} onPressOut={holdEnd} delayLongPress={HOLD_MS} accessibilityRole="button" accessibilityLabel={userPaused ? "Play" : "Pause"} accessibilityHint="Press and hold to play at double speed" />
        </>
      ) : (
        <SlideStrip media={media} aspects={aspects} pos={stripPos} settled={settled} shown={slide} width={width} height={height} boxH={boxH} topInset={topInset} bottomInset={bottomInset} room={room} near={near} playing={playNow} onAspect={onAspect} onTap={onMediaTap} onHoldStart={holdStart} onHoldEnd={holdEnd} boost={boosted} onPlayer={onPlayer} goTo={goTo} startAt={startFrom} borrowed={lentPlayer} startSlide={firstSlide} onStarted={started} onClock={onClock} onShown={firstShown} standIn={standIn} />
      )}
      <HeartBursts ref={hearts} size={104} />
      </CardLift>

      <Reanimated.View pointerEvents={card?.chromeOff || clear || pinching ? "none" : "box-none"} accessibilityElementsHidden={card?.chromeOff || clear} importantForAccessibility={card?.chromeOff || clear ? "no-hide-descendants" : "auto"} style={[StyleSheet.absoluteFill, chromeStyle]}>
      {/* Stepped aside, the words and the rail leave the accessibility tree too, as they leave touch. */}
      <Reanimated.View pointerEvents={hushed ? "none" : "box-none"} accessibilityElementsHidden={hushed} importantForAccessibility={hushed ? "no-hide-descendants" : "auto"} style={[StyleSheet.absoluteFill, quietStyle]}>
      {/* Several photos or videos: where you are, just above the words at the bottom, TikTok's way, and rising with them
          over a video's timeline (wordsStyle). */}
      {media.length > 1 ? (
        <Reanimated.View pointerEvents="none" style={[styles.dots, { bottom: bottomInset + WORDS_GAP + wordsHeight + DOTS_GAP - DOTS_PAD }, wordsStyle]} accessibilityLabel={`${slide + 1} of ${media.length}`}>
          <View style={styles.dotsRow}>
            {media.map((_, i) => (
              <View key={i} style={[styles.dot, i === slide && styles.dotOn]} />
            ))}
          </View>
        </Reanimated.View>
      ) : null}

      {/* The words and the rail side by side, the words in their own column so they never run under a button: the rail
          keeps its place (OVERLAY_PAD), the words sit on their own line under it (WORDS_GAP, wordsLift). */}
      <View style={[styles.overlay, { paddingBottom: WORDS_GAP + bottomInset, paddingRight: railRight }]} pointerEvents="box-none">
        <Reanimated.View style={[styles.info, wordsStyle]} onLayout={(e) => setWordsHeight(e.nativeEvent.layout.height)} pointerEvents="box-none">
          {buzz ? (
            // Who wrote it, as the Buzz card says it: the thread's alias (Buzz's own mark, an emoji in a dashed ring of its
            // colour, and "Anon Comet"), "You" on your own, and nothing that leads anywhere.
            <View style={styles.alias} accessible accessibilityLabel={`${buzz.isMine ? "You, " : ""}${buzz.alias.label}${buzz.isOp ? ", original poster" : ""}, Buzz`}>
              <AliasAvatar alias={buzz.alias} />
              <Text style={styles.author} numberOfLines={1}>
                {buzz.isMine ? `You · ${buzz.alias.label}` : buzz.alias.label}
              </Text>
              <Text style={[styles.author, { fontSize: 12, fontWeight: "600", opacity: 0.85 }]}>· Buzz</Text>
            </View>
          ) : business ? (
            <Pressable onPress={unlessSwiped(() => router.push({ pathname: "/businesses/[id]", params: { id: business.id } }))} style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" }} accessibilityRole="link" accessibilityLabel={`${business.name}'s profile`}>
              <Text style={styles.author} numberOfLines={1}>
                {business.name}
              </Text>
              {business.verified_partner ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={16} color={colors.verifiedOnMedia} accessibilityLabel="Verified Partner" /> : null}
              <Text style={[styles.author, { fontSize: 12, fontWeight: "600", opacity: 0.85 }]}>· Business</Text>
            </Pressable>
          ) : (
            <Pressable onPress={unlessSwiped(() => openProfile(reel.author.id))} style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" }} accessibilityRole="link" accessibilityLabel={`${reel.author.name}'s profile`}>
              <Text style={styles.author} numberOfLines={1}>
                {reel.author.name}
              </Text>
              {reel.author.verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={16} color={colors.verifiedOnMedia} accessibilityLabel="Verified student" /> : null}
            </Pressable>
          )}
          {/* Short by default, like TikTok: one line of title and one of caption, "… more" opens the rest. */}
          {oneLine ? (
            expanded ? (
              <View style={{ gap: 2 }}>
                {reel.title ? (
                  <Text style={styles.title} numberOfLines={3}>
                    {reel.title}
                  </Text>
                ) : null}
                {reel.caption && isBuzz ? (
                  // A buzz's words as they were written: no links out of them, as on its card.
                  <Text style={styles.caption} numberOfLines={10}>
                    {reel.caption}
                  </Text>
                ) : reel.caption ? (
                  // Opened, hashtags and @mentions stand out (white and bold over a picture), and a mention opens its profile.
                  <Text style={styles.caption} numberOfLines={10}>
                    {captionParts(reel.caption).map((part, i) =>
                      part.tag || part.mention ? (
                        <Text key={i} style={styles.tag} onPress={part.mention ? unlessSwiped(() => openMention(part.mention!)) : undefined} accessibilityRole={part.mention ? "link" : undefined}>
                          {part.text}
                        </Text>
                      ) : (
                        part.text
                      ),
                    )}
                  </Text>
                ) : null}
                <Text onPress={unlessSwiped(() => setExpanded(false))} style={styles.more} accessibilityRole="button" accessibilityLabel="Show less">
                  less
                </Text>
              </View>
            ) : (
              /* One line with a tail "…", like Instagram; the line itself is the button, so VoiceOver reads the text and the hint. */
              <>
                <Text
                  style={styles.caption}
                  numberOfLines={1}
                  onPress={canExpand ? unlessSwiped(() => setExpanded(true)) : undefined}
                  accessibilityRole={canExpand ? "button" : "text"}
                  accessibilityHint={canExpand ? "Shows the full description" : undefined}
                >
                  {oneLine}
                </Text>
                {/* The whole description laid out unseen at the same width: more than one line means the line above was
                    cut. (iOS reports a cut line's full text, so the line itself cannot tell.) */}
                <Text style={[styles.caption, styles.measure]} onTextLayout={(e) => setClipped(e.nativeEvent.lines.length > 1)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {oneLine}
                </Text>
              </>
            )
          ) : null}
          {link ? <PostLink url={link} media guard={unlessSwiped} /> : null}
        </Reanimated.View>

        {buzz ? (
          // Buzz's own rail: the votes (up, the score, down; your own buzz, or one that is not active, takes none), the
          // replies on the thread's screen, and Share, which sends the thread's link and headline only (shareBuzz).
          <View style={styles.rail}>
            <RailButton icon="arrow-up" sf={buzz.myVote === 1 ? "arrowshape.up.fill" : "arrowshape.up"} label={compact(buzz.score)} onPress={unlessSwiped(() => voteOnBuzz(buzz.id, 1))} a11y={buzz.myVote === 1 ? `Remove upvote, score ${buzz.score}` : `Upvote, score ${buzz.score}`} selected={buzz.myVote === 1} disabled={buzz.isMine || buzz.status !== "active"} />
            <RailButton icon="arrow-down" sf={buzz.myVote === -1 ? "arrowshape.down.fill" : "arrowshape.down"} onPress={unlessSwiped(() => voteOnBuzz(buzz.id, -1))} a11y={buzz.myVote === -1 ? "Remove downvote" : "Downvote"} selected={buzz.myVote === -1} disabled={buzz.isMine || buzz.status !== "active"} />
            <RailButton icon="chatbubble-ellipses" sf="ellipsis.bubble.fill" size={33} label={compact(buzz.replyCount)} onPress={unlessSwiped(() => onOpenComments(reel))} a11y={`${buzz.replyCount} ${buzz.replyCount === 1 ? "reply" : "replies"}, open the thread`} />
            {buzz.status === "active" ? <RailButton icon="paper-plane" sf="paperplane.fill" size={31} label="Share" onPress={unlessSwiped(() => shareBuzz(buzz))} a11y="Share the thread's link" /> : null}
          </View>
        ) : (
        <View style={styles.rail}>
          <RailButton icon="heart" sf="heart.fill" size={35} tint={reel.likedByMe ? colors.like : undefined} label={compact(reel.likes)} onPress={unlessSwiped(toggleLike)} a11y={reel.likedByMe ? "Unlike" : "Like"} selected={reel.likedByMe} scale={pop} />
          {hasPublicComments(reel.sourceType) ? (
            commentsOff ? null : <RailButton icon="chatbubble-ellipses" sf="ellipsis.bubble.fill" size={33} label={compact(reel.comments)} onPress={unlessSwiped(() => onOpenComments(reel))} a11y="Comments" />
          ) : (
            // A roommate tour has no public comments: the poster is reached in private (your own opens your Inbox).
            <RailButton icon="chatbubble-ellipses" sf="ellipsis.bubble.fill" size={33} label="Inbox" onPress={unlessSwiped(() => (own ? router.push("/messages") : void message()))} a11y={own ? "Inbox" : `Message ${reel.author.name.split(" ")[0]}`} />
          )}
          {/* Saved before Share, as TikTok has them and as the owner asked for Orbit (2026-11-21): the filled bookmark is in the same colour as the rest of the rail (white over a picture). */}
          <RailButton icon="bookmark" sf="bookmark.fill" size={33} tint={reel.savedByMe ? SAVED_TINT : undefined} label={reel.savedByMe ? "Saved" : "Save"} onPress={unlessSwiped(() => void toggleSave())} a11y={reel.savedByMe ? "Unsave" : "Save"} selected={reel.savedByMe} />
          {shareable ? <RailButton icon="paper-plane" sf="paperplane.fill" size={31} label="Share" onPress={unlessSwiped(share)} a11y="Share" /> : null}
          <RailButton icon="ellipsis-horizontal" sf="ellipsis" size={27} weight="heavy" onPress={unlessSwiped(() => void more())} a11y="More options" />
        </View>
        )}
      </View>

      {/* Paused: the play button in the middle, Instagram style, fading away the moment the video plays again (a tap on
          play, or anywhere). There is no sound button: every video plays with its sound on (see VIDEO_MUTED). */}
      {slideIsVideo ? (
        <Animated.View pointerEvents={showControls ? "box-none" : "none"} style={[styles.center, { opacity: controls, transform: [{ scale: controls.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
          <View style={styles.controls}>
            <Pressable onPress={unlessSwiped(() => setUserPaused(false))} accessibilityRole="button" accessibilityLabel="Play" style={({ pressed }) => [styles.playBadge, pressed && { opacity: 0.85 }]}>
              <Icon name="play" size={44} color={colors.onMedia} style={{ marginLeft: 5 }} />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
      </Reanimated.View>

      {/* The video's timeline, under the words and the rail: it shows how far it has played and drags to scrub. */}
      {slidePlayer ? (
        <VideoTimeline key={slide} player={slidePlayer} duration={slideLength} inset={14} style={[styles.timeline, { bottom: bottomInset + TIMELINE_BOTTOM }]} onScrubStart={() => setScrubbing(true)} onScrubEnd={() => setScrubbing(false)} scrubbing={timelineHeld} />
      ) : null}
      {slideIsVideo ? <SpeedBadge visible={boosted} style={{ top: contentTop + BADGE_TOP }} /> : null}
      </Reanimated.View>
      {/* The clear page's one control, Instagram's: back to the name, the words and the rail. */}
      {clear && !pinching ? (
        <Reanimated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)} style={[styles.unclear, { bottom: bottomInset + 14 }]}>
          <Pressable onPress={() => setClear(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Show the post's details" style={({ pressed }) => [styles.unclearButton, pressed && { opacity: 0.7 }]}>
            <Icon name="contract-outline" sf="arrow.down.right.and.arrow.up.left" size={18} color="#fff" />
          </Pressable>
        </Reanimated.View>
      ) : null}
    </View>
    </GestureDetector>
    </PhotoZoomContext.Provider>
    </PicturesContext.Provider>
  );
});

/**
 * One of the rail's buttons: its icon and its count white over the picture, with a crisp shadow; `tint` colours an icon
 * that is on (the red heart).
 */
/**
 * One button of the rail down the right of a full-screen page, TikTok's (2026-11-22): a solid white glyph (red when
 * liked, gold when saved) centred in the same square as every other, with a soft shadow under it so it reads on any
 * picture, a bold count or word under it, and the bounce a symbol gives when it turns on. `size` tunes each glyph to the
 * same optical weight as the others.
 */
function RailButton({ icon, sf, label, tint, onPress, a11y, selected, size = 32, weight = "semibold", scale, disabled }: { icon: keyof typeof Ionicons.glyphMap; sf?: SFSymbol; label?: string; tint?: string; onPress: () => void; a11y: string; selected?: boolean; size?: number; weight?: SymbolWeight; scale?: Animated.Value; disabled?: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  // A heart or a bookmark that turns on bounces like the system's symbols.
  const bounce = useBounceOn(Boolean(selected));
  // Held, the button sinks and dims on a quick spring, TikTok's rail; it rises back as the finger lifts.
  const press = usePressScale(0.86, 0.78);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={6}
      disabled={disabled}
      style={[styles.railButton, disabled && { opacity: 0.45 }]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={selected === undefined && !disabled ? undefined : { selected, disabled }}
    >
      <Animated.View style={[styles.railInner, { opacity: press.opacity, transform: [{ scale: press.scale }] }]}>
        <Animated.View style={[styles.railIcon, scale ? { transform: [{ scale }] } : null]}>
          <Icon name={icon} sf={sf} size={size} weight={weight} color={tint ?? colors.onMedia} style={styles.iconShadow} bounce={bounce} />
        </Animated.View>
        {/* One line in the rail's 60pt column at any text size ("Share" once wrapped in two): it grows only so far. */}
        {label ? (
          <Text style={styles.railLabel} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {label}
          </Text>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

/**
 * The page's pictures (and their taps and heart), moved together as one where the feed shows the page as a card
 * (FeedCardContext); anywhere else exactly as they were, with no view added round them.
 */
function CardLift({ lifted, style, children }: { lifted: boolean; style: ComponentProps<typeof Reanimated.View>["style"]; children: ReactNode }) {
  if (!lifted) return <>{children}</>;
  return (
    <Reanimated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style]}>
      {children}
    </Reanimated.View>
  );
}

/** Width over height, when the upload recorded both. */
export function aspectOf(m: FeedMedia): number | null {
  return m.width && m.height ? m.width / m.height : null;
}

export type Placement = { left: number; top: number; width: number; height: number; fit: "cover" | "contain" };
const frame = (p: Placement) => ({ left: p.left, top: p.top, width: p.width, height: p.height });

/**
 * The room the page's own furniture takes at its top (the row with Back) and its bottom (the dots and the words), which
 * a picture is placed between rather than in the bare page: see mediaRoom and fitWhole.
 */
export type MediaRoom = { top: number; bottom: number };

/**
 * What the dots and the words take at the page's bottom, over the bottom inset: the dots' row, the name, a line of
 * caption and the gaps between them. A constant, not the words' real height, so a caption opened or closed never moves
 * the picture.
 */
const MEDIA_BOTTOM_ROOM = 84;

/** The room round the picture on a page whose top row ends at `contentTop` and whose furniture sits on `bottomInset`. */
export function mediaRoom(contentTop: number, bottomInset: number): MediaRoom {
  return { top: contentTop, bottom: bottomInset + MEDIA_BOTTOM_ROOM };
}

/**
 * Where a page's pictures go (the owner's brief, 2026-11-22): from the very top of the screen down to the top edge of
 * the bottom navigation bar, never behind or below it. `boxH` is that height (the page's, less `mediaBottom`, the bar's
 * room where the bar is drawn); `room` is the furniture round the picture inside it, the words' share measured up from
 * the box's bottom rather than the page's. The page itself stays the whole screen, black under the bar. One place for
 * this, so ReelItem and the viewer's zoom (app/reels/[id].tsx) can never disagree on where a picture is.
 */
export function mediaBox(height: number, contentTop: number, bottomInset: number, mediaBottom: number): { boxH: number; room: MediaRoom } {
  const below = Math.max(0, Math.min(mediaBottom, height));
  return { boxH: height - below, room: mediaRoom(contentTop, Math.max(0, bottomInset - below)) };
}

/**
 * The vertical content TikTok fills the screen with: 9:16 (0.5625) and anything up to 3:5, the shape a phone films in.
 * Wider than this, a picture is shown whole instead.
 */
const FILL_MAX_ASPECT = 0.6;

/**
 * A picture's place in the area a page keeps for it (see mediaBox: from the top of the screen to the top of the bottom
 * bar, never behind it), TikTok's display (the owner's brief, 2026-11-22): a vertical photo or video (9:16, or anything
 * up to 3:5) fills the whole area, a sliver cropped where its shape and the phone's differ (on a phone taller than 9:16,
 * a little of each side); a portrait (4:5), square or landscape one is shown whole, in its own shape, as wide as the area
 * allows and centred in it, pure black round it (see MediaFrame). Never stretched or distorted. An unknown shape (an
 * upload that did not record it, still loading) is shown whole in the area until it is known. `room` is no longer used
 * here (until 2026-11-22 a picture was raised toward the top row by it); it is kept for the zoom and the heart.
 */
function fitWhole(aspect: number | null, pageW: number, pageH: number, _room?: MediaRoom): Placement {
  if (aspect === null || !(aspect > 0)) return { left: 0, top: 0, width: pageW, height: pageH, fit: "contain" };
  if (aspect <= FILL_MAX_ASPECT) return { left: 0, top: 0, width: pageW, height: pageH, fit: "cover" };
  const width = Math.min(pageW, pageH * aspect);
  const height = width / aspect;
  return { left: (pageW - width) / 2, top: (pageH - height) / 2, width, height, fit: "contain" };
}

/** Where a photo sits on its page (see fitWhole). */
export function photoLayout(aspect: number | null, pageW: number, pageH: number, room?: MediaRoom): Placement {
  return fitWhole(aspect, pageW, pageH, room);
}

/** Where a video sits on its page (see fitWhole): whole, in its own shape, in the area above the bottom bar. On Orbit and in the viewer alike. */
export function placeVideo(aspect: number | null, pageW: number, pageH: number, room?: MediaRoom): Placement {
  return fitWhole(aspect, pageW, pageH, room);
}

/** The whole of a video as drawn on its page: its place (see placeVideo). The viewer's zoom opens and closes on it. */
export function wholeVideo(aspect: number | null, pageW: number, pageH: number, room?: MediaRoom): Placement {
  return placeVideo(aspect, pageW, pageH, room);
}

/**
 * Every slide, photo or video: pure black (colors.mediaBg, black in both themes) wherever the picture leaves the page, as
 * TikTok draws it, and over the bottom of the picture the shade that keeps the words and the rail readable (none at the
 * top: see below). A shade only, as Instagram draws it: a blur under the words would be sampled again every frame the video
 * plays, and re-drawn every frame the page zooms or is pulled back, which is where frames were being dropped.
 * `interactive` lets what is drawn in it take touches (a photo's zoom); otherwise every touch goes through to the slide.
 */
function MediaFrame({ whole, width, height, topInset, bottomInset, interactive = false, children }: { whole?: Placement; width: number; height: number; topInset: number; bottomInset: number; interactive?: boolean; children: ReactNode }) {
  const colors = useColors();
  const styles = useStyles();
  // The shades are there for the words and the rail, so in the viewer they come and go with them: the zoom opens on the
  // bare picture, exactly as the feed showed it, and lands back on it. A zoomed photo shows bare too.
  const chrome = useContext(ViewerChromeContext);
  const card = useContext(FeedCardContext);
  const zoom = useContext(PhotoZoomContext);
  const shadesStyle = useAnimatedStyle(() => ({ opacity: (chrome ? chrome.value : 1) * (card ? 1 - card.open.value : 1) * (zoom ? 1 - zoom.fade.value : 1) }));
  // As wide as the picture, where a video runs past the page's sides (see wholeVideo): fading, they leave no edge on it.
  const across = whole ? { left: Math.min(0, whole.left), right: Math.min(0, width - whole.left - whole.width) } : null;
  return (
    <View style={{ width, height, backgroundColor: colors.mediaBg }} pointerEvents={interactive ? "box-none" : "none"}>
      {children}
      {/* A soft shade at the bottom, under the name and the rail, so white words and icons stay readable over a bright
          picture. None at the top, on any page (the owner's brief, 2026-11-24, after the feeds lost theirs on 2026-11-22):
          the top of the picture shows clear, TikTok's way; Home's labels carry their own soft shadow, and the viewer's top
          row holds only the Campus | Global toggle, hidden today (SCOPE_TOGGLE_SHOWN). */}
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, across, shadesStyle]}>
        <View style={styles.shade} />
      </Reanimated.View>
    </View>
  );
}

/** What a video slide needs to go on from the feed (`startAt`, then `onStarted`) and to tell the viewer how far it has got (`onClock`). */
type VideoHandover = {
  index: number;
  startAt?: number;
  borrowed?: VideoPlayer;
  onStarted?: () => void;
  onClock?: (index: number, read: (() => number) | null) => void;
  onShown?: () => void;
  standIn?: string;
  /** Held at 2× (a finger on the video); otherwise 1×. */
  boost?: boolean;
  /** Hands the page this slide's player (null as it goes), for its timeline. */
  onPlayer?: (index: number, player: VideoPlayer | null) => void;
};

/**
 * A video's slide, whole and centred on black (see placeVideo): its player (only near the page on screen, so at most a few
 * exist at a time) or its poster. A video uploaded without its size takes the shape of its poster (a frame of it) once
 * that loads, so it is placed like any other.
 */
function VideoSlide({ uri, poster, aspect: recorded, width, height, boxH, mounted, playing, topInset, bottomInset, room, ...handover }: { uri: string; poster: string; aspect: number | null; width: number; height: number; boxH: number; mounted: boolean; playing: boolean; topInset: number; bottomInset: number; room: MediaRoom } & VideoHandover) {
  const styles = useStyles();
  const [measured, setMeasured] = useState<number | null>(null);
  const aspect = recorded ?? measured;
  const measure = recorded === null && measured === null ? (e: ImageLoadEventData) => (e.source.width > 0 && e.source.height > 0 ? setMeasured(e.source.width / e.source.height) : undefined) : undefined;
  const whole = wholeVideo(aspect, width, boxH, room);
  // The video's very first frame as its still (the poster is a frame a second in): when the player takes over, the
  // picture does not jump back.
  const first = poster ? posterAt(poster, 0) : "";
  const pictures = useContext(PicturesContext);
  return (
    <MediaFrame whole={whole} width={width} height={height} topInset={topInset} bottomInset={bottomInset}>
      {mounted ? (
        <PageVideo uri={uri} poster={poster} first={first} whole={whole} playing={playing} onMeasure={measure} {...handover} />
      ) : first && pictures ? (
        <Image source={{ uri: first }} placeholder={handover.standIn || poster ? { uri: handover.standIn || poster } : undefined} style={[styles.whole, frame(whole)]} contentFit={whole.fit} placeholderContentFit={whole.fit} transition={0} onLoad={measure} onDisplay={handover.onShown} />
      ) : null}
    </MediaFrame>
  );
}

/** How long a video taken over from the feed waits for its jump to land before it plays anyway. */
const HANDOVER_WAIT_MS = 1500;

/**
 * A video's player, drawn whole (see wholeVideo); its poster stays on top until the first frame is painted, so a page is
 * never a black box. Playing the feed's own player (`borrowed`), it shows the feed's very frame and goes on as it is.
 * Taken over from the feed by time instead (`startAt`), it goes on from that moment: once loaded it jumps there and only
 * then plays. Meanwhile the poster (already loaded by the feed) covers the wait, and the still from that very moment over
 * it as soon as it arrives, so it never flashes its first frame. `onShown`: the first picture it drew.
 */
function PageVideo({ uri, poster, first, whole, playing, onMeasure, index, startAt, borrowed, onStarted, onClock, onShown, standIn, boost = false, onPlayer }: { uri: string; poster: string; first: string; whole: Placement; playing: boolean; onMeasure?: (e: ImageLoadEventData) => void } & VideoHandover) {
  const styles = useStyles();
  /** The feed's player, played on as it is, for this mount's whole life. */
  const [shared] = useState(borrowed ?? null);
  const own = useVideoPlayer(shared ? null : { uri }, (p) => {
    p.loop = true;
    p.muted = VIDEO_MUTED;
    p.audioMixingMode = VIDEO_AUDIO_MODE;
  });
  const player = shared ?? own;
  useEffect(() => {
    if (!shared) return;
    lendPlayer(shared);
    onStarted?.();
    return () => {
      // Back to the feed at its own speed, whatever a hold had asked.
      try {
        shared.playbackRate = 1;
      } catch {
        // Released already.
      }
      returnPlayer(shared);
    };
    // Once: the player is this mount's for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The feed's player is already showing its live frame (once it has drawn one); nothing goes over it.
  const [hasFrame, setHasFrame] = useState(() => shared !== null && hasDrawn(shared));
  /** False while a handed-over video is still on its way to `startAt`. */
  const [arrived, setArrived] = useState(() => Boolean(shared) || !(startAt && startAt > 0.2));
  const startRef = useRef(startAt);
  const [still] = useState(() => (!shared && poster && startAt && startAt > 0.2 ? posterAt(poster, startAt) : null));
  useEffect(() => {
    const target = startRef.current;
    if (arrived || !target) return;
    return goOnFrom(player, target, () => {
      setArrived(true);
      onStarted?.();
    });
    // Once, as the player starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);
  // Only what changes is touched: the feed's player arrives playing, with the app's sound, and goes on untouched.
  useEffect(() => {
    if (!(playing && arrived)) player.pause();
    else if (!player.playing) player.play();
  }, [playing, arrived, player]);
  // Sound on, always, the feed's player handed over included (see VIDEO_MUTED).
  useEffect(() => {
    if (player.muted !== VIDEO_MUTED) player.muted = VIDEO_MUTED;
  }, [player]);
  // 1× always, 2× only while held.
  useEffect(() => {
    const rate = boost ? BOOST_RATE : 1;
    if (player.playbackRate !== rate) player.playbackRate = rate;
  }, [boost, player]);
  useEffect(() => {
    if (!onPlayer) return;
    onPlayer(index, player);
    return () => onPlayer(index, null);
  }, [onPlayer, index, player]);
  // Until it has got to where the feed was (`startAt`), that is where it is: closing that early hands that time back,
  // not the 0 a player still loading reads.
  const arrivedRef = useRef(arrived);
  arrivedRef.current = arrived;
  useEffect(() => {
    if (!onClock) return;
    onClock(index, () => (arrivedRef.current || !startRef.current ? player.currentTime : startRef.current));
    return () => onClock(index, null);
  }, [onClock, index, player]);
  return (
    <View style={[styles.whole, frame(whole)]}>
      {/* No Live Text on a paused frame: its button would sit over the play control, and the scan it runs on every pause is wasted. */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit={whole.fit}
        nativeControls={false}
        allowsVideoFrameAnalysis={false}
        onFirstFrameRender={() => {
          setHasFrame(true);
          onShown?.();
        }}
      />
      {(!hasFrame || !arrived) && poster ? (
        <Image source={{ uri: poster }} placeholder={standIn ? { uri: standIn } : undefined} placeholderContentFit={whole.fit} style={StyleSheet.absoluteFill} contentFit={whole.fit} transition={0} onLoad={onMeasure} onDisplay={onShown} />
      ) : null}
      {/* Over the poster, the first frame itself (when it is not taking over part way through): what the player shows next. */}
      {!hasFrame && !still && first ? <Image source={{ uri: first }} style={StyleSheet.absoluteFill} contentFit={whole.fit} transition={0} /> : null}
      {!arrived && still ? <Image source={{ uri: still }} style={StyleSheet.absoluteFill} contentFit={whole.fit} transition={0} /> : null}
    </View>
  );
}

/**
 * Moves a fresh player to `seconds` and calls `done` once it is there: as soon as the video is loaded it jumps, and the
 * player's own clock reporting that moment says it has landed (or, failing that, a short wait). Returns the cleanup.
 */
function goOnFrom(player: VideoPlayer, seconds: number, done: () => void): () => void {
  let jumped = false;
  let finished = false;
  /** Quick time reports while it lands, through wantTimeUpdates: a timeline asking for its own keeps them after. */
  let letGo: (() => void) | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    letGo?.();
    letGo = null;
    clearTimeout(fallback);
    done();
  };
  const jump = () => {
    if (jumped) return;
    jumped = true;
    letGo = wantTimeUpdates(player, 0.1);
    player.currentTime = seconds;
  };
  const status = player.addListener("statusChange", ({ status: next }) => {
    if (next === "readyToPlay") jump();
  });
  const time = player.addListener("timeUpdate", ({ currentTime }) => {
    if (jumped && currentTime >= seconds - 0.3) finish();
  });
  if (player.status === "readyToPlay") jump();
  const fallback = setTimeout(finish, HANDOVER_WAIT_MS);
  return () => {
    status.remove();
    time.remove();
    clearTimeout(fallback);
    letGo?.();
  };
}

/**
 * A photo's slide (see photoLayout): whole and centred on black in the area above the bottom bar, as big as that area
 * allows. Its tiny blurred preview
 * shows at once, in the photo's own place; a photo uploaded without its size reports its shape once loaded (`onAspect`)
 * and takes its place from then on. It zooms (see Zoomable) while it is the slide on show (`active`).
 */
function PhotoSlide({ uri, blur, aspect, width, height, boxH, topInset, bottomInset, room, onAspect, onShown, standIn, active = true }: { uri: string; blur: string | null; aspect: number | null; width: number; height: number; boxH: number; topInset: number; bottomInset: number; room: MediaRoom; onAspect: (aspect: number) => void; onShown?: () => void; standIn?: string; active?: boolean }) {
  const styles = useStyles();
  const place = photoLayout(aspect, width, boxH, room);
  const pictures = useContext(PicturesContext);
  const zoom = useContext(PhotoZoomContext);
  // Closing, the viewer shrinks the page back into the feed's own picture: a zoomed photo settles back to rest first.
  const closing = useContext(ViewerClosingContext);
  const picture = pictures ? (
    <Image
      source={{ uri }}
      // Its tiny blurred preview (inline, so it shows at once), else the page's stand-in when that is another picture.
      placeholder={blur ? { uri: blur } : standIn && standIn !== uri ? { uri: standIn } : undefined}
      placeholderContentFit={place.fit}
      style={[styles.placed, frame(place)]}
      contentFit={place.fit}
      // The photo the viewer opened on is the feed's, already loaded: it shows at once, with no fade in.
      transition={onShown ? 0 : 200}
      onLoad={aspect !== null ? undefined : (e) => (e.source.width > 0 && e.source.height > 0 ? onAspect(e.source.width / e.source.height) : undefined)}
      onDisplay={onShown}
    />
  ) : null;
  return (
    <MediaFrame interactive={zoom !== null && zoom.doubleTap} width={width} height={height} topInset={topInset} bottomInset={bottomInset}>
      {zoom && zoom.doubleTap ? (
        <Zoomable width={width} height={height} frame={place} active={active && !closing} zoomed={zoom.zoomed} onZoomChange={zoom.onChange} doubleTapZoom={zoom.doubleTap}>
          {picture}
        </Zoomable>
      ) : (
        picture
      )}
    </MediaFrame>
  );
}

/** VoiceOver's swipe up and down on a slide of a carousel. */
const ADJUST = [{ name: "increment" }, { name: "decrement" }] as const;

/**
 * A post's photos and videos side by side on a strip, one page wide each, that the page's swipe moves (see usePageSwipe):
 * a photo on the page's colour (or full screen, when it is as tall as a phone's screen), a video full screen. A video
 * slide plays once the strip has settled on it (and while its page is on screen); players mount only for the slides
 * beside that one. Each slide takes the page's taps (a lone tap pauses a video, a double tap likes it; a photo's taps
 * are its zoom's) and holds (a video runs at 2× while held, `boost` on the slide settled on); VoiceOver reads the slide
 * showing, and a swipe up or down on it moves to the next or the previous one.
 */
function SlideStrip({ media, aspects, pos, settled, shown, width, height, boxH, topInset, bottomInset, room, near, playing, onAspect, onTap, onHoldStart, onHoldEnd, boost, onPlayer, goTo, startAt, borrowed, startSlide, onStarted, onClock, onShown, standIn }: { media: FeedMedia[]; aspects: Record<number, number>; pos: SharedValue<number>; settled: number; shown: number; width: number; height: number; boxH: number; topInset: number; bottomInset: number; room: MediaRoom; near: boolean; playing: boolean; onAspect: (index: number, aspect: number) => void; onTap: (e: GestureResponderEvent) => void; onHoldStart: () => void; onHoldEnd: () => void; boost: boolean; onPlayer: (index: number, player: VideoPlayer | null) => void; goTo: (index: number) => void; startAt?: number; borrowed?: VideoPlayer; startSlide: number; onStarted: () => void; onClock: (index: number, read: (() => number) | null) => void; onShown?: () => void; standIn?: string }) {
  const styles = useStyles();
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pos.value }] }));
  return (
    <Reanimated.View style={[styles.strip, { width: width * media.length, height }, stripStyle]}>
      {media.map((item, i) => {
        const close = near && Math.abs(i - settled) <= 1;
        return (
          <Pressable
            key={`${i}:${item.type === "photo" ? item.url : item.playbackUrl}`}
            onPress={onTap}
            onLongPress={item.type === "video" ? onHoldStart : undefined}
            onPressOut={item.type === "video" ? onHoldEnd : undefined}
            delayLongPress={HOLD_MS}
            style={{ width, height, zIndex: i === settled ? 1 : 0 }}
            accessibilityRole="adjustable"
            accessibilityLabel={`${item.type === "video" ? "Video" : "Photo"} ${i + 1} of ${media.length}`}
            accessibilityActions={ADJUST}
            onAccessibilityAction={(e) => goTo(e.nativeEvent.actionName === "increment" ? i + 1 : i - 1)}
            accessibilityElementsHidden={i !== shown}
            importantForAccessibility={i === shown ? "auto" : "no-hide-descendants"}
          >
            <SlideClip settled={i === settled}>
              {item.type === "photo" ? (
                <PhotoSlide uri={item.url} blur={item.blur} aspect={aspectOf(item) ?? aspects[i] ?? null} width={width} height={height} boxH={boxH} room={room} topInset={topInset} bottomInset={bottomInset} onAspect={(a) => onAspect(i, a)} onShown={i === startSlide ? onShown : undefined} standIn={i === 0 ? standIn : undefined} active={i === settled} />
              ) : (
                <VideoSlide uri={item.playbackUrl} poster={item.poster ?? ""} aspect={aspectOf(item)} width={width} height={height} boxH={boxH} room={room} mounted={close} playing={playing && i === settled} topInset={topInset} bottomInset={bottomInset} index={i} startAt={i === startSlide ? startAt : undefined} borrowed={i === startSlide ? borrowed : undefined} onStarted={onStarted} onClock={onClock} onShown={i === startSlide ? onShown : undefined} standIn={i === 0 ? standIn : undefined} boost={boost && i === settled} onPlayer={onPlayer} />
              )}
            </SlideClip>
          </Pressable>
        );
      })}
    </Reanimated.View>
  );
}

/**
 * Where a carousel's slide trims what runs past it (a vertical video's sides, see wholeVideo): always, except the slide
 * the strip rests on while the viewer zooms (ViewerZoomContext), which then shows whole, over its neighbours. Switched
 * on the UI thread, so it is there in the zoom's very first frame.
 */
function SlideClip({ settled, children }: { settled: boolean; children: ReactNode }) {
  const zoom = useContext(ViewerZoomContext);
  const clipStyle = useAnimatedStyle(() => ({ overflow: settled && zoom !== null && zoom.value === 1 ? "visible" : "hidden" }));
  return <Reanimated.View style={[StyleSheet.absoluteFill, clipStyle]}>{children}</Reanimated.View>;
}

/**
 * Over a picture, the media colours (light text, dark scrims) in both themes; on a photo's page (the `…Page` styles),
 * the theme's own ink on the page's own colour.
 */
const useStyles = makeStyles((colors) => {
  // Under the white name, caption and labels: darker than mediaScrim, so the text stays sharp on bright footage.
  // A tight halo: a wide, soft one fades to nothing around thin 12pt digits on a bright frame.
  const shadow = { textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
  return {
    center: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
    playBadge: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
    // The play button, dead centre.
    controls: { alignItems: "center" },
    shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: SHADE_HEIGHT, experimental_backgroundImage: scrimGradient(colors.mediaScrim, bottomShare) },
    // A carousel's slides side by side, moved as one.
    strip: { position: "absolute", top: 0, left: 0, flexDirection: "row" },
    // A photo's place on the page (see photoLayout): clipped, so a cover fit never spills past it.
    placed: { position: "absolute", overflow: "hidden" },
    // A video, drawn whole (see wholeVideo): the page or its slide trims it.
    whole: { position: "absolute" },
    dots: { position: "absolute", left: 0, right: 0, alignItems: "center" },
    timeline: { position: "absolute", left: 0, right: 0 },
    dotsRow: { flexDirection: "row", gap: 5, padding: DOTS_PAD, borderRadius: 999, backgroundColor: colors.mediaScrim },
    dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2, backgroundColor: colors.onMediaMuted },
    dotOn: { width: 18, backgroundColor: colors.onMedia },
    // Instagram's geometry on an iPhone: the "…" centre 46pt above the tab bar, then save, share, comment and like every
    // 73pt or so; the words, in their own column, on their own line below (see WORDS_GAP).
    overlay: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end", paddingLeft: 14, paddingRight: 8, gap: 10 },
    info: { flex: 1, gap: 6 },
    author: { color: colors.onMedia, fontSize: 16, fontWeight: "700", flexShrink: 1, ...shadow },
    // A buzz's alias: Buzz's own mark, then its name.
    alias: { flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start", maxWidth: "100%" },
    title: { color: colors.onMedia, fontSize: 15, fontWeight: "700", ...shadow },
    caption: { color: colors.onMedia, fontSize: 14, lineHeight: 19, ...shadow },
    more: { color: colors.onMediaMuted, fontSize: 13, fontWeight: "700", ...shadow },
    // Hashtags and mentions in an opened caption: bold white over the picture.
    tag: { fontWeight: "700" },
    // Lifted from the words' line to its own: its bottom stays OVERLAY_PAD over the bottom inset.
    rail: { width: RAIL_WIDTH, alignItems: "center", gap: RAIL_GAP, marginBottom: OVERLAY_PAD - WORDS_GAP },
    railButton: { alignItems: "center", minWidth: 48 },
    // Every glyph in the same square, a soft shadow under it (a view's, so the system's own symbols get it too).
    railIcon: { width: RAIL_ICON, height: RAIL_ICON, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
    // The clear page's button back, in the corner over the bottom bar, as Instagram's.
    unclear: { position: "absolute", right: 14 },
    unclearButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.38)", alignItems: "center", justifyContent: "center" },
    railInner: { alignItems: "center", gap: 2 },
    // The unseen copy of the description that tells whether its one line was cut.
    measure: { position: "absolute", left: 0, right: 0, opacity: 0 },
    // The rail's counts and icons: a crisp edge rather than a glow, so they stay sharp, and readable on a white wall, with no
    // smudge or shading round them.
    railLabel: { color: colors.onMedia, fontSize: 12.5, fontWeight: "700", letterSpacing: 0.1, fontVariant: ["tabular-nums"], textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 0.5 }, textShadowRadius: 2 },
    iconShadow: { textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 0.5 }, textShadowRadius: 2 },
  };
});
