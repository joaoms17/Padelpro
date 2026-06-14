import type { Config } from "tailwindcss";

// PadelPro Brand Kit v2 — navy + teal + lime + azul.
// `brand` = teal (primary). The gray scale is remapped to navy tints so every
// existing bg-gray-900 / text-gray-400 / border-gray-700 picks up the new look
// without touching each component.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#00E0A4", // teal-500
          dark: "#00A97C",    // teal-700 (hover)
          light: "#5EEBC4",   // bright teal for text/accents on dark
        },
        navy: {
          950: "#07111F",
          900: "#0B1B2E",
          800: "#10253A",
          700: "#173654",
        },
        // lime — bola, highlights, insights importantes
        accent: {
          DEFAULT: "#E8FF3D",
          soft: "rgba(232,255,61,.12)",
        },
        // azul — estatística, tracking, data viz
        info: {
          DEFAULT: "#54A7FF",
        },
        // Navy-tinted gray scale (keeps light→dark ordering, just teal-navy hue)
        gray: {
          50: "#F8FBFD",
          100: "#F2F8FC",
          200: "#E9F4FA", // slate-100 — bright text
          300: "#C3D2DF",
          400: "#9EB3C7", // slate-300 — secondary text
          500: "#6E8298", // muted text
          600: "#51657A", // slate-600 — dim text/icons
          700: "#173654", // navy-700 — borders
          800: "#10253A", // navy-800 — elevated / inputs / chips
          900: "#0B1B2E", // navy-900 — surface / cards
          950: "#07111F", // navy-950 — app background
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["var(--font-sora)", "var(--font-inter)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "2xl": "18px",
        "3xl": "28px",
      },
    },
  },
  plugins: [],
};

export default config;
