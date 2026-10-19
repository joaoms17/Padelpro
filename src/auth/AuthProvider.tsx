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
import type { Member } from "@/lib/types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  member: Member | null;
  configured: boolean;
  /** Send a 6-digit OTP code to the email. */
  sendCode: (email: string) => Promise<void>;
  /** Verify the 6-digit code and open a session. */
  verifyCode: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<Member | null>(null);

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
        if (active) setMember(data as Member);
        return;
      }

      // No member yet → create household/membership (João) or join it (Joana).
      const fallbackName = (user!.email ?? "Membro").split("@")[0];
      const display = fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1);
      await supabase.rpc("ensure_membership", { p_display: display });

      const { data: created } = await supabase
        .from("members")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (active) setMember((created as Member) ?? null);
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
      configured: isSupabaseConfigured,
      async sendCode(email) {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
      },
      async verifyCode(email, token) {
        const { error } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: token.trim(),
          type: "email",
        });
        if (error) throw error;
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [loading, session, member],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
