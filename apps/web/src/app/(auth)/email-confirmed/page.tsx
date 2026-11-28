import type { Metadata } from "next";
import { EmailConfirmed } from "@/components/auth/email-confirmed";
import { firstParam, safeNextPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Email confirmed" };

/**
 * Where a confirmation link of the implicit flow lands, through the callback route (sign-up and a new link, from the
 * website or the app). Its session is in the URL fragment, read on the client (components/auth/email-confirmed.tsx).
 */
export default async function EmailConfirmedPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  return (
    <>
      <h1 className="mb-6 text-center text-2xl font-bold">Confirming your email</h1>
      <EmailConfirmed next={safeNextPath(firstParam(params.next) ?? null, "/settings/profile?welcome=1")} />
    </>
  );
}
