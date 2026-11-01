import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from "react-native";
import { useIsFocused, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_EVENT_FILTERS, EVENT_SECTIONS, eventActiveChips, eventFilterCount, eventQuickFilters, type EventFilterChoice, type EventSection } from "@apartment-book/shared";
import { DISCOVERY_BAR_HEIGHT, DiscoveryBar } from "@/components/discovery-bar";
import { AllEventsSection } from "@/components/events/all-events-section";
import { EventFilterSheet } from "@/components/events/event-filter-sheet";
import { ForYouEventsSection } from "@/components/events/for-you-events-section";
import { Fab } from "@/components/feed-header";
import { Icon } from "@/components/icon";
import { SlidingTabs } from "@/components/sliding-tabs";
import { useCampusTimeZone } from "@/lib/campus-time-zone";
import { useCollapsingHeader } from "@/lib/collapsing-header";
import { useCollapseOnScroll } from "@/lib/tab-bar-collapse";
import { useSession } from "@/lib/session";
import { auroraGradient, space, textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const ORDER = EVENT_SECTIONS.map((s) => s.value);
/** The title row, fixed under the safe area; the labels, the search field and the quick filters (DiscoveryBar) float and slide away like Explore's. */
const TITLE_ROW = 52;
const FLOAT = DISCOVERY_BAR_HEIGHT;

/**
 * Events, the fourth tab, laid out like Explore: the big "Events" title with Saved at its right, then the same three
 * levels (DiscoveryBar): For you | All events above a pager with Home's sliding underline; one search field (events'
 * titles, words and places) with the filter button beside it; and one row of quick filters that narrow both pages
 * (Today, This week, Weekend: Upcoming is none of them), a removable chip for each event type picked in the sheet, and
 * Clear. The button opens EventFilterSheet (When, any number of event types, and Your interests) and counts the choices
 * in force. Everything comes from the campus's own calendars and its verified clubs, departments and organizations
 * (migration 61); For you ranks it for the person, All events is time order under day headings. The floating "+"
 * publishes an event for an organization the person belongs to. Everyone's events for someone without a campus; the
 * campus's clock for the times (lib/campus-time-zone).
 */
export default function EventsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, profile } = useSession();
  const universityId = profile?.university_id ?? null;
  const timeZone = useCampusTimeZone(universityId);

  const pager = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  /** Page a label tap is scrolling to; swipe tracking waits until we get there so the labels do not flicker. */
  const target = useRef<number | null>(null);
  const ready = useRef(false);
  const initialOffset = useRef({ x: 0, y: 0 });
  const scrollX = useRef(new Animated.Value(0)).current;
  /** All events is mounted the first time it comes into view, so it does not load until someone looks at it. */
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([0]));
  // The bottom bar collapses to Events' button as the page on screen scrolls on and comes back as it scrolls back, as
  // on Home (lib/tab-bar-collapse.ts); the other page starts with the whole bar.
  const focused = useIsFocused();
  const trackTabBar = useCollapseOnScroll(focused, index);
  const { translateY: floatShift, select: followPage, reveal: revealFloat, onScroll: onPageScroll } = useCollapsingHeader(ORDER.length, FLOAT, 0, trackTabBar);

  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  // Wait until typing stops before searching.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  /** When and which event types: the quick filters set When, the filter sheet both. */
  const [filters, setFilters] = useState<EventFilterChoice>(DEFAULT_EVENT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { dateFilter, categories } = filters;
  const chips = [...eventQuickFilters(filters), ...eventActiveChips(filters)].map((c) => ({ ...c, onPress: () => setFilters(c.next) }));
  const section: EventSection = ORDER[index] ?? "foryou";

  const show = useCallback(
    (i: number) => {
      indexRef.current = i;
      setIndex(i);
      setMounted((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
      followPage(i);
    },
    [followPage],
  );
  const place = useCallback(() => {
    if (width <= 0) return;
    pager.current?.scrollTo({ x: indexRef.current * width, animated: false });
    ready.current = true;
  }, [width]);
  useEffect(() => {
    ready.current = false;
  }, [width]);
  const goTo = useCallback(
    (i: number) => {
      target.current = i;
      revealFloat();
      show(i);
      pager.current?.scrollTo({ x: i * width, animated: true });
    },
    [revealFloat, show, width],
  );
  function select(s: EventSection) {
    const i = ORDER.indexOf(s);
    if (i < 0 || i === indexRef.current) return;
    goTo(i);
  }
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width <= 0 || !ready.current) return;
      const pos = e.nativeEvent.contentOffset.x / width;
      if (target.current !== null) {
        if (Math.abs(pos - target.current) < 0.02) target.current = null;
        return;
      }
      const lo = Math.max(0, Math.floor(pos + 0.02));
      const hi = Math.min(ORDER.length - 1, Math.ceil(pos - 0.02));
      setMounted((prev) => (prev.has(lo) && prev.has(hi) ? prev : new Set(prev).add(lo).add(hi)));
      const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(pos)));
      if (i !== indexRef.current) show(i);
    },
    [show, width],
  );
  const onPagerScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true, listener: onScroll }), [onScroll, scrollX]);
  function onSettled(e: NativeSyntheticEvent<NativeScrollEvent>) {
    target.current = null;
    if (width <= 0) return;
    const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)));
    if (i !== indexRef.current) show(i);
  }

  const pageProps = { topInset: FLOAT, universityId, timeZone, q, dateFilter, categories };

  return (
    <View style={styles.screen}>
      <View style={[styles.chrome, { paddingTop: insets.top }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            Events
          </Text>
          <Pressable onPress={() => router.push((user ? "/events/saved" : "/(auth)/login") as never)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Saved events" style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.6 }]}>
            <Icon name="bookmark-outline" size={24} color={colors.text} />
          </Pressable>
        </View>
      </View>
      <View style={styles.body}>
        <Animated.View style={[styles.float, { transform: [{ translateY: floatShift }] }]}>
          <DiscoveryBar
            tabs={<SlidingTabs sections={EVENT_SECTIONS} section={section} onSelect={select} scrollX={scrollX} pageWidth={width} tint={colors.accent} tintGradient={auroraGradient(colors.auroraGlow, 90)} labelColor={colors.text} dimColor={colors.muted} spread fontSize={16} />}
            query={text}
            onQuery={setText}
            placeholder="Search events"
            searching={text.trim() !== q}
            filterCount={eventFilterCount(filters)}
            onOpenFilters={() => setFiltersOpen(true)}
            filterHint="Pick when, which types of event, and your interests"
            chips={chips}
            onClear={() => setFilters(DEFAULT_EVENT_FILTERS)}
          />
        </Animated.View>
        <Animated.ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentOffset={initialOffset.current}
          scrollEventThrottle={16}
          onContentSizeChange={place}
          onScrollBeginDrag={() => {
            target.current = null;
            revealFloat();
          }}
          onScroll={onPagerScroll}
          onMomentumScrollEnd={onSettled}
          style={{ flex: 1 }}
        >
          {ORDER.map((s, i) => (
            <View key={s} style={{ width, flex: 1 }}>
              {!mounted.has(i) ? null : s === "all" ? <AllEventsSection active={section === "all"} onScroll={onPageScroll(i)} {...pageProps} /> : <ForYouEventsSection active={section === "foryou"} onScroll={onPageScroll(i)} {...pageProps} />}
            </View>
          ))}
        </Animated.ScrollView>
        <Fab href="/events/new" label="Create event" hint="Publish an event for a club, organization or department you belong to" />
      </View>
      <EventFilterSheet
        open={filtersOpen}
        value={filters}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
        onClose={() => setFiltersOpen(false)}
        onEditInterests={
          user
            ? () => {
                setFiltersOpen(false);
                router.push("/events/interests" as never);
              }
            : undefined
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  chrome: { backgroundColor: colors.bar, zIndex: 3 },
  titleRow: { height: TITLE_ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingLeft: 20, paddingRight: space.md },
  title: { flexShrink: 1, ...textStyle.largeTitle, color: colors.text },
  titleButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, overflow: "hidden" },
  float: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, backgroundColor: colors.bar },
}));
