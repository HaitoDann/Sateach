// Theme colors are CSS variables (hex), which Tailwind 3 can't apply an opacity
// modifier to. color-mix() makes every `/NN` modifier work on these tokens.
const token = (name) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        background: token("background"),
        foreground: token("foreground"),
        card: token("card"),
        primary: {
          DEFAULT: token("primary"),
          foreground: token("primary-foreground"),
        },
        secondary: {
          DEFAULT: token("secondary"),
          foreground: token("secondary-foreground"),
        },
        muted: {
          DEFAULT: token("muted"),
          foreground: token("muted-foreground"),
        },
        accent: {
          DEFAULT: token("accent"),
          foreground: token("accent-foreground"),
        },
        destructive: {
          DEFAULT: token("destructive"),
          foreground: token("destructive-foreground"),
        },
        // Sat'each identity — a teal ramp built around #00CEC8 (500).
        // Text on light backgrounds uses 700+, fills use 400–500.
        brand: {
          50: "#ecfdfc",
          100: "#cffaf8",
          200: "#a2f3f0",
          300: "#66e6e2",
          400: "#1fd6d0",
          500: "#00cec8",
          600: "#00a8a4",
          700: "#008683",
          800: "#066a68",
          900: "#0a5755",
          950: "#003736",
        },
      },
      fontFamily: {
        sans: ['"Onest Variable"', "system-ui", "sans-serif"],
      },
      transitionTimingFunction: {
        aqua: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 2px)",
        "2xl": "calc(var(--radius) + 4px)",
      },
      keyframes: {
        "view-enter": {
          "0%": { opacity: "0", transform: "scale(0.994)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "item-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "view-enter": "view-enter 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
        "item-in": "item-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) backwards",
      },
    },
  },
  plugins: [],
};
