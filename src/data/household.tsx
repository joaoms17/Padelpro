import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import type { Account, Category } from "@/lib/types";

interface HouseholdState {
  householdId: string | null;
  accounts: Account[];
  categories: Category[];
  categoriesById: Map<string, Category>;
  contaCasa: Account | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<HouseholdState | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const householdId = member?.household_id ?? null;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!householdId) {
      setAccounts([]);
      setCategories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [accRes, catRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("household_id", householdId),
      supabase
        .from("categories")
        .select("*")
        .eq("household_id", householdId)
        .eq("archived", false)
        .order("sort"),
    ]);
    setAccounts((accRes.data as Account[]) ?? []);
    setCategories((catRes.data as Category[]) ?? []);
    setLoading(false);
  }, [householdId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<HouseholdState>(() => {
    const categoriesById = new Map(categories.map((c) => [c.id, c]));
    const contaCasa =
      accounts.find((a) => a.role === "casa") ?? accounts[0] ?? null;
    return {
      householdId,
      accounts,
      categories,
      categoriesById,
      contaCasa,
      loading,
      reload,
    };
  }, [householdId, accounts, categories, loading, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold(): HouseholdState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHousehold must be used within HouseholdProvider");
  return ctx;
}
