import React from "react";
import { ChevronDown, ExternalLink, FolderOpen } from "lucide-react";
import { Dropdown, DropdownEmpty, DropdownItem, DropdownLabel, DropdownSeparator } from "../ui";
import { useOpenTargets } from "../../hooks";
import type { OpenTargetSummary } from "../../types";

/**
 * "Open on ▾" — launch the current project folder in an IDE or the OS file
 * explorer. Skeleton: selecting a target is a no-op placeholder (the daemon
 * launch endpoint is not wired yet).
 */
export const OpenOnMenu: React.FC = () => {
  const { data: targets, loading } = useOpenTargets();

  const ides = targets.filter((t) => t.kind === "ide");
  const tools = targets.filter((t) => t.kind !== "ide");

  // TODO: call system service to actually launch the target via the daemon.
  const open = (target: OpenTargetSummary) => {
    console.info(`[orquester] open project on "${target.id}" (not yet implemented)`);
  };

  const trigger = (
    <span className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-neutral-300 hover:bg-neutral-800">
      <ExternalLink size={13} className="text-neutral-500" />
      Open on
      <ChevronDown size={13} className="text-neutral-500" />
    </span>
  );

  return (
    <Dropdown trigger={trigger} align="right" width="w-52">
      <DropdownLabel>Editors</DropdownLabel>
      {loading && <DropdownEmpty>Loading…</DropdownEmpty>}
      {!loading && ides.length === 0 && <DropdownEmpty>No editors detected</DropdownEmpty>}
      {ides.map((target) => (
        <DropdownItem
          key={target.id}
          icon={<ExternalLink size={14} />}
          disabled={!target.available}
          onClick={() => open(target)}
        >
          {target.name}
        </DropdownItem>
      ))}

      {tools.length > 0 && (
        <>
          <DropdownSeparator />
          {tools.map((target) => (
            <DropdownItem
              key={target.id}
              icon={<FolderOpen size={14} />}
              disabled={!target.available}
              onClick={() => open(target)}
            >
              {target.name}
            </DropdownItem>
          ))}
        </>
      )}
    </Dropdown>
  );
};
