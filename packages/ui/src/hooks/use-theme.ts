import { useEffect } from "react";
import { applyTheme, resolveMode, watchMode } from "../lib/theme";
import { useAppStore } from "../store/app";

/**
 * Keeps the document in sync with the theme settings. "system" re-resolves when
 * the OS flips; "dynamic" is re-checked on a timer so the app follows the time
 * of day on its own. Mount once, at the app root.
 */
export function useTheme(): void {
  const scheme = useAppStore((s) => s.appConfig.theme);
  const themeMode = useAppStore((s) => s.appConfig.themeMode);
  const mode = useAppStore((s) => s.resolvedMode);
  const setResolvedMode = useAppStore((s) => s.setResolvedMode);

  useEffect(() => {
    const sync = () => setResolvedMode(resolveMode(themeMode));
    sync();
    return watchMode(themeMode, sync);
  }, [themeMode, setResolvedMode]);

  useEffect(() => applyTheme(scheme, mode), [scheme, mode]);
}
