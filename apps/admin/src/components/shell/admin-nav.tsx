"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, Headset, LayoutDashboard, Megaphone, Settings, ShieldAlert, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import { SECTIONS, sectionOfPath, type SectionId } from "@/lib/sections";
import { cn } from "@/lib/utils";

const ICONS: Record<SectionId, LucideIcon> = {
  dashboard: LayoutDashboard,
  users: Users,
  moderation: ShieldAlert,
  content: Boxes,
  business: Megaphone,
  analytics: BarChart3,
  operations: SlidersHorizontal,
  support: Headset,
  administration: Settings,
};

/**
 * The nine sections (lib/sections.ts). `sidebar` is the dark vertical list on large screens, each section with what it
 * holds; `tabs` the scrollable strip under the header on phones. Owners and admins see Business & Ads and Analytics.
 */
export function AdminNav({ variant, admin = false }: { variant: "sidebar" | "tabs"; admin?: boolean }) {
  const pathname = usePathname();
  const current = sectionOfPath(pathname)?.id ?? null;
  const items = SECTIONS.filter((s) => admin || !s.adminOnly);

  if (variant === "sidebar") {
    return (
      <nav aria-label="Admin" className="flex flex-col gap-0.5">
        {items.map((section) => {
          const active = current === section.id;
          const Icon = ICONS[section.id];
          return (
            <Link
              key={section.id}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-start gap-3 rounded-lg px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", active ? "text-brand-200" : "text-slate-400")} aria-hidden="true" />
              <span className="min-w-0 leading-tight">
                <span className="block text-sm font-semibold">{section.label}</span>
                <span className={cn("block truncate text-xs", active ? "text-slate-300" : "text-slate-500")}>{section.description}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Admin" className="no-scrollbar -mb-px flex gap-1 overflow-x-auto px-3 sm:px-6">
      {items.map((section) => {
        const active = current === section.id;
        const Icon = ICONS[section.id];
        return (
          <Link
            key={section.id}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
              active ? "border-brand-600 text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
