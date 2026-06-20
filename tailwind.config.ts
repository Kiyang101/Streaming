import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // YouTube-style dark theme tokens
        yt: {
          bg: "#0f0f0f",
          surface: "#212121",
          text: "#f1f1f1",
          subtext: "#aaaaaa",
          red: "#ff0000",
          redHover: "#cc0000",
        },
      },
      fontFamily: {
        // Roboto with Arial/system fallbacks (YouTube's default stack)
        sans: [
          "Roboto",
          "Arial",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
