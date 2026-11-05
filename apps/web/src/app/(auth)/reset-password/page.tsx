import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getCurrentUser } from "@/lib/auth";
import { firstParam } from "@/lib/utils";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Where a recovery link lands (packages/shared/src/auth.ts). The link's session is in the URL fragment, read on the
 * client; a session the server already has (the callback route exchanged a link, or the person is signed in) shows the
 * form at once. `?error=expired` is the callback route's word for a link Supabase refused.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  return (
    <>
      <h1 className="mb-6 text-center text-2xl font-bold">Choose a new password</h1>
      <ResetPasswordForm hasSession={user !== null} initialError={firstParam(params.error)} />
    </>
  );
}
