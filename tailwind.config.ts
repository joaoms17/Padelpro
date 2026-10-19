import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Paleta "Contas a Dois"
        creme: "#F6F1EA",
        areia: "#EAE1D3",
        tinta: "#1E2B2F",
        terracota: "#A64B25",
        petroleo: "#2E6B66",
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["'DM Sans'", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "1.25rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(30,43,47,0.04), 0 8px 24px rgba(30,43,47,0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
