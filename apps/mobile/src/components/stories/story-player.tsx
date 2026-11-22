import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance, type TextInputInstance } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, runOnJS, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withSpring, withTiming, ZoomIn, ZoomOut, type SharedValue } from "react-native-reanimated";
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
import { OVERLAY_PAD, RAIL_GAP, RAIL_WIDTH, RailButton, WORDS_GAP } from "@/components/home/reel-item";
import { useColors } from "@/lib/theme-provider";
import { noteStoryAuthorBlocked, noteStoryDeleted, noteStoryLiked, noteStorySeen, markStoriesStale, setStoryMuted, useStoryMuted } from "@/lib/stories-store";
import { supabase } from "@/lib/supabase";
import { VIDEO_AUDIO_MODE } from "@/lib/video-sound";

/**
 * Everyone's stories, playing one person at a time: the picture edge to edge and filling the screen, the overlay a
 * post's (see StoryPage), and a bar for each of that person's stories across the very top, filling as it plays. Both
 * places that show stories draw this: Home's Stories tab, where it plays inline over the bottom bar
 * (components/home/stories-section.tsx), and the full-screen viewer a story's link or a profile opens
 * (app/stories/[id].tsx).
 *
 * The axes are TikTok's (the owner's brief, 2026-11-21): a tap moves within one person — the right side on, the left
 * side back, and neither leaves at the ends — a swipe **up** goes to the next person and down to the one before, and
 * the sideways axis is left entirely alone, so on Home it belongs to the pager of sections and a swipe there moves
 * between Stories, Orbit and Buzz. The clock running out moves on by itself: to this person's next story, and past
 * their last one to the next person. `onDone` is called when the last person's last story runs out, so each place
 * decides what lies beyond (the viewer closes; the tab moves on to Orbit). `onClose` draws the Close button; leave it
 * out where there is nothing to close.
 */
