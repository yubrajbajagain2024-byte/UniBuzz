/**
 * The answers of migration 63's console functions (Analytics and Business), as the database writes them: camelCase
 * keys, epoch-ms times, money in cents. They live here rather than in the hand-written Database types, because these
 * functions return JSON.
 */
import type { Json } from "@apartment-book/shared";

export type AdStatus = "draft" | "pending_review" | "scheduled" | "active" | "paused" | "completed" | "rejected";
export type AdPlacementId = "for_you" | "reels" | "housing";
export type BusinessStatus = "pending" | "approved" | "rejected" | "suspended";

export interface AnalyticsRange {
  days: number;
  /** Central-time days, "YYYY-MM-DD". */
  from: string;
  to: string;
}

interface AnalyticsBase {
  range: AnalyticsRange;
  timeZone: string;
  generatedAt: number;
  campus?: { id: string; name: string } | null;
}

export type EngagementKind = "posts" | "reels" | "comments" | "likes" | "messages" | "follows" | "listings" | "items" | "buzzes" | "buzzReplies";

export interface EngagementDay {
  day: string;
  posts: number;
  reels: number;
  comments: number;
  likes: number;
  messages: number;
  follows: number;
  buzzes: number;
  engaged: number;
}

export interface AnalyticsOverview extends AnalyticsBase {
  totals: { students: number; businessAccounts: number; businesses: number };
  growth: { signups: number; signupsPrev: number; perDay: { day: string; signups: number; total: number }[] };
  active: {
    now: { online15m: number; dau: number; wau: number; mau: number };
    /** null where no snapshot was taken that day. */
    perDay: { day: string; dau: number | null }[];
    since: string | null;
  };
  engaged: { today: number; last7: number; last30: number; inRange: number; inPrevRange: number };
  engagement: { totals: Record<EngagementKind, number>; prev: Record<EngagementKind, number>; perDay: EngagementDay[] };
  campuses: { id: string; name: string; students: number; signups: number; mau: number }[];
  lastHour: { signups: number; posts: number; messages: number; impressions: number; clicks: number };
}

export interface AdTotals {
  impressions: number;
  reach: number;
  clicks: number;
  saves: number;
  inquiries: number;
  profileVisits: number;
}

export interface AdsAnalytics extends AnalyticsBase {
  totals: AdTotals;
  prev: AdTotals;
  perDay: { day: string; impressions: number; reach: number; clicks: number }[];
  byPlacement: { placement: string; impressions: number; clicks: number }[];
  topAds: {
    id: string;
    name: string;
    businessId: string;
    businessName: string;
    status: AdStatus;
    placements: string[];
    impressions: number;
    reach: number;
    clicks: number;
    paidCents: number;
    currency: string;
  }[];
  adsByStatus: Record<AdStatus, number>;
  review: { pending: number; oldestPendingAt: number | null; decided: number; medianHoursToDecision: number | null };
}

export interface RevenueAnalytics extends AnalyticsBase {
  currency: "USD";
  totals: {
    bookedCents: number;
    voidedCents: number;
    netCents: number;
    recognizedCents: number;
    payments: number;
    advertisers: number;
    activeAdvertisers: number;
    avgPaymentCents: number;
  };
  prev: { bookedCents: number; voidedCents: number; netCents: number; recognizedCents: number; payments: number };
  perDay: { day: string; bookedCents: number; voidedCents: number; recognizedCents: number }[];
  byPlacement: { placement: string; bookedCents: number }[];
  byCategory: { category: string; bookedCents: number }[];
  topBusinesses: { id: string; name: string; bookedCents: number; payments: number }[];
  otherCurrencies: { currency: string; bookedCents: number }[];
  pipeline: { pendingAds: number; pendingBudgetCents: number };
}

export interface AdQuote {
  /** null when a placement has no rate. */
  cents: number | null;
  days: number;
  campuses: number;
  minimumCents: number;
  lines: { placement: AdPlacementId; dailyCents: number; cents: number }[];
  missing: AdPlacementId[];
}

export interface ConsolePayment {
  id: string;
  amountCents: number;
  currency: string;
  reference: string;
  status: "active" | "cancelled";
  startsAt: number;
  endsAt: number;
  createdAt: number;
  cancelledAt: number | null;
  recordedBy: string | null;
  subject: "ad" | "listing" | "post" | "removed";
  ad: { id: string; name: string } | null;
  business: { id: string; name: string } | null;
}

