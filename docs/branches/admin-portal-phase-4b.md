# admin-portal-phase-4b

- **Owner:** Sunil. **As of 2026-11-27:** branched from `main` at `7b73861` (Phase 3 merged; 76, 77 and 78 live).
  Written by an AI session.
- **Purpose:** Phase 4b of the **UniBuzz Master Admin Portal** roadmap ([../status.md](../status.md), one moderation
  model): Trust & Safety's review queue, until now only in the website's console (`/admin`), in the portal. **No
  migration**: migration 41's functions (`console_queue`, `_counts`, `_item`, `_claim`, `_release`, `_act`, `_bulk`,
  `_unmask`).

## What 4b changes (apps/admin only)

- **Moderation > Queue** (`/queue`): the nine views with their counts (Escalated for owners and admins, as SQL shows
  it), filters by guideline, surface and source (and a queue id in Closed), cards with priority, severity rail, SLA
  timer and who is reviewing what, paging, and select mode for bulk actions (approve, dismiss reports or remove, up
  to 50 items, one audit row each; P0, wellbeing, escalated and appeal items skipped by SQL).
- **A queue item** (`/queue/<id>`; opening it claims it for 10 minutes): the content with matched spans, media, the
  engine's rule hits and signals, the blind Buzz thread context, the reports (a reporter's name for admins only,
  public content only, logged in SQL), the history, the author (a public profile, or Buzz's blind bucketed standing),
  the ladder's suggestion, the action sheet (the ladder filtered by role: suspensions, bans, lifts and external
  escalation for owners and admins), the claim, and for owners and admins on a Buzz item the unmask step (reason
  code, a written reason of 30+ characters, the typed word UNMASK; the identity held in component state for five
  minutes and never refreshed into a page).
- **Who:** the platform's staff only. The pages and every action pass a minimum role, which a campus admin never
  passes (`lib/admin.ts`), as SQL rules (`ts_require_staff()` refuses campus admins; migration 74 left the queue to the
  platform). Section tabs take an optional `minRole` for the same reason (`lib/sections.ts`; the shell passes the role
  to `components/shell/permissions-context.tsx`), so the Queue tab never shows to a campus admin.
- Ported from the website's console with its privacy rules unchanged: `lib/console/queue-types.ts`,
  `queue-constants.ts`, `queue-format.ts`, `queue-actions.ts` (server actions); `components/moderation/queue-*` and
  `components/console/live.tsx`; `Pill` gains the outline variant. The dashboard links the queue's priority items and,
  for owners and admins, escalated ones. The website's `/admin` queue stays until Phase 9 retires it after parity.

## Tests (2026-11-27)

- `npm run check` passes (9 tasks).
- Browser, the portal's dev server against staging, in Chrome:
  - Two queue items seeded on staging through `ts_enqueue` (a public profile item; a blocked Buzz text under threats
    and violence), then: the admin sees both and the Escalated view, the Buzz item blind (mask frame, blind standing,
    no name) with Unmask offered, the profile item with its public author, and approves it through the action sheet
    (closed in SQL); the moderator sees no Escalated view, the Buzz item blind and no Unmask; the claim released. Both
    rows deleted afterwards (`mod_queue` back to 0; the action's log row stays, as staging's logs do). A first run's
    failures were the test's own (a wrong guideline id; blocked text is unmaskable only for threats and self-harm,
    which the portal honoured).
  - `apps/admin/e2e/admin.mjs` (new queue step) as the staging admin and moderator, and
    `apps/admin/e2e/campus-admin.mjs` 8/8 (now also: `/queue` refused and no Queue tab for a campus admin).

## Next steps

1. The owner's approval to merge (no migration; merging deploys the portal).
2. 4c, one sanction system; 4d, safety metrics.
