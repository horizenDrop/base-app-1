import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Base Tap Score",
  description: "Mini app with gasless score submission on Base"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