export interface ConsoleAdRow {
  id: string;
  name: string;
  status: AdStatus;
  pausedBy: "business" | "admin" | null;
  vertical: "general" | "housing";
  objective: string;
  placements: AdPlacementId[];
  universityIds: string[];
  startsAt: number | null;
  endsAt: number | null;
  budgetCents: number;
  currency: string;
  paidCents: number;
  quote: AdQuote | null;
  impressions: number;
  clicks: number;
  openReports: number;
  fairHousingFlags: string[];
  submittedAt: number | null;
  createdAt: number;
  business: { id: string; name: string; status: BusinessStatus; category: string };
}

export interface ConsoleAdHistoryRow {
  id: number;
  action: string;
  actorKind: "team" | "admin" | "system";
  actorName: string | null;
  detail: Record<string, unknown>;
  createdAt: number;
}

export interface ConsoleAd extends ConsoleAdRow {
  headline: string | null;
  caption: string;
  media: Json;
  cta: string;
  ctaUrl: string | null;
  promoted: { type: "listing" | "post" | "removed"; id: string | null; title: string | null } | null;
  statusReason: string | null;
  reviewNote: string | null;
  needsReviewReason: string | null;
  fairHousingCheckedAt: number | null;
  reviewedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
  draftedByTeam: boolean;
  business: ConsoleAdRow["business"] & { logoUrl: string | null; verified: boolean };
  payments: ConsolePayment[];
  stats: { impressions: number; reach: number; clicks: number; saves: number; inquiries: number };
  problems: string[];
  history: ConsoleAdHistoryRow[];
}

export interface ConsolePage<T, C> {
  items: T[];
  nextOffset: number | null;
  counts: C;
}

export type AdCounts = Record<AdStatus | "all", number>;
export type BusinessCounts = Record<BusinessStatus | "all", number>;

export interface ConsolePerson {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  confirmed: boolean;
}

export interface ConsoleBusinessRow {
  id: string;
  name: string;
  category: string;
  status: BusinessStatus;
  verified: boolean;
  logoUrl: string | null;
  city: string | null;
  createdAt: number;
  owner: ConsolePerson;
  members: number;
  adsRunning: number;
  adsInReview: number;
  paidCents: number;
  openReports: number;
}

export interface ConsoleBusinessNote {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: number;
}

export interface ConsoleBusiness {
  business: {
    id: string;
    name: string;
    category: string;
    description: string;
    website: string | null;
    phone: string | null;
    contactEmail: string | null;
    address: string | null;
    city: string | null;
    logoUrl: string | null;
    universityIds: string[];
    status: BusinessStatus;
    verified: boolean;
    verifiedAt: number | null;
    verificationNote: string | null;
    reviewNote: string | null;
    reviewedAt: number | null;
    createdAt: number;
    updatedAt: number;
  };
  owner: ConsolePerson | null;
  team: { userId: string; name: string | null; username: string | null; email: string | null; role: "owner" | "admin" | "editor" | "analyst"; joinedAt: number }[];
  pendingInvites: number;
  ads: ConsoleAdRow[];
  payments: ConsolePayment[];
  reports: {
    open: number;
    recent: { id: string; reason: string; details: string | null; status: "open" | "actioned" | "dismissed"; adId: string | null; dealId: string | null; createdAt: number }[];
  };
  stats30d: { impressions: number; reach: number; clicks: number; inquiries: number; profileVisits: number };
  totals: { paidCents: number; voidedCents: number; listings: number; posts: number };
  notes: ConsoleBusinessNote[];
  audit: (ConsoleAdHistoryRow & { targetType: string | null; targetId: string | null })[];
}

export interface BusinessOpsOverview {
  businesses: { pending: number; pendingConfirmed: number; approved: number; rejected: number; suspended: number; verified: number };
  ads: { inReview: number; running: number; scheduled: number; pausedByTeam: number; oldestInReviewAt: number | null };
  reports: { open: number };
  revenue: { monthToDateCents: number; last30Cents: number; earnedMonthToDateCents: number };
  endingSoon: { id: string; name: string; businessId: string; businessName: string; endsAt: number }[];
  generatedAt: number;
}

export interface PaymentsPage {
  items: ConsolePayment[];
  nextOffset: number | null;
  totals: { count: number; bookedCents: number; inForceCents: number; voidedCents: number };
}

