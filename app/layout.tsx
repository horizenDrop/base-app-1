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
      <head>
        <meta name="base:app_id" content="6995a0a325337829d86a541c" />
      </head>
      <body>{children}</body>
    </html>
  );
}
