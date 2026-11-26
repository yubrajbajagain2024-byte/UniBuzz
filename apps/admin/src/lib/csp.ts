/**
 * The portal's Content-Security-Policy, set per request by the proxy (src/proxy.ts) with a fresh nonce. Next.js reads the
 * nonce from the request's CSP header and puts it on its own scripts (node_modules/next/dist/docs/01-app/02-guides/
 * content-security-policy.md); every page is rendered per request already (each one checks the session), so the nonce
 * costs nothing. What it allows, and why:
 * - scripts: this app's, by nonce only ('strict-dynamic' lets them load their chunks); never inline handlers or other
 *   origins, so an injected <script> or a stolen staff session's XSS has nothing to run. `next dev` also needs eval.
 * - styles: this app's and inline style attributes (two charts size their bars with style={{ width }}; a nonce cannot
 *   cover an attribute). Styles cannot run code.
 * - images: this app (the image optimizer), data: (the authenticator's QR code), blob:, Supabase Storage (avatars and
 *   moderation previews through signed URLs), Mux posters, Google avatars.
 * - connections: this app (server actions) and the Supabase project (the browser client: REST, Auth, Storage, Realtime).
 * - forms: this app, plus Supabase Auth and Google, where "Continue with Google" is redirected.
 * - nothing may frame the portal, no plugins, no <base> tricks, and every http: request is upgraded when the portal itself
 *   is served over https (`https`: the request's scheme). On a portal served over http (`next start` on a laptop) the
 *   upgrade would send the browser to https://localhost, which answers nothing.
 */
export function contentSecurityPolicy(nonce: string, opts: { supabaseUrl: string; dev: boolean; https: boolean }): string {
  const supabase = originOf(opts.supabaseUrl);
  const realtime = supabase ? supabase.replace(/^http/, "ws") : null;
  const list = (...values: (string | null | false)[]) => values.filter(Boolean).join(" ");
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    ["script-src", list("'self'", `'nonce-${nonce}'`, "'strict-dynamic'", opts.dev && "'unsafe-eval'")],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", list("'self'", "data:", "blob:", supabase, "https://*.supabase.co", "https://image.mux.com", "https://lh3.googleusercontent.com")],
    ["font-src", "'self'"],
    ["connect-src", list("'self'", supabase, realtime, opts.dev && "ws:")],
    ["media-src", list("'self'", "blob:", supabase)],
    ["frame-src", "'none'"],
    ["worker-src", "'self' blob:"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", list("'self'", supabase, "https://accounts.google.com")],
    ["frame-ancestors", "'none'"],
  ];
  const policy = directives.map(([k, v]) => `${k} ${v}`);
  if (opts.https) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** A random nonce for one response: 16 bytes, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
