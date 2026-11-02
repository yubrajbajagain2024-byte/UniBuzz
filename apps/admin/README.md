# CampConnect Admin

The staff-only control room for UniBuzz: a separate Next.js app that talks to the same Supabase project as the
website and the mobile app.

```bash
cp .env.example .env.local   # same Supabase URL + anon key as the website
npm run dev:admin            # http://localhost:3001 (the website runs on :3000)
```

- **Analytics and Business** (for owners and admins of the staff): docs/technical-reference.md, "CampConnect Admin:
  Analytics and Business".
- **Roles, two-factor sign-in, invitations, moderation and the media worker:** the root README's section
  "Admin app (CampConnect Admin)".
- **Browser check:** `BASE=http://localhost:3001 node apps/admin/e2e/admin.mjs`, with a staff account and its
  authenticator key for the signed-in checks (see the script's header).
- **Deploying:** its own Vercel project (`campconnect-admin`, Root Directory `apps/admin`) is connected to the repository
  since 2026-11-02: every merge into `main` builds and deploys it (about a minute; the repository's `.vercelignore` strips `.git`
  from Vercel's clone, so no git-based ignore command can skip builds there). `npm run deploy:admin` deploys the local tree by hand; both are production deploys
  and need the owner's approval.
