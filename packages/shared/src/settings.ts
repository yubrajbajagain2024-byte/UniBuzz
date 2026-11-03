import type { ProfileVisibility } from "./types/models";

/**
 * The app's Settings, beyond the screens: the graduation year a person may type, the university picker's search and its
 * rule for which universities can be chosen, and the columns a settings patch writes (updateProfileSettings). Pure, so
 * the website could share it and it is tested offline (tests/settings.test.mjs).
 */

/** The years the database takes for a graduation year (as the website's form does). */
export const FIRST_GRADUATION_YEAR = 2000;
export const LAST_GRADUATION_YEAR = 2100;
export const GRADUATION_YEAR_PROBLEM = `Enter a year from ${FIRST_GRADUATION_YEAR} to ${LAST_GRADUATION_YEAR}, like 2028.`;

/** The year typed, as the database takes it: null for none, NaN for something it would refuse. */
export function parseGraduationYear(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const year = Number(t);
  return Number.isInteger(year) && year >= FIRST_GRADUATION_YEAR && year <= LAST_GRADUATION_YEAR ? year : Number.NaN;
}

/** What the picker needs of a university. */
export type PickableUniversity = { id: string; name: string; city?: string | null; email_domain?: string | null };

/** Lower case, accents and punctuation gone, spaces collapsed: "Texas A&M–Commerce" and "texas a m commerce" match. */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

/**
 * The universities matching what was typed in the picker's search: every word of the query has to start a word of the
 * name or the city, or appear in the email domain ("txst", "san marcos", "state univ"). The verified one first, then
 * those whose name starts with the query, then the rest by name. An empty query lists them all.
 */
export function matchUniversities<U extends PickableUniversity>(universities: readonly U[], query: string, verifiedId: string | null = null): U[] {
  const words = fold(query).split(" ").filter(Boolean);
  const q = words.join(" ");
  const matches = universities.filter((u) => {
    if (words.length === 0) return true;
    const nameWords = fold(`${u.name} ${u.city ?? ""}`).split(" ");
    const domain = (u.email_domain ?? "").toLowerCase();
    return words.every((w) => nameWords.some((n) => n.startsWith(w)) || (domain !== "" && domain.includes(w)));
  });
  const rank = (u: U) => (u.id === verifiedId ? 0 : q && fold(u.name).startsWith(q) ? 1 : 2);
  return [...matches].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Whether a university can be chosen, and the line under it saying why or why not. */
export type UniversityChoice = { selectable: boolean; note: string | null; verified: boolean };

/**
 * The picker's rule: a university is yours to choose only when your confirmed sign-in address is one of its (the one
 * `verifiedCampus` finds, `verifiedId`), so the university under your name stays the one your email proves. Another
 * says which address it needs, or that it is not on UniBuzz yet. An account no university verifies (a business, an
 * address not yet confirmed) chooses freely, as before, its choice marked as not verified.
 */
export function universityChoice(university: PickableUniversity, verifiedId: string | null, signInDomain: string | null = null): UniversityChoice {
  if (verifiedId === null) return { selectable: true, note: null, verified: false };
  if (university.id === verifiedId) return { selectable: true, note: signInDomain ? `Verified with your @${signInDomain} address` : "Verified with your university email", verified: true };
  const domain = university.email_domain?.trim().toLowerCase();
  return { selectable: false, note: domain ? `Needs a @${domain} address` : "Not on UniBuzz yet", verified: false };
}

/**
 * One or more of my profile's settings, and nothing else: what a Settings screen saves (a privacy choice, the nearby
 * listings switch, the university, the profile form). Unlike updateProfile, which writes every basic field (null where
 * it is not given), a key left out here leaves its column as it is, so a screen can never blank what another one saved
 * or what was changed on the website meanwhile.
 */
export type ProfileSettingsPatch = {
  fullName?: string;
  /** The @handle. The database tidies it and explains a refusal ("That username is taken."). */
  username?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  program?: string | null;
  graduationYear?: number | null;
  universityId?: string | null;
  notifyNearbyListings?: boolean;
  classesVisibility?: ProfileVisibility;
  savedVisibility?: ProfileVisibility;
  likedVisibility?: ProfileVisibility;
  /** A database before migration 37 has no such column. */
  listingsVisibility?: ProfileVisibility;
};

const PATCH_COLUMNS: Record<keyof ProfileSettingsPatch, string> = {
  fullName: "full_name",
  username: "username",
  bio: "bio",
  avatarUrl: "avatar_url",
  program: "program",
  graduationYear: "graduation_year",
  universityId: "university_id",
  notifyNearbyListings: "notify_nearby_listings",
  classesVisibility: "classes_visibility",
  savedVisibility: "saved_visibility",
  likedVisibility: "liked_visibility",
  listingsVisibility: "listings_visibility",
};

/** The columns a patch writes: only its keys that are set (undefined is left out; null clears). */
export function profileSettingsColumns(patch: ProfileSettingsPatch): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const key of Object.keys(PATCH_COLUMNS) as (keyof ProfileSettingsPatch)[]) {
    if (patch[key] !== undefined) columns[PATCH_COLUMNS[key]] = patch[key];
  }
  return columns;
}
