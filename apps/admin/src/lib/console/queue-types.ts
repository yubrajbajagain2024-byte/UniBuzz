/**
 * The review queue's payloads (Trust & Safety, migration 20261103000000_trust_safety.sql: console_queue,
 * console_queue_item, console_act, console_bulk, console_unmask), as the website's console reads them
 * (apps/web/src/lib/staff/types.ts). They stay in the staff apps: no staff payload type is bundled into the app.
 *
 * FIREWALL (UniVerse SPEC 4.2.14): a queue item has no author, reporter or user field of any kind, for any content
 * type. Buzz content is shown with a blind, bucketed author standing; only `UnmaskResponse` ever names a Buzz author,
 * and the portal keeps it in component state for five minutes, never in a cache.
 */
import type { ModerationCategory } from "@apartment-book/shared";
import type { StaffSanctionRow } from "./ops-types";

/** Trust & Safety's own roles: an owner and an admin are both 'admin' there (migration 72's ts_role_of). */
export type QueueRole = "moderator" | "admin";

export type QueueView = "priority" | "wellbeing" | "held" | "auto_hidden" | "reports" | "escalated" | "appeals" | "mine" | "closed";
export type ModerationPriority = "p0" | "p1" | "p2" | "p3";
export type ModerationSeverity = "none" | "low" | "medium" | "high" | "critical";
export type ContentStatus = "active" | "held" | "hidden" | "removed" | "deleted";
export type QueueSource = "rule_flag" | "rule_block_escalation" | "ai_flag" | "user_report" | "community_score" | "appeal" | "system";
/** Content types: Buzz ('buzz', 'buzz_reply') is anonymous; the rest are public ('story' since migration 62). */
export type StaffEntityType = "buzz" | "buzz_reply" | "post" | "comment" | "apartment" | "item" | "roommate" | "profile" | "message" | "story";

export interface StaffQueueItem {
  id: string;
  entityType: StaffEntityType;
  /** null for a blocked write (it never became content; its text is the excerpt). */
  entityId: string | null;
  surface: string;
  /** Buzz content: shown blind. */
  anon: boolean;
  universityShortName: string;
  source: QueueSource;
  category: ModerationCategory | null;
  severity: ModerationSeverity;
  priority: ModerationPriority;
  label: string | null;
  status: "open" | "claimed" | "escalated" | "closed";
  resolution: string | null;
  reportCount: number;
  appealId: string | null;
  /** ≤ 140 characters of the content (or the blocked text). */
  excerpt: string;
  contentStatus: ContentStatus | null;
  claimedByMe: boolean;
  claimedByOther: boolean;
  /** Epoch ms (Buzz items: cut to the minute). */
  slaDueAt: number;
  createdAt: number;
  closedAt: number | null;
}

export interface StaffUserSummary {
  id: string;
  fullName: string;
  username: string | null;
  avatarUrl: string | null;
}

/** Public content only. */
export interface StaffAuthorPanel {
  kind: "public";
  user: StaffUserSummary;
  accountAgeDays: number;
  strikePoints: number;
  sanctions: StaffSanctionRow[];
}

/** Buzz content (and anything without a known author): bucketed, no identifier of any kind. */
export interface StaffBlindAuthorPanel {
  kind: "blind";
  accountAge: "<24h" | "<7d" | "<30d" | "30d+";
  strikePoints: string;
  priorByCategory: Record<string, string>;
  sanction: string | null;
  otherOpenItems: string;
}

export interface StaffMatchSignals {
  evasion?: boolean;
  invisibleChars?: number;
  homoglyphs?: number;
  urls?: number;
  mentions?: number;
  capsRatio?: number;
  hasFullName?: boolean;
}

export type StaffActionId =
  | "approve" | "dismiss_reports" | "warn_only" | "remove" | "remove_and_warn" | "remove_and_mute_24h" | "remove_and_mute_72h"
  | "remove_and_mute_7d" | "lock_thread" | "unlock_thread" | "escalate" | "restore" | "suspend_7d" | "suspend_30d" | "ban"
  | "lift_sanction" | "escalate_external";

export type BulkActionId = Extract<StaffActionId, "approve" | "remove" | "dismiss_reports">;

export interface StaffQueueItemDetail extends StaffQueueItem {
  fields: { field: string; text: string; spans: [number, number][] }[];
  media: { url: string; kind: "image" | "video" }[];
  href: string | null;
  ruleHits: { ruleId: string; category: ModerationCategory | null; subcode: string | null; severity: ModerationSeverity | null }[];
  signals: StaffMatchSignals | null;
  aiVerdict: unknown;
  /** Buzz: the thread through the blind serializer ({ root, parents, siblings, … }). */
  context: unknown;
  reports: {
    id: string;
    reason: string;
    subReason: string | null;
    note: string | null;
    reporterTrust: "high" | "normal" | "low";
    /** Admins, public content only (audited). Never on Buzz. */
    reporter: StaffUserSummary | null;
    createdAt: number;
  }[];
  history: { action: string; actorRole: "moderator" | "admin" | "campus_admin" | "system"; actorName: string | null; note: string | null; createdAt: number }[];
  author: StaffAuthorPanel | StaffBlindAuthorPanel;
  suggestion: { action: StaffActionId; reason: string } | null;
  /** Buzz threads: whether replies are locked (when the thread context says). */
  locked: boolean | null;
  legalHold: boolean;
  /** Admins: the outside reference of an external escalation. */
  reference: string | null;
  canUnmask: boolean;
}

export interface BulkActionResult {
  results: { id: string; ok: boolean; error?: string }[];
  batchId: string;
}

export type UnmaskReasonCode = "credible_threat" | "self_harm_emergency" | "child_safety" | "severe_repeat_harassment" | "legal_request" | "ban_evasion";

export interface UnmaskResponse {
  /** The buzz_unmask audit row. */
  auditId: string;
  /** Epoch ms: the portal re-masks then. */
  expiresAt: number;
  user: { id: string; fullName: string; username: string | null; email: string | null; universityName: string | null; createdAt: number };
}

export interface QueueFilters {
  surface?: string;
  category?: string;
  source?: string;
  q?: string;
}
