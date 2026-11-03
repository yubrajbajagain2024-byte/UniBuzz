"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { sectionById, type SectionId } from "@/lib/sections";
import { cn } from "@/lib/utils";

/**
 * The pages of one section as a row of pills under the page title (lib/sections.ts). A tab whose address carries a
 * query string (the Users filters) is active only with that query; a plain one is active for its path and anything
 * under it, unless a sibling with a query matches first. `counts`: a number after a tab's label, by href.
 */
export function SectionTabs({ section, admin = false, counts }: { section: SectionId; admin?: boolean; counts?: Record<string, number | null | undefined> }) {
  return (
    <Suspense fallback={null}>
      <Tabs section={section} admin={admin} counts={counts} />
    </Suspense>
  );
}

function Tabs({ section, admin, counts }: { section: SectionId; admin: boolean; counts?: Record<string, number | null | undefined> }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const tabs = sectionById(section).tabs.filter((t) => admin || !t.adminOnly);
  const here = `${pathname}${params.size ? `?${params.toString()}` : ""}`;
  const exactMatch = tabs.find((t) => t.href === here);
  const isActive = (href: string) => {
    if (exactMatch) return exactMatch.href === href;
    if (href.includes("?")) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
  };
  if (tabs.length === 0) return null;
  return (
    <nav aria-label={`${sectionById(section).label} pages`} className="no-scrollbar -mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-2">
        {tabs.map((t) => {
          const active = isActive(t.href);
          const n = counts?.[t.href];
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm font-medium ring-1 ring-inset transition-colors",
                  active ? "bg-brand-50 text-brand-800 ring-brand-300" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50",
                )}
              >
                {t.label}
                {n ? <span className="tabular-nums text-gray-500">· {n}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
