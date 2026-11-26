import { config } from "zod";

// Runs in the browser before the portal's own code (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
// instrumentation-client.md). Zod 4 compiles its object parsers with `new Function` unless told not to, and first tests
// whether it may; the portal's Content-Security-Policy (lib/csp.ts) refuses eval, so that test would log a CSP violation
// on every page. Zod's own switch skips the test and the compiling: parsing is the same, a little slower, which forms
// with a handful of fields never notice. It must run before any schema is built (packages/shared builds them on load).
config({ jitless: true });
