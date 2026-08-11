import React, { useState } from "react";
import { cn } from "../../lib/cn";
import { useStatusModules, type StatusModuleDefinition, type StatusModuleSide, type StatusModuleTone } from "./registry";
import "./demo-modules";

const TONES: Record<StatusModuleTone, { closed: string; open: string; edge: string; panel: string }> = {
  neutral: {
    closed: "text-neutral-500 hover:bg-neutral-800/45 hover:text-neutral-300",
    open: "bg-neutral-800 text-neutral-100",
    edge: "border-neutral-600/80 rounded-b-md",
    panel: "border-neutral-600/80 bg-neutral-800 text-neutral-200"
  },
  blue: {
    closed: "text-sky-500/70 hover:bg-sky-950/35 hover:text-sky-300",
    open: "bg-sky-950 text-sky-100",
    edge: "border-sky-700/80 rounded-b-md",
    panel: "border-sky-700/80 bg-sky-950 text-sky-100"
  }
};

interface StatusModuleProps {
  definition: StatusModuleDefinition;
}

const StatusModule: React.FC<StatusModuleProps> = ({ definition }) => {
  const [open, setOpen] = useState(false);
  const { label, side, tone = "neutral", icon, content: Content } = definition;
  const colors = TONES[tone];

  return (
    <span className="relative block h-full">
      <button
        type="button"
        aria-expanded={open}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        style={{ outline: "none", boxShadow: "none", WebkitTapHighlightColor: "transparent" }}
        className={cn(
          "app-no-drag flex h-full appearance-none items-center gap-1.5 border-x border-b border-transparent px-2 text-[10px] transition-colors focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 active:outline-none",
          open ? colors.open : colors.closed,
          open && cn("relative z-[60] -translate-y-px rounded-none", colors.edge)
        )}
      >
        {icon}
        <span>{label}</span>
      </button>
      {open && (
        <span
          className={cn(
            "absolute bottom-full z-50 block min-w-52 max-w-[calc(100vw-1rem)] rounded-t-lg border px-3 py-2.5 text-left shadow-2xl shadow-black/30",
            side === "right" ? "right-0 rounded-bl-lg" : "left-0 rounded-br-lg",
            colors.panel
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
  const left = modules.filter((module) => module.side === "left");
  const right = modules.filter((module) => module.side === "right");

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
