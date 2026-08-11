import React from "react";
import { Check, Clock, Monitor, Moon, Sun } from "lucide-react";
import { COLOR_SCHEMES, THEME_MODES } from "../../../lib/theme";
import type { BlurStrategy, ThemeMode } from "../../../types";
import { cn } from "../../../lib/cn";
import { OptionCard, Slider, Switch } from "../../ui";
import { useOrquester } from "../../../context/orquester-context";
import { useAppStore } from "../../../store/app";
import { Field, Group, SectionHeading, StackedField } from "./shared";
const BLUR_HINT: Record<BlurStrategy, string> = {
  vibrancy: "Blurred by macOS vibrancy.",
  acrylic: "Blurred by Windows acrylic.",
  kwin: "Blurred by KWin."
};

const MODE_ICON: Record<ThemeMode, React.ReactNode> = {
  system: <Monitor size={13} />,
  light: <Sun size={13} />,
  dark: <Moon size={13} />,
  dynamic: <Clock size={13} />
};

/**
 * A miniature of the app painted with a theme's own variables — the same
 * `[data-scheme][data-mode]` selectors the real chrome uses, so a preview can
 * never drift from the theme it advertises.
 */
const ThemePreview: React.FC<{ scheme: string; mode: "light" | "dark" }> = ({ scheme, mode }) => (
  <span data-scheme={scheme} data-mode={mode} className="flex h-14 w-full bg-neutral-950">
    <span className="flex h-full w-1/3 flex-col gap-1 bg-neutral-900 p-1.5">
      <span className="h-1 w-full rounded-full bg-neutral-700" />
      <span className="h-1 w-3/4 rounded-full bg-neutral-800" />
      <span className="h-1 w-2/3 rounded-full bg-neutral-800" />
    </span>
    <span className="flex h-full flex-1 flex-col gap-1 p-1.5">
      <span className="h-1.5 w-1/2 rounded-full bg-neutral-300" />
      <span className="h-1 w-full rounded-full bg-neutral-700" />
      <span className="h-1 w-4/5 rounded-full bg-neutral-800" />
    </span>
  </span>
);

const ThemeSwatch: React.FC<{ scheme: string; mode: "light" | "dark" }> = ({ scheme, mode }) => (
  <span
    data-scheme={scheme}
    data-mode={mode}
    className="relative flex h-14 w-14 overflow-hidden rounded-full bg-neutral-950 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.18),0_2px_6px_rgb(0_0_0_/_0.25)]"
  >
    <span
      className="absolute inset-0"
      style={{
        background:
          "linear-gradient(135deg, rgb(var(--n-200)) 0%, rgb(var(--n-400)) 30%, rgb(var(--n-700)) 62%, rgb(var(--n-950)) 100%)"
      }}
    />
    <span className="absolute -left-3 -top-4 h-10 w-10 rounded-full bg-white/25 blur-md" />
    <span className="absolute bottom-1.5 right-2 h-2 w-2 rounded-full bg-white/35 blur-[1px]" />
  </span>
);

const ThemeChoice: React.FC<{
  label: string;
  scheme: string;
  mode: "light" | "dark";
  selected: boolean;
  onSelect: () => void;
}> = ({ label, scheme, mode, selected, onSelect }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onSelect}
    className="group relative flex w-20 flex-col items-center gap-2 rounded-lg py-1.5 focus:outline-none focus-visible:bg-neutral-800/60"
  >
    <ThemeSwatch scheme={scheme} mode={mode} />
    <span
      className={cn(
        "absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-md border text-[11px] transition-colors",
        selected
          ? "border-neutral-100 bg-neutral-100 text-neutral-900"
          : "border-neutral-600 bg-neutral-900/70 text-transparent group-hover:border-neutral-400"
      )}
    >
      <Check size={12} strokeWidth={3} />
    </span>
    <span
      className={cn(
        "text-[11px] transition-colors",
        selected ? "text-neutral-100" : "text-neutral-400 group-hover:text-neutral-200"
      )}
    >
      {label}
    </span>
  </button>
);

