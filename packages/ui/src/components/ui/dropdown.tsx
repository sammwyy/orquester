import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  /** Tailwind width class for the panel. */
  width?: string;
  className?: string;
}

interface DropdownContextValue {
  close: () => void;
}

const DropdownContext = React.createContext<DropdownContextValue>({ close: () => undefined });

/**
 * Lightweight popover menu: toggles on trigger click, closes on outside click
 * or Escape. Render {@link DropdownItem}/{@link DropdownLabel}/{@link DropdownSeparator}
 * inside.
 */
export const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  children,
  align = "left",
  width = "w-56",
  className
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        className="inline-flex app-no-drag"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full z-50 mt-1 overflow-hidden rounded-md border border-neutral-800",
            "bg-neutral-900 p-1 shadow-xl shadow-black/40 app-no-drag",
            align === "right" ? "right-0" : "left-0",
            width,
            className
          )}
        >
          <DropdownContext.Provider value={{ close }}>{children}</DropdownContext.Provider>
        </div>
      )}
    </div>
  );
};

export interface DropdownItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  /** Keep the menu open after activation (e.g. nested toggles). */
  keepOpen?: boolean;
}

export const DropdownItem: React.FC<DropdownItemProps> = ({
  icon,
  keepOpen,
  className,
  children,
  onClick,
  ...props
}) => {
  const { close } = React.useContext(DropdownContext);
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-300",
        "transition-colors hover:bg-neutral-800 hover:text-neutral-100",
        "disabled:pointer-events-none disabled:opacity-40",
        className
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!keepOpen) {
          close();
        }
      }}
      {...props}
    >
      {icon && <span className="flex h-4 w-4 items-center justify-center text-neutral-500">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
};

export const DropdownLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
    {children}
  </div>
);

export const DropdownSeparator: React.FC = () => (
  <div className="my-1 h-px bg-neutral-800" />
);

export const DropdownEmpty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-2 py-1.5 text-sm italic text-neutral-600">{children}</div>
);
