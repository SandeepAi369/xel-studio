import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

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
  title: "XeL Studio | AI Research & Cyber Security",
  description: "Architecting Intelligence - AI Research, Custom Models, and Cyber Security Tools by Sandeep",
  keywords: ["AI Research", "Cyber Security", "LLM", "Machine Learning", "Security Tools"],
  authors: [{ name: "Sandeep" }],
  openGraph: {
    title: "XeL Studio | AI Research & Cyber Security",
    description: "Architecting Intelligence - AI Research, Custom Models, and Cyber Security Tools",
    type: "website",
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
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
