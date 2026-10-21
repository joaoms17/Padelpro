import { Link, Outlet, useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";

// The four main screens show the way to the settings (top right).
const MAIN = [/^\/$/, /^\/meses/, /^\/plano/, /^\/movimentos/];

export function AppShell() {
  const { pathname } = useLocation();
  const main = MAIN.some((r) => r.test(pathname));
  return (
    <div className="min-h-full flex flex-col">
      <main className="relative flex-1 w-full max-w-xl mx-auto px-4 sm:px-5 py-6 pb-24">
        {main && (
          <Link
            to="/definicoes"
            aria-label="Definições"
            className="absolute right-4 top-6 w-10 h-10 rounded-full flex items-center justify-center text-tinta/50 dark:text-creme/50 hover:bg-areia/50 dark:hover:bg-white/5"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </Link>
        )}
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
