// Stories (migration 58): one photo or video shared for 24 hours, shown as rings at the top of Home and full screen when
// tapped. The rules of who sees one are the database's (the audience, the expiry, blocks); this file orders what the
// database sent and times the viewer.
import type { PostAudience } from "./constants";
import type { ListingVideo, PhotoMeta } from "./types/models";

/** How long a story lives (the database's expiry; shown nowhere, kept for the copy). */
export const STORY_HOURS = 24;
/** A photo shows for this long before the viewer moves on. */
export const STORY_PHOTO_MS = 5000;
/** A video plays for at most this long as a story (Instagram's limit); a longer one is cut there. */
export const STORY_VIDEO_MAX_SECONDS = 60;
/** The width of the ring round a story's avatar, and the gap inside it. */
export const STORY_RING = 2.5;
export const STORY_RING_GAP = 2.5;

export type StoryAuthor = { id: string; full_name: string; avatar_url: string | null };

export type Story = {
  id: string;
  author: StoryAuthor;
  kind: "photo" | "video";
  photo: PhotoMeta | null;
  video: ListingVideo | null;
  audience: PostAudience;
  createdAt: string;
  expiresAt: string;
  /** Whether the person looking has seen it (always false for their own). */
  seen: boolean;
  /** How many people have seen it: the author's own count; 0 for anyone else's story (the database tells them only about themselves). */
  views: number;
  /** Whether the person looking has liked it (migration 62; always false for their own, and before 62). */
  liked: boolean;
  /** How many people have liked it: the author's own count, like `views`; 0 for anyone else's story. */
  likes: number;
};

/** One person's stories in the tray, oldest first, as Instagram plays them. */
export type StoryGroup = {
  author: StoryAuthor;
  stories: Story[];
  mine: boolean;
  /** Every story seen: a grey ring; else the coloured ring. */
  seen: boolean;
  /** Where the viewer starts: the first story not yet seen, or the first when all are. */
  startAt: number;
  latestAt: string;
};

/**
 * The tray's order, Instagram's: your own first, then people with something you have not seen (newest story first),
 * then the people whose stories you have all seen (newest first). Within a person, oldest story first. A story past its
 * 24 hours is left out: the database stops sending it, and this drops one that expires while the app stays open.
 */
export function groupStories(stories: readonly Story[], meId: string | null, now: number = Date.now()): StoryGroup[] {
  const byAuthor = new Map<string, Story[]>();
  for (const s of stories) {
    if (Date.parse(s.expiresAt) <= now) continue;
    const list = byAuthor.get(s.author.id);
    if (list) list.push(s);
    else byAuthor.set(s.author.id, [s]);
  }
  const groups: StoryGroup[] = [];
  for (const list of byAuthor.values()) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const mine = sorted[0]!.author.id === meId;
    const firstUnseen = mine ? -1 : sorted.findIndex((s) => !s.seen);
    groups.push({
      author: sorted[0]!.author,
      stories: sorted,
      mine,
      seen: !mine && firstUnseen < 0,
      startAt: firstUnseen < 0 ? 0 : firstUnseen,
      latestAt: sorted[sorted.length - 1]!.createdAt,
    });
  }
  const rank = (g: StoryGroup) => (g.mine ? 0 : g.seen ? 2 : 1);
  return groups.sort((a, b) => rank(a) - rank(b) || b.latestAt.localeCompare(a.latestAt));
}

/** How long a story stays on screen: a photo's fixed time; a video for its length, up to the limit. */
export function storyDurationMs(story: Pick<Story, "kind" | "video">): number {
  if (story.kind !== "video") return STORY_PHOTO_MS;
  const seconds = story.video?.duration_seconds ?? STORY_VIDEO_MAX_SECONDS;
  return Math.round(Math.min(STORY_VIDEO_MAX_SECONDS, Math.max(1, seconds)) * 1000);
}

/** The group after `index` with something unseen, else the next group, else null (the viewer closes). */
export function nextStoryGroup(groups: readonly StoryGroup[], index: number): number | null {
  return index + 1 < groups.length ? index + 1 : null;
}

/** "2h", "35m", "now": how long ago a story was shared, as the viewer's header shows it. */
export function storyAge(createdAt: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

/** The few words after a story's age in the viewer's header: who it was shared with, said only when it is not everyone. */
export function storyAudienceNote(audience: PostAudience): string | null {
  return audience === "campus" ? "Campus" : audience === "friends" ? "Friends" : audience === "selected" ? "Selected people" : null;
}

/** The viewer's action bar: a 44-point row (the reply pill, the heart, the paper plane) with 8 points above and below. */
export const STORY_ACTION_BAR = 60;
/** How much of a whole 9:16 picture a screen must leave room for, beside the bar, for the story to sit in a card. */
const FRAME_MIN = 0.94;

/**
 * Where the viewer puts a story on a screen `width` × `height` with these safe-area insets. On a tall phone, as iOS's own
 * viewers and Instagram's do, the story is a rounded 9:16 card from just under the status bar, and the action bar sits
 * below it on black: the actions never lie over the picture (always legible), and a tap that misses one never lands on
 * the story. A shorter screen (an iPhone SE) has no room for that: the story fills the screen (`framed` false, from the
 * top edge) and the bar floats over a deeper shade. The card is never taller than 9:16 nor than the room above the bar.
 */
export function storyFrame(width: number, height: number, insetTop: number, insetBottom: number): { framed: boolean; top: number; height: number } {
  const whole = (width * 16) / 9;
  const room = height - insetTop - insetBottom - STORY_ACTION_BAR;
  if (room >= whole * FRAME_MIN) return { framed: true, top: insetTop, height: Math.min(whole, room) };
  return { framed: false, top: 0, height };
}

/**
 * What a heart's requests came to: `value` is what the database now holds, `attempted` the heart the last request tried
 * to set (a like or an unlike, for the error's title), `error` why it failed (null when nothing did).
 */
export type LikeSyncOutcome = { value: boolean; error: unknown | null; attempted: boolean };

/**
 * The story heart's requests, one at a time and the last tap winning. Two quick taps (like, unlike) would otherwise be
 * two requests racing, and the like arriving last would leave a filled heart in the database under an empty one on
 * screen. `set` records what the person wants now; while a request is out, later taps only change what is wanted, and
 * when it returns the next request (if any) brings the database to it. The caller that started the run gets its
 * outcome (what the database holds at the end, and the error that stopped it); taps that joined a running request get
 * null, so a failure is reported once. `saved` is what the database held when the viewer opened.
 */
export function createLikeSync(send: (liked: boolean) => Promise<void>, saved: boolean): { set: (liked: boolean) => Promise<LikeSyncOutcome | null>; wanted: () => boolean } {
  let held = saved;
  let wanted = saved;
  let running = false;
  return {
    wanted: () => wanted,
    async set(liked) {
      wanted = liked;
      if (running) return null;
      running = true;
      try {
        while (held !== wanted) {
          const next = wanted;
          try {
            await send(next);
            held = next;
          } catch (error) {
            wanted = held;
            return { value: held, error, attempted: next };
          }
        }
        return { value: held, error: null, attempted: held };
      } finally {
        running = false;
      }
    },
  };
}
