import { useRouter } from "expo-router";
import { openCompose } from "@/lib/compose-nav";
import { useSession } from "@/lib/session";

/**
 * What every create button on Home does: opens the live camera at once (app/compose), TikTok's way. Create in the
 * middle of the bottom bar (app/(tabs)/_layout.tsx) passes `snap` and lands on SNAP, the camera's default, with BUZZ to
 * its left and POST and REEL to its right; your circle in the story tray and Upload in the menu under your photo
 * (ProfileMenuSheet) land on POST, where a story is shared (`upload`: the library straight away). Signed out it goes to
 * the login screen instead. Home's top bar has no "+".
 */
export function useCreateMenu(): (opts?: unknown) => void {
  const router = useRouter();
  const { user } = useSession();
  // Often an onPress itself, so `opts` may be a press event: only an explicit { upload: true } or { snap: true } counts.
  return (opts) => {
    if (!user) return router.push("/(auth)/login");
    const flags = typeof opts === "object" && opts !== null ? (opts as { upload?: unknown; snap?: unknown }) : {};
    if (flags.snap === true) return openCompose(router, "snap");
    openCompose(router, "post", { upload: flags.upload === true });
  };
}
