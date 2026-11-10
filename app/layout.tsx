import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Mission Control",
  description: "Signal over noise: what to work on now, next and today.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#05060b" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="aurora" aria-hidden />
        {children}
      </body>
    </html>
  );
}
