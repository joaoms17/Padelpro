import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Paleta "Contas a Dois"
        creme: "rgb(var(--creme) / <alpha-value>)",
        areia: "rgb(var(--areia) / <alpha-value>)",
        tinta: "rgb(var(--tinta) / <alpha-value>)",
        terracota: "rgb(var(--terracota) / <alpha-value>)",
        petroleo: "rgb(var(--petroleo) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
      },
      borderRadius: {
        card: "1rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(30,43,47,0.04), 0 8px 24px rgba(30,43,47,0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
