import type { Story } from "./stories";
import type { FeedMedia, FeedPostWithAuthor, Reel, SavedTargetType, SharedPost, SharedPostKind } from "./types/models";

const KINDS: SharedPostKind[] = ["post", "reel", "listing"];
const TARGETS = ["post", "apartment", "roommate", "item", "story"] as const;
// A story has no page on the website: its path is what the database's card check expects, and the app opens it in the
// story viewer (see isStoryCard).
const BASES: Record<SharedPost["target_type"], string> = { post: "/posts", apartment: "/apartments", roommate: "/roommates", item: "/marketplace", story: "/stories" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A regex rather than `new URL`: React Native's URL does not implement `protocol`.
const HTTPS = /^https:\/\/[^\s/?#]+[^\s]*$/i;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const https = (v: unknown): string | null => {
  const s = str(v);
  return s && HTTPS.test(s) ? s : null;
};

/**
 * Whether posts of this kind have a public comment thread. Roommate posts and Marketplace items do not: their posters
 * are reached in private, through the Inbox button (Message on the listing), so they show no comments anywhere (the
 * listing, the Roommate and Marketplace feeds, a roommate video tour in Reels, the website). Posts, reels and apartments
 * keep theirs, and Buzz keeps its anonymous replies.
 */
export function hasPublicComments(targetType: string): boolean {
  return targetType !== "roommate" && targetType !== "item";
}

/**
 * The poster of an anonymous listing, wherever a listing names one (its card, a shared card, the chat with them): a
 * name and nothing else (20261105000000_anonymous_listings.sql). Pass "" as the poster's name to listingChatPrefill.
 */
export const ANONYMOUS_POSTER: { id: string; name: string; avatar_url: string | null } = { id: "", name: "Anonymous", avatar_url: null };

/** The first message a chat opened from someone's listing starts with: "Hi Maya! I saw your post "…" and I'd like to chat." */
export function listingChatPrefill(posterName: string, title?: string | null): string {
  const first = posterName.trim().split(/\s+/)[0] || "there";
  return title ? `Hi ${first}! I saw your post "${title}" and I'd like to chat.` : `Hi ${first}! I saw your post and I'd like to chat.`;
}

/** Where the shared thing lives on the website, always rebuilt from its type and id: a stored path is never trusted. */
export function sharedPostPath(shared: Pick<SharedPost, "target_type" | "target_id">): string {
  return `${BASES[shared.target_type]}/${shared.target_id}`;
}

/**
 * The snapshot stored on a message, if it is one. Anything malformed (old rows, hand-made JSON) reads as "no share".
 * Anyone in a chat can write this JSON, so nothing in it is taken on trust: the link is rebuilt from the type and id,
 * the id must be a UUID, and pictures are kept only when they are https URLs.
 */
export function sharedPostOf(value: unknown): SharedPost | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const target_type = str(v.target_type);
  const target_id = str(v.target_id);
  if (!target_type || !target_id || !(TARGETS as readonly string[]).includes(target_type) || !UUID.test(target_id)) return null;
  const type = target_type as SharedPost["target_type"];
  const stated = str(v.kind);
  // A story is shared or answered; a listing is always a listing; a post is a post or a reel.
  const kind: SharedPostKind =
    type === "story" ? (stated === "story_reply" ? "story_reply" : "story") : type !== "post" ? "listing" : stated === "reel" ? "reel" : stated && (KINDS as string[]).includes(stated) && stated !== "listing" ? (stated as SharedPostKind) : "post";
  const author = v.author && typeof v.author === "object" ? (v.author as Record<string, unknown>) : null;
  return {
    target_type: type,
    target_id,
    kind,
    path: sharedPostPath({ target_type: type, target_id }),
    title: str(v.title),
    caption: str(v.caption),
    image_url: https(v.image_url),
    author: { id: str(author?.id) ?? "", name: str(author?.name) ?? "Someone", avatar_url: https(author?.avatar_url) },
  };
}

/** The first picture, or a still from the first video, of the media a card already shows; else the post's first image. */
function firstFrame(post: Pick<FeedPostWithAuthor, "images">, media?: FeedMedia[]): string | null {
  for (const m of media ?? []) {
    if (m.type === "photo") return m.url;
    if (m.type === "video" && m.poster) return m.poster;
  }
  return post.images?.[0] ?? null;
}

/** A post or reel from the feed, as it will appear in the chat. Pass the card's media so a video post gets its poster. */
export function sharedPostFromFeedPost(post: FeedPostWithAuthor, media?: FeedMedia[]): SharedPost {
  return {
    target_type: "post",
    target_id: post.id,
    kind: post.kind === "reel" ? "reel" : "post",
    path: sharedPostPath({ target_type: "post", target_id: post.id }),
    title: post.title?.trim() ? post.title.trim() : null,
    caption: post.body?.trim() ? post.body.trim() : null,
    image_url: firstFrame(post, media),
    author: { id: post.author.id, name: post.author.full_name, avatar_url: post.author.avatar_url },
  };
}

/** An item of the Reels feed: a posted reel, or a listing's video tour (which opens the listing). */
export function sharedPostFromReel(reel: Reel): SharedPost {
  const listing = reel.sourceType !== "post";
  return {
    target_type: reel.sourceType,
    target_id: reel.sourceId,
    kind: listing ? "listing" : "reel",
    path: sharedPostPath({ target_type: reel.sourceType, target_id: reel.sourceId }),
    title: reel.title,
    caption: reel.caption?.trim() ? reel.caption.trim() : null,
    image_url: reel.video.poster_url ?? null,
    author: { id: reel.author.id, name: reel.author.name, avatar_url: reel.author.avatarUrl },
  };
}

