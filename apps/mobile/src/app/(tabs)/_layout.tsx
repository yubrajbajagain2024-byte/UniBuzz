import { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import { StyleSheet, UIManager, View, type ColorValue } from "react-native";
import type { SFSymbol } from "expo-symbols";
import { Avatar } from "@/components/avatar";
import { MaskedView } from "@/components/masked-view";
import { FloatingTabBar, type TabBarAction } from "@/components/floating-tab-bar";
import { HeaderActions } from "@/components/header-actions";
import { useHomeRestingOnBuzz } from "@/components/home/buzz-top-bar";
import { useCreateMenu } from "@/components/home/create-menu";
import { isBusinessRole } from "@apartment-book/shared";
import { BusinessAccountNotice } from "@/components/business-account-notice";
import { useSession } from "@/lib/session";
import { auroraGradient } from "@/lib/theme";
import { useAppTheme } from "@/lib/theme-provider";
import { useUnreadCount } from "@/lib/use-unread";
import { Icon, useBounceOn, type IconName } from "@/components/icon";

/**
 * Each tab's icon, outlined at rest and filled while it is the tab on screen: on iOS the system's own tab glyphs (the
 * SF Symbols Apple's apps use for the same places), elsewhere the Ionicons.
 */
const ICONS: Record<string, { on: IconName; off: IconName; sfOn: SFSymbol; sfOff: SFSymbol }> = {
  index: { on: "home", off: "home-outline", sfOn: "house.fill", sfOff: "house" },
  events: { on: "calendar", off: "calendar-outline", sfOn: "calendar", sfOff: "calendar" },
  messages: { on: "chatbubble", off: "chatbubble-outline", sfOn: "message.fill", sfOff: "message" },
  profile: { on: "person-circle", off: "person-circle-outline", sfOn: "person.crop.circle.fill", sfOff: "person.crop.circle" },
};

/** A tab's icon as a component of its own (the bar calls tabBarIcon during its render: hooks must not run there). It bounces when the tab is picked. */
function TabIcon({ route, focused, color, size }: { route: string; focused: boolean; color: ColorValue; size: number }) {
  const names = ICONS[route] ?? ICONS.index!;
  const bounce = useBounceOn(focused);
  return <Icon name={focused ? names.on : names.off} sf={focused ? names.sfOn : names.sfOff} size={size} color={color} weight={focused ? "semibold" : "regular"} bounce={bounce} />;
}

function icon(route: string) {
  return function renderTabIcon(p: { focused: boolean; color: ColorValue; size: number }) {
    return <TabIcon route={route} {...p} />;
  };
}

/**
 * The Profile tab's icon: your own photo in a circle, like Instagram's, with a thin aurora ring while the tab is on
 * screen; the person icon when you are signed out, and while Home rests on its anonymous Buzz page (nothing on screen
 * there may show who is looking).
 */
function ProfileTabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
  const { profile } = useSession();
  const { colors } = useAppTheme();
  const bounce = useBounceOn(focused);
  const restingOnBuzz = useHomeRestingOnBuzz();
  if (!profile || restingOnBuzz) return <Icon name={focused ? ICONS.profile!.on : ICONS.profile!.off} sf={focused ? ICONS.profile!.sfOn : ICONS.profile!.sfOff} size={size} color={color} weight={focused ? "semibold" : "regular"} bounce={bounce} />;
  // The ring takes 2pt on each side, so the photo inside stays the size of the other icons' ink; on screen it is the aurora.
  const photo = size - 4;
  return (
    <View style={[styles.photoRing, { width: size, height: size, borderRadius: size / 2 }, focused && { backgroundColor: color, experimental_backgroundImage: auroraGradient(colors.auroraGlow, 135) }]}>
      <Avatar name={profile.full_name} url={profile.avatar_url} size={photo} online={false} transition={0} />
    </View>
  );
}

/** The ring round the Create "+": 36pt across and thin, so it reads as a button among the outlined tab icons. */
const RING_SIZE = 36;
const RING_STROKE = 1.5;
/**
 * Whether this build has the masked view (Expo Go and every build since it was added do; an older build reading this
 * code over the air may not, and then the ring is the brand blue instead of the aurora).
 */
const CAN_MASK = (() => {
  try {
    return Boolean(UIManager.hasViewManagerConfig?.("RNCMaskedView"));
  } catch {
    return false;
  }
})();

