import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance, type TextInputInstance } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, runOnJS, useAnimatedKeyboard, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, ZoomIn, ZoomOut, type SharedValue } from "react-native-reanimated";
import {
  blockUser,
  createLikeSync,
  deleteStory,
  formatMessageTime,
  likeStory,
  listStoryViewers,
  markStorySeen,
  muxPlaybackUrl,
  REPORT_REASONS,
  reportContent,
  sendStoryReply,
  sharedPostFromStory,
  STORY_ACTION_BAR,
  storyAge,
  storyAudienceNote,
  storyDurationMs,
  unlikeStory,
  type StoryGroup,
  type StoryViewer,
} from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { Avatar } from "@/components/avatar";
import { useFollow, useFollowStatsMany } from "@/components/follow-button";
import { Icon, type IconName } from "@/components/icon";
import { useShareSheet } from "@/components/share-sheet";
import { Sheet, SheetHeader } from "@/components/sheet";
import { alertWithHaptic, hapticLike, hapticSelect, hapticSuccess, hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useColors } from "@/lib/theme-provider";
import { noteStoryAuthorBlocked, noteStoryDeleted, noteStoryLiked, noteStorySeen, markStoriesStale, setStoryMuted, useStoryMuted } from "@/lib/stories-store";
import { supabase } from "@/lib/supabase";
import { VIDEO_AUDIO_MODE } from "@/lib/video-sound";

/**
 * Everyone's stories, playing one person at a time: the picture edge to edge and filling the screen, the bars for each
 * of that person's stories across the very top filling as it plays, who shared it and when under them, and the rail
 * and the reply pill below (see StoryPage). The full-screen viewer draws it (app/stories/[id].tsx), opened from a ring
 * in the row across Orbit's top (components/home/stories-row.tsx), a story's link, a story card in a chat or a profile.
 *
 * Navigation is Instagram's (the owner's brief, 2026-11-22): a tap on the right goes to the next story — past this
 * person's last, to the next person — and a tap on the left to the one before — before their first, to the previous
 * person's last story (or, at the very first, back to the start of it); a swipe **sideways** switches people, the page
 * turning like a face of a cube (CubeFace); holding the picture pauses the story and its bar, letting go plays on; and
 * the clock running out moves on by itself, exactly as a tap on the right does. `onDone` is called past the last
 * person's last story (the viewer closes). For a day
 * (2026-11-21) people moved up and down instead, TikTok's way, while Stories was a tab of Home whose sideways swipe
 * belonged to Home's sections; it no longer is, so the sideways axis is the viewer's own again. `onClose` draws the
 * Close button.
 */
export function StoryPlayer({ groups, start, width, height, barsTop, bottomInset, active, onDone, onClose }: { groups: StoryGroup[]; start: number; width: number; height: number; barsTop: number; bottomInset: number; active: boolean; onDone: () => void; onClose?: () => void }) {
  const { user } = useSession();
  const meId = user?.id ?? null;
  // One keyboard watcher for every page (Reanimated wants as few as possible): the reply row rides on top of it.
  const keyboard = useAnimatedKeyboard();
  const [index, setIndex] = useState(start);
  const pager = useRef<ScrollViewInstance>(null);
  /** Same object on every render: a new one would send the pager back to the first person. */
  const initialOffset = useRef({ x: start * width, y: 0 });
  /** The width the pager was last placed at: a rotation puts it back on its page rather than between two. */
  const placedWidth = useRef(0);
  const place = useCallback(() => {
    if (width <= 0) return;
    pager.current?.scrollTo({ x: index * width, y: 0, animated: false });
    placedWidth.current = width;
  }, [index, width]);
  /** Where the pager stands, in points, on the UI thread: each face turns by it (see CubeFace). */
  const scrollX = useSharedValue(start * width);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });
  const go = useCallback(
    (next: number) => {
      if (next >= groups.length) return onDone();
      pager.current?.scrollTo({ x: next * width, y: 0, animated: true });
    },
    [groups.length, width, onDone],
  );
  /**
   * Where a person's page should stand when it next comes on: set before a tap on the left takes the viewer back to the
   * person before, so their page turns in on their last story, Instagram's way, rather than wherever it was. A fresh
   * object each time (`n`), so the same story asked for twice still moves the page.
   */
  const [entries, setEntries] = useState<Record<string, { at: number; n: number }>>({});
  /** Back a person, onto their last story; false at the very first person, where the story starts over instead. */
  const back = useCallback(
    (from: number) => {
      const prev = groups[from - 1];
      if (!prev) return false;
      setEntries((e) => ({ ...e, [prev.author.id]: { at: prev.stories.length - 1, n: Date.now() } }));
      pager.current?.scrollTo({ x: (from - 1) * width, y: 0, animated: true });
      return true;
    },
    [groups, width],
  );
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (placedWidth.current !== width) return;
    setIndex(Math.max(0, Math.min(groups.length - 1, Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)))));
  };

  return (
    <Animated.ScrollView
      ref={pager}
      horizontal
      pagingEnabled
      bounces={false}
      overScrollMode="never"
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentOffset={initialOffset.current}
      onContentSizeChange={place}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onMomentumScrollEnd={onEnd}
      scrollsToTop={false}
      style={{ width, height }}
    >
      {groups.map((group, i) => (
        <CubeFace key={group.author.id} at={i} scrollX={scrollX} width={width} height={height}>
          {/* Only the page on screen and the two beside it are drawn: a plain pager is not virtualized. */}
          {Math.abs(i - index) <= 1 ? (
            <StoryPage group={group} active={active && i === index} width={width} height={height} barsTop={barsTop} bottomInset={bottomInset} me={meId} keyboard={keyboard.height} entry={entries[group.author.id]} onDone={() => go(i + 1)} onBack={() => back(i)} onClose={onClose} />
          ) : null}
        </CubeFace>
      ))}
    </Animated.ScrollView>
  );
}

