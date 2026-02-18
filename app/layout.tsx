import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pragma",
  description: "Onchain survival mini app on Base"
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