export interface AdRate {
  placement: AdPlacementId;
  dailyCents: number | null;
  minimumCents: number | null;
  currency: "USD";
  updatedAt: number | null;
  updatedBy: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Moderation, events, operations and settings: the staff console functions of migrations 41, 61 and 65, read by the
// Moderation, Content, Operations, Support and Administration sections. Shapes are the functions' JSON.
// ---------------------------------------------------------------------------------------------------------------------

export interface StaffPage<T> {
  items: T[];
  nextOffset: number | null;
}

export type QueueCounts = Record<"priority" | "wellbeing" | "held" | "auto_hidden" | "reports" | "escalated" | "appeals" | "mine" | "closed", number>;

export type SanctionKind = "warning" | "mute" | "suspension" | "ban";

export interface StaffSanctionRow {
  id: string;
  kind: SanctionKind | "removal";
  scope: string;
  category: string | null;
  guidelineAnchor: string | null;
  startsAt: number;
  until: number | null;
  acknowledgedAt: number | null;
  liftedAt: number | null;
  inEffect: boolean;
  liftable: boolean;
  canAppeal: boolean;
  appealStatus: string;
  /** "anon" for a Buzz sanction: times are cut to the day and nothing names a person. */
  origin: "anon" | "public";
}

/** An appeal as console_appeals() returns it: the sanction, the appealed content and the appeal text, never a person. */
export interface StaffAppeal {
  id: string;
  sanction: StaffSanctionRow;
  contentExcerpt: string | null;
  contentLabel: string | null;
  text: string;
  status: "open" | "upheld" | "reversed" | "reduced";
  createdAt: number;
  queueId: string | null;
  /** Whether this staff member may decide it (never their own action; suspensions and bans need an admin). */
  canReview: boolean;
}

export interface RulePackState {
  id: string;
  enabled: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface ConsoleEventsCounts {
  organizations_pending: number;
  feeds_failing: number;
  events_upcoming: number;
}

export interface ConsoleFeed {
  id: string;
  university_id: string;
  university_name: string;
  organization_id: string | null;
  organization_name: string | null;
  name: string;
  url: string;
  kind: "ics" | "rss";
  enabled: boolean;
  default_category: string;
  last_synced_at: string | null;
  last_status: "ok" | "unchanged" | "error" | null;
  last_error: string | null;
  items_seen: number;
  created_at: string;
  updated_at: string;
  upcoming: number;
}

export interface ConsoleOrganization {
  id: string;
  university_id: string;
  university_name: string;
  name: string;
  kind: string;
  description: string | null;
  avatar_url: string | null;
  website: string | null;
  verified: boolean;
  verified_at: string | null;
  status: "active" | "hidden";
  follower_count: number;
  created_at: string;
  created_by: string | null;
  creator_username: string | null;
  members: number;
  events: number;
}

export interface ConsoleEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  category: string;
  image_url: string | null;
  registration_url: string | null;
  source: "feed" | "organization";
  status: "scheduled" | "cancelled" | "pending" | "hidden";
  save_count: number;
  click_count: number;
  created_at: string;
  updated_at: string;
  university_id: string;
  university_name: string;
  organization_id: string | null;
  organization_name: string | null;
  organization_verified: boolean | null;
  feed_id: string | null;
  feed_name: string | null;
}

export interface ConsoleEventsFilter {
  status?: string;
  source?: string;
  q?: string;
  university_id?: string;
  offset?: number;
  limit?: number;
  /** Default true: events still ahead (or ended within a day). */
  upcoming?: boolean;
}

/** console_system_health() (migration 65): numbers and timestamps only. Parts the database lacks are null. */
export interface SystemHealth {
  generated_at: string;
  cron: { name: string; schedule: string; active: boolean; last_status: string | null; last_started_at: string | null; last_ended_at: string | null; last_message: string | null }[] | null;
  media: { pending: number; failing: number; done_24h: number; oldest_pending_at: string | null; last_done_at: string | null; last_error: string | null } | null;
  feeds: { enabled: number; failing: number; last_synced_at: string | null; items_seen: number };
  activity: { latest_day: string | null; recorded_at: string | null; dau: number };
  migrations: { count: number; latest: string | null; latest_applied_at: string | null } | null;
  moderation: { reports_open: number; oldest_open_report_at: string | null; queue_open: number; appeals_open: number; auto_hides_pending: number | null };
  staff: { total: number; without_second_factor: number } | null;
  storage: { objects: number; uploads: number };
  database: { size_bytes: number };
}
