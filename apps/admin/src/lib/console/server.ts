import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { roleOf, type Client, type StaffAccess } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import type { Permission } from "@/lib/permissions";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AdCounts, AdRate, AdsAnalytics, AuditFeedFilters, AuditFeedPage, AnalyticsOverview, BusinessCounts, BusinessOpsOverview, ConsoleAd, ConsoleAdRow, ConsoleBusiness, ConsoleBusinessRow,
  ConsoleEvent, ConsoleEventsCounts, ConsoleEventsFilter, ConsoleFeed, ConsoleOrganization, ConsolePage, ConsoleUniversity, PaymentsPage, QueueCounts, RevenueAnalytics,
  RulePackState, StaffAppeal, StaffPage, SystemHealth, UniversityRequestsPage, UniversityRequestStatus,
} from "./ops-types";
import { consoleRpc, toConsoleError } from "./rpc";

/**
 * Analytics and Business are for owners and admins of the staff in a session that passed two-factor sign-in (their
 * permissions in lib/permissions.ts: requireStaff sends everyone else to log in, to /no-access, to /security or back to
 * the overview).
 * Each console_* function checks the same in SQL (ts_require_admin, migration 41).
 */
export async function requireConsoleAdmin(nextPath: string, permission: Permission = "business.manage"): Promise<{ access: StaffAccess; supabase: Client }> {
  const access = await requireStaff(nextPath, { permission });
  return { access, supabase: await createClient() };
}

/**
 * Whether this admin may run businesses and ads too: migration 63's console functions (console_require_business_admin)
 * and the Business v2 functions the section reuses also ask for the UniBuzz admin role on the account (profiles.role,
 * granted by the database owner), on top of the staff role and the second factor every page already requires.
 */
export const hasBusinessRole = cache(async (): Promise<boolean> => roleOf(await getCurrentProfile()) === "admin");

/** A console function's answer; "not found" becomes the not-found page, a missing second factor the Security page. */
export async function consoleFetch<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await consoleRpc<T>(await createClient(), fn, args);
  } catch (e) {
    const code = toConsoleError(e).code;
    if (code === "not_found") notFound();
    if (code === "mfa_required") redirect("/security");
    throw e;
  }
}

/** A console function's answer, or null where the database does not have it yet (migration 63 not applied). */
export async function maybeDeployed<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (e) {
    if (toConsoleError(e).code === "not_deployed") return null;
    throw e;
  }
}

export const fetchAnalyticsOverview = (days: number, universityId: string | null) =>
  consoleFetch<AnalyticsOverview>("console_analytics_overview", { p_days: days, p_university: universityId });
export const fetchAdsAnalytics = (days: number, universityId: string | null) =>
  consoleFetch<AdsAnalytics>("console_analytics_ads", { p_days: days, p_university: universityId });
export const fetchRevenueAnalytics = (days: number) => consoleFetch<RevenueAnalytics>("console_analytics_revenue", { p_days: days });

export const fetchBusinessOpsOverview = cache(() => consoleFetch<BusinessOpsOverview>("console_business_overview"));
export const fetchConsoleBusinesses = (q: string, status: string | null, offset: number, limit: number) =>
  consoleFetch<ConsolePage<ConsoleBusinessRow, BusinessCounts>>("console_businesses", { p_q: q || null, p_status: status, p_limit: limit, p_offset: offset });
export const fetchConsoleBusiness = (id: string) => consoleFetch<ConsoleBusiness>("console_business", { p_id: id });
export const fetchConsoleAds = (status: string, q: string, businessId: string | null, offset: number, limit: number) =>
  consoleFetch<ConsolePage<ConsoleAdRow, AdCounts>>("console_ads", { p_status: status, p_q: q || null, p_business: businessId, p_limit: limit, p_offset: offset });
export const fetchConsoleAd = (id: string) => consoleFetch<ConsoleAd>("console_ad", { p_id: id });
export const fetchConsolePayments = (days: number | null, status: string | null, q: string, offset: number, limit: number) =>
  consoleFetch<PaymentsPage>("console_payments", { p_days: days, p_status: status, p_q: q || null, p_limit: limit, p_offset: offset });
export const fetchAdRates = () => consoleFetch<AdRate[]>("console_ad_rates");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Route params that cannot be an id are simply not found. */
export function requireUuid(id: string): string {
  if (!UUID.test(id)) notFound();
  return id;
}

// --- Moderation, events, operations and settings (migrations 41, 61 and 65): for every staff member with a second factor.
// The pages call requireStaff first; each function checks the caller again in SQL (ts_require_staff / ts_require_admin).

export const fetchQueueCounts = cache(() => consoleFetch<QueueCounts>("console_queue_counts"));
export const fetchAppeals = (view: string, offset: number, limit: number) =>
  consoleFetch<StaffPage<StaffAppeal>>("console_appeals", { p_view: view, p_limit: limit, p_offset: offset });
export const fetchRulePacks = () => consoleFetch<RulePackState[]>("console_rule_packs");
export const fetchSystemHealth = () => consoleFetch<SystemHealth>("console_system_health");
export const fetchEventsCounts = cache(() => consoleFetch<ConsoleEventsCounts>("events_console_counts"));
export const fetchEventFeeds = () => consoleFetch<ConsoleFeed[]>("events_console_feeds");
// Universities (migration 77): owners and admins with a second factor (ts_require_admin).
export const fetchConsoleUniversities = (q?: string | null) => consoleFetch<ConsoleUniversity[]>("console_universities", { p_q: q ?? null });
export const fetchConsoleUniversity = (id: string) => consoleFetch<ConsoleUniversity>("console_university", { p_id: id });
export const fetchConsoleOrganizations = (filter: { verified?: boolean; status?: string; q?: string } = {}) =>
  consoleFetch<ConsoleOrganization[]>("events_console_organizations", { p_filter: filter });
export const fetchConsoleEvents = (filter: ConsoleEventsFilter = {}) => consoleFetch<{ items: ConsoleEvent[]; total: number }>("events_console_events", { p_filter: filter });

// --- Universities (migration 70): students' requests, for owners and admins of the staff (ts_require_admin in SQL).
export const fetchUniversityRequests = (status: UniversityRequestStatus, offset: number, limit: number) =>
  consoleFetch<UniversityRequestsPage>("console_university_requests", { p_status: status, p_limit: limit, p_offset: offset });

// --- The audit log (migration 71): every staff member with a second factor; what each one sees is decided in SQL.
export const fetchAuditFeed = (filters: AuditFeedFilters, limit = 50) =>
  consoleFetch<AuditFeedPage>("console_audit_feed", { p_filters: filters, p_limit: limit });