/**
 * How far a cube turns as the pager moves a whole page: a quarter turn, so the two faces meet at a right angle and the
 * seam between them never opens. The eye sits this many screen widths in front of the cube.
 */
const CUBE_TURN = 90;
const CUBE_EYE = 1.6;
/** How dark a face is once it has turned away: the far side of a solid cube, so it reads as one object, not two pictures. */
const CUBE_SHADE = 0.55;

/**
 * One person's page as a face of a cube, Instagram's turn between people. The page keeps the place the pager gives it;
 * this only turns it about the edge it shares with the page coming on — its right edge going left, its left edge coming
 * back — so the two faces stay joined through the whole swipe and the one turning away darkens as it goes. The rotation
 * is built from translate · rotate · translate rather than a transform origin, which cannot be animated. Everything
 * runs on the UI thread from the pager's offset, so a turn never waits on React.
 */
function CubeFace({ at, scrollX, width, height, children }: { at: number; scrollX: SharedValue<number>; width: number; height: number; children: React.ReactNode }) {
  const face = useAnimatedStyle(() => {
    // -1 a page to the right of the screen, 0 on it, 1 a page to the left.
    const p = Math.max(-1, Math.min(1, (scrollX.value - at * width) / Math.max(width, 1)));
    // The hinge: the right edge while this page leaves to the left, the left edge while it comes back from the right.
    const hinge = (p > 0 ? width : -width) / 2;
    return {
      transform: [{ perspective: width * CUBE_EYE }, { translateX: hinge }, { rotateY: `${-p * CUBE_TURN}deg` }, { translateX: -hinge }],
    };
  });
  const shade = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.abs((scrollX.value - at * width) / Math.max(width, 1))) * CUBE_SHADE }));
  return (
    <Animated.View style={[{ width, height, backgroundColor: "#000" }, face]}>
      {children}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }, shade]} />
    </Animated.View>
  );
}

/**
 * One person's stories, playing while `active` (the page on screen). `barsTop` is exactly where the row of bars sits,
 * so a caller can pin them above whatever else is drawn over the story (Home's tabs sit just under them), and
 * `bottomInset` what the words, the rail and the reply pill keep clear below them: the home indicator
 * in the viewer, or whatever else a caller keeps clear under the story.
 * `keyboard` is the keyboard's height, for the reply row.
 */
