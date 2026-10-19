import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";

export function AppShell() {
  return (
    <div className="min-h-full flex flex-col">
      <main className="flex-1 w-full max-w-xl mx-auto px-5 py-6 pb-24">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
