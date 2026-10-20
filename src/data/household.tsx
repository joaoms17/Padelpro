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
import { mergeGroupLabels } from "@/lib/categories";
import type { Account, Category, CategoryGroup } from "@/lib/types";

interface HouseholdState {
  householdId: string | null;
  accounts: Account[];
  categories: Category[];
  categoriesById: Map<string, Category>;
  /** Group ("separador") names, with the household's renames applied. */
  groupLabels: Record<CategoryGroup, string>;
  contaCasa: Account | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<HouseholdState | null>(null);

/** State updater that keeps the previous value when the new one is equal. */
function keepIfSame<T>(next: T): (prev: T) => T {
  return (prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const householdId = member?.household_id ?? null;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customLabels, setCustomLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent: boolean) => {
    if (!householdId) {
      setAccounts([]);
      setCategories([]);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    const [accRes, catRes, setRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("household_id", householdId),
      supabase
        .from("categories")
        .select("*")
        .eq("household_id", householdId)
        .eq("archived", false)
        .order("sort"),
      supabase.from("settings").select("group_labels").eq("household_id", householdId).maybeSingle(),
    ]);
    // A quiet refresh that fails (offline) keeps what is on screen.
    if (silent && (accRes.error || catRes.error)) return;
    // Unchanged data keeps its identity: screens that reload on a new
    // categories list (and would reset an open form) are left alone.
    if (!silent) setAccounts((accRes.data as Account[]) ?? []);
    setCategories(keepIfSame((catRes.data as Category[]) ?? []));
    // Missing column/row (before migration 0009) simply means defaults.
    setCustomLabels(keepIfSame(((setRes.data as { group_labels?: Record<string, string> } | null)?.group_labels) ?? {}));
    setLoading(false);
  }, [householdId]);

  const reload = useCallback(() => load(false), [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Back to the app (the other person may have edited categories meanwhile):
  // refresh the categories quietly, so nobody files movements under a
  // removed one. Accounts are left as they are (a balance change would
  // reload the screens that depend on it).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const value = useMemo<HouseholdState>(() => {
    const categoriesById = new Map(categories.map((c) => [c.id, c]));
    const groupLabels = mergeGroupLabels(customLabels);
    const contaCasa =
      accounts.find((a) => a.role === "casa") ?? accounts[0] ?? null;
    return {
      householdId,
      accounts,
      categories,
      categoriesById,
      groupLabels,
      contaCasa,
      loading,
      reload,
    };
  }, [householdId, accounts, categories, customLabels, loading, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold(): HouseholdState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHousehold must be used within HouseholdProvider");
  return ctx;
}