/** An apartment, roommate or marketplace listing from its detail page. */
export function sharedPostFromListing(input: { targetType: SavedTargetType; targetId: string; title: string; caption?: string | null; imageUrl?: string | null; author: { id: string; name: string; avatar_url: string | null } }): SharedPost {
  return {
    target_type: input.targetType,
    target_id: input.targetId,
    kind: "listing",
    path: sharedPostPath({ target_type: input.targetType, target_id: input.targetId }),
    title: input.title,
    caption: input.caption?.trim() ? input.caption.trim() : null,
    image_url: input.imageUrl ?? null,
    author: input.author,
  };
}

/**
 * Someone's story as a card in a chat (migration 62): shared with friends (`reply` false) or answering the story in the
 * author's chat. The database rewrites the picture and the author from the story itself and refuses it for anyone who
 * may not see the story; what is sent here is only what the chat shows while the message is on its way.
 */
export function sharedPostFromStory(story: Pick<Story, "id" | "author" | "photo" | "video">, reply = false): SharedPost {
  return {
    target_type: "story",
    target_id: story.id,
    kind: reply ? "story_reply" : "story",
    path: sharedPostPath({ target_type: "story", target_id: story.id }),
    title: null,
    caption: null,
    image_url: story.photo?.url ?? story.video?.poster_url ?? null,
    author: { id: story.author.id, name: story.author.full_name, avatar_url: story.author.avatar_url },
  };
}

/** A story card: it opens the story viewer while the story lasts, and points nowhere on the website. */
export function isStoryCard(shared: Pick<SharedPost, "target_type">): boolean {
  return shared.target_type === "story";
}

const PREVIEWS: Record<SharedPostKind, string> = { post: "Sent a post", reel: "Sent a reel", listing: "Sent a listing", story: "Sent a story", story_reply: "Replied to a story" };
const LABELS: Record<SharedPostKind, string> = { post: "View post", reel: "View reel", listing: "View listing", story: "View story", story_reply: "Replied to a story" };

/** The inbox line for a share without words; the same text the database writes into last_message_preview. */
export function sharedPostPreview(shared: Pick<SharedPost, "kind">): string {
  return PREVIEWS[shared.kind] ?? PREVIEWS.post;
}

/** The card's footer: what tapping it opens (a story reply says what it is: the story was the author's own). */
export function sharedPostLabel(shared: Pick<SharedPost, "kind">): string {
  return LABELS[shared.kind] ?? LABELS.post;
}

/** What a story's like, reply or share reads while the database lacks migration 62 (story_likes, the story card). */
export const STORY_ACTIONS_NOT_READY = "Likes, replies and sharing for stories need the latest server update. Try again once it's out.";

/** The word for what a card carries, as the database's own refusals use it ("can't see this story"). */
export function sharedPostNoun(shared: Pick<SharedPost, "target_type" | "kind">): string {
  if (shared.target_type === "story") return "story";
  return shared.kind === "reel" ? "reel" : shared.kind === "listing" ? "listing" : "post";
}

/**
 * Why a card did not reach one chat, read from the database's answer rather than guessed:
 *   * "audience": someone in that chat may not see it (guard_message_story_card, migration 62; migrations 45 and 47 for
 *     posts and listings). The people who may not see it are never named by the database, so the chat is.
 *   * "gone": the story expired, was deleted, or its author and the sender are blocked either way.
 *   * "not_ready": a story card on a database without migration 62 (its card check, or no story_likes).
 *   * "other": anything else (no network, a rate limit), with the error's own words.
 */
export type ShareFailureKind = "audience" | "gone" | "not_ready" | "other";
export type ShareFailure = { kind: ShareFailureKind; message: string };

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
const errorCode = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? "");
const errorWords = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : String((e as { message?: unknown } | null)?.message ?? ""));

export function shareFailureOf(error: unknown, shared: Pick<SharedPost, "target_type">): ShareFailure {
  const message = errorWords(error).trim();
  if (/can['’]t see this/i.test(message)) return { kind: "audience", message };
  if (/no longer available/i.test(message)) return { kind: "gone", message };
  if (shared.target_type === "story" && (MISSING_TABLE.has(errorCode(error)) || (errorCode(error) === "23514" && message.includes("messages_shared_post_check")))) {
    return { kind: "not_ready", message: STORY_ACTIONS_NOT_READY };
  }
  return { kind: "other", message: message || "Check your connection and try again." };
}

/** A chat a card was sent to: a friend (a direct chat) or a group, by the name the sheet showed. */
export type ShareTarget = { name: string; group: boolean };

/**
 * The words under "Could not send to …": one line per reason, naming who or which group, so a refusal for privacy is
 * never mistaken for a network failure (or the other way round). `noun` is sharedPostNoun's word.
 */
export function shareFailureSummary(failures: readonly (ShareTarget & ShareFailure)[], noun: string): string {
  const lines: string[] = [];
  const list = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  const people = failures.filter((f) => f.kind === "audience" && !f.group).map((f) => f.name);
  const groups = failures.filter((f) => f.kind === "audience" && f.group).map((f) => f.name);
  if (people.length) lines.push(`${list(people)} can't see this ${noun}.`);
  if (groups.length) lines.push(`Some people in ${list(groups)} can't see this ${noun}.`);
  if (failures.some((f) => f.kind === "gone")) lines.push(`This ${noun} is no longer available.`);
  if (failures.some((f) => f.kind === "not_ready")) lines.push(STORY_ACTIONS_NOT_READY);
  const other = failures.filter((f) => f.kind === "other");
  if (other.length) lines.push(`${list(other.map((f) => f.name))}: ${other[0].message}`);
  return lines.join("\n");
}
