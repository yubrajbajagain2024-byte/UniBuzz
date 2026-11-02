import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { APP_NAME, listConversations, listFriends, sendSharedPost, sharedPostNoun, shareFailureSummary, type ConversationSummary, type FeedMedia, type ProfileSummary, type SharedPost } from "@apartment-book/shared";
import { hapticSuccess, hapticTap, alertWithHaptic } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { auroraGradient, radius } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { Avatar } from "./avatar";
import { InboxAvatar } from "./messages/inbox-row";
import { matchConversations } from "./messages/inbox-utils";
import { Icon } from "@/components/icon";
import { Sheet, SheetFooter, SheetHeader } from "./sheet";

/**
 * Besides the snapshot, the sheet needs the website link for "Share to…" and, optionally, the words that go before it.
 * Without `url` (a story, which has no page on the website) the sheet sends only into chats, with no "Share to…". Who
 * may receive a card is the database's rule (a campus post, a listing or a story reaches only a chat whose members may
 * all see it): a refusal comes back with its reason, and the sheet says it.
 */
export type ShareOptions = { url?: string; label?: string; onClosed?: () => void };
type ShareRequest = { shared: SharedPost; options: ShareOptions; seq: number };
type ShareSheetApi = {
  /** Opens the sheet over whatever is on screen. Selection, note and search start empty every time. */
  open: (shared: SharedPost, options: ShareOptions) => void;
  close: () => void;
};

const Ctx = createContext<ShareSheetApi>({ open: () => {}, close: () => {} });

/** The first picture a card shows, or the still of its first video: what a shared listing looks like in the chat. */
export function firstImageOf(media: FeedMedia[]): string | null {
  for (const m of media) {
    if (m.type === "photo") return m.url;
    if (m.type === "video" && m.poster) return m.poster;
  }
  return null;
}

/**
 * Instagram's share sheet, mounted in the root layout: `useShareSheet().open(sharedPost, { url })` from any Share button.
 * A screen that iOS presents modally (the full-screen viewer) mounts its own: a sheet is presented by the screen on top,
 * and the root one, under that screen, could not appear over it. Your group chats (the most recent first) and your
 * friends (people you follow who follow you back) show as a grid; pick some, add a note, Send, and each friend gets a
 * direct message carrying the post as a card, each group one message in the group. "Share to…" at the bottom is the
 * system share sheet, as before.
 */
export function ShareSheetProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ShareRequest | null>(null);
  const seq = useRef(0);
  const open = useCallback((shared: SharedPost, options: ShareOptions) => setRequest({ shared, options, seq: ++seq.current }), []);
  // `onClosed` of an opening runs once that opening has gone (closed, or replaced by the next).
  const shown = useRef<ShareRequest | null>(null);
  useEffect(() => {
    const before = shown.current;
    shown.current = request;
    if (before && before !== request) before.options.onClosed?.();
  }, [request]);
  /** Given an opening's seq, closes the sheet only while that opening is still the one showing: a late close never shuts the next. */
  const close = useCallback((only?: number) => setRequest((r) => (only === undefined || r?.seq === only ? null : r)), []);
  const value = useMemo<ShareSheetApi>(() => ({ open, close: () => close() }), [open, close]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ShareSheet request={request} onClose={close} />
    </Ctx.Provider>
  );
}

export function useShareSheet(): ShareSheetApi {
  return useContext(Ctx);
}

function ShareSheet({ request, onClose }: { request: ShareRequest | null; onClose: (seq?: number) => void }) {
  // Keep showing the last request while the sheet slides away, so it does not go blank mid-animation.
  const [shown, setShown] = useState<ShareRequest | null>(request);
  const open = request !== null;
  /** Something to do once the sheet is gone: iOS will not present a new screen while this modal is still dismissing. */
  const afterDismiss = useRef<(() => void) | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (request) setShown(request);
  }, [request]);
  useEffect(() => () => void (fallback.current && clearTimeout(fallback.current)), []);

  const runAfterDismiss = useCallback(() => {
    const fn = afterDismiss.current;
    afterDismiss.current = null;
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
    fn?.();
  }, []);

  /** Close, then navigate: straight away on Android, after the dismissal on iOS (onDismiss, or a timer if it never fires). */
  const closeThen = useCallback(
    (fn: () => void) => {
      onClose();
      if (Platform.OS !== "ios") return fn();
      afterDismiss.current = fn;
      // The sheet animates out first (about a quarter second), then the modal goes: allow for both.
      fallback.current = setTimeout(runAfterDismiss, 900);
    },
    [onClose, runAfterDismiss],
  );

  return (
    <Sheet visible={open} onClose={() => onClose()} onDismiss={runAfterDismiss} closeLabel="Close share sheet" height="72%" keyboard>
      {shown ? <SheetBody key={shown.seq} shared={shown.shared} options={shown.options} onClose={() => onClose(shown.seq)} closeThen={closeThen} /> : null}
    </Sheet>
  );
}

