import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/** Fixed-viewport coordinates for the portaled panel. */
interface PanelPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  maxHeight: number;
}

const GAP = 4;
const MARGIN = 8;

/**
 * Lightweight popover menu. The panel is rendered in a portal on `document.body`
 * with fixed positioning derived from the trigger, so it never gets clipped or
 * pushed around by `overflow`/flex ancestors (e.g. the scrollable tab strip).
 * Closes on outside click or Escape.
 */
export const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  children,
  align = "left",
  width = "w-56",
  className
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    // Flip upward when there isn't room below (e.g. the sidebar-footer switcher).
    const openUp = spaceBelow < 280 && spaceAbove > spaceBelow;

    const vertical = openUp
      ? { bottom: window.innerHeight - rect.top + GAP }
      : { top: rect.bottom + GAP };
    const horizontal =
      align === "right" ? { right: window.innerWidth - rect.right } : { left: rect.left };

    setPosition({
      ...vertical,
      ...horizontal,
      maxHeight: Math.max(120, (openUp ? spaceAbove : spaceBelow) - GAP)
    });
  }, [align]);

  // Position before paint to avoid a flash at the wrong spot.
  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const onReflow = () => updatePosition();

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReflow);
    // Reposition (capture phase) when any ancestor scrolls.
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex app-no-drag"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {trigger}
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{
              position: "fixed",
              top: position.top,
              bottom: position.bottom,
              left: position.left,
              right: position.right,
              maxHeight: position.maxHeight
            }}
            className={cn(
              "z-50 overflow-y-auto rounded-md border border-neutral-800",
              "bg-neutral-900 p-1 shadow-xl shadow-black/40 app-no-drag",
              width,
              className
            )}
          >
            <DropdownContext.Provider value={{ close }}>{children}</DropdownContext.Provider>
          </div>,
          document.body
        )}
    </>
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
