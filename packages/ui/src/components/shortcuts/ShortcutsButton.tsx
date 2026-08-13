import React from "react";
import { Keyboard } from "lucide-react";
import { IconButton } from "../ui";
import { useAppStore } from "../../store/app";

export const ShortcutsButton: React.FC = () => {
  const setShortcutsOpen = useAppStore((state) => state.setShortcutsOpen);
  return (
    <div className="app-no-drag">
      <IconButton label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}>
        <Keyboard size={15} />
      </IconButton>
    </div>
  );
};
