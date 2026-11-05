import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type TextInputInstance } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, runOnJS, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, ZoomIn, ZoomOut, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  storyFrame,
  unlikeStory,
  type StoryGroup,
  type StoryViewer,
} from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { Avatar } from "@/components/avatar";
import { Icon, type IconName } from "@/components/icon";
import { ShareSheetProvider, useShareSheet } from "@/components/share-sheet";
import { Sheet, SheetHeader } from "@/components/sheet";
import { alertWithHaptic, hapticLike, hapticSelect, hapticSuccess, hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useColors } from "@/lib/theme-provider";
import { findStoryGroup, getStoryGroups, markStoriesStale, noteStoryAuthorBlocked, noteStoryDeleted, noteStoryLiked, noteStorySeen, refreshStories, setStoryMuted, takeStories, useStoryGroups, useStoryMuted } from "@/lib/stories-store";
import { supabase } from "@/lib/supabase";
import { VIDEO_AUDIO_MODE } from "@/lib/video-sound";

/** A pull down this far (or this fast) closes the viewer; less and it springs back. */
const PULL_CLOSE = 120;
const PULL_VELOCITY = 900;

/**
 * Stories full screen, Instagram's way: one person's stories play in turn (a photo for five seconds, a video for its
 * length), a thin bar for each along the top filling as it plays. A tap on the right goes on, on the left goes back;
 * holding the picture pauses it; a sideways swipe moves to the next or the last person (the pages sit side by side);
 * a pull down closes. A story's bar starts once its photo has loaded or its video can play, and stops while a video
 * buffers, so a slow connection never runs a story out behind a blank screen; the next photo loads ahead. Each story is
 * marked seen as it shows (mark_story_seen, the database refusing anything the person may not see), so its ring greys
 * in the tray. On a tall phone the story is a rounded card from under the status bar and its actions sit below it on
 * black (storyFrame): always legible, and a tap that misses one never moves the story on; on a short screen the story
 * fills it and the actions float over a deeper shade. Your own stories carry Activity (how many have seen each, and
 * liked it: a tap lists them, the database telling only the author), Send (to friends and groups) and Delete. Someone
 * else's carry the reply pill ("Reply to Ann…", a round send arrow inside it once there are words), a heart and a paper
 * plane, each a full 44-point target, and a "⋯" at the top for Report, Mute and Block (migration 62). Holding the story
 * pauses it and fades every control away, so the picture is seen whole. Typing, a sheet or a menu holds the story too. Opened from the tray with the groups it showed (handStories),
 * so nothing loads first; opened cold it reads the store. Opened by a story's id (a story card in a chat) or for a
 * person the tray leaves out (muted), it shows that person's stories alone, from the story named.
 */
export default function StoriesScreen() {
  return (
    // Its own share sheet: this screen is a modal above the root layout's, which could not appear over it.
    <ShareSheetProvider>
      <StoriesViewer />
    </ShareSheetProvider>
  );
}

/** The one person's group to show when the viewer is opened by a story's id or a person outside the tray, from that story. */
function singleGroup(id: string): StoryGroup | null {
  const g = findStoryGroup(id);
  if (!g) return null;
  const at = g.stories.findIndex((s) => s.id === id);
  return at < 0 ? g : { ...g, startAt: at };
}

function StoriesViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { user } = useSession();
  const [handed] = useState(() => takeStories());
  const live = useStoryGroups();
  // Not the tray's: looked up in the store (loading it first when it has nothing yet), or gone.
  const [lookup, setLookup] = useState<StoryGroup | "loading" | "gone" | null>(() => (handed || getStoryGroups().some((g) => g.author.id === id) ? null : (singleGroup(id) ?? "loading")));
  const meId = user?.id ?? null;
  useEffect(() => {
    if (lookup !== "loading") return;
    if (!meId) return setLookup("gone");
    let stale = false;
    void refreshStories(meId).then(() => {
      if (!stale) setLookup(singleGroup(id) ?? "gone");
    });
    return () => {
      stale = true;
    };
  }, [lookup, meId, id]);
  const groups = useMemo(() => handed?.groups ?? (lookup === null ? live : typeof lookup === "object" ? [lookup] : []), [handed, lookup, live]);
  // One keyboard watcher for every page (Reanimated wants as few as possible): the reply row rides on top of it.
  const keyboard = useAnimatedKeyboard();
  // Where it opened: read once, so a change to the groups never moves the page under the finger.
  const [start] = useState(() => {
    const i = groups.findIndex((g) => g.author.id === id);
    return i < 0 ? 0 : i;
  });
  const [index, setIndex] = useState(start);
  const listRef = useRef<FlatList<StoryGroup>>(null);
  const leaving = useRef(false);
  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);
  const go = useCallback(
    (next: number) => {
      if (next < 0 || next >= groups.length) return close();
      listRef.current?.scrollToIndex({ index: next, animated: true });
    },
    [groups.length, close],
  );
  useEffect(() => {
    if (groups.length > 0 || lookup === "loading") return;
    // A story card in a chat outlives its story by days: say why nothing opens.
    if (lookup === "gone") Alert.alert("Story unavailable", "This story is no longer available.");
    close();
  }, [groups.length, lookup, close]);
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)));

  // The pull down: the viewer follows the finger, shrinking a little and rounding its corners as the screen behind shows.
  const pull = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-12, 12])
    .onUpdate((e) => {
      pull.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (pull.value > PULL_CLOSE || e.velocityY > PULL_VELOCITY) {
        pull.value = withTiming(height, { duration: 200, easing: Easing.out(Easing.quad) });
        runOnJS(close)();
      } else {
        pull.value = withSpring(0, { damping: 26, stiffness: 300, mass: 1 });
      }
    });
  const pullStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pull.value }, { scale: 1 - Math.min(pull.value / height, 1) * 0.12 }],
    borderRadius: Math.min(pull.value, 28),
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(pull.value / (height * 0.5), 1) }));

  if (lookup === "loading") {
    return (
      <View style={[styles.root, styles.backdrop, styles.loading]}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={pan}>
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={[styles.root, styles.pages, pullStyle]}>
          <FlatList
            ref={listRef}
            data={groups}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(g) => g.author.id}
            initialScrollIndex={Math.min(start, Math.max(0, groups.length - 1))}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={onEnd}
            renderItem={({ item, index: i }) => <StoryPage group={item} active={i === index} width={width} height={height} me={meId} keyboard={keyboard.height} onDone={() => go(i + 1)} onBack={() => go(i - 1)} onClose={close} />}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            scrollsToTop={false}
          />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

/** One person's stories, playing while `active` (the page on screen). `keyboard` is the keyboard's height, for the reply row. */
function StoryPage({ group, active, width, height, me, keyboard, onDone, onBack, onClose }: { group: StoryGroup; active: boolean; width: number; height: number; me: string | null; keyboard: SharedValue<number>; onDone: () => void; onBack: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  // The list of views is a sheet in the app's theme; everything else on this screen is on black.
  const colors = useColors();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const [at, setAt] = useState(group.startAt);
  const story = group.stories[Math.min(at, group.stories.length - 1)]!;
  const [held, setHeld] = useState(false);
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
  const mine = group.mine && group.author.id === me;
  const author = group.author;
  const firstName = author.full_name.trim().split(/\s+/)[0] || author.full_name;
  const muted = useStoryMuted(mine ? null : author.id);
  const liked = likedNow[story.id] ?? story.liked;
  // The story whose picture can be seen: its photo loaded (or failed, so the viewer moves on), its video ready and not
  // buffering. The clock runs only for it; the video is asked to play as soon as the page is on screen.
  const [shown, setShown] = useState<string | null>(null);
  const ready = shown === story.id;
  const wanted = active && !held && viewers === null && !typing && !sharing && !menuOpen;
  const playing = wanted && ready;
  const storyId = story.id;
  const onPhoto = useCallback(() => setShown(storyId), [storyId]);
  const onVideo = useCallback((canPlay: boolean) => setShown(canPlay ? storyId : null), [storyId]);
  // The next photo of this person's loads while this one shows (the next person's page renders beside this one).
  useEffect(() => {
    const next = group.stories[at + 1];
    if (active && next?.kind === "photo" && next.photo) void Image.prefetch(next.photo.url).catch(() => false);
  }, [active, at, group.stories]);

  const advance = useCallback(() => {
    if (at + 1 < group.stories.length) setAt(at + 1);
    else onDone();
  }, [at, group.stories.length, onDone]);
  const retreat = useCallback(() => {
    if (at > 0) setAt(at - 1);
    else onBack();
  }, [at, onBack]);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const fire = useCallback(() => advanceRef.current(), []);

  // A new story on screen: the bar starts over, and the story counts as seen (never your own).
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    elapsedBefore.current = 0;
    if (!active || mine) return;
    noteStorySeen(story.id);
    void markStorySeen(supabase, story.id).catch(() => {});
  }, [story.id, active, mine, progress]);
  // The clock: runs while playing; held, it keeps its place and goes on from there.
  useEffect(() => {
    if (!playing) {
      cancelAnimation(progress);
      elapsedBefore.current = progress.value * duration;
      return;
    }
    const remaining = Math.max(60, duration - elapsedBefore.current);
    progress.value = withTiming(1, { duration: remaining, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(fire)();
    });
    return () => cancelAnimation(progress);
  }, [playing, story.id, duration, progress, fire]);

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
  const replyRowStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, keyboard.value - insets.bottom) }] }));
  const heartScale = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));

  /**
   * The heart: shows at once, and the database follows the last tap (two quick taps never leave it the other way). If the
   * server says no (the story expired, a block, a database without migration 62), it goes back to what the database
   * holds, with the reason.
   */
  async function toggleLike() {
    if (!me || mine) return;
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
  const onTapBack = () => (typing ? putAway() : retreat());
  const onTapNext = () => (typing ? putAway() : advance());

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
            onClose();
          } catch (e) {
            setHeld(false);
            alertWithHaptic("error", "Couldn't delete it", e instanceof Error ? e.message : "Try again.");
          }
        },
      },
    ]);
  }

  // The card and the bar (storyFrame), and the controls fading away while the story is held to be looked at.
  const frame = storyFrame(width, height, insets.top, insets.bottom);
  const barBottom = insets.bottom + (frame.framed ? 0 : 4);
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
      <View style={[styles.card, { top: frame.top, height: frame.height }, frame.framed && styles.cardFramed]}>
        {story.kind === "photo" && story.photo ? <Image key={story.id} source={{ uri: story.photo.url }} placeholder={story.photo.blur ? { blurhash: story.photo.blur } : undefined} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} onLoad={onPhoto} onError={onPhoto} accessibilityIgnoresInvertColors /> : null}
        {story.kind === "video" && story.video ? <StoryVideo key={story.id} playbackId={story.video.playback_id} playing={wanted} onReady={onVideo} /> : null}
        {/* Only when loading takes a moment: a cached photo shows before this would. */}
        {active && !ready ? (
          <Animated.View entering={FadeIn.delay(300).duration(200)} pointerEvents="none" style={styles.loading}>
            <ActivityIndicator color="#fff" />
          </Animated.View>
        ) : null}
        <Animated.View pointerEvents="none" style={[styles.topShade, chromeStyle]} />
        {/* Over the picture, the bar needs a deeper shade; framed, it sits on black. */}
        {!frame.framed ? <Animated.View pointerEvents="none" style={[styles.bottomShade, chromeStyle]} /> : null}

        {/* The taps: the left third goes back, the rest goes on; a hold anywhere pauses. Never under the action bar. */}
        <View style={[StyleSheet.absoluteFill, !frame.framed && { bottom: barBottom + STORY_ACTION_BAR }]} pointerEvents="box-none">
          <Pressable style={styles.leftZone} onPress={onTapBack} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} accessibilityRole="button" accessibilityLabel="Previous story" />
          <Pressable style={styles.rightZone} onPress={onTapNext} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} accessibilityRole="button" accessibilityLabel="Next story" />
        </View>
        {/* Typing a reply dims the story, as Instagram does. */}
        {typing ? <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} pointerEvents="none" style={styles.typingShade} /> : null}

        <Animated.View style={[styles.header, { paddingTop: frame.framed ? 10 : insets.top + 8 }, chromeStyle]} pointerEvents="box-none">
          <View style={styles.bars} accessible accessibilityLabel={`Story ${at + 1} of ${group.stories.length}`}>
            {group.stories.map((s, i) => (
              <Bar key={s.id} state={i < at ? 1 : i > at ? 0 : null} progress={progress} />
            ))}
          </View>
          <View style={styles.who} pointerEvents="box-none">
            <Avatar name={author.full_name} url={author.avatar_url} size={32} online={false} />
            <View style={styles.whoText} accessible accessibilityLabel={`${mine ? "Your story" : author.full_name}, ${storyAge(story.createdAt)}${audienceNote ? `, ${audienceNote}` : ""}`}>
              <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {mine ? "Your story" : author.full_name}
              </Text>
              <Text style={styles.age} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {storyAge(story.createdAt)}
                {audienceNote ? ` · ${audienceNote}` : ""}
              </Text>
            </View>
            {!mine && me ? <ChromeButton icon="ellipsis-horizontal" label="More" onPress={more} /> : null}
            <ChromeButton icon="close" label="Close" onPress={onClose} />
          </View>
        </Animated.View>
      </View>

      {mine ? (
        <Animated.View pointerEvents="box-none" style={[styles.actionBar, { bottom: barBottom }, chromeStyle]}>
          <Pressable
            onPress={() => void openViewers()}
            style={({ pressed }) => [styles.activity, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Activity: ${views}${likes}`}
            accessibilityHint="Shows who has seen it"
          >
            <Icon name="eye-outline" size={18} color="#fff" />
            <Text style={styles.count}>{story.views}</Text>
            {story.likes > 0 ? (
              <>
                <Icon name="heart" size={15} color={LIKE_RED} />
                <Text style={styles.count}>{story.likes}</Text>
              </>
            ) : null}
          </Pressable>
          <View style={styles.spacer} />
          <LabeledAction icon="paper-plane-outline" caption="Send" label="Send your story to friends and groups" onPress={share} />
          <LabeledAction icon="trash-outline" caption="Delete" label="Delete this story" onPress={confirmDelete} />
        </Animated.View>
      ) : me ? (
        <Animated.View pointerEvents="box-none" style={[styles.actionBar, { bottom: barBottom }, replyRowStyle, chromeStyle]}>
          {sentAt ? (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(220)} pointerEvents="none" style={styles.sent}>
              <Icon name="checkmark-circle" size={16} color="#fff" />
              <Text style={styles.sentText}>Sent to {firstName}</Text>
            </Animated.View>
          ) : null}
          <View style={[styles.replyField, !frame.framed && styles.replyFieldOver, typing && styles.replyFieldActive]}>
            <TextInput
              ref={input}
              value={draft}
              onChangeText={setDraft}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              placeholder={`Reply to ${firstName}…`}
              placeholderTextColor="rgba(255,255,255,0.62)"
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
          {/* While typing the pill takes the row; the heart and the plane come back with the keyboard gone. */}
          {!typing ? (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={styles.actions}>
              <Pressable onPress={() => void toggleLike()} accessibilityRole="button" accessibilityLabel={liked ? "Unlike" : "Like"} accessibilityState={{ selected: liked }} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                <Animated.View style={heartStyle}>
                  <Icon name={liked ? "heart" : "heart-outline"} size={27} weight="medium" color={liked ? LIKE_RED : "#fff"} style={!frame.framed && styles.iconShadow} />
                </Animated.View>
              </Pressable>
              <Pressable onPress={share} accessibilityRole="button" accessibilityLabel="Share story" accessibilityHint="Send it to friends or a group" style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                <Icon name="paper-plane-outline" size={25} weight="medium" color="#fff" style={!frame.framed && styles.iconShadow} />
              </Pressable>
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}

      <Sheet visible={viewers !== null} onClose={() => setViewers(null)} closeLabel="Close the list of views">
        <SheetHeader title={viewers && viewers.length > 0 ? `${viewers.length} ${viewers.length === 1 ? "view" : "views"}` : "Views"} onClose={() => setViewers(null)} />
        {viewers && viewers.length === 0 ? (
          <Text style={[styles.noViews, { color: colors.muted }]}>No views yet</Text>
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
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
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

/** An action on your own story: its glyph with a word under it, so Send and Delete say what they do. */
function LabeledAction({ icon, caption, label, onPress }: { icon: IconName; caption: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.labeled, pressed && styles.pressed]}>
      <Icon name={icon} size={23} weight="medium" color="#fff" />
      <Text style={styles.caption} maxFontSizeMultiplier={1.2}>
        {caption}
      </Text>
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
 * A video story: its own player, from the start, with sound; paused with the page. It tells the page whether it can be
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
/** Instagram's like red: the heart reads the same over any picture. */
const LIKE_RED = "#ff3040";

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: "#000" },
  pages: { overflow: "hidden", backgroundColor: "#000" },
  // The story: the whole screen, or (storyFrame) a card with Apple's continuous corners.
  card: { position: "absolute", left: 0, right: 0, overflow: "hidden", backgroundColor: "#0b0b0c" },
  cardFramed: { borderRadius: 16, borderCurve: "continuous" },
  topShade: { position: "absolute", top: 0, left: 0, right: 0, height: 150, experimental_backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.18) 55%, rgba(0,0,0,0) 100%)" },
  bottomShade: { position: "absolute", bottom: 0, left: 0, right: 0, height: 230, experimental_backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.66) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0) 100%)" },
  loading: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  leftZone: { position: "absolute", top: 0, bottom: 0, left: 0, width: "32%" },
  rightZone: { position: "absolute", top: 0, bottom: 0, right: 0, width: "68%" },
  typingShade: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  // The header: the bars, then who and when, then More and Close.
  header: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 10, gap: 8 },
  bars: { flexDirection: "row", gap: 3, paddingHorizontal: 2 },
  bar: { flex: 1, height: 2, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.32)", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 1, backgroundColor: "#fff" },
  who: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 4 },
  whoText: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 8 },
  name: { color: "#fff", fontSize: 14, fontWeight: "600", letterSpacing: -0.1, flexShrink: 1, ...shadow },
  age: { color: "rgba(255,255,255,0.72)", fontSize: 13, fontWeight: "500", flexShrink: 0, ...shadow },
  chromeButton: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  iconShadow: shadow,
  pressed: { opacity: 0.55, transform: [{ scale: 0.92 }] },
  // The action bar: under the card on black, or floating over the bottom shade.
  actionBar: { position: "absolute", left: 0, right: 0, height: STORY_ACTION_BAR, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 6 },
  replyField: { flex: 1, height: 44, flexDirection: "row", alignItems: "center", paddingLeft: 18, paddingRight: 6, borderRadius: 22, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.28)", backgroundColor: "rgba(255,255,255,0.08)" },
  replyFieldOver: { borderColor: "rgba(255,255,255,0.45)", backgroundColor: "rgba(0,0,0,0.28)" },
  replyFieldActive: { borderColor: "rgba(255,255,255,0.5)", backgroundColor: "rgba(28,28,30,0.92)" },
  replyInput: { flex: 1, height: 44, color: "#fff", fontSize: 16, paddingVertical: 0 },
  sendButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", alignItems: "center" },
  action: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  sent: { position: "absolute", alignSelf: "center", left: 0, right: 0, bottom: STORY_ACTION_BAR + 4, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  sentText: { color: "#fff", fontSize: 14, fontWeight: "600", ...shadow },
  // Your own story: Activity on the left, Send and Delete on the right.
  activity: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.28)", backgroundColor: "rgba(255,255,255,0.08)" },
  count: { color: "#fff", fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"], marginRight: 2 },
  spacer: { flex: 1 },
  labeled: { minWidth: 56, height: 52, alignItems: "center", justifyContent: "center", gap: 3 },
  caption: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "500" },
  noViews: { textAlign: "center", paddingVertical: 32, fontSize: 15 },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  viewerName: { flex: 1, fontSize: 15, fontWeight: "600" },
  viewerTime: { fontSize: 13, fontVariant: ["tabular-nums"] },
});
