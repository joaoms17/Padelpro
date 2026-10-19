import { useState, type ReactNode } from "react";

// Optional local lock with a 4-digit PIN, checked when the app opens.
// The PIN is stored only as a SHA-256 hash in localStorage (never sent anywhere).
const KEY = "cad.pin";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isPinSet(): boolean {
  try {
    return Boolean(localStorage.getItem(KEY));
  } catch {
    return false;
  }
}

export async function setPin(pin: string): Promise<void> {
  localStorage.setItem(KEY, await sha256(pin));
}

export function clearPin(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

async function checkPin(pin: string): Promise<boolean> {
  try {
    return localStorage.getItem(KEY) === (await sha256(pin));
  } catch {
    return false;
  }
}

export function PinLock({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => !isPinSet());
  const [pin, setPinInput] = useState("");
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  async function submit(value: string) {
    if (await checkPin(value)) {
      setUnlocked(true);
    } else {
      setError(true);
      setPinInput("");
    }
  }

  function press(d: string) {
    setError(false);
    const next = (pin + d).slice(0, 4);
    setPinInput(next);
    if (next.length === 4) void submit(next);
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-8 px-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-display">Contas a Dois</h1>
        <p className="text-tinta/60 dark:text-creme/60">Introduz o PIN</p>
      </div>

      <div className={`flex gap-3 ${error ? "animate-pulse" : ""}`}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 ${
              i < pin.length
                ? "bg-terracota border-terracota"
                : "border-areia dark:border-white/20"
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) =>
          d === "" ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              onClick={() =>
                d === "⌫" ? setPinInput((p) => p.slice(0, -1)) : press(d)
              }
              className="w-16 h-16 rounded-full text-xl font-display bg-white/70 dark:bg-white/[0.06] border border-areia/60 dark:border-white/10 active:bg-areia/50"
            >
              {d}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
