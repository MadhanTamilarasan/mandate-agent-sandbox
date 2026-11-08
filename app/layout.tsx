import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Newsreader } from "next/font/google";
import "./globals.css";

// Display serif with an optical-size axis, a humanist UI sans, and a mono for ids and figures.
const display = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], variable: "--font-display", display: "swap" });
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2ede2" },
    { media: "(prefers-color-scheme: dark)", color: "#13110e" },
  ],
};

export const metadata: Metadata = {
  title: "Mandate - an AI shopping agent that can only spend inside your rules",
  description:
    "Give an AI agent a signed spending mandate backed by a PayPal authorization. Every purchase is checked by a rules engine and an independent auditor before a single dollar moves.",
};

// Runs before first paint so there is no light/dark flash: stored choice, else the system setting.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('mandate-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`} data-theme="light" suppressHydrationWarning>
      <head>
        {/* Plain inline script on purpose: it must run during parsing, before first paint.
            React 19 logs a dev-only notice for scripts in the tree; it is harmless here. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
