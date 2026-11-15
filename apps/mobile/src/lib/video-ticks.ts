import type { VideoPlayer } from "expo-video";

type Asks = { base: number; wants: Map<symbol, number> };
const asks = new WeakMap<VideoPlayer, Asks>();

function apply(player: VideoPlayer, entry: Asks) {
  const wanted = [...entry.wants.values()];
  if (entry.base > 0) wanted.push(entry.base);
  const next = entry.wants.size > 0 ? Math.min(...wanted) : entry.base;
  try {
    if (player.timeUpdateEventInterval !== next) player.timeUpdateEventInterval = next;
  } catch {
    // The player has been released.
  }
}

/**
 * Asks `player` to report its time at least every `seconds` (expo-video's `timeUpdate`), until the returned function is
 * called. Several parts can ask at once (a video timeline, the viewer's jump to where the feed was): the player reports
 * at the shortest interval anyone wants, and once the last lets go it reports as it did before anyone asked, so a feed
 * player handed back from the viewer keeps its own rhythm (or none).
 */
export function wantTimeUpdates(player: VideoPlayer, seconds: number): () => void {
  let entry = asks.get(player);
  if (!entry) {
    let base = 0;
    try {
      base = player.timeUpdateEventInterval;
    } catch {
      // Released already: nothing to ask of it.
    }
    entry = { base, wants: new Map() };
    asks.set(player, entry);
  }
  const mine = entry;
  const token = Symbol("time-updates");
  mine.wants.set(token, seconds);
  apply(player, mine);
  return () => {
    if (!mine.wants.delete(token)) return;
    apply(player, mine);
    if (mine.wants.size === 0) asks.delete(player);
  };
}
