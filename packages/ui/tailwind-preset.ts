import type { Config } from "tailwindcss";

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/**
 * The `neutral` scale every component paints with, resolved from the CSS
 * variables in globals.css. Swapping a theme is swapping those variables —
 * utilities like `bg-neutral-900/40` keep working, alpha included.
 */
const neutral = Object.fromEntries(
  STEPS.map((step) => [step, `rgb(var(--n-${step}) / <alpha-value>)`])
);

export const orquesterPreset = {
  content: [],
  theme: {
    extend: {
      colors: { neutral }
    }
  }
} satisfies Config;

export default orquesterPreset;
