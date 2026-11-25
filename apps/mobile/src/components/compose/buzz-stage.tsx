import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { BUZZ_FEED_COPY } from "@apartment-book/shared";
import { BuzzGatePanel, useBuzzGate } from "@/components/buzz/gate";
import { ErrorState, P } from "@/components/buzz/ui";
import { useReduceMotion } from "@/lib/accessibility";

/** Room left at the top of the stage for the camera screen's own row (Close, and the mode's pill). */
const TOP_ROW = 68;

/**
 * BUZZ on the create camera: the stage turns from the camera to Buzz's own dark canvas while the camera pauses. Once the
 * guidelines are accepted, the camera screen raises the Buzz page's own composer over it (BuzzComposer, the sheet the
 * green + opens: a title, the words, up to four photos or one video, a poll, a category, Campus | Global; the owner's
 * brief, 2026-11-25, after this stage had a words-only composer of its own since the create flow's redesign), and this
 * stage is only what shows behind that sheet. Until then it shows the gate ("Not now" goes back to the mode BUZZ was
 * chosen from), a loading mark, or the error with Retry.
 */
export function BuzzStage({ onLeave }: { onLeave: () => void }) {
  const reduce = useReduceMotion();
  const gate = useBuzzGate();
  return (
    <Animated.View entering={reduce ? undefined : FadeIn.duration(180)} exiting={reduce ? undefined : FadeOut.duration(150)} style={styles.stage}>
      {gate.status === "accepted" ? null : gate.status === "required" ? (
        <ScrollView contentContainerStyle={styles.gate} keyboardShouldPersistTaps="handled">
          <BuzzGatePanel variant="pane" onDismiss={onLeave} />
        </ScrollView>
      ) : gate.status === "error" ? (
        <View style={styles.center}>
          <ErrorState title={BUZZ_FEED_COPY.loadError} message={gate.error} onRetry={gate.retry} />
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={P.accent} />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: P.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: TOP_ROW, paddingHorizontal: 16 },
  gate: { paddingTop: TOP_ROW, paddingHorizontal: 16, paddingBottom: 24 },
});
