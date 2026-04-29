import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OneClickCast — Instant Screen Sharing",
  description:
    "Share your screen with anyone in one click. No install needed for viewers, even on mobile.",
  themeColor: "#4F46E5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full font-sans antialiased text-surface-dark bg-white">
        {children}
      </body>
    </html>
  );
}
