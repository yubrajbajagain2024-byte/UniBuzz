import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useSession } from "./session";

/**
 * Opens a person's profile from a post, a reel, a comment or a mention: someone else's is pushed over the screen (and
 * closes with a swipe back, see components/profile/profile-view.tsx); your own is the Profile tab itself, as on
 * Instagram, rather than a second copy of it stacked over the feed. Leaving the feed for the tab keeps the feed where it
 * was.
 */
export function useOpenProfile(): (id: string) => void {
  const router = useRouter();
  const { user } = useSession();
  const me = user?.id ?? null;
  return useCallback(
    (id: string) => {
      if (id && id === me) router.navigate("/(tabs)/profile");
      else router.push({ pathname: "/profile/[id]", params: { id } });
    },
    [router, me],
  );
}