export function StoryPlayer({ groups, start, width, height, barsTop, bottomInset, active, onDone, onClose }: { groups: StoryGroup[]; start: number; width: number; height: number; barsTop: number; bottomInset: number; active: boolean; onDone: () => void; onClose?: () => void }) {
  const { user } = useSession();
  const meId = user?.id ?? null;
  // One keyboard watcher for every page (Reanimated wants as few as possible): the reply row rides on top of it.
  const keyboard = useAnimatedKeyboard();
  const [index, setIndex] = useState(start);
  const pager = useRef<ScrollViewInstance>(null);
  /** Same object on every render: a new one would send the pager back to the first person. */
  const initialOffset = useRef({ x: 0, y: start * height });
  /** The height the pager was last placed at: a rotation puts it back on its page rather than between two. */
  const placedHeight = useRef(0);
  const place = useCallback(() => {
    if (height <= 0) return;
    pager.current?.scrollTo({ x: 0, y: index * height, animated: false });
    placedHeight.current = height;
  }, [index, height]);
  const go = useCallback(
    (next: number) => {
      if (next >= groups.length) return onDone();
      pager.current?.scrollTo({ x: 0, y: next * height, animated: true });
    },
    [groups.length, height, onDone],
  );
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (placedHeight.current !== height) return;
    setIndex(Math.max(0, Math.min(groups.length - 1, Math.round(e.nativeEvent.contentOffset.y / Math.max(height, 1)))));
  };

  return (
    <ScrollView
      ref={pager}
      pagingEnabled
      bounces={false}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentOffset={initialOffset.current}
      onContentSizeChange={place}
      scrollEventThrottle={16}
      onMomentumScrollEnd={onEnd}
      scrollsToTop={false}
      style={{ width, height }}
    >
      {groups.map((group, i) => (
        /* Only the page on screen and the two beside it are drawn: a plain pager is not virtualized, and a list inside
           Home's own pager would be a nested VirtualizedList. */
        <View key={group.author.id} style={{ width, height, backgroundColor: "#000" }}>
          {Math.abs(i - index) <= 1 ? (
            <StoryPage group={group} active={active && i === index} width={width} height={height} barsTop={barsTop} bottomInset={bottomInset} me={meId} keyboard={keyboard.height} onDone={() => go(i + 1)} onClose={onClose} />
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * One person's stories, playing while `active` (the page on screen). `barsTop` is exactly where the row of bars sits,
 * so a caller can pin them above whatever else is drawn over the story (Home's tabs sit just under them), and
 * `bottomInset` what the words, the rail and the reply pill keep clear below them: the home indicator
 * in the viewer, the floating bottom bar's room on Home's Stories tab, so the reply sits just above it.
 * `keyboard` is the keyboard's height, for the reply row.
 */
function StoryPage({ group, active, width, height, barsTop, bottomInset, me, keyboard, onDone, onClose }: { group: StoryGroup; active: boolean; width: number; height: number; barsTop: number; bottomInset: number; me: string | null; keyboard: SharedValue<number>; onDone: () => void; onClose?: () => void }) {
  // The list of views is a sheet in the app's theme; everything else on this screen is on black.
  const colors = useColors();
  const router = useRouter();
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
  // Whether this person is already followed: asked for only on someone else's story, and only while signed in.
  const followTargets = useMemo(() => (mine || !me ? [] : [{ id: author.id }]), [mine, me, author.id]);
  const followStats = useFollowStatsMany(followTargets, me);
  const follow = useFollow(author.id, followStats[author.id], me, () => router.push("/(auth)/login"));
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

  /**
   * A tap moves within this person's stories and no further: switching to someone else is what a sideways swipe is for
   * (the owner's brief, 2026-11-21). A tap on the right at the last story, or on the left at the first, does nothing
   * and the story plays on.
   */
  const last = at + 1 >= group.stories.length;
  const tapNext = useCallback(() => {
    if (at + 1 < group.stories.length) setAt(at + 1);
  }, [at, group.stories.length]);
  const tapBack = useCallback(() => {
    if (at > 0) setAt(at - 1);
  }, [at]);
  /** The clock running out, on the other hand, goes on: past this person's last story to the next person (onDone). */
  const ended = useCallback(() => {
    if (at + 1 < group.stories.length) setAt(at + 1);
    else onDone();
  }, [at, group.stories.length, onDone]);
  const endedRef = useRef(ended);
  endedRef.current = ended;
  const fire = useCallback(() => endedRef.current(), []);

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
  const replyRowStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, keyboard.value - bottomInset) }] }));

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
    // The bounce is the rail's own, the same one a post's heart gives (RailButton bounces whenever `selected` turns on).
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

  // The action bar just above the home indicator, over the picture; the controls fade away while the story is held to be looked at.
  const barBottom = bottomInset + 4;
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
      {/* The picture fills the screen edge to edge, behind everything drawn over it (the owner's brief, 2026-11-21):
          a story is shot for the phone, so it is drawn to the frame and the little it overflows is cropped, rather
          than fitted whole with black bands as a post is on Orbit — there would be nothing behind the tabs then. */}
      <View style={StyleSheet.absoluteFill}>
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
        <View style={[StyleSheet.absoluteFill, { bottom: barBottom + STORY_ACTION_BAR }]} pointerEvents="box-none">
          <Pressable style={styles.leftZone} onPress={onTapBack} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} accessibilityRole="button" accessibilityState={{ disabled: at === 0 }} accessibilityLabel="Previous story" />
          <Pressable style={styles.rightZone} onPress={onTapNext} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} accessibilityRole="button" accessibilityState={{ disabled: last }} accessibilityLabel="Next story" />
        </View>
        {/* Typing a reply dims the story, as Instagram does. */}
        {typing ? <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} pointerEvents="none" style={styles.typingShade} /> : null}

        <Animated.View style={[styles.header, { paddingTop: barsTop }, chromeStyle]} pointerEvents="box-none">
          <View style={styles.bars} accessible accessibilityLabel={`Story ${at + 1} of ${group.stories.length}`}>
            {group.stories.map((s, i) => (
              <Bar key={s.id} state={i < at ? 1 : i > at ? 0 : null} progress={progress} />
            ))}
          </View>
          {/* Only Close up here, and only where there is something to close: who shared it reads at the bottom left
              and "⋯" sits on the rail, as on a post. Home's Stories tab draws no Close: the tabs are right there. */}
          {onClose ? (
            <View style={styles.closeRow} pointerEvents="box-none">
              <ChromeButton icon="close" label="Close" onPress={onClose} />
            </View>
          ) : null}
        </Animated.View>
      </View>

      {/* The words and the rail side by side, laid out exactly as Orbit lays a post out (OVERLAY_PAD, WORDS_GAP and the
          rail's column come from reel-item.tsx): who shared it and when at the bottom left, the actions down the right.
          Only the left column rides the keyboard, so the rail stays where it is while a reply is typed. */}
      <Animated.View pointerEvents="box-none" style={[styles.overlay, { paddingBottom: WORDS_GAP + barBottom }, chromeStyle]}>
        <Animated.View style={[styles.info, replyRowStyle]} pointerEvents="box-none">
          <View style={styles.who} accessible accessibilityLabel={`${mine ? "Your story" : author.full_name}, ${storyAge(story.createdAt)}${audienceNote ? `, ${audienceNote}` : ""}`}>
            <Avatar name={author.full_name} url={author.avatar_url} size={24} online={false} />
            <Text style={styles.author} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {mine ? "Your story" : author.full_name}
            </Text>
            <Text style={styles.when} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {storyAge(story.createdAt)}
              {audienceNote ? ` · ${audienceNote}` : ""}
            </Text>
          </View>
          {!mine && me ? (
            <View style={styles.replyRow}>
              {sentAt ? (
                <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(220)} pointerEvents="none" style={styles.sent}>
                  <Icon name="checkmark-circle" size={16} color="#fff" />
                  <Text style={styles.sentText}>Sent to {firstName}</Text>
                </Animated.View>
              ) : null}
              <View style={[styles.replyField, styles.replyFieldOver, typing && styles.replyFieldActive]}>
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
            </View>
          ) : null}
        </Animated.View>
        {/* The rail, the same shape on either story (the owner's brief, 2026-11-21): the heart, Share, then "⋯". Your
            own adds the eye and its count under Share, which opens the list of who has seen it, and its "⋯" holds
            Delete; someone else's puts the follow button over the heart and keeps Report, Mute and Block behind "⋯".
            While a reply is being typed the whole rail steps aside, as the heart and the plane always did. */}
        {me && !typing ? (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={styles.rail} pointerEvents="box-none">
            {mine ? (
              <>
                <RailButton icon={liked ? "heart" : "heart-outline"} tint={liked ? LIKE_RED : undefined} label={story.likes > 0 ? String(story.likes) : undefined} selected={liked} onPress={() => void toggleLike()} a11y={liked ? "Unlike" : "Like"} />
                <RailButton icon="paper-plane-outline" label="Share" onPress={share} a11y="Send your story to friends and groups" />
                <RailButton icon="eye-outline" label={String(story.views)} onPress={() => void openViewers()} a11y={`Activity: ${views}${likes}, who has seen it`} />
                <RailButton icon="ellipsis-horizontal" small onPress={mineMore} a11y="More options" />
              </>
            ) : (
              <>
                {/* TikTok's: the creator's photo with a "+" on it, over the heart, and gone the moment they are followed. */}
                {follow.followedByMe ? null : (
                  <Animated.View exiting={FadeOut.duration(220)}>
                    <Pressable
                      onPress={() => void follow.toggle()}
                      disabled={follow.pending}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Follow ${author.full_name}`}
                      accessibilityState={{ disabled: follow.pending, busy: follow.pending }}
                      style={({ pressed }) => [styles.followButton, pressed && styles.pressed]}
                    >
                      <View style={styles.followRing}>
                        <Avatar name={author.full_name} url={author.avatar_url} size={FOLLOW_PHOTO} online={false} />
                      </View>
                      <View style={styles.followPlus}>
                        <Icon name="add" size={13} weight="bold" color="#fff" />
                      </View>
                    </Pressable>
                  </Animated.View>
                )}
                <RailButton icon={liked ? "heart" : "heart-outline"} tint={liked ? LIKE_RED : undefined} selected={liked} onPress={() => void toggleLike()} a11y={liked ? "Unlike" : "Like"} />
                <RailButton icon="paper-plane-outline" label="Share" onPress={share} a11y="Share story" />
                <RailButton icon="ellipsis-horizontal" small onPress={more} a11y="More options" />
              </>
            )}
          </Animated.View>
        ) : null}
      </Animated.View>

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
/** The creator's photo on the rail, TikTok's size, with the "+" hanging off its bottom edge. */
const FOLLOW_PHOTO = 40;
const FOLLOW_PLUS = 20;

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
  // The header: the bars across the very top, then Close at the right.
  header: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 10, gap: 8 },
  bars: { flexDirection: "row", gap: 3, paddingHorizontal: 2 },
  bar: { flex: 1, height: 2, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.32)", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 1, backgroundColor: "#fff" },
  closeRow: { flexDirection: "row", justifyContent: "flex-end" },
  // The bottom overlay, a post's geometry exactly (reel-item.tsx): the words' column and the rail side by side.
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end", paddingLeft: 14, paddingRight: 8, gap: 10 },
  info: { flex: 1, gap: 6 },
  who: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", maxWidth: "100%" },
  author: { color: "#fff", fontSize: 16, fontWeight: "700", flexShrink: 1, ...shadow },
  when: { color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 19, flexShrink: 0, ...shadow },
  // Lifted from the words' line to its own, so the rail's last button stays OVERLAY_PAD over the bottom inset.
  rail: { width: RAIL_WIDTH, alignItems: "center", gap: RAIL_GAP, marginBottom: OVERLAY_PAD - WORDS_GAP },
  // The follow button: the photo in a white ring, the "+" centred on its bottom edge. Its own room under it, so the
  // "+" never crowds the heart.
  followButton: { alignItems: "center", paddingBottom: FOLLOW_PLUS / 2 },
  followRing: { width: FOLLOW_PHOTO + 3, height: FOLLOW_PHOTO + 3, borderRadius: (FOLLOW_PHOTO + 3) / 2, borderWidth: 1.5, borderColor: "#fff", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  followPlus: { position: "absolute", bottom: 0, width: FOLLOW_PLUS, height: FOLLOW_PLUS, borderRadius: FOLLOW_PLUS / 2, backgroundColor: LIKE_RED, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(0,0,0,0.25)" },
  replyRow: { alignSelf: "stretch" },
  chromeButton: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  iconShadow: shadow,
  pressed: { opacity: 0.55, transform: [{ scale: 0.92 }] },
  replyField: { flex: 1, height: 44, flexDirection: "row", alignItems: "center", paddingLeft: 18, paddingRight: 6, borderRadius: 22, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.28)", backgroundColor: "rgba(255,255,255,0.08)" },
  replyFieldOver: { borderColor: "rgba(255,255,255,0.45)", backgroundColor: "rgba(0,0,0,0.28)" },
  replyFieldActive: { borderColor: "rgba(255,255,255,0.5)", backgroundColor: "rgba(28,28,30,0.92)" },
  replyInput: { flex: 1, height: 44, color: "#fff", fontSize: 16, paddingVertical: 0 },
  sendButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  // "Sent to Leo" for a moment, just over the reply pill.
  sent: { position: "absolute", left: 0, right: 0, bottom: 48, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  sentText: { color: "#fff", fontSize: 14, fontWeight: "600", ...shadow },
  noViews: { textAlign: "center", paddingVertical: 32, fontSize: 15 },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  viewerName: { flex: 1, fontSize: 15, fontWeight: "600" },
  viewerTime: { fontSize: 13, fontVariant: ["tabular-nums"] },
});

