import React, { useState } from "react";
import { cn } from "../../lib/cn";
import { useAppStore } from "../../store/app";
import { useStatusModules, type StatusModuleDefinition } from "./registry";
import "./demo-modules";

interface StatusModuleProps {
  definition: StatusModuleDefinition;
}

const StatusModule: React.FC<StatusModuleProps> = ({ definition }) => {
  const [open, setOpen] = useState(false);
  const { label, side, icon, content: Content } = definition;
  const triggerContent = (
    <>
      {icon}
      <span className="flex min-w-0 items-center">{label}</span>
    </>
  );

  if (!Content) {
    return (
      <span className="relative block h-full">
        <span className="flex h-full items-center gap-1.5 px-2 text-[10px]">
          {triggerContent}
        </span>
      </span>
    );
  }

  return (
    <span className="relative block h-full">
      <button
        type="button"
        aria-expanded={open}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        style={{ outline: "none", boxShadow: "none", WebkitTapHighlightColor: "transparent" }}
        className={cn(
          "app-no-drag flex h-full appearance-none items-center gap-1.5 border-x border-b border-transparent px-2 text-[10px] focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 active:outline-none",
          open
            ? "relative z-[60] -translate-y-px rounded-none bg-neutral-800 text-neutral-100"
            : "text-neutral-500 hover:bg-neutral-800/45 hover:text-neutral-300",
          open && "border-neutral-700/80 rounded-b-md"
        )}
      >
        {triggerContent}
      </button>
      {open && (
        <span
          className={cn(
            "absolute bottom-full z-50 block min-w-52 max-w-[calc(100vw-1rem)] rounded-t-lg border px-3 py-2.5 text-left shadow-2xl shadow-black/30",
            side === "right" ? "right-0 rounded-bl-lg" : "left-0 rounded-br-lg",
            "border-neutral-700/80 bg-neutral-800 text-neutral-200"
          )}
        >
          <Content />
        </span>
      )}
    </span>
  );
};

export const StatusBar: React.FC = () => {
  const modules = useStatusModules();
  const currentProject = useAppStore((state) => state.currentProject);
  const integrations = useAppStore((state) => state.integrations);
  const view = currentProject ? "project" : "empty";
  const visible = modules.filter((module) => {
    const viewEnabled = !module.enabledOn || module.enabledOn.includes(view);
    const integrationEnabled = !module.integration || integrations.some((integration) =>
      integration.id === module.integration && integration.enabled && integration.available
    );
    return viewEnabled && integrationEnabled;
  });
  const left = visible.filter((module) => module.side === "left");
  const right = visible.filter((module) => module.side === "right");

  return (
    <footer className="relative z-20 flex h-7 shrink-0 items-stretch justify-between bg-neutral-900/60 px-1 backdrop-blur-xl">
      <div className="flex items-center">
        {left.map((definition) => <StatusModule key={definition.id} definition={definition} />)}
      </div>
      <div className="flex items-center">
        {right.map((definition) => <StatusModule key={definition.id} definition={definition} />)}
      </div>
    </footer>
  );
};
