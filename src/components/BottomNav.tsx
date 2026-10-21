import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useHousehold } from "@/data/household";
import { countToReview } from "@/data/transactions";

interface Item {
  to: string;
  label: string;
  icon: (active: boolean) => JSX.Element;
}

const stroke = (active: boolean) =>
  active ? "#A64B25" : "currentColor";

const ITEMS: Item[] = [
  {
    to: "/",
    label: "Este mês",
    icon: (a) => (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" stroke={stroke(a)} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: "/meses",
    label: "Meses",
    icon: (a) => (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <rect x="4" y="5" width="16" height="15" rx="2" stroke={stroke(a)} strokeWidth="1.8" />
        <path d="M4 10h16M9 3v4M15 3v4" stroke={stroke(a)} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: "/plano",
    label: "Plano",
    icon: (a) => (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <circle cx="9" cy="12" r="5" stroke={stroke(a)} strokeWidth="1.8" />
        <circle cx="15" cy="12" r="5" stroke={stroke(a)} strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    to: "/movimentos",
    label: "Movimentos",
    icon: (a) => (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M4 7h16M4 12h16M4 17h10" stroke={stroke(a)} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
];

/** How many movements wait for a category or a confirmation (the Movimentos badge). */
function useToReview(): number {
  const { householdId } = useHousehold();
  const { pathname } = useLocation();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!householdId) return;
    let active = true;
    const load = () => countToReview(householdId).then((c) => active && setN(c)).catch(() => {});
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [householdId, pathname]);
  return n;
}

export function BottomNav() {
  const toReview = useToReview();
  return (
    <nav
      className="sticky bottom-0 z-20 border-t border-areia/70 dark:border-white/10 bg-creme/90 dark:bg-tinta/90 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-xl mx-auto grid grid-cols-4">
        {ITEMS.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === "/"}
            className="flex flex-col items-center gap-1 py-2.5 text-[11px]"
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  {it.icon(isActive)}
                  {it.to === "/movimentos" && toReview > 0 && (
                    <span className="absolute -top-1.5 -right-3 min-w-[18px] h-[18px] px-1 rounded-full bg-terracota text-creme text-[10px] font-semibold leading-[18px] text-center tnum">
                      {toReview > 99 ? "99+" : toReview}
                    </span>
                  )}
                </span>
                <span
                  className={
                    isActive
                      ? "text-terracota font-medium"
                      : "text-tinta/60 dark:text-creme/60"
                  }
                >
                  {it.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
