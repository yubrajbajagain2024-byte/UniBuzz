"use server";

/**
 * Writes of the Moderation, Content, Support, Universities and Administration sections that go through the staff console
 * functions (migrations 41, 61 and 70): deciding an appeal, switching a rule pack, hiding, cancelling or restoring an
 * event, verifying or hiding an organization, deciding a university request. Each checks the caller here first (a
 * staff member in a session with a second factor; rule packs and university requests need an admin) and again in SQL,
 * which also writes the audit rows; these wrappers only shape the input and the answer. Arguments are whatever was
 * posted: every string is cut to its limit.
 */
import { revalidatePath } from "next/cache";
import { requireStaffAction } from "@/lib/admin";
import type { Permission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type { ConsoleUniversityRequest, RulePackState, StaffAppeal } from "./ops-types";
import { consoleRpc, toConsoleError, type ActionResult } from "./rpc";

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);

// `permission`: what the write is (lib/permissions.ts), the only way a campus admin passes (their campus is then checked
// in SQL); `admin`: owners and admins only.
async function run<T>(fn: string, args: Record<string, unknown>, opts: { admin?: boolean; permission?: Permission } = {}): Promise<ActionResult<T>> {
  const staff = await requireStaffAction({ ...(opts.admin ? { minRole: "admin" as const } : {}), ...(opts.permission ? { permission: opts.permission } : {}) });
  if (staff.error) return { ok: false, code: "forbidden", error: staff.error };
  try {
    const data = await consoleRpc<T>(await createClient(), fn, args);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    const err = toConsoleError(e);
    return { ok: false, code: err.code, error: err.message };
  }
}

export async function decideAppealAction(input: { id: string; outcome: "upheld" | "reversed" | "reduced"; note: string; reducedUntil: number | null }): Promise<ActionResult<StaffAppeal>> {
  return run<StaffAppeal>("console_decide_appeal", {
    p_id: str(input.id, 64),
    p_outcome: str(input.outcome, 20),
    p_note: str(input.note, 2000),
    p_reduced_until: typeof input.reducedUntil === "number" && Number.isFinite(input.reducedUntil) ? Math.round(input.reducedUntil) : null,
  }, { permission: "moderation.view" });
}

export async function setRulePackAction(input: { id: string; enabled: boolean; note?: string }): Promise<ActionResult<RulePackState>> {
  return run<RulePackState>("console_set_rule_pack", { p_id: str(input.id, 64), p_enabled: input.enabled === true, p_note: str(input.note ?? "", 500) || null }, { admin: true });
}

export async function setEventStatusAction(input: { id: string; status: "scheduled" | "cancelled" | "hidden"; note?: string }): Promise<ActionResult<{ id: string; status: string }>> {
  return run("events_console_set_event", { p_event: str(input.id, 64), p_status: str(input.status, 20), p_note: str(input.note ?? "", 2000) || null }, { permission: "content.view" });
}

export async function setOrganizationAction(input: { id: string; verified?: boolean | null; status?: "active" | "hidden" | null; note?: string }): Promise<ActionResult<{ id: string; verified: boolean; status: string }>> {
  return run("events_console_set_organization", {
    p_org: str(input.id, 64),
    p_verified: typeof input.verified === "boolean" ? input.verified : null,
    p_status: input.status ? str(input.status, 20) : null,
    p_note: str(input.note ?? "", 2000) || null,
  }, { permission: "content.view" });
}

/**
 * Approve (adds the university, never with an email domain: opening sign-up is the owners' separate step), link to a
 * university already listed, or decline a student's request. `response` is what the student reads.
 */
export async function decideUniversityRequestAction(input: {
  id: string;
  decision: "approve" | "link" | "decline";
  name?: string;
  city?: string;
  country?: string;
  universityId?: string | null;
  response?: string;
}): Promise<ActionResult<ConsoleUniversityRequest>> {
  return run<ConsoleUniversityRequest>(
    "console_decide_university_request",
    {
      p_id: str(input.id, 64),
      p_decision: str(input.decision, 20),
      p_name: input.decision === "approve" ? str(input.name ?? "", 160) || null : null,
      p_city: input.decision === "approve" && typeof input.city === "string" ? str(input.city, 120) : null,
      p_country: input.decision === "approve" && typeof input.country === "string" ? str(input.country, 120) : null,
      p_university: input.decision === "link" ? str(input.universityId ?? "", 64) || null : null,
      p_response: str(input.response ?? "", 1000) || null,
    },
    { admin: true },
  );
}
