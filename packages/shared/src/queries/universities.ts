import { TrustSafetyError } from "../trust-safety";
import type { Client, University } from "../types/models";

export async function listUniversities(supabase: Client): Promise<University[]> {
  const { data, error } = await supabase.from("universities").select("*").order("name");
  if (error) throw error;
  return data;
}

/**
 * A campus's time zone (migration 61), for showing its events on its own clock; null when the campus is unknown or the
 * database predates the column (callers then use the device's zone).
 */
export async function getUniversityTimeZone(supabase: Client, universityId: string | null | undefined): Promise<string | null> {
  if (!universityId) return null;
  const { data, error } = await supabase.from("universities").select("timezone").eq("id", universityId).maybeSingle();
  if (error || !data) return null;
  return (data as { timezone?: string | null }).timezone ?? null;
}

/** A student's request for a university missing from the list (migration 70), as the student sees it. */
export type UniversityRequest = {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  note: string | null;
  status: "pending" | "approved" | "declined";
  universityId: string | null;
  universityName: string | null;
  /** What the UniBuzz team wrote back, if anything. */
  response: string | null;
  createdAt: number;
  decidedAt: number | null;
};

/**
 * Ask the UniBuzz team to add a missing university (migration 70). Students cannot add one themselves: the list
 * decides who may sign up, so the team reviews each request in CampConnect Admin. The database refuses an unconfirmed,
 * business or suspended account, a name already listed, a second request for the same name, more than 3 waiting and
 * more than 5 a day, with a message written for people ('ts:<code>:<message>').
 */
export async function requestUniversity(
  supabase: Client,
  input: { name: string; city?: string | null; country?: string | null; note?: string | null },
): Promise<UniversityRequest> {
  const { data, error } = await supabase.rpc("request_university", {
    p_name: input.name,
    p_city: input.city ?? null,
    p_country: input.country ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw readable(error);
  return data as unknown as UniversityRequest;
}

/** The database's 'ts:<code>:<message>' as a TrustSafetyError whose message is written for people. */
function readable(error: { message: string }): TrustSafetyError {
  const m = /ts:([a-z_]+):([\s\S]*)$/.exec(error.message);
  return m ? new TrustSafetyError(m[1]!, m[2]!.trim()) : new TrustSafetyError("unknown", error.message || "Something went wrong. Try again.");
}

/** The signed-in student's own university requests, newest first (the last 20). */
export async function listMyUniversityRequests(supabase: Client): Promise<UniversityRequest[]> {
  const { data, error } = await supabase.rpc("my_university_requests");
  if (error) throw readable(error);
  return (data ?? []) as unknown as UniversityRequest[];
}

/** Email domains that are allowed to sign up (e.g. ["txstate.edu"]). */
export async function getAllowedEmailDomains(supabase: Client): Promise<string[]> {
  const { data, error } = await supabase.rpc("allowed_email_domains");
  if (error) throw error;
  return (data ?? []) as string[];
}

/** Which university a sign-up email belongs to, or null if the domain is not allowed. */
export async function universityIdForEmail(supabase: Client, email: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("university_for_email", { p_email: email });
  if (error) throw error;
  return data ?? null;
}
