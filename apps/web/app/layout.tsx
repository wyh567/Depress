import type { Metadata } from "next";
import { sourceSerif4 } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "DePress — 结构化学术写作",
  description: "内容与排版解耦的学术写作平台",
};

// `sourceSerif4.variable` only defines the `--font-source-serif-4` custom
// property in scope on <html> — it does not set `font-family` on body or
// anywhere else, so this is visually inert everywhere except the one
// screen (currently: /login) that opts into the variable explicitly.
// T-06 Slice 2.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`h-full antialiased ${sourceSerif4.variable}`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
