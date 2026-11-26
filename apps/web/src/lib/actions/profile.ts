"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  deleteMyAccount,
  flattenZodError,
  getProfile,
  isProfileVisibility,
  normalizeUsername,
  profileSchema,
  requestUniversity,
  setShowActiveStatus,
  universityRequestSchema,
  updateProfile,
  usernameProblem,
  type FieldErrors,
  type ProfileSection,
  type ProfileVisibility,
} from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { profileHandle, sectionVisibility } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

const FIX_FIELDS = "Please fix the highlighted fields.";

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/settings/profile");
  const supabase = await createClient();
  const parsed = profileSchema.safeParse(formToObject(formData));
  const fieldErrors: FieldErrors = parsed.success ? {} : flattenZodError(parsed.error).fieldErrors;

  // Username and the three privacy choices are only sent when they changed, so a profile row that does not have them
  // yet (before migration 18) still saves everything else. Activity status likewise, compared with what the form showed
  // when it loaded: a form left open in an old tab must not turn back on a status hidden since (or the other way round).
  // It goes through set_show_active_status(), the only way to show it again (migration 22).
  const shownWas = formData.get("showActiveStatusWas");
  const activityChoice = (wanted: boolean): boolean | undefined => ((shownWas === "on" || shownWas === "off") && wanted === (shownWas === "on") ? undefined : wanted);
  const current = await getProfile(supabase, user.id).catch(() => null);
  const currentHandle = profileHandle(current) ?? "";
  const rawUsername = formData.get("username");
  const username = typeof rawUsername === "string" ? normalizeUsername(rawUsername) : null;
  if (username === "" && currentHandle) fieldErrors.username = ["Choose a username."];
  else if (username) {
    const problem = usernameProblem(username);
    if (problem) fieldErrors.username = [problem];
  }
  const before = sectionVisibility(current);
  const changed = (field: string, section: ProfileSection): ProfileVisibility | undefined => {
    const value = formData.get(field);
    return isProfileVisibility(value) && value !== before[section] ? value : undefined;
  };

  if (!parsed.success || Object.values(fieldErrors).some((messages) => messages?.length)) {
    return { error: FIX_FIELDS, fieldErrors, values: formValues(formData) };
  }
  try {
    await updateProfile(supabase, user.id, {
      fullName: parsed.data.fullName,
      universityId: parsed.data.universityId ?? null,
      program: parsed.data.program ?? null,
      graduationYear: parsed.data.graduationYear ?? null,
      bio: parsed.data.bio ?? null,
      avatarUrl: parsed.data.avatarUrl ?? null,
      notifyNearbyListings: parsed.data.notifyNearbyListings,
      username: username && username !== currentHandle ? username : undefined,
      classesVisibility: changed("classesVisibility", "classes"),
      savedVisibility: changed("savedVisibility", "saved"),
      likedVisibility: changed("likedVisibility", "liked"),
      listingsVisibility: changed("listingsVisibility", "listings"),
    });
    const showActiveStatus = activityChoice(parsed.data.showActiveStatus);
    if (showActiveStatus !== undefined) await setShowActiveStatus(supabase, showActiveStatus);
  } catch (error) {
    const message = errorMessage(error);
    // "That username is taken. Try another one." and friends belong under the field.
    if (/username/i.test(message)) return { error: FIX_FIELDS, fieldErrors: { username: [message] }, values: formValues(formData) };
    return { error: message, values: formValues(formData) };
  }
  revalidatePath("/", "layout");
  if (formData.get("redirectTo") === "home") redirect("/");
  return { success: "Profile saved." };
}

/**
 * Ask the UniBuzz team to add a university missing from the list (migration 70). Students no longer add one directly:
 * the list decides who may sign up, so the team reviews each request in CampConnect Admin and the database refuses
 * anything else (its messages are written for people).
 */
export async function requestUniversityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser("/settings/profile");
  const parsed = universityRequestSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please check the university details.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await requestUniversity(await createClient(), parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/settings/profile");
  return { success: `Thanks. The UniBuzz team will review ${parsed.data.name}; once it is added you can choose it above.` };
}

/**
 * Permanently delete the signed-in user's account, then sign out. The database can refuse a staff account
 * (CampConnect Admin's migration 14, live: staff need a session that passed two-factor sign-in, and the only owner
 * is refused outright); the reason comes back to the form instead of an error page.
 */
export async function deleteAccountAction(): Promise<{ error?: string }> {
  await requireUser("/settings/profile");
  const supabase = await createClient();
  try {
    await deleteMyAccount(supabase);
  } catch (error) {
    const message = errorMessage(error, "Could not delete your account. Please try again.");
    return {
      error:
        message === "Two-factor authentication required"
          ? "Staff accounts need two-factor sign-in before they can be deleted: confirm it's you at /two-factor and try again, or ask an owner to remove you from the team in the UniBuzz Master Admin Portal first."
          : message,
    };
  }
  await supabase.auth.signOut();
  redirect("/?deleted=1");
}
