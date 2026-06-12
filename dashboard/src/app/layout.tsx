import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ApiBanner } from "@/components/ApiBanner";

export const metadata: Metadata = {
  title: "PadelPro Vision",
  description: "Análise de padel por visão computacional",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body className="min-h-screen flex flex-col">
        <Nav />
        <ApiBanner />
        <main className="flex-1 px-6 py-8 max-w-6xl mx-auto w-full">
          {children}
        </main>
        <footer className="border-t border-gray-800/60 px-6 py-5">
          <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-gray-600 flex-wrap gap-2">
            <span>PadelPro Vision — análise de padel por visão computacional</span>
            <Link href="/ajuda" className="hover:text-gray-400 transition-colors">
              Como funciona →
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
