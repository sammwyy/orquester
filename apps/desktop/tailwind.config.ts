import type { Config } from "tailwindcss";
import { orquesterPreset } from "../../packages/ui/tailwind-preset";

export default {
  presets: [orquesterPreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {}
  },
  plugins: []
} satisfies Config;
