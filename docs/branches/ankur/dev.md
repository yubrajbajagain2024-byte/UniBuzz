# ankur/dev

- **Owner:** Ankur. **As of 2026-11-05:** at `main` (`3a5c613`, PR #107); everything merged (PRs
  #35, #38, #41, #50 and #84). Ankur's active feature line.
- **Purpose:** Ankur's day-to-day feature work, merged into `main` through PRs. Since 2026-11-01 a
  session working for Ankur develops, tests, pushes and merges his own PRs without asking; each
  production write waits on Sunil (root CLAUDE.md, "Workflow").

## Completed

- `5ec8dcb`: the Discover tab, with search and what is popular on every campus (migrations 44 and
  46, live since 2026-11-03). Since Sunil's redesign the search screen (the magnifier beside the
  bell) shows it.
- `cd742f6`: a floating "+" on Orbit and a menu under your photo.
- `e3b71c9`: the Buzz toast shows the message, not only the icon.
- `a56005e` (PR #41, 2026-10-27): an emoji no longer holds a Buzz for review.
- PR #50 (2026-10-28): Buzz. In the app: replies as a Reddit-style tree (migration 51), "Top reply"
  on feed cards (52), one thread per day's prompt (53). In the app and on the website: an optional
  category on a buzz (54). Sunil then restyled the app's thread on top of the tree (PR #66) and
  opened Buzz's media in the full-screen viewer (PRs #64, #65).
- PR #84 (merged 2026-11-02): `supabase/tests/discover-buzz-rollout.test.mjs` rehearses 44 + 46,
  then 51 to 54, as two transactions on production's state; 53 fills only blank titles on older
  prompt answers (Yubraj's change from PR #54, applied unchanged).
- 2026-11-03 00:19 UTC: 44, 46 and 51 to 54 went live with the Business v2 release, in one
  `db:setup` run with the rest of it and Sunil's approval (docs/migrations.md), not in the two
  transactions the rehearsal planned. Testers' Android build `0493abcf`, made on 2026-11-03 after
  the release, has the app's side; there is no iPhone build (docs/status.md).

## Pending

- [ ] Check Discover and Buzz on production on a phone: a reply to a reply to a reply nests, a buzz
      with replies shows "Top reply", an answer to today's prompt goes into its thread, a picked
      category shows, the search screen shows popular posts and trending topics.
- [ ] The website's Buzz: the reply tree, top reply and prompt threads are in the app only.
- [ ] Buzz category sections: categories are stored and shown; nothing filters by them yet.
- [ ] PR #54 (Yubraj) is still open; PR #84 carried its change, so closing it is Yubraj's call.

## Tests

- See [../../testing.md](../../testing.md) for the results.

## Next steps

1. The phone check above.
2. Bring the website's Buzz up to the app; decide how category sections work.
