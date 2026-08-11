import React from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { AdaptiveMenu, DropdownEmpty, DropdownItem, DropdownLabel, DropdownSeparator } from "../ui";
import { getRegistryIcon } from "../../icons";
import { useRegistry } from "../../hooks";
import { useApi } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";
import type { RegistryEntry } from "../../types";

/**
 * "Open on ▾" — launch the current project folder in a detected IDE, file
 * explorer or browser (real daemon registry). Falls back to the OS default
 * ("Open Directory" / "Default Browser") entries the daemon always provides.
 */
export const OpenOnMenu: React.FC = () => {
  const api = useApi();
  const currentProject = useAppStore((s) => s.currentProject);
  const registry = useRegistry();

  const open = (target: RegistryEntry) => {
    if (currentProject) {
      void api.open(target.id, currentProject.path);
    }
  };

  const section = (label: string, kind: "ide" | "file-explorer" | "browser", entries: RegistryEntry[], emptyText: string) => {
    const available = entries.filter((e) => e.enabled);
    return (
      <>
        <DropdownLabel>{label}</DropdownLabel>
        {available.length === 0 && <DropdownEmpty>{emptyText}</DropdownEmpty>}
        {available.map((entry) => (
          <DropdownItem key={entry.id} icon={getRegistryIcon(kind, entry.id, 14)} onClick={() => open(entry)}>
            {entry.name}
          </DropdownItem>
        ))}
      </>
    );
  };

  const trigger = (
    <span className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-800">
      <ExternalLink size={13} className="text-neutral-500" />
      <span className="hidden sm:inline">Open on</span>
      <ChevronDown size={13} className="text-neutral-500" />
    </span>
  );

  return (
    <AdaptiveMenu title="Open in" trigger={trigger} align="right" width="w-56">
      {section("Editors", "ide", registry.ides, "No editors detected")}
      <DropdownSeparator />
      {section("File explorers", "file-explorer", registry.fileExplorers, "Unavailable")}
      <DropdownSeparator />
      {section("Browsers", "browser", registry.browsers, "No browsers detected")}
    </AdaptiveMenu>
  );
};
