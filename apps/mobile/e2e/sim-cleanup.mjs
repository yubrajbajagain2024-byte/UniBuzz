import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { e2eRef } from "../../../scripts/e2e-target.mjs";
const s = JSON.parse(fs.readFileSync(new URL(".sim-state.json", import.meta.url), "utf8"));
// The project the seed used (older state files have none: then production, or STAGING_SUPABASE_REF).
const ref = s.ref ?? (await e2eRef(process.env.SUPABASE_ACCESS_TOKEN));
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } })).json();
const admin = createClient(`https://${ref}.supabase.co`, keys.find((k) => k.name === "service_role").api_key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: convs } = await admin.from("conversation_members").select("conversation_id").in("user_id", [s.me.id, s.other.id, ...(s.extra ?? []).map((u) => u.id)]);
// Files sent in those chats (photos, videos, voice messages) sit in message-media/<chat>/<sender>/ and no row deletes
// them with the chat, so they go first; then the chats, their messages with them.
const removeFolder = async (bucket, prefix) => {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) await removeFolder(bucket, path);
    else await admin.storage.from(bucket).remove([path]);
  }
};
for (const c of new Set((convs ?? []).map((c) => c.conversation_id))) {
  await removeFolder("message-media", c);
  await admin.from("conversations").delete().eq("id", c);
}
if (s.buzzId) await admin.from("buzz_posts").delete().eq("id", s.buzzId); // threads outlive accounts by design, so remove the test one explicitly
await admin.from("buzz_posts").delete().is("author_id", null).like("title", "%(sim test)%");
await admin.from("buzz_secrets").update({ thread_jitter_seconds: 180, reply_jitter_seconds: 45 }).eq("id", 1);
for (const id of [s.me.id, s.other.id, ...(s.extra ?? []).map((u) => u.id)]) await admin.auth.admin.deleteUser(id);
console.log("cleaned up sim users and their data");
