import type { AdminStaffRole } from "@apartment-book/shared";
import type { Permission } from "@/lib/permissions";

/**
 * The ten sections of the UniBuzz Master Admin Portal and the pages inside each. The sidebar lists the sections (title
 * and what they hold); a section's pages show as tabs under the page title (SectionTabs). Existing routes keep their
 * paths, so deep links and the browser check still work: a section is a grouping, not a route.
 * permission: who sees the link (lib/permissions.ts); the page behind it checks the same permission, and the database
 * checks the caller again.
 */
export type SectionId = "dashboard" | "campus" | "users" | "moderation" | "content" | "universities" | "business" | "analytics" | "operations" | "support" | "administration";

/** `minRole`: the platform's staff only, of that rank or above (a campus admin never passes one), as the page itself rules. */
export type SectionTab = { href: string; label: string; permission?: Permission; minRole?: AdminStaffRole };

export type Section = {
  id: SectionId;
  href: string;
  label: string;
  description: string;
  permission: Permission;
  /** Path prefixes that belong to the section (the sidebar's active state). The dashboard matches "/" exactly. */
  match: string[];
  tabs: SectionTab[];
};

export const SECTIONS: readonly Section[] = [
  { id: "dashboard", permission: "dashboard.view", href: "/", label: "Dashboard", description: "KPIs, alerts and pending decisions", match: [], tabs: [] },
  // A campus admin's own overview at the same address (they never have dashboard.view, the platform's staff never
  // campus.overview): their campuses' reports, flags, appeals, students and calendar, all from scoped functions.
  { id: "campus", permission: "campus.overview", href: "/", label: "My campus", description: "What needs you on your campuses", match: [], tabs: [] },
  {
    id: "users",
    permission: "users.view",
    href: "/users",
    label: "Users",
    description: "Accounts, suspensions, verification",
    match: ["/users"],
    tabs: [
      { href: "/users", label: "Accounts" },
      { href: "/users?filter=suspended", label: "Suspensions" },
      { href: "/users?filter=unverified", label: "Verification" },
      { href: "/users?filter=staff", label: "Staff accounts", permission: "staff.view" },
    ],
  },
  {
    id: "moderation",
    permission: "moderation.view",
    href: "/reports",
    label: "Moderation",
    description: "Queue, reports, appeals, automatic hiding",
    match: ["/queue", "/reports", "/appeals", "/flagged"],
    tabs: [
      // Trust & Safety's review queue (Phase 4b): the platform's staff only; SQL refuses campus admins (ts_require_staff).
      { href: "/queue", label: "Queue", minRole: "moderator" },
      { href: "/reports", label: "Reports" },
      { href: "/appeals", label: "Appeals" },
      { href: "/flagged", label: "Automatic hiding" },
    ],
  },
  {
    id: "content",
    permission: "content.view",
    href: "/content",
    label: "Content",
    description: "Posts, Buzz, Reels, listings, events",
    match: ["/content", "/events"],
    tabs: [
      { href: "/content", label: "Hidden content" },
      { href: "/events", label: "Events" },
    ],
  },
  {
    id: "universities",
    permission: "universities.manage",
    href: "/universities",
    label: "Universities",
    description: "Campuses and students' requests",
    match: ["/universities"],
    tabs: [
      { href: "/universities", label: "Requests" },
      { href: "/universities/campuses", label: "Campuses" },
    ],
  },
  { id: "business", permission: "business.manage", href: "/business", label: "Business & Ads", description: "Advertisers, campaigns, payments", match: ["/business"], tabs: [] },
  { id: "analytics", permission: "analytics.view", href: "/analytics", label: "Analytics", description: "Growth, engagement, ads, revenue", match: ["/analytics"], tabs: [] },
  {
    id: "operations",
    permission: "operations.view",
    href: "/media",
    label: "Operations",
    description: "Media jobs, system health, email",
    match: ["/media", "/operations"],
    tabs: [
      { href: "/media", label: "Media jobs" },
      { href: "/operations/health", label: "System health" },
      { href: "/operations/email", label: "Email" },
    ],
  },
  {
    id: "support",
    permission: "support.view",
    href: "/support",
    label: "Support",
    description: "User requests, appeals, issues",
    match: ["/support"],
    tabs: [
      { href: "/support", label: "Requests" },
      { href: "/appeals", label: "Appeals" },
      { href: "/support/issues", label: "Issues" },
    ],
  },
  {
    id: "administration",
    permission: "staff.view",
    href: "/staff",
    label: "Administration",
    description: "Staff, audit logs, security, settings",
    match: ["/staff", "/audit", "/security", "/settings"],
    tabs: [
      { href: "/staff", label: "Staff" },
      { href: "/audit", label: "Audit log", permission: "audit.view" },
      { href: "/security", label: "Security", permission: "security.self" },
      { href: "/settings", label: "Settings", permission: "settings.manage" },
    ],
  },
];

export function sectionById(id: SectionId): Section {
  return SECTIONS.find((s) => s.id === id)!;
}

/** The section a path belongs to ("/" is the dashboard; an unknown path belongs to none). */
export function sectionOfPath(pathname: string): Section | null {
  if (pathname === "/") return SECTIONS[0]!;
  return SECTIONS.find((s) => s.match.some((m) => pathname === m || pathname.startsWith(`${m}/`))) ?? null;
}
