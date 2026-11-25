import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { categoryLabel, compactCount, deleteEvent, eventWhen, getEvent, getEventGoingMany, getPostEngagement, isEventLive, listEventGoing, listMyOrganizations, ORGANIZATION_KINDS, recordEventClick, updateEvent, type EventSummary, type ProfileSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { CommentsSheet } from "@/components/comments-sheet";
import { useLike } from "@/components/engagement";
import { EventGlyph, EventStatusPill, useToggleSavedEvent } from "@/components/events/event-card";
import { OrganizationFollowButton } from "@/components/events/organization-follow-button";
import { Icon, useBounceOn, type IconName } from "@/components/icon";
import { Button, EmptyState, Loading } from "@/components/ui";
import { useCampusTimeZone } from "@/lib/campus-time-zone";
import { shareEvent, useEventEngagementReady, useGoing } from "@/lib/event-engagement";
import { useOpenProfile } from "@/lib/open-profile";
import { savedEvents } from "@/lib/event-saves-store";
import { alertWithHaptic, hapticSuccess } from "@/lib/haptics";
import { errorText, useQuery } from "@/lib/hooks";
import { rowKey } from "@/lib/query-cache";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** Where a place opens: the phone's own maps app, searching the place as the event names it. */
function mapsUrl(location: string): string {
  const q = encodeURIComponent(location);
  return Platform.OS === "ios" ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** One of the actions under the title: its icon over its word, in the brand's colour (or `tint`) once selected. */
function Action({ icon, sf, label, onPress, selected, bounce, tint }: { icon: IconName; sf?: Parameters<typeof Icon>[0]["sf"]; label: string; onPress: () => void; selected?: boolean; bounce?: number; tint?: string }) {
  const styles = useStyles();
  const colors = useColors();
  const on = selected ? (tint ?? colors.brand) : colors.text;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={selected === undefined ? undefined : { selected }} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} sf={sf} size={22} weight="semibold" color={on} bounce={bounce} />
      <Text style={[styles.actionText, selected && { color: on }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Who is going: their faces and first names in a row that scrolls, the most recent first; a tap opens a profile. */
function GoingRow({ people, total }: { people: ProfileSummary[]; total: number }) {
  const styles = useStyles();
  const openProfile = useOpenProfile();
  return (
    <View style={styles.goingBlock}>
      <Text style={styles.goingTitle}>{total > 0 ? `${compactCount(total)} going` : "Who's going"}</Text>
      {people.length === 0 ? (
        <Text style={styles.goingEmpty}>Nobody yet. Tap Going to be the first.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.goingPeople}>
          {people.map((p) => (
            <Pressable key={p.id} onPress={() => openProfile(p.id)} accessibilityRole="button" accessibilityLabel={p.full_name} style={({ pressed }) => [styles.goingPerson, pressed && { opacity: 0.7 }]}>
              <Avatar name={p.full_name} url={p.avatar_url} size={48} userId={p.id} />
              <Text style={styles.goingName} numberOfLines={1}>
                {p.full_name.split(" ")[0] || p.full_name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * An event's own page: its picture (or the category's glyph on the aurora), what and when on the campus's clock, where
 * (a tap opens the maps app), who is holding it with a Follow pill, Like | Comment | Share | Going | Save with who is
 * going under them (migration 69; Save | Share | Directions on a server without it), the registration link as
 * the one big button, then the words. A cancelled or pending event says so at the top. Members of the organization
 * get Edit, Cancel or Restore, and Delete at the bottom. Opening counts once a day for the ranking (record_event_click).
 */
export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const styles = useStyles();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const { user, profile } = useSession();
  // The Events lists hand their rows over (useKeepRows): the event shows at once.
  const event = useQuery(() => getEvent(supabase, id), [id], { key: rowKey("event", id) });
  const e = event.data;
  const timeZone = useCampusTimeZone(e?.university_id ?? profile?.university_id);
  const mine = useQuery(() => (user ? listMyOrganizations(supabase, user.id) : Promise.resolve([])), [user?.id]);
  const member = Boolean(e?.organization_id && mine.data?.some((o) => o.id === e.organization_id));
  const saved = savedEvents.useIds(user?.id ?? null).has(id);
  const toggleSave = useToggleSavedEvent();
  const saveBounce = useBounceOn(saved);
  const [busy, setBusy] = useState(false);
  // Like, comments and who is going (migration 69; the owner's brief, 2026-11-25), once the server has them.
  const engaged = useEventEngagementReady();
  const needLogin = useCallback(() => router.push("/(auth)/login"), [router]);
  const counts = useQuery(() => (engaged ? getPostEngagement(supabase, "event", id) : Promise.resolve(null)), [id, engaged, user?.id]);
  const goingQ = useQuery(() => (engaged && user ? getEventGoingMany(supabase, [id]).then((m) => m[id] ?? null) : Promise.resolve(null)), [id, engaged, user?.id]);
  const peopleQ = useQuery(() => (engaged && user ? listEventGoing(supabase, id, 40) : Promise.resolve([] as ProfileSummary[])), [id, engaged, user?.id]);
  const like = useLike("event", id, counts.data ?? undefined, user?.id ?? null, needLogin);
  const likeBounce = useBounceOn(like.liked);
  const rsvp = useGoing(id, goingQ.data ?? undefined, user?.id ?? null, needLogin);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentDelta, setCommentDelta] = useState(0);
  const comments = Math.max(0, (counts.data?.comments ?? 0) + commentDelta);
  // You join the faces at once when you say you are going, and leave them when you take it back.
  const goingPeople = (() => {
    const others = (peopleQ.data ?? []).filter((p) => p.id !== user?.id);
    return rsvp.goingByMe && profile ? [{ id: profile.id, full_name: profile.full_name, avatar_url: profile.avatar_url }, ...others] : others;
  })();
  const { refresh } = event;
  // Coming back from Edit, the page reads the event again (the rows on screen stay until it arrives).
  const opened = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (opened.current) void refresh();
      opened.current = true;
    }, [refresh]),
  );
  useEffect(() => {
    if (user && id) void recordEventClick(supabase, id, "open");
  }, [user?.id, id, user]);

  if (event.loading && !e) return <Loading />;
  if (!e) return <EmptyState icon="calendar-outline" title="This event is no longer available" body="It may have been removed by its organization or taken off the campus calendar." />;

  const now = Date.now();
  const cancelled = e.status === "cancelled";
  const live = !cancelled && isEventLive(e, now);
  const kind = e.organization ? (ORGANIZATION_KINDS.find((k) => k.value === e.organization?.kind)?.label ?? "Organization") : null;
  const share = () => shareEvent(e, user?.id ?? null);
  function register() {
    if (!e?.registration_url) return;
    if (user) void recordEventClick(supabase, e.id, "register");
    void Linking.openURL(e.registration_url).catch(() => alertWithHaptic("warning", "Could not open the link"));
  }
  async function setCancelled(next: boolean) {
    if (!e) return;
    setBusy(true);
    try {
      const updated = await updateEvent(supabase, e.id, {
        organizationId: e.organization_id!,
        title: e.title,
        description: e.description ?? undefined,
        startsAt: e.starts_at,
        endsAt: e.ends_at ?? undefined,
        allDay: e.all_day,
        location: e.location ?? undefined,
        category: e.category,
        imageUrl: e.image_url ?? undefined,
        registrationUrl: e.registration_url ?? undefined,
        cancelled: next,
      });
      event.setData(updated);
      hapticSuccess();
    } catch (err) {
      alertWithHaptic("error", "Could not update", errorText(err));
    } finally {
      setBusy(false);
    }
  }
  function remove() {
    Alert.alert("Delete this event?", "It disappears from the campus's calendar and from everyone who saved it.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await deleteEvent(supabase, e as EventSummary, user?.id ?? null);
            router.back();
          } catch (err) {
            alertWithHaptic("error", "Could not delete", errorText(err));
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <>
    <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
      {e.image_url ? <Image source={{ uri: e.image_url }} style={{ width, height: Math.round((width * 9) / 16) }} contentFit="cover" transition={200} /> : <EventGlyph category={e.category} size={width} iconSize={44} />}
      <View style={styles.content}>
        {e.status !== "scheduled" ? (
          <View style={styles.banner}>
            <EventStatusPill status={e.status} />
            <Text style={styles.bannerText}>{cancelled ? "This event was cancelled." : e.status === "pending" ? "Visible to the organization's members until staff verify it." : "Hidden by staff: only the organization's members and staff see it."}</Text>
          </View>
        ) : null}
        <Text style={[styles.title, cancelled && { color: colors.muted }]} selectable>
          {e.title}
        </Text>
        <View style={styles.facts}>
          <View style={styles.fact}>
            <Icon name="calendar-outline" size={18} color={colors.brand} />
            <Text style={[styles.factText, { color: colors.brand, fontWeight: "600" }]}>{live ? `Happening now · ${eventWhen(e, timeZone, now)}` : eventWhen(e, timeZone, now)}</Text>
          </View>
          {e.location ? (
            <Pressable onPress={() => void Linking.openURL(mapsUrl(e.location!))} accessibilityRole="link" accessibilityLabel={`${e.location}, open in Maps`} style={({ pressed }) => [styles.fact, pressed && { opacity: 0.6 }]}>
              <Icon name="location-outline" size={18} color={colors.muted} />
              <Text style={styles.factText}>{e.location}</Text>
              <Icon name="chevron-forward" size={14} color={colors.faint} />
            </Pressable>
          ) : null}
          <View style={styles.fact}>
            <Icon name="pricetag-outline" size={18} color={colors.muted} />
            <Text style={styles.factText}>{categoryLabel(e.category)}</Text>
          </View>
        </View>
        {e.organization ? (
          <View style={styles.host}>
            <Pressable onPress={() => router.push({ pathname: "/organizations/[id]", params: { id: e.organization!.id } } as never)} accessibilityRole="button" accessibilityLabel={e.organization.name} style={({ pressed }) => [styles.hostPerson, pressed && { opacity: 0.7 }]}>
              <Avatar name={e.organization.name} url={e.organization.avatar_url} size={44} />
              <View style={{ flex: 1, gap: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={styles.hostName} numberOfLines={1}>
                    {e.organization.name}
                  </Text>
                  {e.organization.verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={15} color={colors.brand} accessibilityLabel="Verified organization" /> : null}
                </View>
                <Text style={styles.hostMeta} numberOfLines={1}>
                  {kind}
                </Text>
              </View>
            </Pressable>
            <OrganizationFollowButton organizationId={e.organization.id} compact />
          </View>
        ) : e.source === "feed" ? (
          <View style={styles.host}>
            <View style={styles.feedMark}>
              <Icon name="school-outline" size={20} color={colors.auroraInk} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hostName}>Campus calendar</Text>
              <Text style={styles.hostMeta}>From the university's own calendar, kept in step with it.</Text>
            </View>
          </View>
        ) : null}
        {engaged ? (
          // Like, Comment, Share, Going and Save, as under a post (the place above already opens the maps app).
          <View style={styles.actions}>
            <Action icon={like.liked ? "heart" : "heart-outline"} label={like.likes > 0 ? compactCount(like.likes) : "Like"} selected={like.liked} tint={colors.like} bounce={likeBounce} onPress={() => void like.toggle()} />
            <Action icon="chatbubble-outline" label={comments > 0 ? compactCount(comments) : "Comment"} onPress={() => setCommentsOpen(true)} />
            <Action icon="share-outline" label="Share" onPress={() => void share()} />
            <Action icon={rsvp.goingByMe ? "people" : "people-outline"} label="Going" selected={rsvp.goingByMe} onPress={() => void rsvp.toggle()} />
            <Action icon={saved ? "bookmark" : "bookmark-outline"} label={saved ? "Saved" : "Save"} selected={saved} bounce={saveBounce} onPress={() => toggleSave(e)} />
          </View>
        ) : (
          <View style={styles.actions}>
            <Action icon={saved ? "bookmark" : "bookmark-outline"} label={saved ? "Saved" : "Save"} selected={saved} bounce={saveBounce} onPress={() => toggleSave(e)} />
            <Action icon="share-outline" label="Share" onPress={() => void share()} />
            {e.location ? <Action icon="navigate-outline" label="Directions" onPress={() => void Linking.openURL(mapsUrl(e.location!))} /> : null}
          </View>
        )}
        {engaged && user ? <GoingRow people={goingPeople} total={rsvp.going} /> : null}
        {e.registration_url && !cancelled ? <Button title={e.source === "feed" ? "Event page" : "Register"} size="large" icon="open-outline" onPress={register} /> : null}
        {e.description ? (
          <Text style={styles.description} selectable>
            {e.description}
          </Text>
        ) : null}
        {member ? (
          <View style={styles.manage}>
            <Text style={styles.manageTitle}>Your organization's event</Text>
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              <Button title="Edit" variant="secondary" icon="create-outline" disabled={busy} onPress={() => router.push({ pathname: "/events/edit/[id]", params: { id: e.id } } as never)} />
              {e.status !== "hidden" ? <Button title={cancelled ? "Restore" : "Cancel event"} variant="secondary" icon={cancelled ? "refresh-outline" : "close-circle-outline"} disabled={busy} onPress={() => void setCancelled(!cancelled)} /> : null}
              <Button title="Delete" variant="danger" icon="trash-outline" disabled={busy} onPress={remove} />
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
    {/* An event has no owner who could delete others' comments (migration 69): nobody is its "Author". */}
    <CommentsSheet target={commentsOpen ? { targetType: "event", targetId: e.id, ownerId: "", comments } : null} onClose={() => setCommentsOpen(false)} onCountChange={(d) => setCommentDelta((n) => n + d)} />
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { padding: space.lg, gap: space.lg },
  banner: { gap: 6, padding: space.md, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.panel },
  bannerText: { ...textStyle.footnote, color: colors.muted },
  title: { ...textStyle.title2, color: colors.text },
  facts: { gap: space.sm },
  fact: { flexDirection: "row", alignItems: "center", gap: 10 },
  factText: { ...textStyle.subheadline, color: colors.text, flex: 1 },
  host: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  hostPerson: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md },
  hostName: { ...textStyle.headline, color: colors.text, flexShrink: 1 },
  hostMeta: { ...textStyle.footnote, color: colors.muted },
  feedMark: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", justifyContent: "space-around", paddingVertical: space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  // Up to five, sharing the row.
  action: { flex: 1, alignItems: "center", gap: 4, paddingVertical: space.sm, minWidth: 0 },
  actionText: { ...textStyle.caption1, fontWeight: "600", color: colors.text },
  description: { ...textStyle.body, color: colors.text },
  goingBlock: { gap: space.sm },
  goingTitle: { ...textStyle.headline, color: colors.text },
  goingEmpty: { ...textStyle.footnote, color: colors.muted },
  goingPeople: { gap: space.md, paddingRight: space.lg },
  goingPerson: { width: 60, alignItems: "center", gap: 4 },
  goingName: { ...textStyle.caption1, color: colors.text, maxWidth: 60 },
  manage: { gap: space.sm, padding: space.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.panel },
  manageTitle: { ...textStyle.footnote, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4 },
}));
