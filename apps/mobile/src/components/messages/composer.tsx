import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type TextInputInstance } from "react-native";
import Reanimated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MESSAGE_ATTACHMENT_LIMITS, type MessageReply } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { GlassBackdrop, GlassIconButton } from "@/components/glass";
import { Icon } from "@/components/icon";
import { ProgressiveBlur } from "@/components/progressive-blur";
import { useReduceMotion } from "@/lib/accessibility";
import { hapticTap, alertWithHaptic } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { ATTACHMENT_LIMIT_TEXT, captureMedia, pickDocuments, pickLibraryMedia, type PendingAttachment, type PickResult } from "@/lib/message-attachments";
import { auroraGradient, scrollEdge } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { AttachmentStrip } from "./attachment-strip";
import { CHAT_EDGE } from "./chat-header";
import { ReplyQuote, type ReplyContext } from "./reply-quote";
import { VOICE_AVAILABLE } from "@/lib/voice";

// expo-audio is loaded only where this build has it.
const VoiceRecorder = VOICE_AVAILABLE ? (require("./voice-recorder") as typeof import("./voice-recorder")).VoiceRecorder : null;

/**
 * The bar's sizes: the "+" circle and the capsule are the system's 44pt touch target, the same height as the chat's top
 * bar, the capsule fully rounded; the microphone and Send inside it are 32pt circles, centred on its first line however
 * tall the text grows.
 */
const BAR = 44;
const CAPSULE = BAR / 2;
const CONTROL = 32;
const CONTROL_INSET = (BAR - CONTROL) / 2;
/**
 * Above the bar, the messages fade out over this many points before its backdrop reaches full strength: shorter than
 * the room the chat leaves under its newest message, so that message and its "Delivered" stay clear at rest.
 */
const FADE = 16;
/** Send pops in on a quick spring that settles without a wobble; the microphone it replaces just fades. */
const SEND_IN = ZoomIn.springify().damping(17).stiffness(340).mass(0.6);
const SEND_OUT = ZoomOut.duration(120);
const MIC_IN = FadeIn.duration(160);
const MIC_OUT = FadeOut.duration(100);

/**
 * The bar keeps this much under its field above the home indicator (or the screen's edge), and, with the keyboard up,
 * KEYBOARD_GAP above the keyboard. The chat lifts the bar (and the messages with it) by how far the keyboard reaches
 * past its resting room (see keyboardLift), frame by frame on the UI thread, so the bar rides on the keyboard as it
 * slides, and follows it down under the finger when it is swiped away.
 */
export const KEYBOARD_GAP = 8;
export function barRestingPad(bottomInset: number): number {
  return Math.max(bottomInset, 12);
}
/** How far the bar and the messages rise for a keyboard `keyboard` points tall: nothing until it reaches the bar's field. */
export function keyboardLift(keyboard: number, restingPad: number): number {
  "worklet";
  return Math.max(0, keyboard - restingPad + KEYBOARD_GAP);
}

/** What the person is about to answer, shown above the field until they send or dismiss it. */
export type ComposerReply = { reply: MessageReply; context: ReplyContext };

/**
 * The floating bar under a chat, with nothing solid behind it: the messages scroll under it and are dimmed and blurred
 * into the screen's colour (iOS 26's scroll edge effect, as under the chat's top bar), nearly solid behind the field and
 * fading out just above it. It keeps the home-indicator space under it, always: the chat lifts it onto the keyboard
 * (see keyboardLift), so its own height never changes as the keyboard comes and goes. `onHeight` tells the chat how
 * much of the list it covers.
 */
function FloatingBar({ onHeight, children }: { onHeight?: (height: number) => void; children: ReactNode }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  // The share of the backdrop's band that the bar itself covers: held at full strength, the fade above it.
  const solid = height > 0 ? height / (height + FADE) : 0.8;
  function measured(e: LayoutChangeEvent) {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h === height) return;
    setHeight(h);
    onHeight?.(h);
  }
  return (
    <View style={[styles.bar, { paddingBottom: barRestingPad(insets.bottom) }]} onLayout={measured}>
      <View pointerEvents="none" style={[styles.edge, { top: -FADE }]}>
        <ProgressiveBlur edge="bottom" height={height + FADE} solid={solid} intensity={40} tint={isDark ? "dark" : "light"} />
        <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: scrollEdge(colors.bg, "bottom", solid) }]} />
      </View>
      {children}
    </View>
  );
}

/** A see-through glass panel above the field: the reply being answered, or the files waiting to go. */
function GlassPanel({ children, style }: { children: ReactNode; style?: object }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <View style={[styles.panel, { borderColor: colors.glassEdge }, style]}>
      <GlassBackdrop variant="float" radius={CAPSULE} />
      {children}
    </View>
  );
}

