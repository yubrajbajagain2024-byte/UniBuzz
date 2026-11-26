import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { connection } from "next/server";
import { ADMIN_APP_NAME, ADMIN_TAGLINE } from "@/lib/brand";
import { getSiteUrl } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: ADMIN_APP_NAME,
    template: `%s · ${ADMIN_APP_NAME}`,
  },
  description: ADMIN_TAGLINE,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page is rendered per request, the 404 page included, so each response gets the proxy's CSP nonce on its
  // scripts (lib/csp.ts); a page built ahead of time would carry none and its scripts would be refused.
  await connection();
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
