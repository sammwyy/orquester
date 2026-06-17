import React from "react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}

/** Centered placeholder used by empty panels across the app. */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
    {icon && <div className="text-neutral-700">{icon}</div>}
    <div className="space-y-1">
      <p className="text-sm font-medium text-neutral-300">{title}</p>
      {description && <p className="max-w-sm text-xs text-neutral-600">{description}</p>}
    </div>
  </div>
);