type SendStatus = "idle" | "sending" | "sent";
/** Someone or somewhere the card can go: a friend (their direct chat) or one of your group chats. */
type Recipient = { key: string; name: string; personId?: string; conversationId?: string };
/** Group chats shown before a search: the most recently active. A search looks through all of them. */
const RECENT_GROUPS = 9;

/** One opening of the sheet: remounted (fresh search, selection and note) each time it opens. */
function SheetBody({ shared, options, onClose, closeThen }: { shared: SharedPost; options: ShareOptions; onClose: () => void; closeThen: (fn: () => void) => void }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const router = useRouter();
  const { user } = useSession();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState("");
  const [friends, setFriends] = useState<ProfileSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Your group chats, newest activity first; null while loading. */
  const [groups, setGroups] = useState<ConversationSummary[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Who gets it, by key. A Map so names survive a search that no longer lists them. */
  const [picked, setPicked] = useState<Map<string, Recipient>>(new Map());
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<SendStatus>("idle");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** False once this opening is gone (closed, or replaced by the next): a send that finishes later must leave it alone. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const userId = user?.id ?? null;
  // Friends load as soon as the sheet opens; typing waits 250ms for the next letter before asking again.
  useEffect(() => {
    if (!userId) return;
    let stale = false;
    const t = setTimeout(() => {
      setSearching(true);
      setError(null);
      listFriends(supabase, q)
        .then((rows) => {
          if (stale) return;
          setFriends(rows);
          setError(null);
        })
        .catch((e) => {
          if (!stale) setError(errorText(e, "Could not load your friends."));
        })
        .finally(() => {
          if (!stale) setSearching(false);
        });
    }, q ? 250 : 0);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, userId, attempt]);
  // The group chats load once per opening (the inbox's own list); a search filters them here, by name and members.
  useEffect(() => {
    if (!userId) return;
    let stale = false;
    setGroupsError(null);
    listConversations(supabase, userId)
      .then((rows) => {
        if (!stale) setGroups(rows.filter((c) => c.type === "group"));
      })
      .catch((e) => {
        if (stale) return;
        setGroups((g) => g ?? []);
        setGroupsError(errorText(e, "Could not load your group chats."));
      });
    return () => {
      stale = true;
    };
  }, [userId, attempt]);
  const shownGroups = useMemo(() => (!groups ? [] : q.trim() ? matchConversations(groups, q, () => null) : groups.slice(0, RECENT_GROUPS)), [groups, q]);

  // Three tiles per row on a phone (390pt), more on a tablet.
  const columns = Math.max(3, Math.floor((width - 24) / 118));
  const busy = status !== "idle";

  function toggle(r: Recipient) {
    if (busy) return;
    hapticTap();
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(r.key)) next.delete(r.key);
      else next.set(r.key, r);
      return next;
    });
  }

  async function send() {
    if (!user || picked.size === 0 || busy) return;
    const recipients = [...picked.values()];
    setStatus("sending");
    try {
      const { failed, reasons } = await sendSharedPost(supabase, {
        senderId: user.id,
        recipientIds: recipients.flatMap((r) => (r.personId ? [r.personId] : [])),
        conversationIds: recipients.flatMap((r) => (r.conversationId ? [r.conversationId] : [])),
        sharedPost: shared,
        note: note.trim(),
      });
      // Closed while it was sending: no timer, alert or state for a sheet that is gone.
      if (!alive.current) return;
      if (failed.length > 0) {
        // The ones that did not get it stay picked, so Send again reaches just them; the alert says why for each.
        const missed = recipients.filter((r) => failed.includes(r.personId ?? r.conversationId ?? ""));
        setPicked(new Map(missed.map((r) => [r.key, r])));
        setStatus("idle");
        const why = missed.map((r) => ({ name: r.name, group: Boolean(r.conversationId), ...reasons[r.personId ?? r.conversationId ?? ""] }));
        alertWithHaptic("error", `Could not send to ${missed.map((r) => r.name).join(", ")}`, shareFailureSummary(why, sharedPostNoun(shared)));
        return;
      }
      hapticSuccess();
      setStatus("sent");
      closeTimer.current = setTimeout(onClose, 900);
    } catch (e) {
      if (!alive.current) return;
      setStatus("idle");
      alertWithHaptic("error", "Could not send", errorText(e));
    }
  }

  /** The system share sheet, as the Share buttons opened before: the link with a line of words in front of it. */
  async function shareTo() {
    if (!options.url) return;
    const label = options.label ?? shared.title ?? (shared.caption ? shared.caption.slice(0, 80) : `${shared.author.name} on ${APP_NAME}`);
    try {
      const result = await Share.share({ message: `${label} · ${options.url}`, url: options.url });
      if (alive.current && result.action === Share.sharedAction) onClose();
    } catch {
      // The system sheet was closed or is not available here; ours stays open.
    }
  }

  const sendLabel = status === "sending" ? "Sending…" : status === "sent" ? "Sent" : "Send";
  const names = [...picked.values()].map((r) => r.name);
  const toLine = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

  let body: ReactNode;
  if (!user) {
    body = (
      <Pressable onPress={() => closeThen(() => router.push("/(auth)/login"))} accessibilityRole="button" accessibilityLabel="Log in to share with friends" style={({ pressed }) => [styles.empty, pressed && { opacity: 0.7 }]}>
        <Icon name="person-circle-outline" size={44} color={colors.faint} />
        <Text style={styles.loginText}>Log in to share with friends</Text>
        <Text style={styles.emptyBody}>Posts you share land in a chat with each friend.</Text>
      </Pressable>
    );
  } else if (error && !friends) {
    body = (
      <View style={styles.empty}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => setAttempt((n) => n + 1)} accessibilityRole="button" accessibilityLabel="Retry" style={styles.ghostButton}>
          <Text style={styles.ghostButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  } else if (!friends) {
    body = (
      <View style={styles.empty}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  } else {
    /** A friend or a group as a tile: the photo with a tick when picked, the name under it. */
    const tile = (r: Recipient, photo: ReactNode) => {
      const selected = picked.has(r.key);
      return (
        <Pressable
          key={r.key}
          onPress={() => toggle(r)}
          accessibilityRole="button"
          accessibilityLabel={r.conversationId ? `${r.name}, group chat` : r.name}
          accessibilityState={{ selected }}
          style={({ pressed }) => [styles.tile, { width: `${100 / columns}%` }, pressed && { opacity: 0.7 }]}
        >
          <View>
            {photo}
            {selected ? (
              <View style={styles.check}>
                <Icon name="checkmark" size={14} color={colors.onBrand} />
              </View>
            ) : null}
          </View>
          <Text style={[styles.tileName, selected && { color: colors.brand }]} numberOfLines={2}>
            {r.name}
          </Text>
        </Pressable>
      );
    };
    const noFriends = friends.length === 0;
    body = (
      <>
        {shownGroups.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Groups</Text>
            <View style={styles.grid}>{shownGroups.map((c) => tile({ key: `group:${c.id}`, name: c.title, conversationId: c.id }, <InboxAvatar conversation={c} size={64} />))}</View>
            {!noFriends ? <Text style={styles.sectionLabel}>Friends</Text> : null}
          </>
        ) : null}
        {!noFriends ? (
          <View style={styles.grid}>{friends.map((p) => tile({ key: `person:${p.id}`, name: p.full_name, personId: p.id }, <Avatar name={p.full_name} url={p.avatar_url} size={64} userId={p.id} ringColor={colors.elevated} />))}</View>
        ) : q.trim() ? (
          shownGroups.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyBody}>No friends or groups match “{q.trim()}”.</Text>
            </View>
          ) : null
        ) : (
          <View style={styles.empty}>
            <Icon name="people-outline" size={44} color={colors.faint} />
            <Text style={styles.emptyTitle}>Friends you follow back show up here.</Text>
            <Pressable onPress={() => closeThen(() => router.push("/find-people"))} accessibilityRole="button" accessibilityLabel="Find people" style={styles.ghostButton}>
              <Text style={styles.ghostButtonText}>Find people</Text>
            </Pressable>
          </View>
        )}
      </>
    );
  }

  return (
    <>
      <SheetHeader title="Share" onClose={onClose} />
      {user ? (
        <View style={styles.search}>
          <Icon name="search-outline" size={18} color={colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search friends and groups"
            placeholderTextColor={colors.faint}
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel="Search friends and groups"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            editable={!busy}
            style={styles.searchInput}
          />
          {searching && friends ? <ActivityIndicator size="small" color={colors.muted} /> : null}
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}>
        {/* A search that failed once a list was showing: that list stays, with the error and Retry above it. */}
        {user && ((error && friends) || groupsError) ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error && friends ? error : groupsError}</Text>
            <Pressable onPress={() => setAttempt((n) => n + 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Retry" style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
              <Text style={styles.bannerRetry}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {body}
      </ScrollView>
      <SheetFooter style={styles.footer}>
        {user && picked.size > 0 ? (
          <View style={styles.composer}>
            <Text style={styles.to} numberOfLines={1}>
              To {toLine}
            </Text>
            <View style={styles.composerRow}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Write a message…"
                placeholderTextColor={colors.faint}
                keyboardAppearance={isDark ? "dark" : "light"}
                accessibilityLabel="Write a message"
                maxLength={500}
                multiline
                editable={!busy}
                style={styles.note}
              />
              <Pressable
                onPress={() => void send()}
                disabled={busy || picked.size === 0}
                accessibilityRole="button"
                accessibilityLabel={sendLabel}
                accessibilityState={{ disabled: busy || picked.size === 0 }}
                style={({ pressed }) => [styles.send, status === "sent" ? { backgroundColor: colors.successFill } : styles.sendAurora, pressed && !busy && { opacity: 0.85 }]}
              >
                {status === "sending" ? <ActivityIndicator size="small" color={colors.onBrand} /> : status === "sent" ? <Icon name="checkmark" size={16} color={colors.onBrand} /> : null}
                <Text style={styles.sendText}>{sendLabel}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {options.url ? (
          <Pressable onPress={() => void shareTo()} disabled={busy} accessibilityRole="button" accessibilityLabel="Share to…" style={({ pressed }) => [styles.secondary, pressed && { backgroundColor: colors.input }]}>
            <View style={styles.secondaryIcon}>
              <Icon name="share-outline" size={20} color={colors.text} />
            </View>
            <Text style={styles.secondaryText}>Share to…</Text>
            <Icon name="chevron-forward" size={16} color={colors.faint} />
          </Pressable>
        ) : null}
      </SheetFooter>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 12, paddingHorizontal: 12, height: 40, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.input },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  list: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, flexGrow: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  tile: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 4, gap: 6 },
  // The ring is the sheet's own colour, cutting the tick out of the photo.
  check: { position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, borderWidth: 2, borderColor: colors.elevated, alignItems: "center", justifyContent: "center" },
  tileName: { fontSize: 12, lineHeight: 15, color: colors.text, textAlign: "center" },
  sectionLabel: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: 4, marginBottom: 2, marginLeft: 4 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 32, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.text, textAlign: "center" },
  emptyBody: { fontSize: 14, color: colors.muted, textAlign: "center" },
  loginText: { fontSize: 16, fontWeight: "700", color: colors.brand, textAlign: "center" },
  errorText: { fontSize: 14, color: colors.red, textAlign: "center" },
  // The look of ErrorBanner in components/ui.
  banner: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8, padding: 12, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.dangerSoft },
  bannerText: { flex: 1, fontSize: 14, color: colors.dangerText },
  bannerRetry: { fontSize: 14, fontWeight: "700", color: colors.dangerText },
  ghostButton: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  ghostButtonText: { fontSize: 14, fontWeight: "700", color: colors.brand },
  footer: { paddingHorizontal: 12, paddingTop: 8 },
  composer: { gap: 6, paddingBottom: 8 },
  to: { fontSize: 12, color: colors.muted, marginLeft: 2 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  note: { flex: 1, minHeight: 40, maxHeight: 96, backgroundColor: colors.input, borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 15, color: colors.text },
  send: { minWidth: 84, height: 40, borderRadius: 20, paddingHorizontal: 16, backgroundColor: colors.brand, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  // Until it has gone: then the green "Sent" replaces the aurora.
  sendAurora: { experimental_backgroundImage: auroraGradient(colors.aurora) },
  sendText: { color: colors.onBrand, fontSize: 15, fontWeight: "700" },
  secondary: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.md, borderCurve: "continuous" },
  secondaryIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  secondaryText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text },
}));
