import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Proactive AI — From turns to timelines",
  description:
    "An executable research demo for replannable temporal message queues and proactive LLM conversations.",
  openGraph: {
    title: "Proactive AI — From turns to timelines",
    description:
      "AI conversation that can wait, speak in bursts, reconsider, and initiate.",
    images: [{ url: "/og.png", width: 1731, height: 909 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f2efe8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
