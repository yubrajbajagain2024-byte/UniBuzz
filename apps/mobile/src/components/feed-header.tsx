import { useContext } from "react";
import { useRouter } from "expo-router";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/lib/session";
import { collapsedRide, InTabsContext, tabBarInset } from "@/lib/tab-bar";
import { tabBarCollapse } from "@/lib/tab-bar-collapse";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";
import { AnimatedPressable, usePressScale } from "@/components/ui";

const SIZE = 56;
/** In from the screen's right edge while the whole bar shows. */
const RIGHT = 16;

/**
 * The round floating "+" of a feed (Explore's new listing, Events' new event), at the bottom right above the bottom bar,
 * X's compose button: the page's one prominent action, an aurora disc with a soft shadow that dips under the finger (no
 * haptic). When the bottom bar collapses to the circle of the tab on screen (lib/tab-bar-collapse.ts) it becomes that
 * circle's twin on the UI thread: the same size, at the same height, as far in from the right edge as the circle is from
 * the left (collapsedRide). With `href` it goes there (signed out, to log in); with `onPress` it does that instead.
 */
export function Fab({ label, hint, ...target }: { label: string; hint?: string } & ({ href: string } | { onPress: () => void })) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { user } = useSession();
  const insets = useSafeAreaInsets();
  // Off the tabs (Events, pushed from Home) there is no bar to sit above or to ride down beside.
  const inTabs = useContext(InTabsContext);
  const bottom = 20 + (inTabs ? tabBarInset(insets) : insets.bottom);
  const to = collapsedRide(insets, bottom, SIZE, RIGHT);
  const ride = useAnimatedStyle(() => {
    const c = inTabs ? tabBarCollapse.value : 0;
    return { transform: [{ translateX: c * to.x }, { translateY: c * to.y }, { scale: 1 + c * (to.scale - 1) }] };
  });
  const press = usePressScale(0.92, 1);
  return (
    <Reanimated.View pointerEvents="box-none" style={[styles.wrap, { bottom }, ride]}>
      <AnimatedPressable
        onPress={() => ("onPress" in target ? target.onPress() : router.push((user ? target.href : "/(auth)/login") as never))}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        style={[styles.fab, { transform: [{ scale: press.scale }] }]}
      >
        <Icon name="add" size={28} weight="semibold" color={colors.onBrand} />
      </AnimatedPressable>
    </Reanimated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { position: "absolute", right: RIGHT },
  fab: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135), alignItems: "center", justifyContent: "center", shadowColor: colors.shadow, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
}));
