// A throwaway test mailbox for the staging email checks: Ethereal (nodemailer's catch-all test service) accepts mail
// through SMTP and delivers none of it. auth-email.mjs points the staging project's Auth SMTP at it for the run, and
// the messages are read back here over HTTPS (Ethereal's web pages: its POP3 and IMAP ports are often blocked on
// laptops and CI). Holds only throwaway staging accounts and their links.

/** A new Ethereal account: SMTP credentials and the address its mail is read with (nothing about the project is sent). */
export async function createMailbox() {
  const r = await fetch("https://api.nodemailer.com/user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestor: "smtp-check", version: "1.0.0" }) });
  const j = await r.json();
  if (j.status !== "success" || !j.user || !j.pass) throw new Error(`Ethereal: ${JSON.stringify(j).slice(0, 200)}`);
  return { user: j.user, pass: j.pass, smtp: j.smtp };
}

const BASE = "https://ethereal.email";

/** A signed-in web session (cookies kept by hand: fetch has no jar). */
async function session(box) {
  let cookie = "";
  const keep = (r) => {
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const kv = c.split(";")[0];
      const name = kv.split("=")[0];
      cookie = cookie.split("; ").filter((x) => x && !x.startsWith(`${name}=`)).concat(kv).join("; ");
    }
  };
  let r = await fetch(`${BASE}/login`, { headers: { cookie } });
  keep(r);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await r.text())?.[1];
  if (!csrf) throw new Error("Ethereal: no login form");
  r = await fetch(`${BASE}/login`, { method: "POST", redirect: "manual", headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: csrf, address: box.user, password: box.pass }) });
  keep(r);
  if (r.status !== 302) throw new Error(`Ethereal: login answered ${r.status}`);
  return async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
    keep(res);
    if (!res.ok) throw new Error(`Ethereal ${path}: ${res.status}`);
    return res.text();
  };
}

/** Every message in the mailbox, parsed (the newest first, as the list shows them). */
export async function readAll(box) {
  const get = await session(box);
  const list = await get("/messages");
  const paths = [...new Set([...list.matchAll(/href="(\/messages\/[0-9a-f]+\/\d+)"/g)].map((m) => m[1]))];
  const out = [];
  for (const p of paths) out.push(parse(await get(`${p}/message.eml`)));
  return out;
}

/** Decodes quoted-printable text (Supabase's emails use it). */
function qp(text) {
  return text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parse(raw) {
  const split = raw.search(/\r?\n\r?\n/);
  const head = raw.slice(0, split).replace(/\r?\n[ \t]+/g, " ");
  const body = raw.slice(split);
  const header = (name) => (new RegExp(`^${name}:\\s*(.*)$`, "im").exec(head)?.[1] ?? "").trim();
  const text = /quoted-printable/i.test(raw) ? qp(body) : body;
  const links = [...text.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  return { to: header("To"), from: header("From"), subject: header("Subject"), date: header("Date"), links, text };
}

/** Waits until more than `after` messages to `to` (matching `subject`) are there; returns the newest and the count. */
export async function waitFor(box, { to, subject, after = 0, timeoutMs = 120_000 }) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const mine = (await readAll(box)).filter((m) => m.to.toLowerCase().includes(to.toLowerCase()) && (!subject || subject.test(m.subject)));
    if (mine.length > after) return { message: mine[0], count: mine.length };
    if (Date.now() > until) throw new Error(`no email to ${to}${subject ? ` (${subject})` : ""} within ${timeoutMs / 1000}s (have ${mine.length})`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

/** How many messages are addressed to `to` right now. */
export async function countTo(box, to) {
  return (await readAll(box)).filter((m) => m.to.toLowerCase().includes(to.toLowerCase())).length;
}

/** Auth's SMTP settings that send through `box` (with `pass`: its own password, or a wrong one so sending fails). */
export function smtpSettings(box, pass) {
  return { smtp_host: box.smtp.host, smtp_port: String(box.smtp.port), smtp_user: box.user, smtp_pass: pass, smtp_admin_email: box.user, smtp_sender_name: "UniBuzz (staging test)", rate_limit_email_sent: 30 };
}
/**
 * Supabase's built-in sender again (staging's setting), by clearing the SMTP fields: the API takes no sender name or
 * email rate without custom SMTP, and the built-in sender's limit is fixed.
 */
export const BUILT_IN_SENDER = { smtp_host: null, smtp_port: null, smtp_user: null, smtp_pass: null, smtp_admin_email: null };
