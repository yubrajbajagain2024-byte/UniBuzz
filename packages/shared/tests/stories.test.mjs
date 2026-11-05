// Unit tests for Stories (src/stories.ts): the tray's order (your own, then unseen, then seen; newest first; a person's
// stories oldest first), where the viewer starts in a person's stories, how long each stays on screen, and the age
// shown in the viewer's header. Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The sources import their siblings without an extension, as the bundlers resolve them; this hook adds it (as in media.test.mjs).
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) {
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const { groupStories, storyDurationMs, storyAge, nextStoryGroup, STORY_PHOTO_MS } = await import("../src/stories.ts");

const who = (id) => ({ id, full_name: id.toUpperCase(), avatar_url: null });
const story = (id, author, createdAt, extra = {}) => ({ id, author: who(author), kind: "photo", photo: { url: "x", width: 1, height: 1, blur: null }, video: null, audience: "global", createdAt, expiresAt: "2099-01-01T00:00:00Z", seen: false, views: 0, ...extra });

test("groupStories: mine first, then people with something unseen (newest first), then all-seen (newest first); each person oldest first", () => {
  const stories = [
    story("a1", "amy", "2026-10-30T10:00:00Z"),
    story("b1", "ben", "2026-10-30T12:00:00Z", { seen: true }),
    story("b2", "ben", "2026-10-30T13:00:00Z", { seen: true }),
    story("m2", "me", "2026-10-30T09:30:00Z"),
    story("m1", "me", "2026-10-30T08:00:00Z"),
    story("c1", "cat", "2026-10-30T11:00:00Z", { seen: true }),
    story("c2", "cat", "2026-10-30T14:00:00Z"),
  ];
  const groups = groupStories(stories, "me");
  assert.deepEqual(groups.map((g) => g.author.id), ["me", "cat", "amy", "ben"]);
  assert.deepEqual(groups[0].stories.map((s) => s.id), ["m1", "m2"]);
  assert.equal(groups[0].mine, true);
  assert.equal(groups[0].seen, false);
  // Cat: the first unseen story is her second, so the viewer starts there.
  assert.deepEqual([groups[1].seen, groups[1].startAt], [false, 1]);
  assert.deepEqual([groups[2].seen, groups[2].startAt], [false, 0]);
  assert.deepEqual([groups[3].seen, groups[3].startAt], [true, 0]);
});

test("groupStories: signed out (no me) nobody is mine; an empty list is an empty tray", () => {
  assert.equal(groupStories([story("a1", "amy", "2026-10-30T10:00:00Z")], null)[0].mine, false);
  assert.deepEqual(groupStories([], "me"), []);
});

test("groupStories: a story past its 24 hours is left out, and a person with none left has no ring", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const groups = groupStories([
    story("a1", "amy", "2026-10-29T11:00:00Z", { expiresAt: "2026-10-30T11:00:00Z" }),
    story("a2", "amy", "2026-10-30T10:00:00Z", { expiresAt: "2026-10-31T10:00:00Z" }),
    story("b1", "ben", "2026-10-29T12:00:00Z", { expiresAt: "2026-10-30T12:00:00Z" }),
  ], null, now);
  assert.deepEqual(groups.map((g) => [g.author.id, g.stories.map((s) => s.id)]), [["amy", ["a2"]]]);
});

test("storyDurationMs: a photo 5 s; a video its length, at least 1 s, at most 60 s", () => {
  assert.equal(storyDurationMs({ kind: "photo", video: null }), STORY_PHOTO_MS);
  assert.equal(storyDurationMs({ kind: "video", video: { duration_seconds: 12.4 } }), 12400);
  assert.equal(storyDurationMs({ kind: "video", video: { duration_seconds: 0.2 } }), 1000);
  assert.equal(storyDurationMs({ kind: "video", video: { duration_seconds: 180 } }), 60000);
  assert.equal(storyDurationMs({ kind: "video", video: { duration_seconds: null } }), 60000);
});

test("nextStoryGroup and storyAge", () => {
  const groups = groupStories([story("a1", "amy", "2026-10-30T10:00:00Z"), story("b1", "ben", "2026-10-30T11:00:00Z")], null);
  assert.equal(nextStoryGroup(groups, 0), 1);
  assert.equal(nextStoryGroup(groups, 1), null);
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(storyAge("2026-10-30T11:59:40Z", now), "now");
  assert.equal(storyAge("2026-10-30T11:25:00Z", now), "35m");
  assert.equal(storyAge("2026-10-30T09:10:00Z", now), "2h");
});

test("storyFrame: a card under the status bar with the bar below it where a 9:16 story fits; full screen where it does not", async () => {
  const { storyFrame, STORY_ACTION_BAR } = await import("../src/stories.ts");
  // iPhone 17 Pro (402 × 874, insets 62 and 34): the whole 9:16 picture, the bar under it.
  const pro = storyFrame(402, 874, 62, 34);
  assert.equal(pro.framed, true);
  assert.equal(pro.top, 62);
  assert.ok(Math.abs(pro.height - (402 * 16) / 9) < 0.01, `${pro.height}`);
  assert.ok(pro.top + pro.height <= 874 - 34 - STORY_ACTION_BAR, "the card runs into the bar");
  // iPhone 16e (390 × 844, insets 47 and 34): framed too.
  assert.equal(storyFrame(390, 844, 47, 34).framed, true);
  // A screen a little short of the whole picture still frames it, cropped a touch (never taller than the room).
  const tight = storyFrame(390, 820, 47, 34);
  assert.equal(tight.framed, true);
  assert.equal(tight.height, 820 - 47 - 34 - STORY_ACTION_BAR);
  // iPhone SE (375 × 667, insets 20 and 0): no room, so the story fills the screen from the top edge.
  assert.deepEqual(storyFrame(375, 667, 20, 0), { framed: false, top: 0, height: 667 });
});

test("storyAudienceNote: said for campus, friends and selected stories, nothing for global ones", async () => {
  const { storyAudienceNote } = await import("../src/stories.ts");
  assert.equal(storyAudienceNote("global"), null);
  assert.equal(storyAudienceNote("campus"), "Campus");
  assert.equal(storyAudienceNote("friends"), "Friends");
  assert.equal(storyAudienceNote("selected"), "Selected people");
});
