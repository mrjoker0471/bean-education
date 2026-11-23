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
  title: "BEAN Education — Learn. Practise. Teach. Grow.",
  description:
    "A premium education platform for Indian learners: examination preparation with honest coverage, AI-grounded practice through Riishe, live classrooms and verified teachers on BEAN Teach, institution workspaces and career opportunities.",
  keywords: [
    "BEAN Education", "TNPSC", "UPSC", "SSC", "IBPS", "RRB", "NEET", "CUET", "Indian competitive exams",
    "study material", "practice tests", "Riishe AI", "BEAN Teach",
  ],
  authors: [{ name: "BEAN Education" }],
  icons: {
    icon: [{ url: "/logo.svg", type: "image/svg+xml" }],
    apple: [{ url: "/logo.svg" }],
    shortcut: ["/logo.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0C",
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