/**
 * The message bar, laid out like the Messages app's: "+" in a glass circle on the left (photo or video, camera, file),
 * then a see-through glass capsule holding the growing field and, at its end, the microphone (a voice message records
 * in the bar, where the build can) or, once something is typed or picked, the aurora Send, which springs in as the
 * microphone fades out (and back). Picked files wait on a glass panel above the capsule until they are sent with the
 * message; a message being answered shows there too, with its quote and an ✕. The bar floats over the chat; the chat
 * lifts it with the keyboard (see keyboardLift).
 */
export function Composer({
  value,
  onChangeText,
  items,
  onAddItems,
  onRemoveItem,
  onSend,
  onSendVoice,
  reply,
  onCancelReply,
  inputRef,
  onHeight,
  placeholder = "Message",
}: {
  value: string;
  onChangeText: (text: string) => void;
  items: PendingAttachment[];
  /** Files picked to send; without it there is no "+" (an anonymous poster's chat: a file's path would name them). */
  onAddItems?: (items: PendingAttachment[]) => void;
  onRemoveItem: (id: string) => void;
  onSend: () => void;
  /** A voice message just recorded: sent at once. Without it there is no microphone. */
  onSendVoice?: (item: PendingAttachment) => void;
  reply?: ComposerReply | null;
  onCancelReply?: () => void;
  /** The field, so the chat can bring the keyboard up (a swipe to reply). */
  inputRef?: RefObject<TextInputInstance | null>;
  onHeight?: (height: number) => void;
  placeholder?: string;
}) {
  const { colors, isDark } = useAppTheme();
  const styles = useStyles();
  const show = useActionSheet();
  const reduceMotion = useReduceMotion();
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const remaining = MESSAGE_ATTACHMENT_LIMITS.maxItems - items.length;
  const canSend = value.trim().length > 0 || items.length > 0;
  const canRecord = Boolean(VoiceRecorder && onSendVoice) && !canSend;
  // The microphone and Send trade places with a little motion once the bar is up; the first draw is still.
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);
  const animate = settled.current && !reduceMotion;

  async function add(pick: () => Promise<PickResult>) {
    setBusy(true);
    try {
      const { items: picked, problems } = await pick();
      if (picked.length > 0) onAddItems?.(picked);
      if (problems.length > 0) Alert.alert(picked.length > 0 ? "Some files weren't added" : "Couldn't add that", problems.join("\n"));
    } catch (e) {
      alertWithHaptic("error", "Couldn't add that", errorText(e, "Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function attach() {
    if (remaining <= 0) {
      Alert.alert("That's the limit", ATTACHMENT_LIMIT_TEXT);
      return;
    }
    show([
      { label: "Photo or video", icon: "images-outline", onPress: () => void add(() => pickLibraryMedia(remaining)) },
      { label: "Camera", icon: "camera-outline", onPress: () => void add(captureMedia) },
      { label: "File", icon: "document-outline", onPress: () => void add(() => pickDocuments(remaining)) },
    ]);
  }

  const panels = (
    <>
      {reply ? (
        <GlassPanel>
          <View style={styles.replyRow}>
            <ReplyQuote reply={reply.reply} context={reply.context} tone="composer" />
            <Pressable onPress={onCancelReply} hitSlop={10} accessibilityRole="button" accessibilityLabel="Stop replying" style={({ pressed }) => [styles.replyClose, pressed && { opacity: 0.6 }]}>
              <Icon name="close" size={15} color={colors.muted} weight="semibold" />
            </Pressable>
          </View>
        </GlassPanel>
      ) : null}
      {items.length > 0 ? (
        <GlassPanel style={styles.stripPanel}>
          <AttachmentStrip items={items} onRemove={onRemoveItem} />
        </GlassPanel>
      ) : null}
    </>
  );

  if (recording && VoiceRecorder && onSendVoice) {
    return (
      <FloatingBar onHeight={onHeight}>
        {panels}
        <VoiceRecorder
          onCancel={() => setRecording(false)}
          onSend={(item) => {
            setRecording(false);
            onSendVoice(item);
          }}
        />
      </FloatingBar>
    );
  }

  return (
    <FloatingBar onHeight={onHeight}>
      {panels}
      <View style={styles.row}>
        {onAddItems ? (
          <GlassIconButton icon="add" label="Attach a photo, video or file" variant="float" size={BAR} iconSize={22} weight="medium" disabled={busy} onPress={attach}>
            {busy ? <ActivityIndicator color={colors.text} /> : undefined}
          </GlassIconButton>
        ) : null}
        <View style={[styles.capsule, { borderColor: colors.glassEdge }]}>
          <GlassBackdrop variant="float" radius={CAPSULE} />
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            keyboardAppearance={isDark ? "dark" : "light"}
            multiline
            // The web's text area starts two rows tall; phones start at one line and grow.
            numberOfLines={Platform.OS === "web" ? 1 : undefined}
            maxLength={4000}
            style={styles.input}
            accessibilityLabel="Message"
          />
          {/* One slot for both: the one leaving fades or shrinks away in place while the other comes in over it. */}
          <View style={styles.controlSlot}>
            {canRecord ? (
              <Reanimated.View key="mic" entering={animate ? MIC_IN : undefined} exiting={animate ? MIC_OUT : undefined} style={styles.controlLayer}>
                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    hapticTap();
                    setRecording(true);
                  }}
                  hitSlop={8}
                  style={({ pressed }) => [styles.control, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Record a voice message"
                >
                  <Icon name="mic" size={21} color={colors.muted} weight="medium" />
                </Pressable>
              </Reanimated.View>
            ) : (
              <Reanimated.View key="send" entering={animate ? SEND_IN : undefined} exiting={animate ? SEND_OUT : undefined} style={styles.controlLayer}>
                <Pressable
                  onPress={onSend}
                  disabled={!canSend}
                  hitSlop={8}
                  style={({ pressed }) => [styles.control, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) }, !canSend && { opacity: 0.35 }, pressed && { transform: [{ scale: 0.9 }] }]}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  accessibilityState={{ disabled: !canSend }}
                >
                  <Icon name="arrow-up" size={17} color={colors.onBrand} weight="bold" />
                </Pressable>
              </Reanimated.View>
            )}
          </View>
        </View>
      </View>
    </FloatingBar>
  );
}

