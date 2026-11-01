import { useCallback } from "react";
import { updateProfileSettings, type ProfileSettingsPatch } from "@apartment-book/shared";
import { alertWithHaptic, hapticSuccess } from "./haptics";
import { errorText } from "./hooks";
import { useSession } from "./session";
import { supabase } from "./supabase";

/**
 * Saves a patch of your profile's settings (only what it names: see updateProfileSettings) and reloads the session's
 * profile, so every screen shows the new choice, with a success tick. Resolves to null once saved, or to what went
 * wrong, which it also says in an alert unless `alert` is false (a form that shows the error under its field); the
 * screen then puts its control back.
 */
export function useSaveProfileSettings() {
  const { user, refreshProfile } = useSession();
  return useCallback(
    async (patch: ProfileSettingsPatch, { alert = true }: { alert?: boolean } = {}): Promise<string | null> => {
      if (!user) return "You're signed out.";
      try {
        await updateProfileSettings(supabase, user.id, patch);
        await refreshProfile();
        hapticSuccess();
        return null;
      } catch (e) {
        const message = errorText(e, "Check your connection and try again.");
        if (alert) alertWithHaptic("error", "Couldn't save", message);
        return message;
      }
    },
    [user, refreshProfile],
  );
}
