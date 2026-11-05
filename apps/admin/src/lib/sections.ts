/**
 * The nine sections of CampConnect Admin and the pages inside each. The sidebar lists the sections (title and what
 * they hold); a section's pages show as tabs under the page title (SectionTabs). Existing routes keep their paths, so
 * deep links and the browser check still work: a section is a grouping, not a route.
 * adminOnly: owners and admins of the staff only (the pages check it too, as every page does).
 */
export type SectionId = "dashboard" | "users" | "moderation" | "content" | "business" | "analytics" | "operations" | "support" | "administration";

export type SectionTab = { href: string; label: string; adminOnly?: boolean };

export type Section = {
  id: SectionId;
  href: string;
  label: string;
  description: string;
  adminOnly?: boolean;
  /** Path prefixes that belong to the section (the sidebar's active state). The dashboard matches "/" exactly. */
  match: string[];
  tabs: SectionTab[];
};

export const SECTIONS: readonly Section[] = [
  { id: "dashboard", href: "/", label: "Dashboard", description: "KPIs, alerts and pending decisions", match: [], tabs: [] },
  {
    id: "users",
    href: "/users",
    label: "Users",
    description: "Accounts, suspensions, verification",
    match: ["/users"],
    tabs: [
      { href: "/users", label: "Accounts" },
      { href: "/users?filter=suspended", label: "Suspensions" },
      { href: "/users?filter=unverified", label: "Verification" },
      { href: "/users?filter=staff", label: "Staff accounts" },
    ],
  },
  {
    id: "moderation",
    href: "/reports",
    label: "Moderation",
    description: "Reports, appeals, automatic hiding",
    match: ["/reports", "/appeals", "/flagged"],
    tabs: [
      { href: "/reports", label: "Reports" },
      { href: "/appeals", label: "Appeals" },
      { href: "/flagged", label: "Automatic hiding" },
    ],
  },
  {
    id: "content",
    href: "/content",
    label: "Content",
    description: "Posts, Buzz, Reels, listings, events",
    match: ["/content", "/events"],
    tabs: [
      { href: "/content", label: "Hidden content" },
      { href: "/events", label: "Events" },
    ],
  },
  { id: "business", href: "/business", label: "Business & Ads", description: "Advertisers, campaigns, payments", adminOnly: true, match: ["/business"], tabs: [] },
  { id: "analytics", href: "/analytics", label: "Analytics", description: "Growth, engagement, ads, revenue", adminOnly: true, match: ["/analytics"], tabs: [] },
  {
    id: "operations",
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
    href: "/staff",
    label: "Administration",
    description: "Staff, audit logs, security, settings",
    match: ["/staff", "/audit", "/security", "/settings"],
    tabs: [
      { href: "/staff", label: "Staff" },
      { href: "/audit", label: "Audit log" },
      { href: "/security", label: "Security" },
      { href: "/settings", label: "Settings", adminOnly: true },
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
