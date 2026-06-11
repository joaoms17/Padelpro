import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#16a34a",  // padel green
          dark: "#15803d",
          light: "#bbf7d0",
        },
      },
    },
  },
  plugins: [],
};

export default config;
