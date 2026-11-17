import { useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Reanimated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ConversationSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { GlassBackdrop, GlassIconButton } from "@/components/glass";
import { ProgressiveBlur } from "@/components/progressive-blur";
import { AnimatedPressable, usePressScale } from "@/components/ui";
import { useReduceMotion } from "@/lib/accessibility";
import { scrollEdge } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { InboxAvatar } from "./inbox-row";

/** Every control in the bar is the system's 44pt touch target, so all of them share one centre line. */
const CONTROL = 44;
/** The chat's photo, at the right: a touch smaller than the glass circle across from it, which it balances (a photo weighs more than glass). */
const PHOTO = 40;
/**
 * A chat's side margin: the bar's controls, the bubbles and the message bar all keep this far from the screen's edges,
 * so their outer edges line up down the screen.
 */
export const CHAT_EDGE = 16;
/** Below the bar, the messages fade out over this many points before the bar's backdrop reaches full strength. */
const FADE = 20;
/** The capsule's two lines follow the phone's text size only this far, so they always fit its 44 points. */
const MAX_FONT_SCALE = 1.2;

/**
 * A chat's floating top bar, in one row of three glass pieces of the same height, iOS 26 style: Back in a glass circle
 * on the left; in the middle of the screen a glass capsule with who the chat is with and, under it, their activity
 * ("Active now", with a green dot) or a group's member count; and the chat's photo on the right (the other person's,
 * with the green dot while they are active; a group's two members overlapping, as in the inbox). The capsule and the
 * photo open the chat's details (Search is there, with everything else about the chat). Audio call and Video call join
 * the right side only when calls are on. Nothing solid behind the bar: the messages scroll under it and are dimmed and
 * blurred into the screen's colour (iOS 26's scroll edge effect), nearly solid behind the controls and fading out just
 * below them, so the bar's words always read and nothing shows through them. `onHeight` tells the chat how much of
 * the list it covers.
 */
export function ChatHeader({
  conversation,
  subtitle,
  activeNow,
  keepSubtitleRoom,
  onBack,
  onOpenInfo,
  onAudioCall,
  onVideoCall,
  onHeight,
}: {
  conversation: ConversationSummary | null;
  /** "Active now", "Active 5 min ago" or "4 members"; "" for nothing. */
  subtitle: string;
  activeNow: boolean;
  /** Nothing to show yet, but maybe in a moment: the line keeps its place, so the name does not jump. */
  keepSubtitleRoom: boolean;
  onBack: () => void;
  onOpenInfo: () => void;
  /** The call buttons; left out (calls paused, or a chat you cannot call in), the right side is the photo alone. */
  onAudioCall?: () => void;
  onVideoCall?: () => void;
  onHeight: (height: number) => void;
}) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  // The share of the backdrop's band that the bar itself covers: held at full strength, the fade below it.
  const solid = height > 0 ? height / (height + FADE) : 0.8;

  function measured(e: LayoutChangeEvent) {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h === height) return;
    setHeight(h);
    onHeight(h);
  }

  return (
    <View pointerEvents="box-none" style={styles.header} onLayout={measured}>
      <View pointerEvents="none" style={[styles.edge, { bottom: -FADE }]}>
        <ProgressiveBlur edge="top" height={height + FADE} solid={solid} intensity={40} tint={isDark ? "dark" : "light"} />
        <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: scrollEdge(colors.bg, "top", solid) }]} />
      </View>
      <View pointerEvents="box-none" style={[styles.row, { paddingTop: insets.top + 4 }]}>
        <View style={styles.side}>
          <GlassIconButton icon="chevron-back" label="Back" variant="float" size={CONTROL} iconSize={20} weight="semibold" haptic={false} onPress={onBack} />
        </View>
        <View pointerEvents="box-none" style={styles.middle}>
          {conversation ? <TitleCapsule title={conversation.title ?? ""} subtitle={subtitle} activeNow={activeNow} keepSubtitleRoom={keepSubtitleRoom} onPress={onOpenInfo} /> : null}
        </View>
        <View style={[styles.side, styles.sideEnd]}>
          {onAudioCall ? <GlassIconButton icon="call" label="Audio call" variant="float" size={CONTROL} iconSize={18} weight="medium" onPress={onAudioCall} /> : null}
          {onVideoCall ? <GlassIconButton icon="videocam" label="Video call" variant="float" size={CONTROL} iconSize={20} weight="medium" onPress={onVideoCall} /> : null}
          {conversation ? <ChatPhoto conversation={conversation} activeNow={activeNow} onPress={onOpenInfo} /> : null}
        </View>
      </View>
    </View>
  );
}

