import "server-only";
import { headers } from "next/headers";

/**
 * Where a staff member's request came from, for the audit log (migration 71's audit_request_context). The portal's
 * server calls Supabase for the staff member, so the API gateway sees the server's address, not theirs: these headers
 * pass on what this server saw. On Vercel x-real-ip and x-forwarded-for are the browser's address, set by Vercel
 * (it overwrites what the browser sends); x-portal-path is the page, set by the proxy. The database keeps them apart
 * from the gateway's own view and treats them as reported, since anyone calling the API could send such headers.
 * Only an address's characters pass; the browser is cut at 300 characters, the path at 200.
 */
export async function portalRequestHeaders(): Promise<Record<string, string>> {
  let h: Headers;
  try {
    h = await headers();
  } catch {
    return {}; // Outside a request (a build step): nothing to report.
  }
  const out: Record<string, string> = {};
  const ip = (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  if (/^[0-9A-Fa-f:.]{2,45}$/.test(ip)) out["x-portal-client-ip"] = ip;
  const agent = clean(h.get("user-agent"), 300);
  if (agent) out["x-portal-user-agent"] = agent;
  const path = clean(h.get("x-portal-path"), 200);
  if (path?.startsWith("/")) out["x-portal-path"] = path;
  return out;
}

/** Printable ASCII only (a header value must be), trimmed and cut. */
function clean(value: string | null, max: number): string | null {
  const text = (value ?? "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, max);
  return text || null;
}
