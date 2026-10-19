import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { identityConfigured } from "@/lib/tenant";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "EngineX AI",
  description:
    "Signal-based pipeline engine for boutique consultancies — accounts that need your services now, with research briefs and drafted outreach.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Each signed-in user works in their own workspace, so the app needs Clerk's
  // context on the client as well as on the server. It is mounted only when the
  // keys are present: ClerkProvider without a publishable key throws, and a
  // development install (or a single-workspace deployment) has none.
  const identityEnabled = identityConfigured();

  const shell = (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="mx-auto flex min-h-screen w-full max-w-[1400px] gap-0">
          <Suspense fallback={<div className="hidden w-60 shrink-0 md:block" />}>
            <Nav identityEnabled={identityEnabled} />
          </Suspense>
          <main className="min-w-0 flex-1 px-6 py-8 lg:px-10">{children}</main>
        </div>
      </body>
    </html>
  );

  return identityEnabled ? <ClerkProvider>{shell}</ClerkProvider> : shell;
}
