import type { Metadata } from "next";
import { getAllowedEmailDomains } from "@apartment-book/shared";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reset your password" };

/** "Forgot password?": the email to send a recovery link to. The reply never says whether an account exists. */
export default async function ForgotPasswordPage() {
  const domains = await getAllowedEmailDomains(await createClient()).catch(() => [] as string[]);
  return (
    <>
      <h1 className="mb-2 text-center text-2xl font-bold">Reset your password</h1>
      <p className="mb-6 text-center text-sm text-gray-600">Enter the email you signed up with and we&apos;ll send a link to choose a new password.</p>
      <ForgotPasswordForm domains={domains} />
    </>
  );
}
