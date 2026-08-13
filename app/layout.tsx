import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "빈칸 | 한 줄로 채우는 나만의 하루",
  description:
    "내 마음대로 한 줄을 적으면 날짜와 시간을 알아서 정리해 주는 가벼운 하루 일정 앱.",
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