/** In place of the message bar when this chat cannot take messages (someone is blocked). */
export function ComposerNotice({ title, body, action, onHeight }: { title: string; body?: string; action?: { label: string; onPress: () => void }; onHeight?: (height: number) => void }) {
  const styles = useStyles();
  return (
    <FloatingBar onHeight={onHeight}>
      <GlassPanel>
        <View style={styles.notice} accessibilityRole="summary">
          <Text style={styles.noticeTitle}>{title}</Text>
          {body ? <Text style={styles.noticeBody}>{body}</Text> : null}
          {action ? (
            <Pressable onPress={action.onPress} hitSlop={6} accessibilityRole="button" style={({ pressed }) => [styles.noticeButton, pressed && { opacity: 0.8 }]}>
              <Text style={styles.noticeButtonText}>{action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </GlassPanel>
    </FloatingBar>
  );
}

const useStyles = makeStyles((colors) => ({
  // The chat's side margin (CHAT_EDGE), so the "+" and the capsule line up with the bubbles and the top bar.
  bar: { paddingHorizontal: CHAT_EDGE, paddingTop: 8, gap: 8 },
  // The backdrop reaches FADE above the bar (see `top` where it is drawn), so the messages fade out under its edge.
  edge: { position: "absolute", left: 0, right: 0, bottom: 0 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  panel: { borderRadius: CAPSULE, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  stripPanel: { paddingBottom: 8 },
  replyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingLeft: 4, paddingRight: 6 },
  replyClose: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  capsule: { flex: 1, flexDirection: "row", alignItems: "flex-end", minHeight: BAR, borderRadius: CAPSULE, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  // One line of 16pt text sits centred in the 44pt capsule (11 + 21 + 12), as the bubbles' words are set; it grows to
  // about six lines, then scrolls.
  input: {
    flex: 1,
    minHeight: BAR,
    maxHeight: 150,
    paddingLeft: 16,
    paddingRight: 6,
    paddingTop: 11,
    paddingBottom: 12,
    fontSize: 16,
    lineHeight: 21,
    color: colors.text,
    textAlignVertical: "center",
  },
  controlSlot: { width: CONTROL, height: CONTROL, marginRight: CONTROL_INSET, marginBottom: CONTROL_INSET },
  controlLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  control: { width: CONTROL, height: CONTROL, borderRadius: CONTROL / 2, alignItems: "center", justifyContent: "center" },
  notice: { alignItems: "center", gap: 4, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 14 },
  noticeTitle: { fontSize: 15, fontWeight: "700", color: colors.text, textAlign: "center" },
  noticeBody: { fontSize: 13, color: colors.muted, textAlign: "center" },
  noticeButton: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.input },
  noticeButtonText: { fontSize: 14, fontWeight: "700", color: colors.brand },
}));
