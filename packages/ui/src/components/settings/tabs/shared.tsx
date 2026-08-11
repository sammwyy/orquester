import React from "react";
/** iOS-style grouped list: a small caption over a rounded card of rows. */
export const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-1.5">
    <h3 className="px-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
      {title}
    </h3>
    <div className="divide-y divide-neutral-800/80 rounded-xl border border-neutral-800/70 bg-neutral-900/40 px-3">
      {children}
    </div>
  </section>
);

export const SectionHeading: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="flex items-baseline justify-between gap-4 px-1">
    <h3 className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{title}</h3>
    <p className="text-right text-[11px] text-neutral-600">{description}</p>
  </div>
);

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children
}) => (
  <div className="flex items-center justify-between gap-4 py-2.5">
    <div className="min-w-0">
      <p className="text-sm text-neutral-200">{label}</p>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

/** Field whose control needs the full width (option grids, sliders). */
export const StackedField: React.FC<{ label?: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children
}) => (
  <div className="space-y-2.5 py-3">
    {(label || hint) && (
      <div className="min-w-0">
        {label && <p className="text-sm text-neutral-200">{label}</p>}
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
    )}
    {children}
  </div>
);
