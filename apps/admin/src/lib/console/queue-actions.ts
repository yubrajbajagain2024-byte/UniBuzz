"use server";

/**
 * The review queue's writes (Trust & Safety, migration 41): claiming and releasing an item, acting on one, bulk actions
 * and the unmask of a Buzz author. They are for the platform's staff: every one passes a minimum role, which a campus
 * admin never passes (lib/admin.ts), as SQL rules (ts_require_staff refuses campus admins; migration 74 left the queue
 * to the platform). Each checks the caller here first (a staff member in a session with a second factor) and again in
 * SQL, which also writes the audit rows and decides what each role may do (the ladder's admin actions, unmasking).
 * Arguments are whatever was posted: every string is cut to its limit.
 */
import { revalidatePath } from "next/cache";
import { requireStaffAction } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import type { BulkActionId, BulkActionResult, StaffActionId, StaffQueueItemDetail, UnmaskReasonCode, UnmaskResponse } from "./queue-types";
import { consoleRpc, toConsoleError, type ActionResult } from "./rpc";

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);

// `revalidate: false` for the unmask: its answer is the only place the identity travels, and nothing is cached.
async function run<T>(fn: string, args: Record<string, unknown>, opts: { admin?: boolean; revalidate?: boolean } = {}): Promise<ActionResult<T>> {
  const staff = await requireStaffAction({ minRole: opts.admin ? "admin" : "moderator", permission: "moderation.view" });
  if (staff.error) return { ok: false, code: "forbidden", error: staff.error };
  try {
    const data = await consoleRpc<T>(await createClient(), fn, args);
    if (opts.revalidate !== false) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    const err = toConsoleError(e);
    return { ok: false, code: err.code, error: err.message };
  }
}

export async function claimQueueItemAction(id: string): Promise<ActionResult<unknown>> {
  return run("console_claim", { p_id: str(id, 64) });
}

export async function releaseQueueItemAction(id: string): Promise<ActionResult<unknown>> {
  return run("console_release", { p_id: str(id, 64) });
}

export interface ActInput {
  id: string;
  action: StaffActionId;
  category: string;
  note?: string;
  confirmText?: string;
  reference?: string;
  badFaith?: boolean;
}

export async function actOnQueueItemAction(input: ActInput): Promise<ActionResult<{ status: string; resolution: string | null }>> {
  const options: Record<string, unknown> = {};
  if (input.confirmText) options.confirmText = str(input.confirmText, 20);
  if (input.reference) options.reference = str(input.reference, 200);
  if (input.badFaith) options.badFaith = true;
  const res = await run<StaffQueueItemDetail>("console_act", {
    p_id: str(input.id, 64),
    p_action: str(input.action, 40),
    p_category: str(input.category, 40),
    p_note: str(input.note ?? "", 2000) || null,
    p_sanction: options,
    p_batch: null,
  });
  return res.ok ? { ok: true, data: { status: res.data.status, resolution: res.data.resolution } } : res;
}

export async function bulkQueueAction(input: { ids: string[]; action: BulkActionId; category: string; note?: string }): Promise<ActionResult<BulkActionResult>> {
  const ids = Array.isArray(input.ids) ? input.ids.filter((x) => typeof x === "string").slice(0, 50) : [];
  return run<BulkActionResult>("console_bulk", { p_ids: ids, p_action: str(input.action, 40), p_category: str(input.category, 40), p_note: str(input.note ?? "", 2000) || null });
}

/**
 * Owners and admins only (and SQL checks it again: console_unmask, with its reason code, a written reason of 30+
 * characters and the typed word UNMASK; every unmask is audited and every other admin alerted). The identity comes
 * back in this answer and nowhere else: the portal holds it in component state until `expiresAt` (five minutes) and
 * drops it on unmount. Nothing here caches it or refreshes a page with it.
 */
export async function unmaskAuthorAction(input: {
  entityType: "buzz" | "buzz_reply";
  entityId: string;
  reasonCode: UnmaskReasonCode;
  reason: string;
  confirm: string;
  caseRef?: string;
}): Promise<ActionResult<UnmaskResponse>> {
  return run<UnmaskResponse>(
    "console_unmask",
    {
      p_entity_type: str(input.entityType, 20),
      p_entity_id: str(input.entityId, 64),
      p_reason_code: str(input.reasonCode, 40),
      p_reason: str(input.reason, 2000),
      p_confirm: str(input.confirm, 20),
      p_case_ref: str(input.caseRef ?? "", 100) || null,
    },
    { admin: true, revalidate: false },
  );
}
