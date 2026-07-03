import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DePress — 结构化学术写作",
  description: "内容与排版解耦的学术写作平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
