/**
 * Stickers in chats: emoji sent on their own as a message. Nothing new is stored for them: a sticker is a message whose
 * words are one to three emoji and nothing else (jumboEmoji), and the apps draw any such message large, without a
 * bubble, whether it was picked from the sticker sheet or typed. So every chat, every reader (the website included) and
 * every rule about messages (blocks, anonymity, reports) treats a sticker exactly as words.
 */

/** A message of at most this many emoji, and nothing else, is drawn large. */
export const JUMBO_EMOJI_MAX = 3;

/** One group of the sticker sheet. */
export type StickerSet = { key: string; title: string; stickers: readonly string[] };

/** The sticker sheet, campus first. Recently used ones are kept on the device and shown above these. */
export const STICKER_SETS: readonly StickerSet[] = [
  { key: "reactions", title: "Reactions", stickers: ["😂", "🥹", "😭", "🔥", "💯", "👏", "🙌", "😍", "🤯", "😅", "🫡", "💀", "👀", "🤝", "🙏", "❤️", "🫶", "👍", "😮‍💨", "🤭"] },
  { key: "campus", title: "Campus life", stickers: ["🎓", "📚", "✏️", "🧠", "💻", "☕️", "🍕", "🌮", "🏀", "🏈", "⚽️", "🎉", "🎧", "🚌", "🏠", "🐾", "🗓️", "📍", "🛋️", "🎒"] },
  { key: "moods", title: "Moods", stickers: ["😴", "🤔", "😎", "🥳", "😤", "🤓", "😇", "🫠", "🥲", "😌", "✨", "🌈", "☀️", "🌧️", "🌙", "⚡️", "🍀", "🎈", "🌸", "🌊"] },
];

/** Code points that draw as an emoji on their own (the pictographic blocks, without arrows and other text symbols). */
function pictographic(cp: number): boolean {
  return (
    (cp >= 0x1f000 && cp <= 0x1faff && !(cp >= 0x1f1e6 && cp <= 0x1f1ff) && !(cp >= 0x1f3fb && cp <= 0x1f3ff)) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b05 && cp <= 0x2b55) ||
    cp === 0x231a ||
    cp === 0x231b ||
    cp === 0x2328 ||
    cp === 0x23cf ||
    (cp >= 0x23e9 && cp <= 0x23f3) ||
    (cp >= 0x23f8 && cp <= 0x23fa) ||
    cp === 0x00a9 ||
    cp === 0x00ae ||
    cp === 0x203c ||
    cp === 0x2049 ||
    cp === 0x2122 ||
    cp === 0x2139 ||
    cp === 0x3030 ||
    cp === 0x303d ||
    cp === 0x3297 ||
    cp === 0x3299
  );
}
/** What may follow an emoji within the same one: variation selectors, skin tones, the keycap mark and tag letters (subdivision flags). */
function modifier(cp: number): boolean {
  return cp === 0xfe0f || cp === 0xfe0e || (cp >= 0x1f3fb && cp <= 0x1f3ff) || cp === 0x20e3 || (cp >= 0xe0020 && cp <= 0xe007f);
}
const ZWJ = 0x200d;
const regional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const keycapBase = (cp: number) => (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a;
const space = (cp: number) => cp === 0x20 || cp === 0x0a || cp === 0x09 || cp === 0x0d;

/**
 * How many emoji `text` is when it is nothing but one to JUMBO_EMOJI_MAX emoji (spaces between them allowed), else 0.
 * Joined emoji (a family, a profession with a skin tone), flags and keycaps count as one each, as they draw as one.
 */
export function jumboEmoji(text: string | null | undefined): number {
  if (!text) return 0;
  const cps = Array.from(text, (c) => c.codePointAt(0) ?? 0);
  let count = 0;
  let i = 0;
  while (i < cps.length) {
    const cp = cps[i];
    if (space(cp)) {
      i++;
      continue;
    }
    if (regional(cp)) {
      // A flag is two regional indicators.
      if (!regional(cps[i + 1] ?? 0)) return 0;
      i += 2;
    } else if (keycapBase(cp)) {
      // 1️⃣, #️⃣, *️⃣: the character, perhaps a variation selector, then the keycap mark. A plain digit is words.
      let j = i + 1;
      if (cps[j] === 0xfe0f) j++;
      if (cps[j] !== 0x20e3) return 0;
      i = j + 1;
    } else if (pictographic(cp)) {
      i++;
      for (;;) {
        while (i < cps.length && modifier(cps[i])) i++;
        if (cps[i] === ZWJ && pictographic(cps[i + 1] ?? 0)) {
          i += 2;
          continue;
        }
        break;
      }
    } else {
      return 0;
    }
    count++;
    if (count > JUMBO_EMOJI_MAX) return 0;
  }
  return count;
}
