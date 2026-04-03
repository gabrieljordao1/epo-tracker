import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0a",
        surface: "rgba(255,255,255,0.04)",
        card: "rgba(255,255,255,0.06)",
        "card-border": "rgba(255,255,255,0.08)",
        "border-lt": "rgba(255,255,255,0.12)",
        text1: "rgba(255,255,255,0.85)",
        text2: "rgba(255,255,255,0.50)",
        text3: "rgba(255,255,255,0.30)",
        green: "rgb(52,211,153)",
        "green-dim": "rgba(52,211,153,0.12)",
        "green-bdr": "rgba(52,211,153,0.25)",
        amber: "rgb(251,191,36)",
        "amber-dim": "rgba(251,191,36,0.12)",
        "amber-bdr": "rgba(251,191,36,0.25)",
        red: "rgb(248,113,113)",
        "red-dim": "rgba(248,113,113,0.12)",
        "red-bdr": "rgba(248,113,113,0.25)",
        blue: "rgb(144,191,249)",
        purple: "rgb(192,160,255)",
      },
      fontFamily: {
        sans: ['"DM Sans"', "-apple-system", "system-ui", "sans-serif"],
        mono: ['"Roboto Mono"', "monospace"],
      },
      letterSpacing: {
        label: "0.08em",
      },
      backdropBlur: {
        xs: "4px",
      },
    },
  },
  plugins: [],
};
export default config;
