import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface TooltipProps {
  label: string;
  children: React.ReactNode;
  /** Only "right" is implemented (used by the collapsed sidebar rail). */
  side?: "right";
}

const GAP = 8;
const MARGIN = 4;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Hover label rendered in a portal so it is never clipped by `overflow`
 * ancestors (e.g. the icon-only collapsed sidebar). It sits to the right of the
 * anchor, flipping to the left and clamping to the viewport when it would not
 * fit.
 */
export const Tooltip: React.FC<TooltipProps> = ({ label, children }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    // The wrapper is `display: contents`, so it has no box of its own: measure
    // the element it wraps.
    const el = ref.current?.firstElementChild ?? ref.current;
    if (el) {
      setAnchor(el.getBoundingClientRect());
    }
  };

  const hide = () => {
    setAnchor(null);
    setPos(null);
  };

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!anchor || !tip) {
      return;
    }
    const { width, height } = tip.getBoundingClientRect();
    const fitsRight = anchor.right + GAP + width <= window.innerWidth - MARGIN;
    setPos({
      left: fitsRight ? anchor.right + GAP : Math.max(MARGIN, anchor.left - GAP - width),
      top: clamp(
        anchor.top + anchor.height / 2 - height / 2,
        MARGIN,
        window.innerHeight - height - MARGIN
      )
    });
  }, [anchor]);

  return (
    <span ref={ref} className="contents" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {anchor &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos?.top ?? anchor.top,
              left: pos?.left ?? anchor.right + GAP,
              // Hidden for the measuring pass so it never flashes at the wrong spot.
              visibility: pos ? "visible" : "hidden"
            }}
            className="pointer-events-none z-[120] max-w-[240px] truncate rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 shadow-lg"
          >
            {label}
          </div>,
          document.body
        )}
    </span>
  );
};