function StoryPage({ group, active, width, height, barsTop, bottomInset, me, keyboard, entry, onDone, onBack, onClose }: { group: StoryGroup; active: boolean; width: number; height: number; barsTop: number; bottomInset: number; me: string | null; keyboard: SharedValue<number>; entry?: { at: number; n: number }; onDone: () => void; onBack: () => boolean; onClose?: () => void }) {
  // The list of views is a sheet in the app's theme; everything else on this screen is on black.
  const colors = useColors();
  const router = useRouter();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const [at, setAt] = useState(group.startAt);
  const story = group.stories[Math.min(at, group.stories.length - 1)]!;
  const [held, setHeld] = useState(false);
  /** Paused with the button in the top row, until it is pressed again or the story changes. */
  const [paused, setPaused] = useState(false);
  /** The viewers sheet: null closed, [] loading, else the list. */
  const [viewers, setViewers] = useState<StoryViewer[] | null>(null);
  /** The reply box has the keyboard, the share sheet is up, or the "⋯" menu (or what it opened) is: the story waits. */
  const [typing, setTyping] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  /** "Sent" over the reply row for a moment after a reply goes. */
  const [sentAt, setSentAt] = useState(0);
  /** Hearts changed here, by story id: the groups the viewer was handed are a snapshot. */
  const [likedNow, setLikedNow] = useState<Record<string, boolean>>({});
  /** Each story's heart requests, one at a time with the last tap winning (createLikeSync). */
  const likeSyncs = useRef(new Map<string, ReturnType<typeof createLikeSync>>());
  const input = useRef<TextInputInstance>(null);
  const progress = useSharedValue(0);
  const duration = storyDurationMs(story);
  const elapsedBefore = useRef(0);
  /** When the bar last started moving (Date.now()), or null while it is still: see the clock below. */
  const clockSince = useRef<number | null>(null);
  const mine = group.mine && group.author.id === me;
  const author = group.author;
  const firstName = author.full_name.trim().split(/\s+/)[0] || author.full_name;
  const muted = useStoryMuted(mine ? null : author.id);
  // Whether this person is already followed: asked for only on someone else's story, and only while signed in.
  const followTargets = useMemo(() => (mine || !me ? [] : [{ id: author.id }]), [mine, me, author.id]);
  const followStats = useFollowStatsMany(followTargets, me);
  const follow = useFollow(author.id, followStats[author.id], me, () => router.push("/(auth)/login"));
  const liked = likedNow[story.id] ?? story.liked;
  // The story whose picture can be seen: its photo loaded (or failed, so the viewer moves on), its video ready and not
  // buffering. The clock runs only for it; the video is asked to play as soon as the page is on screen.
  const [shown, setShown] = useState<string | null>(null);
  const ready = shown === story.id;
  const wanted = active && !held && !paused && viewers === null && !typing && !sharing && !menuOpen;
  const playing = wanted && ready;
  const storyId = story.id;
  const onPhoto = useCallback(() => setShown(storyId), [storyId]);
  const onVideo = useCallback((canPlay: boolean) => setShown(canPlay ? storyId : null), [storyId]);
  // The next photo of this person's loads while this one shows (the next person's page renders beside this one).
  useEffect(() => {
    const next = group.stories[at + 1];
    if (active && next?.kind === "photo" && next.photo) void Image.prefetch(next.photo.url).catch(() => false);
  }, [active, at, group.stories]);

  /**
   * Instagram's taps (the owner's brief, 2026-11-22). On the right: the next story, and past this person's last, the
   * next person (onDone, the very thing the clock running out does). On the left: the story before, and before their
   * first, the previous person's last story (onBack); at the very first story of all it starts over. `restart` re-runs
   * the clock for that one case, where the story itself does not change.
   */
  const [restart, setRestart] = useState(0);
  const last = at + 1 >= group.stories.length;
  const ended = useCallback(() => {
    if (at + 1 < group.stories.length) setAt(at + 1);
    else onDone();
  }, [at, group.stories.length, onDone]);
  const tapNext = ended;
  const tapBack = useCallback(() => {
    if (at > 0) return setAt(at - 1);
    if (onBack()) return;
    cancelAnimation(progress);
    progress.value = 0;
    elapsedBefore.current = 0;
    clockSince.current = null;
    setRestart((n) => n + 1);
  }, [at, onBack, progress]);
  // Turned to from the person after by a tap on the left: on their last story (see StoryPlayer's `entries`).
  useEffect(() => {
    if (entry) setAt(Math.min(entry.at, group.stories.length - 1));
  }, [entry, group.stories.length]);
  // A story that changes plays, whatever the button said about the one before.
  useEffect(() => setPaused(false), [story.id]);
  const endedRef = useRef(ended);
  endedRef.current = ended;
  const fire = useCallback(() => endedRef.current(), []);

  // A new story on screen: the bar starts over, and the story counts as seen (never your own).
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    elapsedBefore.current = 0;
    clockSince.current = null;
    if (!active || mine) return;
    noteStorySeen(story.id);
    void markStorySeen(supabase, story.id).catch(() => {});
  }, [story.id, active, mine, progress]);
  /**
   * The clock: runs while playing; held or paused, it keeps its place and goes on from there. How much of the story has
   * played is kept here in JS, from the moments the bar started and stopped (`clockSince`), never read back from the
   * bar's own animated value: on the JS side that value can still be the story before's (1, full) just after the story
   * changes, and a new story that had to load first was then counted as already over and skipped in 60 ms, with every
   * story after it (found 2026-11-22: the end of someone's first story ran straight on to the next person).
   */
  useEffect(() => {
    if (clockSince.current !== null) {
      elapsedBefore.current = Math.min(duration, elapsedBefore.current + (Date.now() - clockSince.current));
      clockSince.current = null;
    }
    if (!playing) {
      cancelAnimation(progress);
      // The bar holds exactly where the clock stopped.
      progress.value = elapsedBefore.current / duration;
      return;
    }
    const remaining = Math.max(60, duration - elapsedBefore.current);
    progress.value = elapsedBefore.current / duration;
    clockSince.current = Date.now();
    progress.value = withTiming(1, { duration: remaining, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(fire)();
    });
    return () => cancelAnimation(progress);
  }, [playing, story.id, duration, progress, fire, restart]);

  // A page swiped away gives up the keyboard: the next person's story plays.
  useEffect(() => {
    if (!active) input.current?.blur();
  }, [active]);
  useEffect(() => {
    if (!sentAt) return;
    const t = setTimeout(() => setSentAt(0), 1600);
    return () => clearTimeout(t);
  }, [sentAt]);

  // The reply row sits on the keyboard while it is up, and just above the home indicator otherwise.
  const replyRowStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, keyboard.value - bottomInset) }] }));
  const heartScale = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));

  /**
   * The heart: shows at once, and the database follows the last tap (two quick taps never leave it the other way). If the
   * server says no (the story expired, a block, a database without migration 62), it goes back to what the database
   * holds, with the reason. Your own story can be liked too (the owner asked for it, 2026-11-21); should the database
   * refuse a self-like, the heart goes back and says why, like any other refusal.
   */
  async function toggleLike() {
    if (!me) return;
    const next = !liked;
    const id = story.id;
    // Felt before anything else happens, TikTok's way: then the heart, then the server.
    if (next) hapticLike();
    else hapticTap();
    if (next) heartScale.value = withSequence(withTiming(1.3, { duration: 110 }), withSpring(1, { damping: 9, stiffness: 260 }));
    setLikedNow((m) => ({ ...m, [id]: next }));
    noteStoryLiked(id, next);
    let sync = likeSyncs.current.get(id);
    if (!sync) {
      const viewer = me;
      sync = createLikeSync((value) => (value ? likeStory(supabase, viewer, id) : unlikeStory(supabase, viewer, id)), story.liked);
      likeSyncs.current.set(id, sync);
    }
    const outcome = await sync.set(next);
    if (!outcome?.error) return;
    setLikedNow((m) => ({ ...m, [id]: outcome.value }));
    noteStoryLiked(id, outcome.value);
    alertWithHaptic("error", outcome.attempted ? "Couldn't like this story" : "Couldn't unlike this story", errorText(outcome.error));
  }

  /** "Send message": a reply in the direct chat with the author, carrying the story (the database checks it and sends the picture). */
  async function sendReply() {
    const text = draft.trim();
    if (!me || mine || !text || sending) return;
    setSending(true);
    try {
      await sendStoryReply(supabase, { senderId: me, story, text });
      hapticSuccess();
      setDraft("");
      setSentAt(Date.now());
      input.current?.blur();
    } catch (e) {
      alertWithHaptic("error", "Couldn't send your reply", errorText(e));
    } finally {
      setSending(false);
    }
  }

  /** The paper plane: the story as a card to friends and group chats; the database refuses a chat with anyone who may not see it. */
  function share() {
    if (!me) return;
    hapticTap();
    setSharing(true);
    shareSheet.open(sharedPostFromStory(story), { onClosed: () => setSharing(false) });
  }

  function report() {
    if (!me) return setMenuOpen(false);
    const storyId = story.id;
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: () => {
          reportContent(supabase, me, { targetType: "story", targetId: storyId, reason: r.value })
            .then(() => Alert.alert("Thanks for letting us know", "Our team will review this story.", [{ text: "OK", onPress: () => setMenuOpen(false) }], { onDismiss: () => setMenuOpen(false) }))
            .catch((e) => {
              setMenuOpen(false);
              alertWithHaptic("error", "Couldn't send the report", errorText(e));
            });
        },
      })),
      "Why are you reporting this story?",
      () => setMenuOpen(false),
    );
  }

  async function toggleMute() {
    setMenuOpen(false);
    if (!me) return;
    try {
      await setStoryMuted(me, author.id, !muted);
      hapticSuccess();
      // Muted: their stories leave the tray, and the viewer moves on to the next person.
      if (!muted) onDone();
    } catch (e) {
      alertWithHaptic("error", muted ? "Couldn't unmute" : "Couldn't mute", errorText(e));
    }
  }

  function block() {
    if (!me) return setMenuOpen(false);
    const blocker = me;
    alertWithHaptic("warning", `Block ${author.full_name}?`, "They won't be able to message you, and you won't see each other's posts or stories.", [
      { text: "Cancel", style: "cancel", onPress: () => setMenuOpen(false) },
      {
        text: "Block",
        style: "destructive",
        onPress: () =>
          void blockUser(supabase, blocker, author.id).then(
            () => {
              noteStoryAuthorBlocked(author.id);
              setMenuOpen(false);
              onDone();
            },
            (e) => {
              setMenuOpen(false);
              Alert.alert("Couldn't block", errorText(e));
            },
          ),
      },
    ]);
  }

  /** "⋯" on someone else's story: Report, Mute or unmute their stories, Block. The story waits while it is open. */
  /** "⋯" on your own story: Delete, where it used to be a button of its own on the rail (the owner's brief, 2026-11-21). */
  function mineMore() {
    if (!me) return;
    hapticTap();
    input.current?.blur();
    setMenuOpen(true);
    show([{ label: "Delete story", icon: "trash-outline", destructive: true, onPress: confirmDelete }], undefined, () => setMenuOpen(false));
  }

  function more() {
    if (!me) return;
    hapticTap();
    input.current?.blur();
    setMenuOpen(true);
    show(
      [
        { label: "Report…", icon: "flag-outline", destructive: true, onPress: report },
        { label: muted ? `Unmute ${firstName}'s stories` : `Mute ${firstName}'s stories`, icon: muted ? "volume-high-outline" : "volume-mute-outline", onPress: () => void toggleMute() },
        { label: `Block ${author.full_name}`, icon: "ban-outline", destructive: true, onPress: block },
      ],
      undefined,
      () => setMenuOpen(false),
    );
  }

  /**
   * While the reply box is focused, a tap on the story puts it away instead of moving on: the field itself is blurred too,
   * since Keyboard.dismiss() alone leaves it focused when there is no on-screen keyboard (a hardware keyboard).
   */
  const putAway = () => {
    input.current?.blur();
    Keyboard.dismiss();
  };
  const onTapBack = () => (typing ? putAway() : tapBack());
  const onTapNext = () => (typing ? putAway() : tapNext());

  async function openViewers() {
    if (!mine) return;
    hapticSelect();
    setViewers([]);
    try {
      setViewers(await listStoryViewers(supabase, story.id));
    } catch {
      setViewers([]);
    }
  }
  function confirmDelete() {
    setHeld(true);
    Alert.alert("Delete this story?", "It disappears for everyone right away.", [
      { text: "Cancel", style: "cancel", onPress: () => setHeld(false) },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteStory(supabase, story.id);
            noteStoryDeleted(story.id);
            markStoriesStale();
            hapticSelect();
            onClose?.();
          } catch (e) {
            setHeld(false);
            alertWithHaptic("error", "Couldn't delete it", e instanceof Error ? e.message : "Try again.");
          }
        },
      },
    ]);
  }

  // The action bar just above the home indicator, on black under the picture; the controls fade away while the story is
  // held to be looked at.
  const barBottom = bottomInset + 4;
  /** Where the picture ends: the top of the bottom row (the screen's bottom when there is none). */
  const mediaBottom = me ? barBottom + STORY_ACTION_BAR : 0;
  const chrome = useSharedValue(1);
  useEffect(() => {
    chrome.value = withTiming(held ? 0 : 1, { duration: held ? 160 : 240, easing: Easing.out(Easing.quad) });
  }, [held, chrome]);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.value }));
  const audienceNote = storyAudienceNote(story.audience);
  const views = `${story.views} ${story.views === 1 ? "view" : "views"}`;
  const likes = story.likes > 0 ? `, ${story.likes} ${story.likes === 1 ? "like" : "likes"}` : "";

  return (
    <View style={{ width, height, backgroundColor: "#000" }}>
      {/* The picture fills its frame edge to edge (a story is shot for the phone, so the little it overflows is cropped
          rather than fitted with black bands), from the very top of the screen down to the top of the bottom row with
          the reply field (the owner's brief, 2026-11-22), its bottom corners rounded, Instagram's: the row sits on
          black below it. With no bottom row (signed out) it runs to the screen's bottom. */}
      <View style={[styles.media, { bottom: mediaBottom }, me ? styles.mediaCard : null]}>
        {story.kind === "photo" && story.photo ? <Image key={story.id} source={{ uri: story.photo.url }} placeholder={story.photo.blur ? { blurhash: story.photo.blur } : undefined} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} onLoad={onPhoto} onError={onPhoto} accessibilityIgnoresInvertColors /> : null}
        {story.kind === "video" && story.video ? <StoryVideo key={story.id} playbackId={story.video.playback_id} playing={wanted} onReady={onVideo} /> : null}
        {/* Only when loading takes a moment: a cached photo shows before this would. */}
        {active && !ready ? (
          <Animated.View entering={FadeIn.delay(300).duration(200)} pointerEvents="none" style={styles.loading}>
            <ActivityIndicator color="#fff" />
          </Animated.View>
        ) : null}
        <Animated.View pointerEvents="none" style={[styles.topShade, chromeStyle]} />
        {/* The controls sit on the picture now, so both ends need a shade to hold them on a bright frame. */}
        <Animated.View pointerEvents="none" style={[styles.bottomShade, chromeStyle]} />

        {/* The taps: the left third goes back, the rest goes on; a hold anywhere pauses. Never under the action bar. */}
        {/* The taps start under the top row and stop over the bottom row: a near miss on pause, "⋯", Close, the heart or
            the field never moves the story on. Held, the story and its bar stop; let go, both go on from there, and a
            hold never counts as a tap. */}
        <View style={[StyleSheet.absoluteFill, { top: barsTop + HEADER_ROOM, bottom: barBottom + STORY_ACTION_BAR + (mine ? VIEWS_ROOM : 0) }]} pointerEvents="box-none">
          <Pressable style={styles.leftZone} onPress={onTapBack} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} accessibilityRole="button" accessibilityLabel={at > 0 ? "Previous story" : "Previous person's stories"} />
          <Pressable style={styles.rightZone} onPress={onTapNext} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} accessibilityRole="button" accessibilityLabel={last ? "Next person's stories" : "Next story"} />
        </View>
        {/* Typing a reply dims the story, as Instagram does. */}
        {typing ? <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} pointerEvents="none" style={styles.typingShade} /> : null}

        <Animated.View style={[styles.header, { paddingTop: barsTop }, chromeStyle]} pointerEvents="box-none">
          <View style={styles.bars} accessible accessibilityLabel={`Story ${at + 1} of ${group.stories.length}`}>
            {group.stories.map((s, i) => (
              <Bar key={s.id} state={i < at ? 1 : i > at ? 0 : null} progress={progress} />
            ))}
          </View>
          {/* Instagram's top row (the owner's brief and screenshot, 2026-11-22): the photo, the name and how long ago, then
              at the far end pause or play, "⋯" (Delete on your own; Report, Mute and Block on someone else's) and Close
              where there is something to close. On someone else's story, until you follow them, a "+" on their photo
              follows them (the owner's ask of 2026-11-21, here rather than on a rail the layout no longer has). */}
          <View style={styles.who} pointerEvents="box-none">
            <View>
              <Avatar name={author.full_name} url={author.avatar_url} size={32} online={false} />
              {!mine && me && !follow.followedByMe ? (
                <Animated.View exiting={FadeOut.duration(220)} style={styles.followPlusAt}>
                  <Pressable
                    onPress={() => void follow.toggle()}
                    disabled={follow.pending}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Follow ${author.full_name}`}
                    accessibilityState={{ disabled: follow.pending, busy: follow.pending }}
                    style={({ pressed }) => [styles.followPlus, pressed && styles.pressed]}
                  >
                    <Icon name="add" size={11} weight="bold" color="#fff" />
                  </Pressable>
                </Animated.View>
              ) : null}
            </View>
            <View style={styles.whoText} accessible accessibilityLabel={`${mine ? "Your story" : author.full_name}, ${storyAge(story.createdAt)}${audienceNote ? `, ${audienceNote}` : ""}`}>
              <Text style={styles.author} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {mine ? "Your story" : author.full_name}
              </Text>
              <Text style={styles.when} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {storyAge(story.createdAt)}
                {audienceNote ? ` · ${audienceNote}` : ""}
              </Text>
            </View>
            <ChromeButton icon={paused ? "play" : "pause"} label={paused ? "Play" : "Pause"} onPress={() => setPaused((v) => !v)} />
            {me ? <ChromeButton icon="ellipsis-horizontal" label="More options" onPress={mine ? mineMore : more} /> : null}
            {onClose ? <ChromeButton icon="close" label="Close" onPress={onClose} /> : null}
          </View>
        </Animated.View>
      </View>

      {/* Instagram's bottom row, on every story, your own included (the owner's brief, 2026-11-22): the "Reply to…"
          field, then the heart and the paper plane. On your own story the field cannot reply to yourself (a reply is a
          message to the author, and sendStoryReply refuses your own), so it sends the story to friends and groups
          instead, through the share sheet, and the eye with its count sits just above it, opening who has seen it. The
          whole row rides the keyboard; the heart and the plane step aside while a reply is typed. */}
      {me ? (
        <Animated.View pointerEvents="box-none" style={[styles.bottom, { bottom: barBottom }, replyRowStyle, chromeStyle]}>
          {mine ? (
            <Pressable onPress={() => void openViewers()} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Activity: ${views}${likes}`} accessibilityHint="Shows who has seen it" style={({ pressed }) => [styles.views, pressed && styles.pressed]}>
              <Icon name="eye-outline" size={17} color="#fff" style={styles.iconShadow} />
              <Text style={styles.viewsText}>{story.views}</Text>
            </Pressable>
          ) : null}
          {sentAt ? (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(220)} pointerEvents="none" style={styles.sent}>
              <Icon name="checkmark-circle" size={16} color="#fff" />
              <Text style={styles.sentText}>Sent to {firstName}</Text>
            </Animated.View>
          ) : null}
          <View style={styles.bottomRow}>
            {mine ? (
              <Pressable onPress={share} accessibilityRole="button" accessibilityLabel="Send your story to friends and groups" style={({ pressed }) => [styles.replyField, pressed && styles.pressed]}>
                <Text style={styles.replyPlaceholder} numberOfLines={1}>
                  Send to friends…
                </Text>
              </Pressable>
            ) : (
              <View style={[styles.replyField, typing && styles.replyFieldActive]}>
                <TextInput
                  ref={input}
                  value={draft}
                  onChangeText={setDraft}
                  onFocus={() => setTyping(true)}
                  onBlur={() => setTyping(false)}
                  placeholder="Send message…"
                  placeholderTextColor={PLACEHOLDER}
                  keyboardAppearance="dark"
                  returnKeyType="send"
                  onSubmitEditing={() => void sendReply()}
                  submitBehavior="submit"
                  maxLength={1000}
                  editable={!sending}
                  accessibilityLabel={`Reply to ${firstName}`}
                  style={styles.replyInput}
                />
                {draft.trim() ? (
                  <Animated.View entering={ZoomIn.duration(160)} exiting={ZoomOut.duration(120)}>
                    <Pressable onPress={() => void sendReply()} disabled={sending} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Send reply to ${firstName}`} accessibilityState={{ disabled: sending, busy: sending }} style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}>
                      {sending ? <ActivityIndicator size="small" color="#000" /> : <Icon name="arrow-up" size={17} weight="bold" color="#000" />}
                    </Pressable>
                  </Animated.View>
                ) : null}
              </View>
            )}
            {!typing ? (
              <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={styles.actions}>
                <Pressable onPress={() => void toggleLike()} hitSlop={4} accessibilityRole="button" accessibilityLabel={liked ? "Unlike" : "Like"} accessibilityState={{ selected: liked }} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                  <Animated.View style={heartStyle}>
                    <Icon name={liked ? "heart" : "heart-outline"} size={28} weight="regular" color={liked ? LIKE_RED : "#fff"} />
                  </Animated.View>
                </Pressable>
                <Pressable onPress={share} hitSlop={4} accessibilityRole="button" accessibilityLabel={mine ? "Send your story to friends and groups" : "Share story"} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                  <Icon name="paper-plane-outline" size={26} weight="regular" color="#fff" style={styles.plane} />
                </Pressable>
              </Animated.View>
            ) : null}
          </View>
        </Animated.View>
      ) : null}

      {/* Full width, edge to edge and down to the screen's bottom (the owner's brief, 2026-11-23), as the share sheet is. */}
      <Sheet visible={viewers !== null} onClose={() => setViewers(null)} closeLabel="Close the list of views" edge="full">
        <SheetHeader title={viewers && viewers.length > 0 ? `${viewers.length} ${viewers.length === 1 ? "view" : "views"}` : "Views"} onClose={() => setViewers(null)} />
        {viewers && viewers.length === 0 ? (
          <Text style={[styles.noViews, { color: colors.muted, paddingBottom: 32 + bottomInset }]}>No views yet</Text>
        ) : (
          <FlatList
            data={viewers ?? []}
            keyExtractor={(v) => v.viewer.id}
            renderItem={({ item }) => (
              <View style={styles.viewerRow} accessible accessibilityLabel={`${item.viewer.full_name}${item.liked ? ", liked it" : ""}, ${formatMessageTime(item.at)}`}>
                <Avatar name={item.viewer.full_name} url={item.viewer.avatar_url} size={40} online={false} />
                <Text style={[styles.viewerName, { color: colors.text }]} numberOfLines={1}>
                  {item.viewer.full_name}
                </Text>
                {item.liked ? <Icon name="heart" size={16} color={LIKE_RED} /> : null}
                <Text style={[styles.viewerTime, { color: colors.muted }]}>{formatMessageTime(item.at)}</Text>
              </View>
            )}
            contentContainerStyle={{ paddingBottom: bottomInset + 16 }}
          />
        )}
      </Sheet>
    </View>
  );
}

/** A control in the story's header: a white glyph in a full 44-point target, no plate, over the top shade. */
function ChromeButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.chromeButton, pressed && styles.pressed]}>
      <Icon name={icon} size={21} weight="semibold" color="#fff" style={styles.iconShadow} />
    </Pressable>
  );
}

/** One story's bar along the top: full for the ones played, empty for the ones to come, filling for the one on screen. */
function Bar({ state, progress }: { state: 0 | 1 | null; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ width: `${(state === null ? progress.value : state) * 100}%` }));
  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.barFill, style]} />
    </View>
  );
}

/**
 * A video story: its own player, from the start, with sound; paused with the page. Drawn to the frame like a photo
 * story, so it fills the screen. It tells the page whether it can be
 * seen playing (ready, not buffering); a video that fails counts as ready, so the story's time runs out and moves on.
 */
function StoryVideo({ playbackId, playing, onReady }: { playbackId: string; playing: boolean; onReady: (canPlay: boolean) => void }) {
  const player = useVideoPlayer({ uri: muxPlaybackUrl(playbackId) }, (p) => {
    p.loop = false;
    p.muted = false;
    p.audioMixingMode = VIDEO_AUDIO_MODE;
  });
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  useEffect(() => {
    onReady(player.status === "readyToPlay" || player.status === "error");
    const sub = player.addListener("statusChange", ({ status }) => onReady(status === "readyToPlay" || status === "error"));
    return () => sub.remove();
  }, [player, onReady]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} allowsVideoFrameAnalysis={false} accessibilityLabel="Video" />;
}

const shadow = { textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } } as const;
/** Instagram's like red: the heart reads the same over any picture, and the "+" on the follow button takes it too. */
const LIKE_RED = "#ff3040";
/** The bar's placeholder words: white, a touch soft. */
const PLACEHOLDER = "rgba(255,255,255,0.92)";
/** How tall the bars and the top row are together: the taps start under them. */
const HEADER_ROOM = 58;
/** The eye and its count over the bottom row on your own story: the taps stop above it too. */
const VIEWS_ROOM = 42;
/** The "+" on the creator's photo in the top row, until they are followed. */
const FOLLOW_PLUS = 18;

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: "#000" },
  pages: { overflow: "hidden", backgroundColor: "#000" },
  // Taller and a touch deeper than a viewer's needs, because on Home the tab labels sit on the picture too and have to
  // read on a blown-out white frame (the owner's brief, 2026-11-21).
  topShade: { position: "absolute", top: 0, left: 0, right: 0, height: 190, experimental_backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.3) 45%, rgba(0,0,0,0.12) 72%, rgba(0,0,0,0) 100%)" },
  bottomShade: { position: "absolute", bottom: 0, left: 0, right: 0, height: 230, experimental_backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.66) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0) 100%)" },
  loading: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  leftZone: { position: "absolute", top: 0, bottom: 0, left: 0, width: "32%" },
  rightZone: { position: "absolute", top: 0, bottom: 0, right: 0, width: "68%" },
  typingShade: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  // The header: the bars across the very top, then who shared it and when.
  header: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 10, gap: 8 },
  bars: { flexDirection: "row", gap: 3, paddingHorizontal: 2 },
  bar: { flex: 1, height: 2, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.32)", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 1, backgroundColor: "#fff" },
  // Under the bars: the photo, the name and how long ago, then pause, "⋯" and Close at the far end.
  who: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 4 },
  whoText: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 8 },
  author: { color: "#fff", fontSize: 15, fontWeight: "700", flexShrink: 1, ...shadow },
  when: { color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: "500", flexShrink: 0, ...shadow },
  // The "+" on the creator's photo until they are followed: small, red, on the photo's bottom right edge.
  followPlusAt: { position: "absolute", right: -5, bottom: -4 },
  followPlus: { width: FOLLOW_PLUS, height: FOLLOW_PLUS, borderRadius: FOLLOW_PLUS / 2, backgroundColor: LIKE_RED, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#000" },
  // Instagram's bottom row: the field, then the heart and the paper plane; your own story's views just above it.
  bottom: { position: "absolute", left: 0, right: 0, paddingLeft: 16, paddingRight: 8, gap: 10 },
  // Instagram's story bar (the owner's reference, 2026-11-23): the outlined field, then the heart and the plane.
  bottomRow: { height: STORY_ACTION_BAR, flexDirection: "row", alignItems: "center", gap: 12 },
  // The heart and the plane: the same 44-point square each, side by side, the same weight (2026-11-22).
  actions: { flexDirection: "row", alignItems: "center", gap: 0 },
  action: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  // The paper plane's glyph leans right of its box: nudged back so the two sit as a pair.
  plane: { marginLeft: -2, marginTop: 1 },
  // The picture's frame, from the screen's top to the bottom row; a card with rounded bottom corners over it.
  media: { position: "absolute", top: 0, left: 0, right: 0, overflow: "hidden" },
  mediaCard: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14, borderCurve: "continuous" },
  views: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, borderCurve: "continuous", backgroundColor: "rgba(0,0,0,0.32)" },
  viewsText: { color: "#fff", fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"], ...shadow },
  replyPlaceholder: { flex: 1, color: PLACEHOLDER, fontSize: 16 },
  chromeButton: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  iconShadow: shadow,
  pressed: { opacity: 0.55, transform: [{ scale: 0.92 }] },
  // No fill, a soft grey edge one point wide, white words: Instagram's "Send message…" field on black.
  replyField: { flex: 1, height: 44, flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 6, borderRadius: 22, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)", backgroundColor: "transparent" },
  replyFieldOver: { borderColor: "rgba(255,255,255,0.45)", backgroundColor: "rgba(0,0,0,0.28)" },
  replyFieldActive: { borderColor: "rgba(255,255,255,0.5)", backgroundColor: "rgba(28,28,30,0.92)" },
  replyInput: { flex: 1, height: 44, color: "#fff", fontSize: 16, paddingVertical: 0 },
  sendButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  // "Sent to Leo" for a moment, just over the bottom row.
  sent: { position: "absolute", left: 0, right: 0, bottom: STORY_ACTION_BAR + 6, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  sentText: { color: "#fff", fontSize: 14, fontWeight: "600", ...shadow },
  noViews: { textAlign: "center", paddingVertical: 32, fontSize: 15 },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  viewerName: { flex: 1, fontSize: 15, fontWeight: "600" },
  viewerTime: { fontSize: 13, fontVariant: ["tabular-nums"] },
});

