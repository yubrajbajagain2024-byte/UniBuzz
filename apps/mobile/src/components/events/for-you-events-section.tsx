import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View, type FlatList } from "react-native";
import { useRouter } from "expo-router";
import { eventDateRange, FOR_YOU_EVENTS_POOL, getForYouContext, listEvents, listOrganizations, rankEvents, type EventSummary, type ForYouContext, type Organization } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { ErrorBanner, Loading, useAppearingCells } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { savedEvents } from "@/lib/event-saves-store";
import { refreshWithHaptic } from "@/lib/haptics";
import { useQuery } from "@/lib/hooks";
import { organizationFollows } from "@/lib/organization-follows-store";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useTabReselect } from "@/lib/tab-reselect";
import { dismissInterestsPrompt, interestsPromptDismissed, onEventInterestsChanged } from "@/lib/event-interests";
import { radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { EventCard, useToggleSavedEvent } from "./event-card";
import { EventsEmpty, iso, RowGap, type EventsPageProps } from "./events-page";
import { OrganizationFollowButton } from "./organization-follow-button";

/** Under this many follows the page still suggests organizations. */
const FEW_FOLLOWS = 3;
const NO_CONTEXT: ForYouContext = {};

/**
 * For you, the Events tab's first page: the campus's upcoming events in the order the ranking puts them for this person
 * (rankEvents in packages/shared: picked interests, what they keep saving and opening, the organizations they follow,
 * how soon, how many others saved it), narrowed by the bar's filters like the All page. Signed out, or with nothing
 * known yet, it is soonest-and-most-saved first. Until interests are picked it asks once, in a single line that opens
 * Your interests and can be dismissed for good (lib/event-interests.ts); the filter sheet keeps Your interests after
 * that, and a save there re-ranks the page at once. While they follow few organizations, a row of the campus's to
 * follow sits at the top.
 */
export function ForYouEventsSection({ active, topInset, onScroll, universityId, timeZone, q, dateFilter, categories }: EventsPageProps) {
  const colors = useColors();
  const styles = useStyles();
  const router = useRouter();
  const { user } = useSession();
  const me = user?.id ?? null;
  const saved = savedEvents.useIds(me);
  const follows = organizationFollows.useIds(me);
  const toggleSave = useToggleSavedEvent();
  const query = useQuery(async () => {
    const now = Date.now();
    const range = eventDateRange(dateFilter, now, timeZone);
    const [events, ctx] = await Promise.all([
      listEvents(supabase, { universityId, from: iso(range.from), to: iso(range.to), categories, q: q || undefined, limit: FOR_YOU_EVENTS_POOL }),
      me ? getForYouContext(supabase, me).catch(() => NO_CONTEXT) : Promise.resolve(NO_CONTEXT),
    ]);
    return { events, ctx, now };
  }, [me, universityId, timeZone, q, dateFilter, categories]);
  const organizations = useQuery(() => (me ? listOrganizations(supabase, { universityId, limit: 12 }) : Promise.resolve([] as Organization[])), [me, universityId]);

  const interests = query.data?.ctx.interests ?? [];
  // Interests saved in Your interests (the prompt below, or the filter sheet): ranked again with them at once.
  const refreshQuery = query.refresh;
  useEffect(() => onEventInterestsChanged(() => void refreshQuery()), [refreshQuery]);
  /** Whether this account dismissed the interests prompt on this phone (null until known, so it never flashes in). */
  const [promptDismissed, setPromptDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    setPromptDismissed(null);
    if (!me) return;
    let live = true;
    void interestsPromptDismissed(me).then((dismissed) => live && setPromptDismissed(dismissed));
    return () => {
      live = false;
    };
  }, [me]);
  // The follows as they are now (the shared set), so following an organization lifts its events at once.
  const ranked = useMemo(() => {
    if (!query.data) return [];
    const ctx: ForYouContext = { ...query.data.ctx, followedOrganizationIds: [...follows] };
    return rankEvents(query.data.events, ctx, query.data.now);
  }, [query.data, follows]);

  const inset = useMemo(() => listInset(topInset), [topInset]);
  const listRef = useRef<FlatList<EventSummary>>(null);
  const appearCells = useAppearingCells();
  const tabBar = useTabBarInset();
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: inset.topOffset, animated: true }), active);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([query.refresh(), organizations.refresh(), me ? savedEvents.reload(me) : null]);
    } finally {
      setRefreshing(false);
    }
  }, [query.refresh, organizations.refresh, me]);

  const askInterests = Boolean(me) && query.data !== null && interests.length === 0 && promptDismissed === false;
  const suggest = Boolean(me) && follows.size < FEW_FOLLOWS && (organizations.data?.length ?? 0) > 0;
  const header =
    askInterests || suggest ? (
      <View style={styles.header}>
        {askInterests ? (
          // One line, asked once: it opens Your interests, and its × puts it away for good.
          <View style={styles.prompt}>
            <Pressable onPress={() => router.push("/events/interests" as never)} accessibilityRole="button" accessibilityLabel="Pick your interests" accessibilityHint="For you puts them first" style={({ pressed }) => [styles.promptMain, pressed && { opacity: 0.7 }]}>
              <Icon name="sparkles-outline" sf="sparkles" size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.promptTitle}>Pick your interests</Text>
                <Text style={styles.promptHint}>For you puts them first</Text>
              </View>
              <Icon name="chevron-forward" sf="chevron.right" size={14} color={colors.faint} />
            </Pressable>
            <Pressable
              onPress={() => {
                setPromptDismissed(true);
                if (me) dismissInterestsPrompt(me);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Not now"
              accessibilityHint="You can pick interests later from Filters"
              style={({ pressed }) => [styles.promptClose, pressed && { opacity: 0.6 }]}
            >
              <Icon name="close" sf="xmark" size={13} weight="semibold" color={colors.muted} />
            </Pressable>
          </View>
        ) : null}
        {suggest ? (
          <View style={styles.block}>
            <View style={styles.blockHead}>
              <Icon name="people-outline" size={16} color={colors.brand} />
              <Text style={styles.blockTitle}>Organizations to follow</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.orgRow} keyboardShouldPersistTaps="handled">
              {(organizations.data ?? []).map((o) => (
                <View key={o.id} style={styles.orgCard}>
                  <Pressable onPress={() => router.push({ pathname: "/organizations/[id]", params: { id: o.id } } as never)} accessibilityRole="button" accessibilityLabel={o.name} style={({ pressed }) => [styles.orgPerson, pressed && { opacity: 0.7 }]}>
                    <Avatar name={o.name} url={o.avatar_url} size={56} />
                    <View style={styles.orgName}>
                      <Text numberOfLines={1} style={styles.orgNameText}>
                        {o.name}
                      </Text>
                      {o.verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={12} color={colors.brand} /> : null}
                    </View>
                    <Text numberOfLines={1} style={styles.orgMeta}>
                      {o.follower_count === 1 ? "1 follower" : `${o.follower_count} followers`}
                    </Text>
                  </Pressable>
                  <OrganizationFollowButton organizationId={o.id} compact style={styles.orgFollow} />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
    ) : null;
  const filtered = Boolean(q) || categories.length > 0 || dateFilter !== "any";

  return (
    <View style={{ flex: 1 }}>
      <AnimatedFlatList
        ref={listRef}
        data={ranked}
        keyExtractor={(e) => e.id}
        {...inset.list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 90 + tabBar, paddingTop: inset.paddingTop }}
        CellRendererComponent={appearCells}
        ListHeaderComponent={header ?? undefined}
        renderItem={({ item }) => <EventCard event={item} timeZone={timeZone} saved={saved.has(item.id)} onToggleSave={toggleSave} />}
        ItemSeparatorComponent={RowGap}
        windowSize={9}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={query.loading && !query.data ? <Loading /> : query.error ? <View style={{ paddingHorizontal: 16 }}><ErrorBanner message={query.error} onRetry={() => void query.refresh()} /></View> : <EventsEmpty filtered={filtered} campus={Boolean(universityId)} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshWithHaptic(() => void onRefresh())} progressViewOffset={inset.progressViewOffset} />}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { gap: space.md, paddingTop: space.sm, paddingBottom: space.md },
  block: { marginHorizontal: space.lg, padding: space.md, gap: space.sm, borderRadius: 18, borderCurve: "continuous", backgroundColor: colors.panel },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  blockTitle: { ...textStyle.headline, color: colors.text },
  // For you's interests prompt: one line on the panel, with its × at the right.
  prompt: { marginHorizontal: space.lg, flexDirection: "row", alignItems: "center", borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.panel },
  promptMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingLeft: 14, paddingRight: 6 },
  promptTitle: { ...textStyle.subheadline, fontWeight: "600", color: colors.text },
  promptHint: { ...textStyle.footnote, color: colors.muted },
  promptClose: { width: 40, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  orgRow: { gap: space.sm, paddingVertical: 2 },
  orgCard: { width: 140, padding: space.md, gap: space.sm, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.card, alignItems: "center" },
  orgPerson: { alignItems: "center", gap: 2, alignSelf: "stretch" },
  orgName: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: space.xs, maxWidth: "100%" },
  orgNameText: { fontSize: 14, fontWeight: "700", color: colors.text, textAlign: "center", flexShrink: 1 },
  orgMeta: { fontSize: 12, color: colors.muted, textAlign: "center" },
  orgFollow: { alignSelf: "stretch" },
}));
