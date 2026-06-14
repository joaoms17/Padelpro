"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/modelo", label: "O teu modelo" },
  { href: "/tempo-util", label: "Tempo útil" },
  { href: "/ajuda", label: "Como funciona" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-800/80 bg-black/60 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-5 flex-wrap">
        <Link href="/" className="flex items-center gap-2 font-bold text-white text-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/padelpro_icon.svg" alt="" className="w-7 h-7 rounded-lg" />
          <span className="font-display tracking-tight">Padel<span className="text-brand">Pro</span></span>
        </Link>

        <Link
          href="/"
          className={`px-3 py-1.5 rounded-full text-sm font-bold transition-colors ${
            pathname === "/"
              ? "bg-brand text-navy-950"
              : "bg-brand/15 text-brand hover:bg-brand hover:text-navy-950"
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
