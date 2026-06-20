import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Streaming Prototype",
  description: "VOD + live streaming demo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-yt-bg text-yt-text">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
