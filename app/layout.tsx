import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "취준 일정 | 지금 해야 할 일을 보여주는 일정 앱",
  description:
    "한 줄로 빠르게 등록하고, 현재 해야 할 취업 준비 일정을 바로 확인하세요.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
