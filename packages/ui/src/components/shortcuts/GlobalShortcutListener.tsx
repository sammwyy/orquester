import { useEffect } from "react";
import { useAppStore } from "../../store/app";

/**
 * App-wide shortcuts that aren't already owned by a specific feature
 * component (unlike Ctrl/Cmd+K, which the command palette wires itself).
 * Renders nothing; mount once near the app root.
 */
export const GlobalShortcutListener: React.FC = () => {
  const jumpToAttention = useAppStore((state) => state.jumpToAttention);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setShortcutsOpen = useAppStore((state) => state.setShortcutsOpen);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.ctrlKey && event.shiftKey && key === "a") {
        event.preventDefault();
        jumpToAttention();
      } else if (event.ctrlKey && event.shiftKey && key === "s") {
        event.preventDefault();
        toggleSidebar();
      } else if (event.ctrlKey && event.shiftKey && key === "o") {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (event.key === "F1") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [jumpToAttention, toggleSidebar, setSettingsOpen, setShortcutsOpen]);

  return null;
};
