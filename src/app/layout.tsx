import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BEAN EXAMS — One syllabus. Every topic.",
  description:
    "Premium preparation for Indian competitive examinations, with verified syllabus coverage, honest resource availability, real practice tests, and topic-aware learning support through BEAN Intelligence.",
  keywords: [
    "BEAN EXAMS", "TNPSC", "UPSC", "SSC", "IBPS", "RRB", "NEET", "Indian competitive exams",
    "study material", "practice tests", "BEAN Intelligence",
  ],
  authors: [{ name: "BEAN EXAMS" }],
  icons: { icon: "/logo.svg" },
};

export const viewport: Viewport = {
  themeColor: "#070707",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
