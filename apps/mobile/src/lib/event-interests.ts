import AsyncStorage from "@react-native-async-storage/async-storage";

/*
 * Events' interests (event_interests, what For you puts first) as a setting rather than a panel: For you asks once, in a
 * single line that can be dismissed for good (remembered on this phone, per account), and the interests are changed
 * from the Events filter sheet's "Your interests" (app/events/interests.tsx). Saving them there tells For you, which
 * re-ranks at once.
 */

const listeners = new Set<() => void>();

/** Hears every save of the interests; returns the unsubscribe. */
export function onEventInterestsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The interests were saved: For you loads them again. */
export function emitEventInterestsChanged(): void {
  for (const listener of [...listeners]) listener();
}

const promptKey = (userId: string) => `unibuzz.events.interests-prompt-dismissed.${userId}`;

/** Whether this account dismissed For you's interests prompt on this phone. Unknown storage reads as not dismissed. */
export async function interestsPromptDismissed(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(promptKey(userId))) === "1";
  } catch {
    return false;
  }
}

/** For you never asks this account again on this phone; Your interests in the filter sheet stays. */
export function dismissInterestsPrompt(userId: string): void {
  void AsyncStorage.setItem(promptKey(userId), "1").catch(() => {});
}
