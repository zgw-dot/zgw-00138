/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        crane: {
          bg: "#0A1628",
          panel: "#0F1B2D",
          border: "#1E3A5F",
          text: "#8BA4C7",
          muted: "#5A7A9E",
          accent: "#FF6B35",
          danger: "#E53E3E",
          success: "#38A169",
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "monospace"],
        sans: ['"Noto Sans SC"', "sans-serif"],
      },
    },
  },
  plugins: [],
};
