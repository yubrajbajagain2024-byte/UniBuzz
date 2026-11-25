import { useCallback, useMemo, useState } from "react";
import type { EventGoing, EventSummary, PostEngagement } from "@apartment-book/shared";
import { CommentsSheet } from "@/components/comments-sheet";
import { useEventEngagement } from "@/lib/event-engagement";

/**
 * What a list of event cards needs for their row of buttons (migration 69): the like and comment counts and who is going
 * for the events on screen (one call each for the page), the comments sheet a card's comment button opens, and its
 * comments counted on the card at once. `engaged` is false until the server has migration 69.
 */
export function useEventCards(events: readonly EventSummary[], userId: string | null) {
  const ids = useMemo(() => events.map((e) => e.id), [events]);
  const { ready, engagement, going } = useEventEngagement(ids, userId);
  /** Comments written or deleted in the sheet since the counts were read, per event. */
  const [delta, setDelta] = useState<Record<string, number>>({});
  const [commenting, setCommenting] = useState<EventSummary | null>(null);
  const engagementOf = useCallback(
    (id: string): PostEngagement | undefined => {
      const e = engagement[id];
      const d = delta[id] ?? 0;
      return e && d !== 0 ? { ...e, comments: Math.max(0, e.comments + d) } : e;
    },
    [engagement, delta],
  );
  const goingOf = useCallback((id: string): EventGoing | undefined => going[id], [going]);
  const onComments = useCallback((event: EventSummary) => setCommenting(event), []);
  const sheet = (
    <CommentsSheet
      // An event has no owner who could delete others' comments (migration 69): nobody is its "Author".
      target={commenting ? { targetType: "event", targetId: commenting.id, ownerId: "", comments: engagementOf(commenting.id)?.comments ?? 0 } : null}
      onClose={() => setCommenting(null)}
      onCountChange={(d) => commenting && setDelta((prev) => ({ ...prev, [commenting.id]: (prev[commenting.id] ?? 0) + d }))}
    />
  );
  return { engaged: ready, engagementOf, goingOf, onComments, sheet };
}