/**
 * Create, in the middle of the bar: the plain plus inside a thin aurora ring (cyan, blue, violet, corner to corner, the
 * glow the app keeps for rings, like your photo's on Profile) and nothing filled, so the bar's glass shows through. The
 * ring is the gradient seen through a ring-shaped mask. A component of its own: the bar calls the icon during its render.
 */
function CreateIcon() {
  const { colors } = useAppTheme();
  return (
    <View style={styles.createRing}>
      {CAN_MASK ? (
        <MaskedView style={StyleSheet.absoluteFill} maskElement={<View style={styles.ringMask} />}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.auroraGlow, 135) }]} />
        </MaskedView>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.ringMask, { borderColor: colors.brand }]} />
      )}
      <Icon name="add" sf="plus" size={18} color={colors.text} weight="regular" />
    </View>
  );
}

/**
 * Home, Events | Create | Messages, Profile: icons only, the campus's calendar second (the owner's sketch, 2026-11-21).
 * Create sits in the middle and opens the live camera on SNAP (BUZZ | SNAP | POST | REEL, see app/compose; signed out,
 * the login screen); the Stories page's + opens it on POST, where a story is shared, and Buzz's pen still writes a buzz.
 * Explore and Search are not tabs: the compass and the magnifier beside the bell in Home's top bar open app/housing.tsx
 * (Housing | Roommate | Marketplace) and app/search.tsx (people, topics, posts and what is popular on every campus). The
 * bar is FloatingTabBar: a frosted glass pill floating over the tabs' content (see lib/tab-bar.ts for its size and the
 * room each tab keeps clear under it); while a page of Home (Stories, Buzz) or Events scrolls on it collapses to that
 * tab's own icon, like Reddit's (lib/tab-bar-collapse.ts).
 */
export default function TabsLayout() {
  const { user, profile } = useSession();
  const unread = useUnreadCount(user?.id ?? null);
  const { colors, isDark } = useAppTheme();
  const openCreate = useCreateMenu();
  const create: TabBarAction = {
    label: "Create",
    hint: "A post, a reel, a Buzz thread or a Snap",
    icon: () => <CreateIcon />,
    // The camera opens on SNAP, in the middle of BUZZ | SNAP | POST | REEL.
    onPress: () => openCreate({ snap: true }),
  };
  /**
   * Events, Messages and Profile render behind Home a moment after it opens (signed in), so switching to them finds them
   * ready, their first page loaded, instead of a spinner (the owner's brief, 2026-11-25). Home loads first; the tabs then
   * stay mounted, as tabs do.
   */
  const [warmTabs, setWarmTabs] = useState(false);
  const signedIn = Boolean(user);
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => setWarmTabs(true), 1200);
    return () => clearTimeout(t);
  }, [signedIn]);
  // A business account stays out of the student side: it is pointed to the business portal instead (after every hook).
  if (profile && isBusinessRole(profile.role)) return <BusinessAccountNotice />;
  // The header's own shadow barely shows on black, so in dark a hairline marks its edge. Light keeps its shadow.
  const headerStyle = isDark ? { backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border } : { backgroundColor: colors.bar };
  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <FloatingTabBar {...props} action={create} />}
      screenOptions={{
        headerStyle,
        headerTitleStyle: { fontWeight: "700", color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
        headerRight: () => <HeaderActions inHeader />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false, tabBarIcon: icon("index") }} />
      {/* Events draws its own top bar ("Events" with Saved at its right, then For you | All events, the search box and the quick filters). */}
      <Tabs.Screen name="events" options={{ title: "Events", headerShown: false, lazy: !warmTabs, tabBarIcon: icon("events") }} />
      {/* Messages draws its own top bar: the new-message pencil, the "Messages" title, Chats | Requests and the search. */}
      <Tabs.Screen name="messages" options={{ title: "Messages", headerShown: false, lazy: !warmTabs, tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined, tabBarIcon: icon("messages") }} />
      {/* Profile draws its own top bar (Find friends, your name, the menu), like TikTok. */}
      <Tabs.Screen name="profile" options={{ title: "Profile", headerShown: false, lazy: !warmTabs, tabBarIcon: (p) => <ProfileTabIcon {...p} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  photoRing: { padding: 2, alignItems: "center", justifyContent: "center" },
  createRing: { width: RING_SIZE, height: RING_SIZE, alignItems: "center", justifyContent: "center" },
  // Only the mask's outline is solid, so only the ring shows the gradient.
  ringMask: { flex: 1, borderRadius: RING_SIZE / 2, borderWidth: RING_STROKE, borderColor: "#000" },
});
