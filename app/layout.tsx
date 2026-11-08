import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mandate - an AI shopping agent that can only spend inside your rules",
  description:
    "Give an AI agent a signed spending mandate backed by a PayPal authorization. Every purchase is checked by a rules engine and an independent auditor before a single dollar moves.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
