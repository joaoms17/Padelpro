import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PadelPro Vision",
  description: "Análise de padel com Gemini AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body className="min-h-screen flex flex-col">
        <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-6 flex-shrink-0">
          <Link href="/" className="flex items-center gap-2 font-bold text-white">
            <span className="text-brand text-xl">●</span>
            PadelPro
          </Link>
          <div className="flex gap-4 text-sm">
            <Link href="/matches" className="text-gray-400 hover:text-white transition-colors">
              Jogos
            </Link>
          </div>
        </nav>
        <main className="flex-1 px-6 py-8 max-w-6xl mx-auto w-full">
          {children}
        </main>
      </body>
    </html>
  );
}
