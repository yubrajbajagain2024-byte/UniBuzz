"use client";

import { createContext, useContext, type ReactNode } from "react";
import { isPlatformRole, STAFF_ROLE_RANK, type AdminStaffRole, type StaffListRole } from "@apartment-book/shared";
import type { Permission } from "@/lib/permissions";

/**
 * The signed-in staff member's permissions (lib/permissions.ts) and role, given once by the shell to the sidebar and the
 * section tabs. Without a provider the list is empty and there is no role: nothing optional shows (default deny).
 */
const PermissionsContext = createContext<{ permissions: readonly Permission[]; role: StaffListRole | null }>({ permissions: [], role: null });

export function PermissionsProvider({ permissions, role = null, children }: { permissions: readonly Permission[]; role?: StaffListRole | null; children: ReactNode }) {
  return <PermissionsContext.Provider value={{ permissions, role }}>{children}</PermissionsContext.Provider>;
}

/** A function telling whether the staff member has a permission. */
export function useCan(): (permission: Permission | undefined) => boolean {
  const { permissions } = useContext(PermissionsContext);
  return (permission) => permission === undefined || permissions.includes(permission);
}

/**
 * A function telling whether the staff member holds at least a platform role, as lib/admin.ts hasRole rules for pages:
 * a campus admin (or no role) never does.
 */
export function useAtLeast(): (minRole: AdminStaffRole | undefined) => boolean {
  const { role } = useContext(PermissionsContext);
  return (minRole) => minRole === undefined || (isPlatformRole(role) && STAFF_ROLE_RANK[role] >= STAFF_ROLE_RANK[minRole]);
}
