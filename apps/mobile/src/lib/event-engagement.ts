import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Share } from "react-native";
import { eventEngagementReady, eventPath, getEventGoingMany, getPostEngagementMany, recordEventClick, setEventGoing, type EventGoing, type PostEngagement } from "@apartment-book/shared";
import { alertWithHaptic, hapticLike, hapticSelect } from "./haptics";
import { errorText } from "./hooks";
import { SITE_URL, supabase } from "./supabase";

/*
 * Likes, comments and who is going on events (migration 69; the owner's brief, 2026-11-25): what the event cards and an
 * event's page share. Until the server has migration 69 those buttons stay out (useEventEngagementReady), so nothing is
 * offered that the database would refuse; Share and Save need nothing new and are always there.
 */

let readyAsk: Promise<boolean> | null = null;
let readyKnown: boolean | null = null;

/** Whether the server has migration 69: asked once per run of the app (asked again after a failed ask). */
export function useEventEngagementReady(): boolean {
  const [ready, setReady] = useState(readyKnown === true);
  useEffect(() => {
    if (readyKnown !== null) return setReady(readyKnown);
    let alive = true;
    readyAsk ??= eventEngagementReady(supabase).then(
      (yes) => (readyKnown = yes),
      () => {
        readyAsk = null;
        return false;
      },
    );
    void readyAsk.then((yes) => alive && setReady(yes));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

/**
 * Like and comment counts, and who is going, for a page of events: one call each for the whole page, again when the
 * page's events change. Empty until the server has migration 69.
 */
export function useEventEngagement(eventIds: string[], userId: string | null): { ready: boolean; engagement: Record<string, PostEngagement>; going: Record<string, EventGoing> } {
  const ready = useEventEngagementReady();
  const key = eventIds.join(",");
  const [engagement, setEngagement] = useState<Record<string, PostEngagement>>({});
  const [going, setGoing] = useState<Record<string, EventGoing>>({});
  useEffect(() => {
    if (!ready || key === "") return;
    let alive = true;
    const ids = key.split(",");
    getPostEngagementMany(supabase, "event", ids).then((e) => alive && setEngagement(e), () => {});
    getEventGoingMany(supabase, ids).then((g) => alive && setGoing(g), () => {});
    return () => {
      alive = false;
    };
  }, [ready, key, userId]);
  return { ready, engagement, going };
}

// --- Going, shared by a card and the event's page --------------------------------------------------------------------

const goingNow = new Map<string, EventGoing>();
const goingListeners = new Set<(eventId: string, state: EventGoing) => void>();
function publishGoing(eventId: string, state: EventGoing) {
  goingNow.set(eventId, state);
  for (const l of goingListeners) l(eventId, state);
}

/**
 * The Going button: how many are going and whether you are, flipped at once and sent to the server (taken back with
 * the reason if refused). A card and the event's page show the same answer: a change on one reaches the other.
 */
export function useGoing(eventId: string, initial: EventGoing | undefined, userId: string | null, onNeedLogin: () => void) {
  const [state, setState] = useState<EventGoing>(() => goingNow.get(eventId) ?? initial ?? { going: 0, goingByMe: false });
  useEffect(() => {
    if (initial && !goingNow.has(eventId)) setState(initial);
  }, [initial, eventId]);
  useEffect(() => {
    const l = (id: string, next: EventGoing) => id === eventId && setState(next);
    goingListeners.add(l);
    return () => void goingListeners.delete(l);
  }, [eventId]);
  const toggle = useCallback(async () => {
    if (!userId) return onNeedLogin();
    const before = goingNow.get(eventId) ?? state;
    const next: EventGoing = { going: Math.max(0, before.going + (before.goingByMe ? -1 : 1)), goingByMe: !before.goingByMe };
    if (next.goingByMe) hapticLike();
    else hapticSelect();
    publishGoing(eventId, next);
    try {
      await setEventGoing(supabase, userId, eventId, next.goingByMe);
    } catch (e) {
      publishGoing(eventId, before);
      alertWithHaptic("error", "Could not update", errorText(e));
    }
  }, [eventId, onNeedLogin, state, userId]);
  return useMemo(() => ({ ...state, toggle }), [state, toggle]);
}

/** The system's share sheet with the event's page on the website; a share counts toward the ranking (record_event_click). */
export async function shareEvent(event: { id: string; title: string }, userId: string | null): Promise<void> {
  const url = `${SITE_URL}${eventPath(event.id)}`;
  try {
    await Share.share(Platform.OS === "ios" ? { url, message: event.title } : { message: `${event.title}\n${url}` });
    if (userId) void recordEventClick(supabase, event.id, "share");
  } catch {
    // The sheet was dismissed.
  }
}
