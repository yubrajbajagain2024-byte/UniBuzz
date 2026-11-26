"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Permission } from "@/lib/permissions";

/**
 * The signed-in staff member's permissions (lib/permissions.ts), given once by the shell to the sidebar and the section
 * tabs. Without a provider the list is empty: nothing optional shows (default deny).
 */
const PermissionsContext = createContext<readonly Permission[]>([]);

export function PermissionsProvider({ permissions, children }: { permissions: readonly Permission[]; children: ReactNode }) {
  return <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>;
}

/** A function telling whether the staff member has a permission. */
export function useCan(): (permission: Permission | undefined) => boolean {
  const granted = useContext(PermissionsContext);
  return (permission) => permission === undefined || granted.includes(permission);
}
