import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from "react-native";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clearExploreFilters, DEFAULT_EXPLORE_FILTERS, DEFAULT_HOUSING_SECTION, exploreActiveChips, exploreFilterCount, exploreQuickFilters, HOUSING_SECTIONS, type ExploreFilters, type HousingSection, type ItemCategoryValue } from "@apartment-book/shared";
import { DISCOVERY_BAR_HEIGHT, DiscoveryBar } from "@/components/discovery-bar";
import { Fab } from "@/components/feed-header";
import { ApartmentsSection } from "@/components/housing/apartments-section";
import { FilterSheet } from "@/components/housing/filter-sheet";
import { MarketplaceSection } from "@/components/housing/marketplace-section";
import { RoommatesSection } from "@/components/housing/roommates-section";
import { SlidingTabs } from "@/components/sliding-tabs";
import { useCollapsingHeader } from "@/lib/collapsing-header";
import { useCollapseOnScroll } from "@/lib/tab-bar-collapse";
import { followOffset, handOverTarget, SectionPagerContext, type SectionPager } from "@/lib/section-pager";
import { auroraGradient, space, textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const ORDER = HOUSING_SECTIONS.map((s) => s.value);
const START = Math.max(0, ORDER.indexOf(DEFAULT_HOUSING_SECTION));
/** The page a link's `section` parameter names (/housing?section=marketplace, where the old Marketplace address lands), or -1. */
function pageOf(section: string | undefined): number {
  return section ? ORDER.indexOf(section as HousingSection) : -1;
}
/** The title row, fixed under the safe area. */
const TITLE_ROW = 52;
/** The labels, the search field and the quick filters (DiscoveryBar): they float over the pager and slide up under the title as the page on screen scrolls. */
const FLOAT = DISCOVERY_BAR_HEIGHT;

/** Every page shows the person's own university (everyone's without a university of their own): there is no campus switch here. */
const CAMPUS = "mine" as const;
/**
 * Explore: the big "Find" title, then three levels and no more (DiscoveryBar): Housing | Roommate | Marketplace above the
 * pager with Home's sliding violet underline; one search field (it searches the page on screen) with the filter button
 * beside it; and one row of the page's few quick filters (Furnished, Pets OK, Within 1 mi, Video tour; Has a room,
 * Looking for a room, With a video; Furniture, Textbooks, Electronics, Kitchen), a removable chip for every other choice
 * in force, and Clear. Everything else (sort, price, bedrooms, distance, every category, condition, who a post is open
 * to) is in the filter sheet, one set of choices per page, applied with Show results. A quick filter applies at once.
 * The three pages sit side by side in a pager (a swipe or a tap on a label moves between them, silently, like Home's);
 * the bar floats over it and slides up under the title as the page on screen scrolls down, back as soon as it scrolls
 * up (useCollapsingHeader). The floating "+" follows the visible page. A link to the tab can name the page to open
 * (?section=marketplace).
 */
export default function HousingScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ section: string }>();
  /** The page to open on: the one the link asked for, else Apartments. Read once; a later link is handled below. */
  const start = useRef(pageOf(params.section) >= 0 ? pageOf(params.section) : START).current;
  const pager = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(start);
  const indexRef = useRef(start);
  /** Page a label tap is scrolling to; swipe tracking waits until we get there so the labels do not flicker. */
  const target = useRef<number | null>(null);
  /** False until the pager has been placed on the starting page, so the first layout cannot change the page by accident. */
  const ready = useRef(false);
  /** Same object on every render: a new one would send the pager back to the starting page. */
  const initialOffset = useRef({ x: start * width, y: 0 });
  /** The pager's offset, kept up to date on the native side so the underline slides with the finger. */
  const scrollX = useRef(new Animated.Value(start * width)).current;
  /** Pages are mounted the first time they come into view, so Roommates and the Marketplace do not load until someone looks at them. */
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([start]));
  // The bottom bar collapses to Explore's button as the page on screen scrolls on and comes back as it scrolls back, as
  // on Home (lib/tab-bar-collapse.ts); another page starts with the whole bar.
  const focused = useIsFocused();
  const trackTabBar = useCollapseOnScroll(focused, index);
  const { translateY: floatShift, select: followPage, reveal: revealFloat, onScroll: onPageScroll } = useCollapsingHeader(ORDER.length, FLOAT, start, trackTabBar);

  // The search, shared by the pages, and the filters: one set per page, from the quick filters and the sheet alike.
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_EXPLORE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** The Marketplace grid is still catching up with the words typed: the search box shows a spinner in place of its magnifier. */
  const [busy, setBusy] = useState(false);

  const section: HousingSection = ORDER[index] ?? DEFAULT_HOUSING_SECTION;

  const show = useCallback(
    (i: number) => {
      indexRef.current = i;
      setIndex(i);
      setMounted((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
      followPage(i);
    },
    [followPage],
  );

  // Keep the current page in place when the pager is first laid out and when the screen width changes.
  const place = useCallback(() => {
    if (width <= 0) return;
    pager.current?.scrollTo({ x: indexRef.current * width, animated: false });
    ready.current = true;
  }, [width]);
  useEffect(() => {
    ready.current = false;
  }, [width]);

  /** Moves the pager to page i: a label tap, or a link naming the page. */
  const goTo = useCallback(
    (i: number) => {
      target.current = i;
      revealFloat();
      show(i);
      pager.current?.scrollTo({ x: i * width, animated: true });
    },
    [revealFloat, show, width],
  );

  /** A label moves the pager to its page. */
  function select(s: HousingSection) {
    const i = ORDER.indexOf(s);
    if (i < 0 || i === indexRef.current) return;
    goTo(i);
  }

  /**
   * A swipe a listing's photo carousel on page `from` took past its last photo (or first): the pager follows the finger,
   * never further than the page beside, and once let go glides on to it or back, as after a label tap
   * (lib/section-pager.ts). A swipe the pager has itself is left alone.
   */
  const pagerDragging = useRef(false);
  const handOver = useRef<number | null>(null);
  const followCarousel = (from: number, dx: number) => {
    if (pagerDragging.current || width <= 0) return;
    if (handOver.current === null) {
      handOver.current = from;
      target.current = null;
      revealFloat();
    }
    pager.current?.scrollTo({ x: followOffset(handOver.current, dx, width, ORDER.length - 1), animated: false });
  };
  const releaseCarousel = (dx: number, vx: number) => {
    const from = handOver.current;
    handOver.current = null;
    if (from === null || width <= 0) return;
    goTo(handOverTarget(from, dx, vx, width, ORDER.length - 1));
  };
  const carouselRef = useRef({ follow: followCarousel, release: releaseCarousel });
  carouselRef.current = { follow: followCarousel, release: releaseCarousel };
  /** What each page's photo carousels see of the pager: one value per page, the same for good. Never past the first or last page, so never to another tab. */
  const sectionPagers = useMemo<SectionPager[]>(
    () =>
      ORDER.map((_, i) => ({
        follow: (dx: number) => carouselRef.current.follow(i, dx),
        release: (dx: number, vx: number) => carouselRef.current.release(dx, vx),
      })),
    [],
  );

  // A later link to the tab naming a page (the old /marketplace address, say) moves the pager there.
  const linked = useRef(params.section);
  useEffect(() => {
    if (params.section === linked.current) return;
    linked.current = params.section;
    const i = pageOf(params.section);
    if (i >= 0 && i !== indexRef.current) goTo(i);
  }, [params.section, goTo]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width <= 0 || !ready.current) return;
      const pos = e.nativeEvent.contentOffset.x / width;
      if (target.current !== null) {
        if (Math.abs(pos - target.current) < 0.02) target.current = null;
        return;
      }
      // Mount the neighbour as soon as a swipe starts to reveal it.
      const lo = Math.max(0, Math.floor(pos + 0.02));
      const hi = Math.min(ORDER.length - 1, Math.ceil(pos - 0.02));
      setMounted((prev) => (prev.has(lo) && prev.has(hi) ? prev : new Set(prev).add(lo).add(hi)));
      // The page under the finger changes at the halfway point of a swipe, like Home.
      const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(pos)));
      if (i !== indexRef.current) show(i);
    },
    [show, width],
  );
  // One handler for both jobs: scrollX follows the finger on the UI thread, the page tracking above runs as its listener.
  const onPagerScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true, listener: onScroll }), [onScroll, scrollX]);

  function onSettled(e: NativeSyntheticEvent<NativeScrollEvent>) {
    target.current = null;
    if (width <= 0) return;
    const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)));
    // A flick the scroll events missed still lands on another page.
    if (i !== indexRef.current) show(i);
  }

  /** The Marketplace's category, from the empty grid's "Search all categories" (the quick filters and the sheet set it too). */
  const pickCategory = useCallback((next: ItemCategoryValue | null) => setFilters((f) => ({ ...f, marketplace: { ...f.marketplace, category: next ?? undefined } })), []);
  const placeholder = section === "apartments" ? "Search apartments" : section === "roommates" ? "Search roommate posts" : "Search marketplace";
  const filterCount = exploreFilterCount(section, filters);
  const chips = [...exploreQuickFilters(section, filters), ...exploreActiveChips(section, filters)].map((c) => ({ ...c, onPress: () => setFilters(c.next) }));
  const counts = { apartments: exploreFilterCount("apartments", filters), roommates: exploreFilterCount("roommates", filters), marketplace: exploreFilterCount("marketplace", filters) };

  return (
    <View style={styles.screen}>
      <View style={[styles.chrome, { paddingTop: insets.top }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            Find
          </Text>
        </View>
      </View>
      {/* Clipped, so the labels and pills slid up out of the way never show over the title. */}
      <View style={styles.body}>
        <Animated.View style={[styles.float, { transform: [{ translateY: floatShift }] }]}>
          <DiscoveryBar
            // Spread like Home's labels: three labels do not fit a phone with the inbox's gap.
            tabs={<SlidingTabs sections={HOUSING_SECTIONS} section={section} onSelect={select} scrollX={scrollX} pageWidth={width} tint={colors.accent} tintGradient={auroraGradient(colors.auroraGlow, 90)} labelColor={colors.text} dimColor={colors.muted} spread fontSize={16} />}
            query={q}
            onQuery={setQ}
            placeholder={placeholder}
            searching={section === "marketplace" && busy}
            filterCount={filterCount}
            onOpenFilters={() => setFiltersOpen(true)}
            filterHint="Sort, price, distance and more for the page on screen"
            chips={chips}
            onClear={() => setFilters((f) => clearExploreFilters(section, f))}
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
            pagerDragging.current = true;
            target.current = null;
            // The labels come back for the swipe, wherever the page had scrolled them.
            revealFloat();
          }}
          onScroll={onPagerScroll}
          onScrollEndDrag={() => {
            pagerDragging.current = false;
          }}
          onMomentumScrollEnd={onSettled}
          style={{ flex: 1 }}
        >
          {ORDER.map((s, i) => (
            <View key={s} style={{ width, flex: 1 }}>
              <SectionPagerContext.Provider value={sectionPagers[i]!}>
                {!mounted.has(i) ? null : s === "roommates" ? (
                  <RoommatesSection active={section === "roommates"} topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={CAMPUS} type={filters.roommates.type} filters={filters.roommates} filtered={counts.roommates > 0} />
                ) : s === "marketplace" ? (
                  <MarketplaceSection active={section === "marketplace"} topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={CAMPUS} category={filters.marketplace.category ?? null} onCategoryChange={pickCategory} onSearchBusy={setBusy} filters={filters.marketplace} filtered={counts.marketplace > 0} />
                ) : (
                  <ApartmentsSection active={section === "apartments"} topInset={FLOAT} onScroll={onPageScroll(i)} q={q} campus={CAMPUS} filters={filters.apartments} filtered={counts.apartments > 0} />
                )}
              </SectionPagerContext.Provider>
            </View>
          ))}
        </Animated.ScrollView>
        {/* One "+" for whichever page is showing; it is absolutely positioned, so it floats over all the pages. Signed out it goes to log in. */}
        <Fab
          href={section === "apartments" ? "/create/apartment" : section === "roommates" ? "/create/roommate" : "/create/item"}
          label={section === "apartments" ? "List an apartment" : section === "roommates" ? "Create roommate post" : "Sell an item"}
        />
      </View>
      <FilterSheet
        section={section}
        open={filtersOpen}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  chrome: { backgroundColor: colors.bar, zIndex: 3 },
  titleRow: { height: TITLE_ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingLeft: 20, paddingRight: space.lg },
  title: { flexShrink: 1, ...textStyle.largeTitle, color: colors.text },
  body: { flex: 1, overflow: "hidden" },
  float: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, backgroundColor: colors.bar },
}));
