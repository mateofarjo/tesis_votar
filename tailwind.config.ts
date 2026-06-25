import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      animation: {
        "fade-up": "fadeUp 500ms ease-out both",
        "fade-in": "fadeIn 400ms ease-out both",
        "pulse-soft": "pulseSoft 2.2s ease-in-out infinite",
        "reveal-bar": "revealBar 800ms ease-out both",
        "shimmer": "shimmer 1.6s ease-in-out infinite",
        "spin-slow": "spin 1.4s linear infinite",
        "live-pulse": "livePulse 2s ease-in-out infinite"
      },
      boxShadow: {
        panel: "0 24px 70px rgba(5, 24, 28, 0.12)",
        card: "0 4px 24px rgba(5, 24, 28, 0.07)",
        "card-hover": "0 8px 32px rgba(5, 24, 28, 0.13)"
      },
      colors: {
        "brand-ink": "#082227",
        "brand-line": "#bfd5d0",
        "brand-mint": "#d9f4eb",
        "brand-sand": "#f8f1df",
        "brand-teal": "#0e5f5a",
        "brand-amber": "#d08a18",
        "danger": "#b4412f"
      },
      fontFamily: {
        heading: ["var(--font-heading)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"]
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.6", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.03)" }
        },
        revealBar: {
          "0%": { transform: "scaleX(0)", transformOrigin: "left" },
          "100%": { transform: "scaleX(1)", transformOrigin: "left" }
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" }
        },
        livePulse: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(0.85)" }
        }
      }
    }
  },
  plugins: []
};

export default config;
