import { useEffect, useState } from "react";
import { Animated, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { STICKER_SETS } from "@apartment-book/shared";
import { Sheet, SheetHeader } from "@/components/sheet";
import { usePressScale } from "@/components/ui";
import { hapticSelect } from "@/lib/haptics";
import { makeStyles } from "@/lib/theme-provider";

/** Where the recently sent stickers are kept, on this device only. */
const RECENT_KEY = "chat.stickers.recent.v1";
const RECENT_MAX = 10;
/** A sticker's cell in the grid, and the emoji in it. */
const CELL = 58;
const EMOJI = 36;
const SIDE = 18;

let recentCache: string[] | null = null;

async function readRecent(): Promise<string[]> {
  if (recentCache) return recentCache;
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    recentCache = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    recentCache = [];
  }
  return recentCache;
}

/** The sticker just sent goes to the front of the recent row (kept on this device, never sent anywhere). */
export function noteStickerSent(sticker: string) {
  const next = [sticker, ...(recentCache ?? []).filter((s) => s !== sticker)].slice(0, RECENT_MAX);
  recentCache = next;
  AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
}

/**
 * The chat's stickers: big emoji in a few sets (reactions, campus life, moods), the ones sent lately first. A tap sends
 * one at once, as a message of its own (see jumboEmoji: it draws large, with no bubble), and closes the sheet; whatever
 * is typed in the field stays there. Each cell sinks under the finger like every control in the app.
 */
export function StickerSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (sticker: string) => void }) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const [recent, setRecent] = useState<string[]>(recentCache ?? []);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void readRecent().then((list) => alive && setRecent(list));
    return () => {
      alive = false;
    };
  }, [visible]);
  // As many whole cells as fit across the sheet (inset 8 from each screen edge), spread evenly.
  const perRow = Math.max(4, Math.floor((width - 16 - SIDE * 2) / CELL));
  const pick = (sticker: string) => {
    hapticSelect();
    noteStickerSent(sticker);
    onPick(sticker);
    onClose();
  };
  const sets = [...(recent.length > 0 ? [{ key: "recent", title: "Recent", stickers: recent }] : []), ...STICKER_SETS];
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel="Close stickers" height="58%">
      <SheetHeader title="Stickers" onClose={onClose} divider={false} />
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {sets.map((set) => (
          <View key={set.key} style={styles.set} accessibilityRole="list" accessibilityLabel={set.title}>
            <Text style={styles.title} accessibilityRole="header">
              {set.title}
            </Text>
            <View style={styles.grid}>
              {set.stickers.map((sticker) => (
                <StickerCell key={`${set.key}:${sticker}`} sticker={sticker} width={`${100 / perRow}%`} onPress={() => pick(sticker)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

function StickerCell({ sticker, width, onPress }: { sticker: string; width: `${number}%`; onPress: () => void }) {
  const styles = useStyles();
  const press = usePressScale(0.82, 1);
  return (
    <Pressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.cell, { width }]} accessibilityRole="button" accessibilityLabel={`Send ${sticker}`}>
      <Animated.View style={{ transform: [{ scale: press.scale }] }}>
        <Text style={styles.emoji} maxFontSizeMultiplier={1.2}>
          {sticker}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { paddingHorizontal: SIDE, paddingBottom: 28, gap: 18 },
  set: { gap: 6 },
  title: { fontSize: 13, fontWeight: "600", color: colors.muted, marginLeft: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { height: CELL, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: EMOJI, lineHeight: EMOJI + 8, color: colors.text },
}));
