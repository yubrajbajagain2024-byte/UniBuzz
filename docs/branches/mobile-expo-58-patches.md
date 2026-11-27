# mobile-expo-58-patches

- **Owner:** Sunil. **As of 2026-11-27:** branched from `main` at `ba60b7b`. Written by an AI session.
- **Purpose:** the dependency advisories left after PR #139, all inside Expo SDK 58's tooling, fixed by moving the app
  to SDK 58's latest versions (no SDK change, no downgrade) with a new native build, as the owner decided
  (2026-11-27).

## What it changes

- `apps/mobile/package.json` (`npx expo install --fix` from `apps/mobile`): `expo` 58.0.19 to 58.1.0, React Native
  0.88.0 to 0.88.1, and the 29 other SDK 58 packages to the versions SDK 58 expects (`expo-router` 58.0.33,
  `expo-updates` 58.0.23, `expo-notifications` 58.1.10, `react-native-safe-area-context` 5.11.1,
  `react-native-screens` 4.30.1, …). No app code changed.
- `package-lock.json`: npm first nested the new versions under `apps/mobile/node_modules` beside the old ones at the
  root (two `expo` copies, which Metro must not see). The stale lock entries for Expo and React Native packages were
  dropped and installed again, so each has one hoisted copy; the third-party config plugins
  (`@config-plugins/react-native-webrtc`, `@livekit/react-native-expo-plugin`) keep their versions.

## Results (2026-11-27)

- `npm audit`: 13 advisories (2 high) to **6 moderate**, none in the app at run time:
  - `minimatch` (< 11.0.1) in `@expo/fingerprint` 0.22.0 (through `expo` and the WebRTC config plugin's peer): it
    matches only the project's own ignore patterns when computing the runtime version. No SDK 58 fix.
  - `uuid` 3.4.0 in `@expo/ngrok` (the optional `expo start --tunnel` helper), which calls only `v4()`; the advisory
    is about v3, v5 and v6 with a buffer. No fix in `@expo/ngrok` 4.
- `npx expo install --check`: up to date. `expo-doctor`: 20/20 (one check failed before: 31 packages out of date).
- `npm run check` (all 9 tasks, the mobile typecheck included) passes; `test:shared` 321/321.
- `npx expo export` bundles for iOS (2,867 modules) and Android (3,067).
- Native fingerprint: `49dc2a1…` on `main` to `355f83e…` here (44 sources: autolinking and the native packages), so
  **a new native build is required**. Existing builds will not take an update made from this branch, by design.

## Next steps (each waits on the owner)

1. A `preview` build from this branch (`npx eas-cli@latest build --profile preview --platform ios`, then Android, from
   `apps/mobile`), installed and checked on a tester's iPhone: sign-in, Home, Stories, Reels, messages, camera,
   notifications.
2. Merge only once testers have that build: after the merge, an `eas update` from `main` carries the new fingerprint
   and stops reaching the builds testers have now.
