import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { nameForEmail, allowlistConfigured } from "@/lib/members";
import type { Member } from "@/lib/types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  member: Member | null;
  /** Set when a signed-in user cannot become a member (e.g. household full). */
  memberError: string | null;
  configured: boolean;
  /** Sign in with email + password (session persists — no repeated logins). */
  signIn: (email: string, password: string) => Promise<void>;
  /** Create the account with email + password. */
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load the member row for the signed-in user; bootstrap it on first login.
  useEffect(() => {
    const user = session?.user;
    if (!user) {
      setMember(null);
      return;
    }
    let active = true;

    async function load() {
      const { data } = await supabase
        .from("members")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (data) {
        if (active) {
          setMember(data as Member);
          setMemberError(null);
        }
        return;
      }

      // Fixed identity from the email (João / Joana). Any other email is
      // rejected when the allowlist is configured.
      const mapped = nameForEmail(user!.email);
      if (allowlistConfigured && !mapped) {
        if (active) setMemberError("Esta app é só para o João e a Joana.");
        return;
      }
      const fallback = (user!.email ?? "Membro").split("@")[0];
      const display = mapped || fallback.charAt(0).toUpperCase() + fallback.slice(1);

      const { error: rpcErr } = await supabase.rpc("ensure_membership", { p_display: display });
      if (rpcErr) {
        // e.g. "o agregado já tem 2 membros" — this app is only for two people.
        if (active) setMemberError(rpcErr.message);
        return;
      }

      const { data: created } = await supabase
        .from("members")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (active) {
        setMember((created as Member) ?? null);
        setMemberError(null);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [session?.user]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      member,
      memberError,
      configured: isSupabaseConfigured,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      },
      async signUp(email, password) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        // When email confirmation is disabled, signUp returns a session and the
        // user is logged in immediately. Otherwise fall back to a sign-in.
        if (!data.session) {
          const { error: e2 } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (e2) throw e2;
        }
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [loading, session, member, memberError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
