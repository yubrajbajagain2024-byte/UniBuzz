// A dedicated staging campus admin for the portal's campus-admin browser check (apps/admin/e2e/campus-admin.mjs): a
// confirmed txstate.edu account made by the admin API (no email sent), with a TOTP authenticator enrolled through
// Supabase Auth as a real staff member's is, on the staff list as campus_admin with Texas State as their campus (put
// there by the database owner, as the other staging staff are). Its password and authenticator key live only in the
// git-ignored state file beside this script (.campus-e2e.json, mode 0600), never in the repository or on screen. Needs
// migrations 72 to 75 on staging (76 adds the campus dashboard's permission). Never runs against production.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/campus-e2e-account.mjs create
//   eval "$(node supabase/tests/staging/campus-e2e-account.mjs env)"     sets CAMPUS_E2E_EMAIL/PASSWORD/TOTP_SECRET/CAMPUS
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/campus-e2e-account.mjs delete
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { enrolAuthenticator } from "./mfa.mjs";

const PRODUCTION = "dskbzoqreandwwpxiplh";
const STATE_FILE = new URL("./.campus-e2e.json", import.meta.url);
const EMAIL = "unibuzz-e2e+campus-admin@txstate.edu";
const [command = ""] = process.argv.slice(2);
const sh = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;

if (command === "env") {
  if (!fs.existsSync(STATE_FILE)) throw new Error("No state file: run create first");
  const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  console.log(`export CAMPUS_E2E_EMAIL=${sh(s.email)} CAMPUS_E2E_PASSWORD=${sh(s.password)} CAMPUS_E2E_TOTP_SECRET=${sh(s.secret)} CAMPUS_E2E_CAMPUS=${sh(s.campus)}`);
  process.exit(0);
}

const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("Staging test accounts are never made on production.");
async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.replace(REF, "<staging>")} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, keys.find((k) => k.name === "service_role").api_key, opts);

if (command === "create") {
  const campus = (await sql("select id, name from public.universities where email_domain = 'txstate.edu'"))[0];
  let state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : null;
  if (!state) {
    const password = `Cx-${randomBytes(12).toString("base64url")}!`;
    const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true, user_metadata: { full_name: "Campus Admin E2E" } });
    if (error) throw new Error(error.message);
    const c = createClient(URL_, keys.find((k) => k.name === "anon").api_key, opts);
    const s = await c.auth.signInWithPassword({ email: EMAIL, password });
    if (s.error) throw new Error(s.error.message);
    const secret = await enrolAuthenticator(c);
    state = { id: data.user.id, email: EMAIL, password, secret, campus: campus.name };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
  await sql(`insert into public.staff (user_id, role) values (${lit(state.id)}, 'campus_admin') on conflict (user_id) do update set role = 'campus_admin';
             insert into public.staff_campuses (user_id, university_id) values (${lit(state.id)}, ${lit(campus.id)}) on conflict do nothing`);
  console.log(`campus admin ${EMAIL} for ${campus.name} ready (state in .campus-e2e.json)`);
} else if (command === "delete") {
  if (!fs.existsSync(STATE_FILE)) throw new Error("No state file");
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  await sql(`delete from public.staff_campuses where user_id = ${lit(state.id)}; delete from public.staff where user_id = ${lit(state.id)}`);
  await admin.auth.admin.deleteUser(state.id);
  fs.unlinkSync(STATE_FILE);
  console.log("deleted the staging campus admin and the state file");
} else {
  throw new Error("Usage: create | env | delete");
}
