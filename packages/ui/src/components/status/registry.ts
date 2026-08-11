import React, { useSyncExternalStore } from "react";

export type StatusModuleSide = "left" | "right";
export type StatusModuleTone = "neutral" | "blue";

export interface StatusModuleDefinition {
  id: string;
  label: React.ReactNode;
  side: StatusModuleSide;
  tone?: StatusModuleTone;
  icon?: React.ReactNode;
  content: React.ComponentType;
}

const modules = new Map<string, StatusModuleDefinition>();
let snapshot: readonly StatusModuleDefinition[] = [];
const listeners = new Set<() => void>();

const publish = (): void => {
  snapshot = [...modules.values()];
  listeners.forEach((listener) => listener());
};

export function registerStatusModule(definition: StatusModuleDefinition): () => void {
  modules.set(definition.id, definition);
  publish();
  return () => {
    if (modules.get(definition.id) === definition) {
      modules.delete(definition.id);
      publish();
    }
  };
}

export function useStatusModules(): readonly StatusModuleDefinition[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );
}
