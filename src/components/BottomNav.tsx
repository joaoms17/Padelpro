import { NavLink } from "react-router-dom";

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
    label: "Início",
    icon: (a) => (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" stroke={stroke(a)} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
  {
    to: "/conferir",
    label: "Entradas",
    icon: (a) => (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M12 4v11M7 10l5 5 5-5" stroke={stroke(a)} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 19h16" stroke={stroke(a)} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: "/metricas",
    label: "Métricas",
    icon: (a) => (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M5 20V10M12 20V4M19 20v-7" stroke={stroke(a)} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: "/definicoes",
    label: "Definições",
    icon: (a) => (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <circle cx="12" cy="12" r="3" stroke={stroke(a)} strokeWidth="1.8" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" stroke={stroke(a)} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function BottomNav() {
  return (
    <nav
      className="sticky bottom-0 z-20 border-t border-areia/70 dark:border-white/10 bg-creme/90 dark:bg-tinta/90 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-xl mx-auto grid grid-cols-5">
        {ITEMS.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === "/"}
            className="flex flex-col items-center gap-1 py-2.5 text-[11px]"
          >
            {({ isActive }) => (
              <>
                {it.icon(isActive)}
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
