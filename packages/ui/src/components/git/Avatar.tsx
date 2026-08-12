import React from "react";
import { hashIndex, initials } from "./avatar-helpers";
import { laneColor } from "./graph";

/** Colored-initials avatar; the color is hashed from the name so it stays consistent — and matches the same palette the graph lanes use, tying rows and lines together. */
export const Avatar: React.FC<{ name: string; size?: number; className?: string }> = ({ name, size = 20, className }) => (
  <span
    className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-neutral-900 ${className ?? ""}`}
    style={{ width: size, height: size, fontSize: Math.round(size * 0.42), backgroundColor: laneColor(hashIndex(name, 8)) }}
  >
    {initials(name)}
  </span>
);
