import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import TopLoader from "@/components/TopLoader";
import { Suspense } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://xel-studio.vercel.app"),
  title: {
    default: "XeL Studio | AI Research & Cyber Security Platform",
    template: "%s | XeL Studio",
  },
  description:
    "XeL Studio is an AI research and cyber security platform by Sandeep. Explore automated AI news, research articles, AI chat (Gemini), security tools, text-to-speech, and more.",
  keywords: [
    "AI Research", "Cyber Security", "AI News", "LLM", "Machine Learning",
    "Security Tools", "AI Chat", "Gemini AI", "Research Articles",
    "Text-to-Speech", "Artificial Intelligence", "XeL Studio",
  ],
  authors: [{ name: "Sandeep", url: "https://github.com/SandeepAi369" }],
  creator: "Sandeep",
  publisher: "XeL Studio",
  verification: {
    google: "FM0rU4JR-PGH2cL8V8PCqNo0bflPeEGiwD6cAcG-jOQ",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: "XeL Studio | AI Research & Cyber Security Platform",
    description:
      "AI-powered news aggregation, research articles, Gemini chat, security tools, and text-to-speech — all in one platform.",
    type: "website",
    url: "https://xel-studio.vercel.app",
    siteName: "XeL Studio",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "XeL Studio | AI Research & Cyber Security",
    description:
      "AI-powered news, articles, chat, security tools by Sandeep.",
  },
  alternates: {
    canonical: "https://xel-studio.vercel.app",
    types: {
      "application/rss+xml": [
        { url: "https://xel-studio.vercel.app/api/rss", title: "XeL Studio RSS Feed" },
      ],
      "text/plain": [
        { url: "https://xel-studio.vercel.app/articles.txt", title: "Articles index (plain text)" },
        { url: "https://xel-studio.vercel.app/llms-full.txt", title: "Full article contents for LLMs" },
      ],
    },
  },
  other: {
    // In-band verification of our IndexNow key so any LLM/crawler
    // can confirm ownership without making a separate request.
    "indexnow-key": "d942c55b41224d45a963b655513ab0a9",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* ── Skip-to-content link (a11y, Phase 3) ────────────────
            Visually hidden until keyboard-focused, then revealed.
            Anchors to the per-page <main> via #main-content. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-emerald-500 focus:text-black focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
        >
          Skip to main content
        </a>
        <Suspense fallback={null}>
          <TopLoader />
        </Suspense>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
