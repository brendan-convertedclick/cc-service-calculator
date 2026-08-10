import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import { mColorRoles, radius, fontFamily, elevation, typeScale, gradients } from "./src/styles/tokens";

type TypeStyle = typeof typeScale[keyof typeof typeScale];

const fontSize = Object.fromEntries(
  Object.entries(typeScale).map(([name, s]: [string, TypeStyle]) => {
    const kebab = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    return [
      kebab,
      [
        s.size,
        { lineHeight: s.lineHeight, letterSpacing: s.tracking, fontWeight: String(s.weight) },
      ] as const,
    ];
  })
);

const config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Material 3 role-based colors — synced from Figma variables.
        m: mColorRoles,
      },
      borderRadius: {
        xs: radius.xs,
        sm: radius.sm,
        md: radius.md,
        lg: radius.lg,
        xl: radius.xl,
        full: radius.full,
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
        display: ["var(--font-sans)"],
      },
      fontSize,
      boxShadow: {
        "elev-0": elevation.level0,
        "elev-1": elevation.level1,
        "elev-2": elevation.level2,
        "elev-3": elevation.level3,
        "elev-4": elevation.level4,
        "elev-5": elevation.level5,
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      // Was three hardcoded hex gradients — the only colour left in the whole
      // token pipeline, and therefore unreachable by tokens:sync. Now they come
      // from tokens/base.json like everything else. Values are unchanged.
      backgroundImage: gradients,
    },
  },
  plugins: [animate],
} satisfies Config;

// Unused at runtime but kept to silence noUnusedLocals.
void fontFamily;

export default config;
