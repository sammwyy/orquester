export type ColorScheme = "mono" | "warm" | "slate" | "rose" | "green" | "yellow" | "amethyst";
export type ColorMode = "light" | "dark";
export type NeutralScale = "50" | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900" | "950";

export const COLOR_SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: "mono", label: "Monochrome" },
  { id: "warm", label: "Warm" },
  { id: "slate", label: "Slate" },
  { id: "rose", label: "Rose" },
  { id: "green", label: "Matcha" },
  { id: "yellow", label: "Dune" },
  { id: "amethyst", label: "Amethyst" }
];

const scale = (...values: string[]): Record<NeutralScale, string> => ({
  "50": values[0], "100": values[1], "200": values[2], "300": values[3], "400": values[4],
  "500": values[5], "600": values[6], "700": values[7], "800": values[8], "900": values[9], "950": values[10]
});

/** RGB triplets shared by web CSS and future native renderers. */
export const NEUTRAL_PALETTES: Record<ColorScheme, Record<ColorMode, Record<NeutralScale, string>>> = {
  mono: {
    dark: scale("250 250 250", "245 245 245", "229 229 229", "212 212 212", "163 163 163", "115 115 115", "82 82 82", "64 64 64", "38 38 38", "23 23 23", "10 10 10"),
    light: scale("9 9 11", "24 24 27", "39 39 42", "63 63 70", "100 100 106", "124 124 132", "148 148 156", "208 208 212", "226 226 230", "240 240 243", "252 252 253")
  },
  slate: {
    dark: scale("246 247 248", "231 233 234", "211 214 215", "190 194 195", "158 164 166", "128 136 139", "69 97 116", "48 72 89", "31 49 62", "19 31 42", "11 19 28"),
    light: scale("14 15 16", "27 28 29", "45 46 47", "66 68 69", "94 98 99", "119 124 125", "145 151 152", "200 216 224", "222 235 240", "242 248 250", "250 253 254")
  },
  warm: {
    dark: scale("250 250 249", "245 245 244", "231 229 228", "214 211 209", "168 162 158", "120 113 108", "87 83 78", "68 64 60", "41 37 36", "28 25 23", "14 12 11"),
    light: scale("12 10 9", "28 25 23", "41 37 36", "68 64 60", "106 100 94", "128 121 114", "152 145 138", "214 209 203", "231 227 221", "244 241 237", "253 252 250")
  },
  rose: {
    dark: scale("248 247 247", "235 233 234", "216 214 215", "194 191 192", "165 160 162", "138 132 134", "108 76 84", "79 58 64", "55 43 46", "35 29 30", "20 17 18"),
    light: scale("18 17 18", "31 30 31", "50 49 50", "72 70 71", "100 96 98", "125 120 122", "151 146 148", "226 184 190", "241 218 222", "253 242 243", "255 250 250")
  },
  green: {
    dark: scale("245 247 245", "232 235 232", "213 216 213", "191 195 191", "161 167 162", "132 140 134", "88 105 92", "64 78 68", "44 54 47", "27 34 29", "15 19 16"),
    light: scale("15 17 15", "28 30 29", "46 48 47", "68 71 69", "96 101 98", "121 127 123", "147 153 149", "190 218 200", "218 240 224", "240 250 243", "250 254 251")
  },
  yellow: {
    dark: scale("247 247 243", "235 234 229", "216 214 205", "195 191 177", "165 159 137", "136 130 105", "101 91 56", "75 68 43", "53 48 32", "34 31 21", "20 18 12"),
    light: scale("19 18 14", "32 31 27", "51 50 44", "74 72 62", "101 98 83", "126 122 101", "153 148 123", "231 215 161", "244 235 202", "252 248 232", "255 253 245")
  },
  amethyst: {
    dark: scale("247 246 248", "235 233 237", "216 213 219", "192 187 196", "164 155 173", "134 124 145", "103 77 119", "75 57 88", "52 40 61", "34 27 41", "20 16 25"),
    light: scale("18 17 19", "31 30 32", "50 48 52", "73 70 76", "101 96 106", "126 119 132", "152 145 159", "216 201 224", "235 228 241", "247 244 249", "252 250 253")
  }
};

export const LAYOUT_TOKENS = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { none: 0, sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
  touchTarget: 44,
  mobileBreakpoint: 768,
  zIndex: { base: 0, chrome: 20, dropdown: 50, modal: 100, toast: 150 }
} as const;

export const TYPOGRAPHY_TOKENS = {
  fontSans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontMono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  size: { xs: 11, sm: 12, md: 14, lg: 16, xl: 20 }
} as const;
