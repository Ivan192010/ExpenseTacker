/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#4F6BED", light: "#EEF3FF", dark: "#3A52C4" },
        ink: { DEFAULT: "#111827", muted: "#6B7280", faint: "#9CA3AF" },
        surface: "#F5F6FA",
        positive: "#16A34A",
        negative: "#DC2626",
      },
    },
  },
  plugins: [],
};