export const AppearanceSettings: React.FC = () => {
  const { runtime, windowControls } = useOrquester();
  const appConfig = useAppStore((s) => s.appConfig);
  const updateAppConfig = useAppStore((s) => s.updateAppConfig);
  const capabilities = useAppStore((s) => s.windowCapabilities);
  const resolvedMode = useAppStore((s) => s.resolvedMode);
  const drawsCorners = Boolean(windowControls?.cssRoundedCorners);
  const desktop = runtime === "desktop";
  const canBlur = capabilities.blur !== null;
  const transparent = appConfig.sidebarTransparent && capabilities.transparency;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionHeading title="Theme" description="Choose your visual tone" />
        <div className="flex flex-wrap gap-3">
          {COLOR_SCHEMES.map((scheme) => (
            <ThemeChoice
              key={scheme.id}
              label={scheme.label}
              scheme={scheme.id}
              mode={resolvedMode}
              selected={appConfig.theme === scheme.id}
              onSelect={() => void updateAppConfig({ theme: scheme.id })}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading title="Color Mode" description="System follows the OS · Dynamic follows the time of day" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {THEME_MODES.map((mode) => (
            <OptionCard
              key={mode.id}
              label={mode.label}
              selected={appConfig.themeMode === mode.id}
              onSelect={() => void updateAppConfig({ themeMode: mode.id })}
            >
              <span className="relative block">
                <ThemePreview
                  scheme={appConfig.theme}
                  mode={mode.id === "light" ? "light" : mode.id === "dark" ? "dark" : resolvedMode}
                />
                <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900/80 text-neutral-300 backdrop-blur">
                  {MODE_ICON[mode.id]}
                </span>
              </span>
            </OptionCard>
          ))}
        </div>
      </section>

      {desktop && (
        <Group title="Sidebar">
          <Field
            label="Transparent"
            hint={
              capabilities.transparency
                ? "Let the desktop show through the sidebar."
                : "This window can't show what's behind it."
            }
          >
            <Switch
              checked={transparent}
              disabled={!capabilities.transparency}
              onChange={(checked) => void updateAppConfig({ sidebarTransparent: checked })}
            />
          </Field>

          <StackedField label="Opacity">
            <div className="flex items-center gap-3">
              <Slider
                min={0.3}
                max={1}
                step={0.05}
                value={appConfig.sidebarOpacity}
                disabled={!transparent}
                onChange={(value) => void updateAppConfig({ sidebarOpacity: value })}
              />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-neutral-400">
                {Math.round(appConfig.sidebarOpacity * 100)}%
              </span>
            </div>
          </StackedField>

          <Field
            label="Glass blur"
            hint={
              canBlur
                ? (capabilities.blur && BLUR_HINT[capabilities.blur]) ?? ""
                : "No window blur here — needs macOS, Windows 11 or KDE/KWin."
            }
          >
            <Switch
              checked={appConfig.glassSidebar && canBlur}
              disabled={!canBlur || !transparent}
              onChange={(checked) => void updateAppConfig({ glassSidebar: checked })}
            />
          </Field>
        </Group>
      )}

      <Group title="Window">
        <Field label="Custom titlebar" hint="Frameless window with in-app window controls.">
          <Switch
            checked={appConfig.useTitlebar}
            onChange={(checked) => void updateAppConfig({ useTitlebar: checked })}
          />
        </Field>
        {desktop && (
          <Field
            label="Rounded corners"
            hint={
              drawsCorners
                ? "Rounded while the window floats; square when maximized."
                : "This platform rounds frameless windows itself."
            }
          >
            <Switch
              checked={appConfig.roundedWindow && drawsCorners}
              disabled={!drawsCorners}
              onChange={(checked) => void updateAppConfig({ roundedWindow: checked })}
            />
          </Field>
        )}
      </Group>

      <Group title="Titlebar">
        <Field
          label="Show quota menu"
          hint="Adds a compact live quota menu beside Settings."
        >
          <Switch
            checked={appConfig.showQuotaMenu}
            onChange={(checked) => void updateAppConfig({ showQuotaMenu: checked })}
          />
        </Field>
      </Group>
    </div>
  );
};
