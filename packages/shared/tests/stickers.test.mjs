// Unit tests for stickers in chats (src/stickers.ts): which messages draw large, without a bubble. Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { JUMBO_EMOJI_MAX, STICKER_SETS, jumboEmoji } from "../src/stickers.ts";

test("jumboEmoji: one to three emoji, and nothing else, count", () => {
  assert.equal(jumboEmoji("😂"), 1);
  assert.equal(jumboEmoji("🔥🔥"), 2);
  assert.equal(jumboEmoji("👏 👏 👏"), 3, "spaces between them are fine");
  assert.equal(jumboEmoji("  🎓\n"), 1, "around them too");
});

test("jumboEmoji: emoji drawn as one count as one", () => {
  assert.equal(jumboEmoji("❤️"), 1, "with its variation selector");
  assert.equal(jumboEmoji("👍🏽"), 1, "with a skin tone");
  assert.equal(jumboEmoji("👩‍💻"), 1, "joined");
  assert.equal(jumboEmoji("👨‍👩‍👧‍👦"), 1, "a whole family");
  assert.equal(jumboEmoji("😮‍💨"), 1, "a joined face");
  assert.equal(jumboEmoji("🇺🇸"), 1, "a flag");
  assert.equal(jumboEmoji("🏴󠁧󠁢󠁳󠁣󠁴󠁿"), 1, "a subdivision flag");
  assert.equal(jumboEmoji("1️⃣"), 1, "a keycap");
  assert.equal(jumboEmoji("☕️🍕🎉"), 3);
});

test("jumboEmoji: words, more than three, or nothing are not stickers", () => {
  assert.equal(jumboEmoji("lol 😂"), 0);
  assert.equal(jumboEmoji("😂!"), 0);
  assert.equal(jumboEmoji("1"), 0, "a digit alone is a word");
  assert.equal(jumboEmoji("→"), 0, "an arrow is a text symbol");
  assert.equal(jumboEmoji("🔥🔥🔥🔥"), 0, `more than ${JUMBO_EMOJI_MAX}`);
  assert.equal(jumboEmoji("🇺"), 0, "half a flag");
  assert.equal(jumboEmoji(""), 0);
  assert.equal(jumboEmoji("   "), 0);
  assert.equal(jumboEmoji(null), 0);
  assert.equal(jumboEmoji("📷 Photo"), 0, "the website's photo text");
});

test("STICKER_SETS: every sticker is a single emoji, and none repeats", () => {
  const all = STICKER_SETS.flatMap((s) => s.stickers);
  for (const sticker of all) assert.equal(jumboEmoji(sticker), 1, `${sticker} sends as one sticker`);
  assert.equal(new Set(all).size, all.length);
  assert.equal(new Set(STICKER_SETS.map((s) => s.key)).size, STICKER_SETS.length);
});
