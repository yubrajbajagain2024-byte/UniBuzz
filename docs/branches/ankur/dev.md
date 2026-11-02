# ankur/dev

- **Owner:** Ankur. **As of 2026-11-01:** at `main` (`7dd513a`, PR #83) plus one PR: the offline
  rehearsal for putting Discover (44, 46) and Buzz (51 to 54) live ahead of the Business v2
  release, and Yubraj's fix to 53 from PR #54. Before it: fully merged (PRs #35, #38, #41, and #50
  on 2026-10-28). Ankur's active feature line.
- **Purpose:** Ankur's day-to-day feature work, merged into `main` through PRs. Since 2026-11-01 a
  session working for Ankur develops, tests, pushes and merges his own PRs without asking; each
  production write waits on Sunil (root CLAUDE.md, "Workflow").

## Completed

- `5ec8dcb`: the Discover tab, with search and what is popular on every campus (migration 44,
  `20261103000300_discover.sql`, **not on production**). Since Sunil's redesign the search screen
  (the magnifier beside the bell) shows it.
- `cd742f6`: a floating "+" on Orbit and a menu under your photo.
- `e3b71c9`: the Buzz toast shows the message, not only the icon.
- `a56005e` (PR #41, 2026-10-27): an emoji no longer holds a Buzz for review.
- PR #50 (2026-10-28): Buzz. In the app: replies as a Reddit-style tree (migration 51), "Top reply"
  on feed cards (52), one thread per day's prompt (53). In the app and on the website: an optional
  category on a buzz (54). Sunil then restyled the app's thread on top of the tree (PR #66) and
  opened Buzz's media in the full-screen viewer (PRs #64, #65).
- This PR (2026-11-01): `supabase/tests/discover-buzz-rollout.test.mjs` rehearses 44 + 46, then 51
  to 54, as two transactions on production's state, the rest of the release after them, the undo,
  and both again; 53 now fills only blank titles on older prompt answers (Yubraj's change from PR
  #54, applied unchanged).

## Pending

- [ ] 44, 46 and 51 to 54 are not on production (docs/migrations.md, "44, 46 and 51 to 54 ahead of
      the release"): the staging rehearsal (needs a staging token), a full backup and Sunil's
      approval. Until then Discover and Buzz fall back on the live app.
- [ ] After they are live: take the six out of the release lists (`PENDING`, `RELEASE` and the
      rollout suites) and record them in docs/migrations.md.
- [ ] The website's Buzz: the reply tree, top reply and prompt threads are in the app only.
- [ ] Buzz category sections: categories are stored and shown; nothing filters by them yet.
- [ ] Testers get the app's side with an EAS update (Sunil's approval).

## Tests

- 2026-11-01 on this branch: see [../../testing.md](../../testing.md) for the results.

## Next steps

1. Merge this PR once its checks pass.
2. With a staging token: apply the two transactions on staging and smoke-test Discover and Buzz.
3. With Sunil's approval, one operation at a time: a full backup, then the two transactions on
   production, then the checks; then a PR that records them and updates the release lists.
4. Bring the website's Buzz up to the app; decide how category sections work.
