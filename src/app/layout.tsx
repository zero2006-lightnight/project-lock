import type { Metadata, Viewport } from "next";
import { Zilla_Slab, Inter_Tight, Archivo_Black, Space_Grotesk, JetBrains_Mono, Courier_Prime, Special_Elite } from "next/font/google";
import { ToastProvider } from "@/components/ui/toaster";
import { MotionProvider } from "@/components/motion/MotionProvider";
import "./globals.css";

const zillaSlab = Zilla_Slab({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-zilla",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
});

// Neo-brutalism display/sans/mono faces (Phase 0 — loaded alongside the
// existing faces; call sites opt in via font-brutal-* utilities).
const archivoBlack = Archivo_Black({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-archivo",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

// Typewriter voice (user request): Special Elite for display/stamps,
// Courier Prime (readable monospace) for body + functional mono.
const courierPrime = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-courier",
  display: "swap",
});

const specialElite = Special_Elite({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-special",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "StudyPilot — Your AI-powered study co-pilot",
    template: "%s · StudyPilot",
  },
  description:
    "StudyPilot turns your syllabus, deadlines and available time into a personalized study plan that adapts as you progress.",
  applicationName: "StudyPilot",
};

export const viewport: Viewport = {
  themeColor: "#ece7dd",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${zillaSlab.variable} ${interTight.variable} ${archivoBlack.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable} ${courierPrime.variable} ${specialElite.variable}`}>
      <head />
      <body className={`${zillaSlab.variable} ${interTight.variable} ${archivoBlack.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable} ${courierPrime.variable} ${specialElite.variable} font-sans antialiased`}>
        <MotionProvider>
          <ToastProvider>{children}</ToastProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
