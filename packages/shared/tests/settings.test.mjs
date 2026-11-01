import { test } from "node:test";
import assert from "node:assert/strict";

const { parseGraduationYear, matchUniversities, universityChoice, profileSettingsColumns, GRADUATION_YEAR_PROBLEM } = await import("../src/settings.ts");

const TXST = { id: "txst", name: "Texas State University", city: "San Marcos", email_domain: "txstate.edu" };
const BAYLOR = { id: "baylor", name: "Baylor University", city: "Waco", email_domain: "baylor.edu" };
const UT = { id: "ut", name: "University of Texas at Austin", city: "Austin", email_domain: null };
const AM = { id: "am", name: "Texas A&M University–Commerce", city: "Commerce", email_domain: null };
const ALL = [UT, BAYLOR, AM, TXST];

test("parseGraduationYear takes the database's years, none for empty, NaN for anything else", () => {
  assert.equal(parseGraduationYear(""), null);
  assert.equal(parseGraduationYear("  "), null);
  assert.equal(parseGraduationYear("2028"), 2028);
  assert.equal(parseGraduationYear(" 2000 "), 2000);
  assert.ok(Number.isNaN(parseGraduationYear("1999")));
  assert.ok(Number.isNaN(parseGraduationYear("2101")));
  assert.ok(Number.isNaN(parseGraduationYear("20.5")));
  assert.match(GRADUATION_YEAR_PROBLEM, /2000 to 2100/);
});

test("matchUniversities finds by the start of any word of the name or the city, or by the email domain", () => {
  const names = (q) => matchUniversities(ALL, q).map((u) => u.id);
  assert.deepEqual(names("baylor"), ["baylor"]);
  assert.deepEqual(names("san mar"), ["txst"], "the city counts");
  assert.deepEqual(names("txstate"), ["txst"], "the email domain counts");
  assert.deepEqual(names("state univ"), ["txst"], "every word has to match");
  assert.deepEqual(names("exas"), [], "a word must start, not merely contain");
  assert.deepEqual(names("TEXAS a&m commerce"), ["am"], "case, accents and punctuation are ignored");
});

test("matchUniversities lists the verified one first, then names starting with the query, then the rest by name", () => {
  assert.deepEqual(matchUniversities(ALL, "", "txst").map((u) => u.id), ["txst", "baylor", "am", "ut"]);
  assert.deepEqual(matchUniversities(ALL, "texas").map((u) => u.id), ["am", "txst", "ut"], "names starting with it first");
  assert.deepEqual(matchUniversities(ALL, "texas", "ut").map((u) => u.id), ["ut", "am", "txst"]);
});

test("universityChoice: only the university the sign-in email proves can be chosen", () => {
  assert.deepEqual(universityChoice(TXST, "txst", "txstate.edu"), { selectable: true, note: "Verified with your @txstate.edu address", verified: true });
  assert.deepEqual(universityChoice(BAYLOR, "txst", "txstate.edu"), { selectable: false, note: "Needs a @baylor.edu address", verified: false });
  assert.deepEqual(universityChoice(UT, "txst", "txstate.edu"), { selectable: false, note: "Not on UniBuzz yet", verified: false });
});

test("universityChoice: an account no university verifies still chooses, marked as not verified", () => {
  for (const u of ALL) assert.deepEqual(universityChoice(u, null), { selectable: true, note: null, verified: false });
});

test("profileSettingsColumns writes only what the patch sets: undefined is left alone, null clears", () => {
  assert.deepEqual(profileSettingsColumns({}), {});
  assert.deepEqual(profileSettingsColumns({ savedVisibility: "friends" }), { saved_visibility: "friends" });
  assert.deepEqual(profileSettingsColumns({ program: null, graduationYear: 2028, universityId: undefined }), { program: null, graduation_year: 2028 });
  assert.deepEqual(profileSettingsColumns({ fullName: "Maya Patel", username: "maya", bio: null, avatarUrl: "https://x/a.jpg" }), { full_name: "Maya Patel", username: "maya", bio: null, avatar_url: "https://x/a.jpg" });
  assert.deepEqual(profileSettingsColumns({ notifyNearbyListings: false, listingsVisibility: "private" }), { notify_nearby_listings: false, listings_visibility: "private" });
});
