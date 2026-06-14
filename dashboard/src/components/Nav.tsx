"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/matches", label: "Jogos" },
  { href: "/qualidade", label: "Deteção" },
  { href: "/calibrate", label: "Calibrar" },
  { href: "/ajuda", label: "Como funciona" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-800/80 bg-black/60 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-5 flex-wrap">
        <Link href="/" className="flex items-center gap-2 font-bold text-white text-lg">
          <span className="text-brand text-xl leading-none">●</span>
          PadelPro
        </Link>

        <Link
          href="/"
          className={`px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
            pathname === "/"
              ? "bg-brand text-white"
              : "bg-brand/15 text-brand hover:bg-brand hover:text-white"
          }`}
        >
          ⚡ Analisar
        </Link>

        <div className="flex gap-1 text-sm items-center flex-wrap ml-auto">
          {LINKS.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  active
                    ? "text-white bg-gray-800"
                    : "text-gray-400 hover:text-white hover:bg-gray-800/60"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