/** The name, and the activity line under it, centred in a glass capsule that sinks under the finger. */
function TitleCapsule({ title, subtitle, activeNow, keepSubtitleRoom, onPress }: { title: string; subtitle: string; activeNow: boolean; keepSubtitleRoom: boolean; onPress: () => void }) {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const press = usePressScale(0.96, 0.9);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityRole="button"
      accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ""}. Chat details`}
      style={[styles.capsule, { opacity: press.opacity, transform: [{ scale: press.scale }] }]}
    >
      <GlassBackdrop variant="float" radius={CONTROL / 2} interactive />
      <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {title}
      </Text>
      {subtitle ? (
        // Keyed by the words, so "Active 5 min ago" turning into "Active now" fades in rather than snapping.
        <Reanimated.View key={subtitle} entering={reduceMotion ? undefined : FadeIn.duration(220)} style={styles.subRow}>
          {activeNow ? <View style={styles.liveDot} /> : null}
          <Text style={styles.sub} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {subtitle}
          </Text>
        </Reanimated.View>
      ) : keepSubtitleRoom ? (
        <Text style={styles.sub} maxFontSizeMultiplier={MAX_FONT_SCALE}> </Text>
      ) : null}
    </AnimatedPressable>
  );
}

/** The face of the other side of a one-to-one chat: what its header shows, and what sits beside their messages. */
export type ChatFace = { name: string; url: string | null; anonymous: boolean; business: boolean };

/**
 * Who a one-to-one chat is with, as a face, by the same rules everywhere in the chat: an anonymous poster's mask while
 * they are hidden (never their photo), a business's logo (never the photo of whoever on its staff wrote), otherwise the
 * other person. Null for a group, where each message carries its sender's own face.
 */
export function chatPeerFace(conversation: ConversationSummary): ChatFace | null {
  if (conversation.type === "group") return null;
  if (conversation.anonymous?.role === "asker" && conversation.anonymous.hidden) return { name: conversation.title, url: null, anonymous: true, business: false };
  if (conversation.business) return { name: conversation.business.name, url: conversation.business.logo_url, anonymous: false, business: true };
  const other = conversation.otherMembers[0];
  return { name: other?.full_name ?? conversation.title, url: other?.avatar_url ?? null, anonymous: false, business: false };
}

/** Who the chat is with, as a photo: the other person's, a business's logo, an anonymous poster's mask, or a group's members. */
function ChatPhoto({ conversation, activeNow, onPress }: { conversation: ConversationSummary; activeNow: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const press = usePressScale(0.92, 0.9);
  const face = chatPeerFace(conversation);
  const photo = !face ? (
    <InboxAvatar conversation={conversation} size={PHOTO} />
  ) : face.anonymous ? (
    <Avatar name={face.name} size={PHOTO} anonymous />
  ) : face.business ? (
    <Avatar name={face.name} url={face.url} size={PHOTO} online={false} />
  ) : (
    <Avatar name={face.name} url={face.url} size={PHOTO} online={activeNow} ringColor={colors.bg} />
  );
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Chat details"
      style={[styles.photo, { opacity: press.opacity, transform: [{ scale: press.scale }] }]}
    >
      {photo}
    </AnimatedPressable>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 },
  // The backdrop reaches FADE below the bar (see `bottom` where it is drawn), so the messages fade out under its edge.
  edge: { position: "absolute", top: 0, left: 0, right: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: CHAT_EDGE, paddingBottom: 8 },
  // Both sides are at least one control wide, so with one control each (calls paused) the capsule is centred on the screen.
  side: { minWidth: CONTROL, flexDirection: "row", alignItems: "center", gap: 8 },
  sideEnd: { justifyContent: "flex-end" },
  middle: { flex: 1, minWidth: 0, alignItems: "center" },
  capsule: { height: CONTROL, maxWidth: "100%", minWidth: 112, paddingHorizontal: 18, borderRadius: CONTROL / 2, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassEdge, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  // Two lines in the 44pt capsule: 19 + 15, centred; one line alone sits on the capsule's centre line.
  name: { maxWidth: "100%", fontSize: 15, lineHeight: 19, fontWeight: "600", letterSpacing: -0.1, color: colors.text },
  subRow: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  sub: { flexShrink: 1, fontSize: 12, lineHeight: 15, color: colors.muted },
  photo: { width: CONTROL, height: CONTROL, alignItems: "center", justifyContent: "center" },
}));
